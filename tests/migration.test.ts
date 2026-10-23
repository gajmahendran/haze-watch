import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Observation } from "@/lib/domain/schemas";
import { CONFLICT, fromRow, TABLE, toRow } from "@/lib/store/supabase";

/**
 * Runs the real migration in an embedded PostgreSQL 17 (PGlite) and checks that the constraints the
 * pipeline relies on hold, and that the app's row mapping matches the schema exactly.
 */

const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "0001_init.sql"), "utf8");
let db: PGlite;

const station = { id: "sg-nea-air:west", provider_id: "sg-nea-air", external_id: "west", name: "West region, Singapore", country_code: "SG", kind: "region_aggregate", latitude: 1.35735, longitude: 103.7, area: "Singapore" };

const psi: Observation = {
  kind: "index", providerId: "sg-nea-air", stationId: "sg-nea-air:west", countryCode: "SG",
  observedAtUtc: "2026-10-20T13:00:00.000Z", retrievedAtUtc: "2026-10-20T13:10:00.000Z",
  original: { value: 142, unit: null, timestamp: "2026-10-20T21:00:00+08:00", timezone: "+08:00" },
  quality: "unvalidated", provenance: "provider", sourceUrl: "https://api-open.data.gov.sg/v2/real-time/api/psi?date=2026-10-20",
  indexId: "SG_PSI", value: 142, averagingPeriod: "PT24H", dominantPollutant: null,
};
const pm: Observation = {
  ...psi, kind: "concentration", pollutant: "PM2.5", unit: "µg/m³", value: null, averagingPeriod: "PT1H",
  original: { value: null, unit: "µg/m³", timestamp: "2026-10-20T21:00:00+08:00", timezone: "+08:00" },
} as Observation;
const wind: Observation = {
  ...psi, kind: "weather", parameter: "wind_speed", unit: "m/s", value: 5.14, averagingPeriod: "PT10M",
  original: { value: 10, unit: "knots", timestamp: "2026-10-20T21:00:00+08:00", timezone: "+08:00" },
} as Observation;

async function insert(table: string, row: Record<string, unknown>, conflict?: string) {
  const cols = Object.keys(row);
  const params = cols.map((_, i) => `$${i + 1}`).join(",");
  const onConflict = conflict ? ` on conflict (${conflict}) do nothing` : "";
  return db.query(`insert into ${table} (${cols.join(",")}) values (${params})${onConflict}`, Object.values(row));
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SQL);
  await insert("stations", station);
}, 60_000);

describe("database migration", () => {
  it("creates every table and can be run twice", async () => {
    await db.exec(SQL);
    const r = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by 1");
    expect(r.rows.map((x) => x.table_name)).toEqual(
      expect.arrayContaining(["countries", "stations", "index_observations", "pollutant_measurements", "weather_observations", "hotspot_detections", "haze_events", "research_documents", "ingestion_logs", "data_sources", "normalised_values", "regions"]),
    );
    expect((await db.query<{ n: number }>("select count(*)::int as n from countries")).rows[0]!.n).toBe(10);
  });

  it("accepts the app's own row mapping for every observation kind", async () => {
    for (const o of [psi, pm, wind]) await insert(TABLE[o.kind], toRow(o), CONFLICT[o.kind]);
    const row = (await db.query<Record<string, unknown>>("select * from weather_observations")).rows[0]!;
    expect(row.original_value).toBe("10");
    expect(row.original_unit).toBe("knots");
    expect(Number(row.value)).toBeCloseTo(5.14);
  });

  it("round-trips rows back into valid observations, keeping nulls as nulls", async () => {
    const r = (await db.query<Record<string, unknown>>("select * from pollutant_measurements")).rows[0]!;
    const o = fromRow("concentration", r);
    expect(o).not.toBeNull();
    expect(o!.value).toBeNull();
    expect(o!.original.timestamp).toBe("2026-10-20T21:00:00+08:00");
  });

  it("ignores a repeated ingestion of the same reading (natural key)", async () => {
    await insert(TABLE.index, toRow(psi), CONFLICT.index);
    await insert(TABLE.index, toRow(psi), CONFLICT.index);
    expect((await db.query<{ n: number }>("select count(*)::int as n from index_observations")).rows[0]!.n).toBe(1);
  });

  it("rejects an index that is not on the registry, so no 'AQI' column can appear", async () => {
    await expect(insert(TABLE.index, { ...toRow(psi), index_id: "US_AQI", observed_at: "2026-10-20T14:00:00Z" })).rejects.toThrow(/check constraint/);
  });

  it("rejects negative concentrations, unknown units and invalid provenance", async () => {
    const base = { ...toRow(pm), observed_at: "2026-10-20T15:00:00Z" };
    await expect(insert(TABLE.concentration, { ...base, value: -1 })).rejects.toThrow(/check constraint/);
    await expect(insert(TABLE.concentration, { ...base, unit: "AQI" })).rejects.toThrow(/check constraint/);
    await expect(insert(TABLE.concentration, { ...base, provenance: "guess" })).rejects.toThrow(/check constraint/);
  });

  it("only allows satellite thermal anomalies in the hotspot table", async () => {
    const h = { id: "N20-1", provider_id: "nasa-firms-viirs", latitude: 1, longitude: 103, acquired_at: "2026-10-20T05:45:00Z", confidence_scale: "categorical", retrieved_at: "2026-10-20T06:00:00Z", provenance: "provider", source_url: "https://firms.example/" };
    await insert("hotspot_detections", h);
    await expect(insert("hotspot_detections", { ...h, id: "N20-2", kind: "confirmed_fire" })).rejects.toThrow(/check constraint/);
  });

  it("hides demo rows and ingestion logs from the public role", async () => {
    await insert(TABLE.index, { ...toRow(psi), provenance: "demo", observed_at: "2026-10-20T16:00:00Z" });
    await insert("ingestion_logs", { provider_id: "sg-nea-air", started_at: "2026-10-20T13:00:00Z", finished_at: "2026-10-20T13:00:01Z", status: "success" });
    await db.exec("do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;");
    await db.exec("grant select on all tables in schema public to anon");
    await db.exec("set role anon");
    try {
      const obs = await db.query<{ provenance: string }>("select provenance from index_observations");
      expect(obs.rows.every((r) => r.provenance === "provider")).toBe(true);
      expect((await db.query("select * from ingestion_logs")).rows).toHaveLength(0);
      await expect(db.query("insert into countries (code, name, timezone) values ('XX','X','UTC')")).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });
});

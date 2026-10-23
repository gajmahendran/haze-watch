import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  observationSchema,
  stationSchema,
  type Hotspot,
  type IngestionLog,
  type Observation,
  type Station,
} from "../domain/schemas";
import type { ProviderEnv } from "../providers/types";
import { isKnownTimezone, ZONES } from "../domain/time";

/**
 * Optional persistence (Supabase / PostgreSQL). Schema: supabase/migrations/0001_init.sql.
 *
 * Enabled only when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. The service role key is a
 * server secret: this module imports "server-only" so it can never be bundled for the browser.
 *
 * Writes are upserts on the natural keys, so re-ingesting the same payload never duplicates rows.
 * Original source values are stored next to normalised values and never overwritten by them.
 */

let client: SupabaseClient | null = null;

export function isPersistenceConfigured(env: ProviderEnv): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function db(env: ProviderEnv): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export const TABLE: Record<Observation["kind"], string> = {
  index: "index_observations",
  concentration: "pollutant_measurements",
  weather: "weather_observations",
};

export const CONFLICT: Record<Observation["kind"], string> = {
  index: "provider_id,station_id,observed_at,index_id,averaging_period",
  concentration: "provider_id,station_id,observed_at,pollutant,averaging_period",
  weather: "provider_id,station_id,observed_at,parameter,averaging_period",
};

export function toRow(o: Observation): Record<string, unknown> {
  const common = {
    provider_id: o.providerId,
    station_id: o.stationId,
    country_code: o.countryCode,
    observed_at: o.observedAtUtc,
    retrieved_at: o.retrievedAtUtc,
    averaging_period: o.averagingPeriod,
    value: o.value,
    original_value: o.original.value === null ? null : String(o.original.value),
    original_unit: o.original.unit,
    source_timestamp: o.original.timestamp,
    source_timezone: o.original.timezone,
    quality: o.quality,
    provenance: o.provenance,
    source_url: o.sourceUrl,
  };
  if (o.kind === "index") return { ...common, index_id: o.indexId, dominant_pollutant: o.dominantPollutant };
  if (o.kind === "concentration") return { ...common, pollutant: o.pollutant, unit: o.unit };
  return { ...common, parameter: o.parameter, unit: o.unit };
}

export function fromRow(kind: Observation["kind"], r: Record<string, unknown>): Observation | null {
  const original = {
    value: r.original_value === null || r.original_value === undefined ? null : Number.isFinite(Number(r.original_value)) ? Number(r.original_value) : String(r.original_value),
    unit: (r.original_unit as string | null) ?? null,
    timestamp: String(r.source_timestamp),
    timezone: String(r.source_timezone),
  };
  const base = {
    kind,
    providerId: r.provider_id,
    stationId: r.station_id,
    countryCode: r.country_code,
    observedAtUtc: new Date(String(r.observed_at)).toISOString(),
    retrievedAtUtc: new Date(String(r.retrieved_at)).toISOString(),
    original,
    quality: r.quality,
    provenance: r.provenance,
    sourceUrl: r.source_url,
    averagingPeriod: r.averaging_period,
    value: r.value === null ? null : Number(r.value),
  };
  const candidate =
    kind === "index"
      ? { ...base, indexId: r.index_id, dominantPollutant: r.dominant_pollutant ?? null }
      : kind === "concentration"
        ? { ...base, pollutant: r.pollutant, unit: r.unit }
        : { ...base, parameter: r.parameter, unit: r.unit };
  const parsed = observationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export async function upsertStations(env: ProviderEnv, stations: readonly Station[]): Promise<void> {
  if (!isPersistenceConfigured(env) || stations.length === 0) return;
  const rows = stations.map((s) => ({
    id: s.id,
    provider_id: s.providerId,
    external_id: s.externalId,
    name: s.name,
    country_code: s.countryCode,
    kind: s.kind,
    latitude: s.latitude,
    longitude: s.longitude,
    area: s.area,
  }));
  const { error } = await db(env).from("stations").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`stations upsert failed: ${error.message}`);
}

/** Inserts new observations; existing natural keys are ignored. Returns the number of rows sent. */
export async function upsertObservations(env: ProviderEnv, observations: readonly Observation[]): Promise<number> {
  if (!isPersistenceConfigured(env) || observations.length === 0) return 0;
  let sent = 0;
  for (const kind of ["index", "concentration", "weather"] as const) {
    const rows = observations.filter((o) => o.kind === kind).map(toRow);
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await db(env).from(TABLE[kind]).upsert(batch, { onConflict: CONFLICT[kind], ignoreDuplicates: true });
      if (error) throw new Error(`${TABLE[kind]} upsert failed: ${error.message}`);
      sent += batch.length;
    }
  }
  return sent;
}

export async function upsertHotspots(env: ProviderEnv, hotspots: readonly Hotspot[]): Promise<number> {
  if (!isPersistenceConfigured(env) || hotspots.length === 0) return 0;
  const rows = hotspots.map((h) => ({
    id: h.id,
    provider_id: h.providerId,
    latitude: h.latitude,
    longitude: h.longitude,
    acquired_at: h.acquiredAtUtc,
    satellite: h.satellite,
    instrument: h.instrument,
    confidence_raw: h.confidenceRaw,
    confidence_scale: h.confidenceScale,
    frp_mw: h.frpMegawatts,
    day_night: h.dayNight,
    country_code: h.countryCode,
    retrieved_at: h.retrievedAtUtc,
    provenance: h.provenance,
    source_url: h.sourceUrl,
  }));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db(env).from("hotspot_detections").upsert(rows.slice(i, i + 1000), { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`hotspot upsert failed: ${error.message}`);
  }
  return rows.length;
}

export async function insertIngestionLog(env: ProviderEnv, log: IngestionLog): Promise<void> {
  if (!isPersistenceConfigured(env)) return;
  const { error } = await db(env).from("ingestion_logs").insert({
    provider_id: log.providerId,
    started_at: log.startedAtUtc,
    finished_at: log.finishedAtUtc,
    status: log.status,
    http_status: log.httpStatus,
    stations_seen: log.stationsSeen,
    inserted: log.inserted,
    duplicates: log.duplicates,
    conflicts: log.conflicts,
    invalid_items: log.invalidItems,
    attempts: log.attempts,
    message: log.message,
  });
  if (error) console.warn(`[store] ingestion log insert failed: ${error.message}`);
}

export async function readHistoryFromStore(
  env: ProviderEnv,
  q: { providerId: string; stationId: string; metricKey: string; averagingPeriod: string; from: string; to: string; zone: string },
): Promise<{ station: Station | null; observations: Observation[] } | null> {
  if (!isPersistenceConfigured(env)) return null;
  const [kindPart, metric] = q.metricKey.split(":") as [string, string];
  const kind = kindPart === "index" ? "index" : kindPart === "concentration" ? "concentration" : kindPart === "weather" ? "weather" : null;
  if (!kind || !metric) return null;
  const offsetMs = (isKnownTimezone(q.zone) ? ZONES[q.zone].offsetMinutes : 0) * 60_000;
  const fromIso = new Date(Date.parse(`${q.from}T00:00:00Z`) - offsetMs).toISOString();
  const toIso = new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000 - offsetMs).toISOString();
  const metricColumn = kind === "index" ? "index_id" : kind === "concentration" ? "pollutant" : "parameter";

  const { data, error } = await db(env)
    .from(TABLE[kind])
    .select("*")
    .eq("provider_id", q.providerId)
    .eq("station_id", q.stationId)
    .eq(metricColumn, metric)
    .eq("averaging_period", q.averagingPeriod)
    .gte("observed_at", fromIso)
    .lt("observed_at", toIso)
    .order("observed_at", { ascending: true })
    .limit(20_000);
  if (error) throw new Error(error.message);
  const observations = (data ?? []).map((r) => fromRow(kind, r as Record<string, unknown>)).filter((o): o is Observation => o !== null);

  const { data: st } = await db(env).from("stations").select("*").eq("id", q.stationId).maybeSingle();
  const station = st
    ? stationSchema.safeParse({
        id: st.id,
        providerId: st.provider_id,
        externalId: st.external_id,
        name: st.name,
        countryCode: st.country_code,
        kind: st.kind,
        latitude: st.latitude,
        longitude: st.longitude,
        area: st.area,
      })
    : null;
  return { station: station?.success ? station.data : null, observations };
}

import { describe, expect, it } from "vitest";
import { escapeCsvCell, exportFilename, observationsToCsv, toCsv } from "@/lib/domain/csv";
import type { Observation, Station } from "@/lib/domain/schemas";
import { bucketSeries, comparePeriods, summarise } from "@/lib/domain/stats";

describe("missing data is never zero", () => {
  it("excludes nulls from statistics but keeps genuine zeros", () => {
    const s = summarise([
      { t: "2026-10-01T00:00:00Z", v: 0 },
      { t: "2026-10-01T01:00:00Z", v: null },
      { t: "2026-10-01T02:00:00Z", v: 10 },
      { t: "2026-10-01T03:00:00Z", v: undefined },
    ]);
    expect(s.count).toBe(2);
    expect(s.missing).toBe(2);
    expect(s.mean).toBe(5);
    expect(s.min).toBe(0);
    expect(s.coverage).toBe(0.5);
  });

  it("gives an empty bucket a null mean, not zero", () => {
    expect(summarise([{ t: "2026-10-01T00:00:00Z", v: null }]).mean).toBeNull();
    expect(summarise([]).coverage).toBeNull();
  });

  it("reports the earliest peak on ties", () => {
    expect(
      summarise([
        { t: "2026-10-01T05:00:00Z", v: 90 },
        { t: "2026-10-01T02:00:00Z", v: 90 },
      ]).peak,
    ).toEqual({ t: "2026-10-01T02:00:00Z", v: 90 });
  });
});

describe("daily and monthly summaries", () => {
  it("buckets by local day and flags incomplete days", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      t: new Date(Date.UTC(2026, 9, 21, 16) + i * 3_600_000).toISOString(), // starts 00:00 SGT on 22 Oct
      v: i % 5 === 0 ? null : 50 + i,
    }));
    const days = bucketSeries(points, "day", "Asia/Singapore", { intervalMinutes: 60 });
    expect(days.map((d) => d.key)).toEqual(["2026-10-22", "2026-10-23"]);
    expect(days[0]!.total).toBe(24);
    expect(days[0]!.expected).toBe(24);
    expect(days[1]!.incomplete).toBe(true);
    expect(days[0]!.mean).not.toBe(0);
  });

  it("compares two periods and states the caveats", () => {
    const a = [{ t: "a", v: 40 }, { t: "b", v: 60 }];
    const b = [{ t: "c", v: 75 }, { t: "d", v: null }];
    const c = comparePeriods(a, b);
    expect(c.meanDelta).toBe(25);
    expect(c.meanDeltaPercent).toBe(50);
    expect(c.caveats.join(" ")).toMatch(/Period B is missing 1 of 2/);
  });
});

describe("CSV export", () => {
  it("writes missing values as empty cells and neutralises formulas", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(Number.NaN)).toBe("");
    expect(escapeCsvCell(0)).toBe("0");
    expect(escapeCsvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(escapeCsvCell('He said "hi", twice')).toBe('"He said ""hi"", twice"');
  });

  it("keeps original values, units, timezone and provenance in their own columns", () => {
    const station: Station = {
      id: "sg-nea-air:west", providerId: "sg-nea-air", externalId: "west", name: "West region, Singapore",
      countryCode: "SG", kind: "region_aggregate", latitude: 1.35735, longitude: 103.7, area: "Singapore",
    };
    const obs: Observation = {
      kind: "concentration", providerId: "sg-nea-air", stationId: station.id, countryCode: "SG",
      observedAtUtc: "2026-10-22T14:00:00.000Z", retrievedAtUtc: "2026-10-22T14:20:00.000Z",
      original: { value: null, unit: "µg/m³", timestamp: "2026-10-22T22:00:00+08:00", timezone: "+08:00" },
      quality: "unvalidated", provenance: "provider", sourceUrl: "https://api-open.data.gov.sg/v2/real-time/api/pm25",
      pollutant: "PM2.5", value: null, unit: "µg/m³", averagingPeriod: "PT1H",
    };
    const csv = observationsToCsv([obs], new Map([[station.id, station]]));
    const [header, row] = csv.trim().split("\r\n");
    const split = (line: string) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]!).slice(0, -1);
    const cols = split(header!);
    const cells = split(row!);
    expect(cells[cols.indexOf("station_name")]).toBe('"West region, Singapore"');
    const cell = (name: string) => cells[cols.indexOf(name)];
    expect(cell("value")).toBe("");
    expect(cell("metric")).toBe("PM2.5");
    expect(cell("averaging_period")).toBe("PT1H");
    expect(cell("source_timestamp")).toBe("2026-10-22T22:00:00+08:00");
    expect(cell("provenance")).toBe("provider");
  });

  it("prefixes demo exports so they cannot pass as real readings", () => {
    expect(exportFilename({ scope: "West region", from: "2026-10-01", to: "2026-10-07", demo: true })).toBe(
      "DEMO-haze-watch_west-region_2026-10-01_to_2026-10-07.csv",
    );
    expect(toCsv([], [{ header: "a", value: () => 1 }], { bom: true }).startsWith("﻿")).toBe(true);
  });
});

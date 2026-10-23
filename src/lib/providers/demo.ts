import type { ConcentrationObservation, Hotspot, IndexObservation, Observation, Station, WeatherObservation } from "../domain/schemas";
import { countryAt } from "../geo/boundaries";
import { eachDate } from "./sg-nea-air";
import type { AdapterContext, AirProvider, AirResult, HistoryQuery, HotspotProvider } from "./types";

/**
 * DEVELOPMENT FIXTURES. SYNTHETIC. NOT MEASUREMENTS.
 *
 * Enabled only when HAZE_DEMO_MODE=true and NODE_ENV is not "production" (see `isDemoEnabled`).
 * Every station name starts with "DEMO", every record has `provenance: "demo"`, and the UI badges
 * them. They exist so the interface can be developed and tested when real sources are unreachable,
 * and they are never substituted for a real source that fails.
 *
 * Values come from a deterministic formula, so tests and screenshots are repeatable. A few gaps and
 * one deliberately stale station exercise the missing-data and stale-data states.
 */

export const DEMO_AIR_ID = "demo-air";
export const DEMO_HOTSPOTS_ID = "demo-hotspots";
const DEMO_URL = "https://haze-watch.invalid/demo-fixture";

interface DemoStationSpec {
  key: string;
  name: string;
  country: "MY" | "SG";
  lat: number;
  lon: number;
  base: number;
  stale?: boolean;
}

const STATIONS: DemoStationSpec[] = [
  { key: "my-kl", name: "DEMO station, Klang Valley", country: "MY", lat: 3.14, lon: 101.69, base: 62 },
  { key: "my-pg", name: "DEMO station, Penang", country: "MY", lat: 5.4, lon: 100.33, base: 48 },
  { key: "my-jb", name: "DEMO station, Johor Bahru", country: "MY", lat: 1.49, lon: 103.74, base: 71 },
  { key: "my-kch", name: "DEMO station, Kuching", country: "MY", lat: 1.55, lon: 110.34, base: 95 },
  { key: "my-kk", name: "DEMO station, Kota Kinabalu", country: "MY", lat: 5.98, lon: 116.07, base: 35, stale: true },
  { key: "my-kt", name: "DEMO station, Kuala Terengganu", country: "MY", lat: 5.33, lon: 103.14, base: 41 },
  { key: "sg-w", name: "DEMO region, Singapore west", country: "SG", lat: 1.357, lon: 103.7, base: 66 },
  { key: "sg-e", name: "DEMO region, Singapore east", country: "SG", lat: 1.357, lon: 103.94, base: 52 },
];

function station(s: DemoStationSpec): Station {
  return {
    id: `${DEMO_AIR_ID}:${s.key}`,
    providerId: DEMO_AIR_ID,
    externalId: s.key,
    name: s.name,
    countryCode: s.country,
    kind: s.country === "SG" ? "region_aggregate" : "station",
    latitude: s.lat,
    longitude: s.lon,
    area: s.country === "SG" ? "Singapore" : "Malaysia",
  };
}

/** Deterministic pseudo-random in [0, 1) from integers. */
function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= p >>> 16;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function seed(key: string): number {
  return [...key].reduce((n, c) => n * 31 + c.charCodeAt(0), 7) >>> 0;
}

/** Synthetic hourly value. Smooth daily cycle plus a slow multi-day swell. */
export function demoValue(spec: DemoStationSpec, hourMs: number, scale: number): number | null {
  const hours = Math.floor(hourMs / 3_600_000);
  const k = seed(spec.key);
  if (hash(k, hours) < 0.03) return null; // occasional gap, rendered as a gap, never as zero
  const daily = Math.sin(((hours % 24) / 24) * Math.PI * 2 - 1.2) * 0.12;
  const swell = Math.sin(hours / 61 + (k % 13)) * 0.35;
  const noise = (hash(k, hours, 9) - 0.5) * 0.1;
  return Math.max(0, Math.round(spec.base * scale * (1 + daily + swell + noise)));
}

function hourFloor(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

function buildObservations(spec: DemoStationSpec, hourMs: number, retrievedAtUtc: string): Observation[] {
  const observedAtUtc = new Date(hourMs).toISOString();
  const base = {
    providerId: DEMO_AIR_ID,
    stationId: `${DEMO_AIR_ID}:${spec.key}`,
    countryCode: spec.country,
    observedAtUtc,
    retrievedAtUtc,
    quality: "estimated" as const,
    provenance: "demo" as const,
    sourceUrl: DEMO_URL,
  };
  const indexValue = demoValue(spec, hourMs, 1);
  const pm25 = demoValue(spec, hourMs + 1, 0.6);
  const pm10 = demoValue(spec, hourMs + 2, 0.85);
  const original = (v: number | null, unit: string | null) => ({ value: v, unit, timestamp: observedAtUtc, timezone: "UTC" });
  const index: IndexObservation = {
    ...base,
    kind: "index",
    indexId: spec.country === "SG" ? "SG_PSI" : "MY_API",
    value: indexValue,
    averagingPeriod: spec.country === "SG" ? "PT24H" : "PT1H",
    dominantPollutant: null,
    original: original(indexValue, null),
  };
  const c25: ConcentrationObservation = {
    ...base,
    kind: "concentration",
    pollutant: "PM2.5",
    value: pm25,
    unit: "µg/m³",
    averagingPeriod: "PT1H",
    original: original(pm25, "µg/m³"),
  };
  const c10: ConcentrationObservation = {
    ...base,
    kind: "concentration",
    pollutant: "PM10",
    value: pm10,
    unit: "µg/m³",
    averagingPeriod: "PT24H",
    original: original(pm10, "µg/m³"),
  };
  const out: Observation[] = [index, c25, c10];
  if (spec.key === "my-kl" || spec.key === "sg-w") {
    const temp = 26 + Math.round(hash(seed(spec.key), hourMs / 3_600_000, 3) * 60) / 10;
    const w: WeatherObservation = {
      ...base,
      kind: "weather",
      parameter: "temperature",
      value: temp,
      unit: "°C",
      averagingPeriod: "PT1M",
      original: original(temp, "°C"),
    };
    out.push(w);
  }
  return out;
}

function latestFor(ctx: AdapterContext): AirResult {
  const now = hourFloor(ctx.now.getTime());
  const retrievedAtUtc = ctx.now.toISOString();
  const observations = STATIONS.flatMap((s) => buildObservations(s, s.stale ? now - 9 * 3_600_000 : now, retrievedAtUtc));
  return {
    stations: STATIONS.map(station),
    observations,
    invalidItems: 0,
    warnings: ["Development demo mode is on. Readings marked DEMO are synthetic."],
    httpStatus: null,
    attempts: 0,
  };
}

function historyFor(ctx: AdapterContext, query: HistoryQuery): AirResult {
  const specs = query.stationId === "all" ? STATIONS : STATIONS.filter((s) => `${DEMO_AIR_ID}:${s.key}` === query.stationId);
  if (specs.length === 0) return { stations: [], observations: [], invalidItems: 0, warnings: [], httpStatus: null, attempts: 0 };
  const dates = eachDate(query.from, query.to);
  const limit = hourFloor(ctx.now.getTime());
  const observations: Observation[] = [];
  for (const spec of specs) {
    for (const date of dates) {
      const start = Date.parse(`${date}T00:00:00Z`) - 8 * 3_600_000; // local midnight, UTC+8
      for (let h = 0; h < 24; h++) {
        const t = start + h * 3_600_000;
        if (t > limit) break;
        observations.push(...buildObservations(spec, t, ctx.now.toISOString()));
      }
    }
  }
  return { stations: specs.map(station), observations, invalidItems: 0, warnings: [], httpStatus: null, attempts: 0 };
}

const DEMO_META = {
  operator: "Haze Watch development fixtures",
  homepage: "https://haze-watch.invalid/",
  docsUrl: "https://haze-watch.invalid/",
  licence: "Synthetic data, no licence needed",
  attribution: "DEMO data generated by this application. Not measurements.",
  accessMethod: "demo" as const,
  cacheTtlSeconds: 60,
};

export const demoAir: AirProvider = {
  ...DEMO_META,
  kind: "air",
  id: DEMO_AIR_ID,
  name: "DEMO air quality fixtures",
  countries: ["MY", "SG"],
  role: "live",
  expectedIntervalMinutes: 60,
  intervalNote: "Synthetic hourly values for development only.",
  zone: "Asia/Kuala_Lumpur",
  historyChunk: "day",
  maxHistoryDays: 31,
  knownStations: STATIONS.map(station),
  series: [
    { metricKey: "index:MY_API", label: "API (demo)", unitLabel: "index, no unit", averagingPeriod: "PT1H" },
    { metricKey: "index:SG_PSI", label: "24-hour PSI (demo)", unitLabel: "index, no unit", averagingPeriod: "PT24H" },
    { metricKey: "concentration:PM2.5", label: "PM2.5, 1-hour (demo)", unitLabel: "µg/m³", averagingPeriod: "PT1H" },
    { metricKey: "concentration:PM10", label: "PM10, 24-hour (demo)", unitLabel: "µg/m³", averagingPeriod: "PT24H" },
  ],
  connection: () => ({ status: "connected" }),
  async fetchLatest(ctx) {
    return latestFor(ctx);
  },
  async fetchHistory(ctx, query) {
    return historyFor(ctx, query);
  },
};

/** Clusters roughly where dry-season fires are often reported. Shapes only, not real detections. */
const CLUSTERS = [
  { lat: -2.9, lon: 104.6, spread: 0.9, n: 90 },
  { lat: -1.6, lon: 113.9, spread: 1.2, n: 110 },
  { lat: 0.4, lon: 101.6, spread: 0.7, n: 40 },
  { lat: 18.8, lon: 98.9, spread: 1.0, n: 50 },
  { lat: 2.8, lon: 101.4, spread: 0.3, n: 8 },
];

export const demoHotspots: HotspotProvider = {
  ...DEMO_META,
  kind: "hotspots",
  id: DEMO_HOTSPOTS_ID,
  name: "DEMO hotspot fixtures",
  countries: ["MY", "SG", "ID", "BN", "TH", "VN", "PH", "LA", "KH", "MM"],
  role: "hotspots",
  expectedIntervalMinutes: 720,
  intervalNote: "Synthetic detections for development only.",
  connection: () => ({ status: "connected" }),
  async fetchHotspots(ctx, { days }) {
    const now = ctx.now.getTime();
    const hotspots: Hotspot[] = [];
    CLUSTERS.forEach((c, ci) => {
      for (let i = 0; i < c.n * days; i++) {
        const r1 = hash(ci, i, 1);
        const r2 = hash(ci, i, 2);
        const lat = Math.round((c.lat + (r1 - 0.5) * 2 * c.spread) * 1e4) / 1e4;
        const lon = Math.round((c.lon + (r2 - 0.5) * 2 * c.spread) * 1e4) / 1e4;
        const age = Math.floor(hash(ci, i, 3) * days * 24) * 3_600_000 + 2 * 3_600_000;
        const conf = hash(ci, i, 4);
        hotspots.push({
          id: `demo-${ci}-${i}`,
          providerId: DEMO_HOTSPOTS_ID,
          kind: "satellite_thermal_anomaly",
          latitude: lat,
          longitude: lon,
          acquiredAtUtc: new Date(hourFloor(now - age)).toISOString(),
          satellite: "DEMO",
          instrument: "DEMO",
          confidenceRaw: conf < 0.2 ? "low" : conf < 0.85 ? "nominal" : "high",
          confidenceScale: "categorical",
          frpMegawatts: Math.round(hash(ci, i, 5) * 400) / 10,
          dayNight: hash(ci, i, 6) < 0.6 ? "D" : "N",
          countryCode: countryAt(lat, lon),
          retrievedAtUtc: ctx.now.toISOString(),
          provenance: "demo",
          sourceUrl: DEMO_URL,
        });
      }
    });
    return {
      hotspots,
      invalidItems: 0,
      warnings: ["Development demo mode is on. Detections marked DEMO are synthetic."],
      httpStatus: null,
      attempts: 0,
    };
  },
};

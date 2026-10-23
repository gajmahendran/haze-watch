import { z } from "zod";
import type { ConcentrationObservation, IndexObservation, Observation, Pollutant, Station } from "../domain/schemas";
import { parseSourceTimestamp, TimestampError } from "../domain/time";
import { fetchWithRetry, limiterFor, readJson } from "./http";
import {
  PayloadError,
  type AdapterContext,
  type AirProvider,
  type AirResult,
  type HistoryQuery,
  type ProviderEnv,
} from "./types";

/**
 * Singapore National Environment Agency readings via data.gov.sg real-time API v2.
 *
 *   PSI endpoint   https://api-open.data.gov.sg/v2/real-time/api/psi
 *   PM2.5 endpoint https://api-open.data.gov.sg/v2/real-time/api/pm25
 *
 * Both are public and need no key. An optional key (DATA_GOV_SG_API_KEY, sent as `x-api-key`)
 * raises the rate limit from 6 to 12 or 30 calls per 10 seconds. `?date=YYYY-MM-DD` returns the
 * hourly items for one local day.
 *
 * NEA reports five REGIONS, not stations. Each region is placed at NEA's label location and is
 * marked `region_aggregate` so the UI never presents it as a sensor.
 *
 * Fields kept: 24-hour PSI (index), 24-hour PM2.5, 24-hour PM10 and 1-hour PM2.5 (concentrations,
 * µg/m³). Sub-indices and the 8-hour or 1-hour maxima are left out because their averaging
 * definitions need a closer reading of NEA's methodology before they can be labelled precisely.
 *
 * Licence: Singapore Open Data Licence v1.0, attribution required.
 */

export const SG_NEA_AIR_ID = "sg-nea-air";
const BASE = "https://api-open.data.gov.sg/v2/real-time/api";
const DATASET_PAGE = "https://data.gov.sg/datasets/d_e1058d6974c877257e32048ab128ad83/view";

const regionSchema = z.object({
  name: z.string().min(1),
  labelLocation: z.object({ latitude: z.number(), longitude: z.number() }),
});

const itemSchema = z.object({
  date: z.string().optional(),
  timestamp: z.string().min(1),
  updatedTimestamp: z.string().optional(),
  readings: z.record(z.string(), z.record(z.string(), z.number().nullable())),
});

export const neaPayloadSchema = z.object({
  code: z.number(),
  errorMsg: z.string().nullable().optional(),
  data: z
    .object({
      regionMetadata: z.array(regionSchema),
      items: z.array(itemSchema),
    })
    .nullable()
    .optional(),
});

const REGION_ORDER = ["north", "south", "east", "west", "central"];

interface FieldMap {
  field: string;
  build: "index" | "concentration";
  pollutant?: Pollutant;
  averagingPeriod: "PT1H" | "PT24H";
}

const PSI_FIELDS: FieldMap[] = [
  { field: "psi_twenty_four_hourly", build: "index", averagingPeriod: "PT24H" },
  { field: "pm25_twenty_four_hourly", build: "concentration", pollutant: "PM2.5", averagingPeriod: "PT24H" },
  { field: "pm10_twenty_four_hourly", build: "concentration", pollutant: "PM10", averagingPeriod: "PT24H" },
];
const PM25_FIELDS: FieldMap[] = [
  { field: "pm25_one_hourly", build: "concentration", pollutant: "PM2.5", averagingPeriod: "PT1H" },
];

function regionLabel(name: string): string {
  return name === "central" ? "Central region" : `${name[0]!.toUpperCase()}${name.slice(1)} region`;
}

export function regionStation(name: string, lat: number | null, lon: number | null): Station {
  return {
    id: `${SG_NEA_AIR_ID}:${name}`,
    providerId: SG_NEA_AIR_ID,
    externalId: name,
    name: `${regionLabel(name)}, Singapore`,
    countryCode: "SG",
    kind: "region_aggregate",
    latitude: lat,
    longitude: lon,
    area: "Singapore",
  };
}

/**
 * Converts one NEA payload into canonical stations and observations.
 * Regions listed in metadata but missing a value produce a `null` observation, never a zero.
 */
export function parseNeaPayload(
  raw: unknown,
  endpoint: "psi" | "pm25",
  meta: { retrievedAtUtc: string; sourceUrl: string },
): AirResult {
  const parsed = neaPayloadSchema.safeParse(raw);
  if (!parsed.success) throw new PayloadError(SG_NEA_AIR_ID, parsed.error.issues[0]?.message ?? "schema mismatch");
  if (parsed.data.code !== 0) {
    throw new PayloadError(SG_NEA_AIR_ID, `API code ${parsed.data.code}: ${parsed.data.errorMsg || "no message"}`);
  }
  const data = parsed.data.data;
  if (!data) throw new PayloadError(SG_NEA_AIR_ID, "missing data object");

  const stations = data.regionMetadata
    .map((r) => regionStation(r.name, r.labelLocation.latitude, r.labelLocation.longitude))
    .sort((a, b) => REGION_ORDER.indexOf(a.externalId) - REGION_ORDER.indexOf(b.externalId));
  const regionNames = stations.map((s) => s.externalId);

  const fields = endpoint === "psi" ? PSI_FIELDS : PM25_FIELDS;
  const observations: Observation[] = [];
  const warnings: string[] = [];
  let invalidItems = 0;

  for (const item of data.items) {
    let ts;
    try {
      ts = parseSourceTimestamp(item.timestamp, "Asia/Singapore");
    } catch (error) {
      invalidItems += 1;
      warnings.push(error instanceof TimestampError ? error.message : "Unparseable timestamp");
      continue;
    }
    for (const f of fields) {
      const values = item.readings[f.field];
      if (!values) {
        warnings.push(`Field ${f.field} missing from item at ${item.timestamp}.`);
        continue;
      }
      for (const region of regionNames) {
        const rawValue = region in values ? values[region] : undefined;
        const value = typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : null;
        if (rawValue !== undefined && rawValue !== null && value === null) invalidItems += 1;
        const base = {
          providerId: SG_NEA_AIR_ID,
          stationId: `${SG_NEA_AIR_ID}:${region}`,
          countryCode: "SG" as const,
          observedAtUtc: ts.utcIso,
          retrievedAtUtc: meta.retrievedAtUtc,
          original: {
            value: rawValue ?? null,
            unit: f.build === "index" ? null : "µg/m³",
            timestamp: ts.sourceTimestamp,
            timezone: ts.sourceTimezone,
          },
          quality: "unvalidated" as const,
          provenance: "provider" as const,
          sourceUrl: meta.sourceUrl,
          averagingPeriod: f.averagingPeriod,
        };
        if (f.build === "index") {
          const o: IndexObservation = { ...base, kind: "index", indexId: "SG_PSI", value, dominantPollutant: null };
          observations.push(o);
        } else {
          const o: ConcentrationObservation = { ...base, kind: "concentration", pollutant: f.pollutant!, value, unit: "µg/m³" };
          observations.push(o);
        }
      }
    }
  }

  return { stations, observations, invalidItems, warnings, httpStatus: 200, attempts: 1 };
}

function headers(env: ProviderEnv): Record<string, string> {
  return env.DATA_GOV_SG_API_KEY ? { "x-api-key": env.DATA_GOV_SG_API_KEY } : {};
}

function limiter(env: ProviderEnv) {
  // Published limits per 10 s: 6 without a key, 12 with a developer key. Leave one call of headroom.
  return limiterFor("api-open.data.gov.sg", env.DATA_GOV_SG_API_KEY ? 11 : 5, 10_000);
}

async function fetchEndpoint(ctx: AdapterContext, endpoint: "psi" | "pm25", date?: string): Promise<AirResult> {
  const url = `${BASE}/${endpoint}${date ? `?date=${date}` : ""}`;
  const { response, attempts } = await fetchWithRetry(url, {
    headers: headers(ctx.env),
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
    retries: ctx.retries,
    limiter: ctx.fetchImpl ? undefined : limiter(ctx.env),
  });
  const json = await readJson(response, url);
  const result = parseNeaPayload(json, endpoint, { retrievedAtUtc: ctx.now.toISOString(), sourceUrl: url });
  return { ...result, httpStatus: response.status, attempts };
}

export function mergeResults(results: AirResult[]): AirResult {
  const stations = new Map<string, Station>();
  for (const r of results) for (const s of r.stations) if (!stations.has(s.id)) stations.set(s.id, s);
  return {
    stations: [...stations.values()],
    observations: results.flatMap((r) => r.observations),
    invalidItems: results.reduce((n, r) => n + r.invalidItems, 0),
    warnings: results.flatMap((r) => r.warnings),
    httpStatus: results.at(-1)?.httpStatus ?? null,
    attempts: results.reduce((n, r) => n + r.attempts, 0),
  };
}

/** Each local date in [from, to], inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out;
  for (let t = start; t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const sgNeaAir: AirProvider = {
  kind: "air",
  id: SG_NEA_AIR_ID,
  name: "Singapore PSI and PM2.5 (NEA)",
  operator: "National Environment Agency, Singapore, via data.gov.sg",
  homepage: "https://www.haze.gov.sg/",
  docsUrl: DATASET_PAGE,
  licence: "Singapore Open Data Licence v1.0",
  attribution:
    "Contains information from PSI and PM2.5 readings accessed from data.gov.sg, which is made available under the terms of the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).",
  countries: ["SG"],
  role: "live",
  accessMethod: "documented_api",
  expectedIntervalMinutes: 60,
  intervalNote: "NEA publishes hourly. data.gov.sg describes the PM2.5 dataset as updated every 15 minutes, but readings are hourly values.",
  cacheTtlSeconds: 600,
  zone: "Asia/Singapore",
  historyChunk: "day",
  maxHistoryDays: 7,
  // Label locations as published in the API's regionMetadata (checked 2026-10-22).
  knownStations: [
    regionStation("north", 1.41803, 103.82),
    regionStation("south", 1.29587, 103.82),
    regionStation("east", 1.35735, 103.94),
    regionStation("west", 1.35735, 103.7),
    regionStation("central", 1.35735, 103.82),
  ],
  series: [
    { metricKey: "index:SG_PSI", label: "24-hour PSI", unitLabel: "index, no unit", averagingPeriod: "PT24H" },
    { metricKey: "concentration:PM2.5", label: "PM2.5, 1-hour", unitLabel: "µg/m³", averagingPeriod: "PT1H" },
    { metricKey: "concentration:PM2.5", label: "PM2.5, 24-hour", unitLabel: "µg/m³", averagingPeriod: "PT24H" },
    { metricKey: "concentration:PM10", label: "PM10, 24-hour", unitLabel: "µg/m³", averagingPeriod: "PT24H" },
  ],
  connection: () => ({ status: "connected" }),
  async fetchLatest(ctx) {
    const psi = await fetchEndpoint(ctx, "psi");
    const pm25 = await fetchEndpoint(ctx, "pm25");
    return mergeResults([psi, pm25]);
  },
  async fetchHistory(ctx, query: HistoryQuery) {
    const endpoint = query.metricKey === "concentration:PM2.5" && query.averagingPeriod === "PT1H" ? "pm25" : "psi";
    const results: AirResult[] = [];
    for (const date of eachDate(query.from, query.to)) results.push(await fetchEndpoint(ctx, endpoint, date));
    return mergeResults(results);
  },
};

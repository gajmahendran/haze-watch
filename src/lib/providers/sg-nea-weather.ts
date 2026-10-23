import { z } from "zod";
import type { AveragingPeriod, Station, WeatherObservation, WeatherParameter } from "../domain/schemas";
import { parseSourceTimestamp } from "../domain/time";
import { fetchWithRetry, HttpError, limiterFor, readJson } from "./http";
import { mergeResults } from "./sg-nea-air";
import { PayloadError, type AdapterContext, type AirProvider, type AirResult } from "./types";

/**
 * Singapore weather station readings (Meteorological Service Singapore, via data.gov.sg v2).
 *
 * Endpoints and what they report (checked 2026-10-23):
 *   air-temperature     "DBT 1M F"                   deg C       1-minute
 *   relative-humidity   "RH 1M F"                    percentage  1-minute
 *   wind-speed          "Wind Speed AVG(S)10M M1M"   knots       10-minute average
 *   wind-direction      "Wind Dir AVG (S) 10M M1M"   degrees     10-minute average
 *
 * Wind speed is converted from knots to m/s (1 kn = 0.514444 m/s) so the UI uses one unit. The
 * original knots value and unit are kept in `original`. Any other unit is rejected, not guessed.
 */

export const SG_NEA_WEATHER_ID = "sg-nea-weather";
const BASE = "https://api-open.data.gov.sg/v2/real-time/api";
export const KNOT_TO_MS = 0.514444;

const payloadSchema = z.object({
  code: z.number(),
  errorMsg: z.string().nullable().optional(),
  data: z
    .object({
      stations: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          location: z.object({ latitude: z.number(), longitude: z.number() }),
        }),
      ),
      readings: z.array(
        z.object({
          timestamp: z.string().min(1),
          data: z.array(z.object({ stationId: z.string(), value: z.number().nullable() })),
        }),
      ),
      readingType: z.string().optional(),
      readingUnit: z.string(),
    })
    .nullable()
    .optional(),
});

interface EndpointSpec {
  endpoint: string;
  parameter: WeatherParameter;
  averagingPeriod: AveragingPeriod;
}

const ENDPOINTS: EndpointSpec[] = [
  { endpoint: "air-temperature", parameter: "temperature", averagingPeriod: "PT1M" },
  { endpoint: "relative-humidity", parameter: "relative_humidity", averagingPeriod: "PT1M" },
  { endpoint: "wind-speed", parameter: "wind_speed", averagingPeriod: "PT10M" },
  { endpoint: "wind-direction", parameter: "wind_direction", averagingPeriod: "PT10M" },
];

type Converted = { value: number | null; unit: WeatherObservation["unit"] } | null;

/** Maps a source unit to our unit. Returns null for anything we have not explicitly handled. */
export function convertWeatherValue(parameter: WeatherParameter, sourceUnit: string, value: number | null): Converted {
  const unit = sourceUnit.trim().toLowerCase();
  const v = value === null || !Number.isFinite(value) ? null : value;
  switch (parameter) {
    case "temperature":
      return unit === "deg c" || unit === "°c" ? { value: v, unit: "°C" } : null;
    case "relative_humidity":
      return unit === "percentage" || unit === "%" ? { value: v, unit: "%" } : null;
    case "wind_speed":
      if (unit === "knots" || unit === "kn" || unit === "knot") {
        return { value: v === null ? null : Math.round(v * KNOT_TO_MS * 100) / 100, unit: "m/s" };
      }
      return unit === "m/s" ? { value: v, unit: "m/s" } : null;
    case "wind_direction":
      return unit === "degrees" || unit === "°" ? { value: v, unit: "°" } : null;
  }
}

export function parseWeatherPayload(
  raw: unknown,
  spec: EndpointSpec,
  meta: { retrievedAtUtc: string; sourceUrl: string },
): AirResult {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) throw new PayloadError(SG_NEA_WEATHER_ID, parsed.error.issues[0]?.message ?? "schema mismatch");
  if (parsed.data.code !== 0 || !parsed.data.data) {
    throw new PayloadError(SG_NEA_WEATHER_ID, `API code ${parsed.data.code}: ${parsed.data.errorMsg || "no data"}`);
  }
  const data = parsed.data.data;
  const stations: Station[] = data.stations.map((s) => ({
    id: `${SG_NEA_WEATHER_ID}:${s.id}`,
    providerId: SG_NEA_WEATHER_ID,
    externalId: s.id,
    name: s.name,
    countryCode: "SG",
    kind: "station",
    latitude: s.location.latitude,
    longitude: s.location.longitude,
    area: "Singapore",
  }));

  const observations: WeatherObservation[] = [];
  const warnings: string[] = [];
  let invalidItems = 0;

  // Reject the unit once for the whole payload rather than once per reading.
  if (convertWeatherValue(spec.parameter, data.readingUnit, 0) === null) {
    warnings.push(`Unrecognised unit "${data.readingUnit}" for ${spec.endpoint}; readings dropped.`);
    return {
      stations,
      observations,
      invalidItems: data.readings.reduce((n, r) => n + r.data.length, 0),
      warnings,
      httpStatus: 200,
      attempts: 1,
    };
  }

  for (const reading of data.readings) {
    let ts;
    try {
      ts = parseSourceTimestamp(reading.timestamp, "Asia/Singapore");
    } catch {
      invalidItems += reading.data.length;
      continue;
    }
    for (const d of reading.data) {
      const converted = convertWeatherValue(spec.parameter, data.readingUnit, d.value)!;
      if (spec.parameter === "relative_humidity" && converted.value !== null && (converted.value < 0 || converted.value > 100)) {
        invalidItems += 1;
        continue;
      }
      observations.push({
        kind: "weather",
        providerId: SG_NEA_WEATHER_ID,
        stationId: `${SG_NEA_WEATHER_ID}:${d.stationId}`,
        countryCode: "SG",
        observedAtUtc: ts.utcIso,
        retrievedAtUtc: meta.retrievedAtUtc,
        original: { value: d.value, unit: data.readingUnit, timestamp: ts.sourceTimestamp, timezone: ts.sourceTimezone },
        quality: "unvalidated",
        provenance: "provider",
        sourceUrl: meta.sourceUrl,
        parameter: spec.parameter,
        value: converted.value,
        unit: converted.unit,
        averagingPeriod: spec.averagingPeriod,
      });
    }
  }
  return { stations, observations, invalidItems, warnings, httpStatus: 200, attempts: 1 };
}

async function fetchSpec(ctx: AdapterContext, spec: EndpointSpec): Promise<AirResult> {
  const url = `${BASE}/${spec.endpoint}`;
  const { response, attempts } = await fetchWithRetry(url, {
    headers: ctx.env.DATA_GOV_SG_API_KEY ? { "x-api-key": ctx.env.DATA_GOV_SG_API_KEY } : {},
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
    retries: ctx.retries,
    limiter: ctx.fetchImpl ? undefined : limiterFor("api-open.data.gov.sg", ctx.env.DATA_GOV_SG_API_KEY ? 11 : 5, 10_000),
  });
  const json = await readJson(response, url);
  return { ...parseWeatherPayload(json, spec, { retrievedAtUtc: ctx.now.toISOString(), sourceUrl: url }), httpStatus: response.status, attempts };
}

export const sgNeaWeather: AirProvider = {
  kind: "air",
  id: SG_NEA_WEATHER_ID,
  name: "Singapore weather stations (MSS)",
  operator: "Meteorological Service Singapore (NEA), via data.gov.sg",
  homepage: "https://www.weather.gov.sg/",
  docsUrl: "https://data.gov.sg/collections/1459/view",
  licence: "Singapore Open Data Licence v1.0",
  attribution:
    "Contains information from realtime weather readings accessed from data.gov.sg, which is made available under the terms of the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).",
  countries: ["SG"],
  role: "live",
  accessMethod: "documented_api",
  expectedIntervalMinutes: 5,
  intervalNote: "Stations report about once a minute. This platform asks for new readings at most every five minutes.",
  cacheTtlSeconds: 300,
  zone: "Asia/Singapore",
  historyChunk: "day",
  maxHistoryDays: 0,
  series: [],
  knownStations: [],
  connection: () => ({ status: "connected" }),
  async fetchLatest(ctx) {
    const results: AirResult[] = [];
    const warnings: string[] = [];
    for (const spec of ENDPOINTS) {
      // Weather is supporting context. One failed parameter should not hide the others.
      try {
        results.push(await fetchSpec(ctx, spec));
      } catch (error) {
        warnings.push(`${spec.endpoint}: ${error instanceof Error ? error.message : String(error)}`);
        // If the host is unreachable, the remaining endpoints will fail the same way.
        if (error instanceof HttpError && error.status === null) break;
      }
    }
    if (results.length === 0) throw new Error(`All weather endpoints failed. ${warnings.join(" ")}`);
    const merged = mergeResults(results);
    return { ...merged, warnings: [...merged.warnings, ...warnings] };
  },
};

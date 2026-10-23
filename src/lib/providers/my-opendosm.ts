import { z } from "zod";
import type { ConcentrationObservation, ConcentrationUnit, Pollutant, Station } from "../domain/schemas";
import { parseSourceTimestamp } from "../domain/time";
import { fetchWithRetry, limiterFor, readJson } from "./http";
import { PayloadError, type AirProvider, type AirResult } from "./types";

/**
 * Malaysia monthly national pollutant averages (Department of Environment, published by the
 * Department of Statistics Malaysia on OpenDOSM / data.gov.my).
 *
 *   Dataset  https://open.dosm.gov.my/data-catalogue/air_pollution
 *   API      https://api.data.gov.my/data-catalogue?id=air_pollution
 *   Licence  CC BY 4.0
 *   Limit    4 requests per minute (data.gov.my API)
 *
 * What it is: a single national monthly mean per pollutant, computed by the publisher from hourly
 * station observations. It is NOT a station reading and NOT the Air Pollutant Index. Units, per the
 * dataset page: µg/m³ for PM2.5 and PM10, ppm for CO, NO2, O3 and SO2.
 *
 * Seen on 2026-10-23: pollutant labels "PM 2.5", "PM 10", "SO2", "NO2", "O3", "CO"; latest month
 * December 2024; some values null (for example CO in 2024). Nulls stay null.
 */

export const MY_OPENDOSM_ID = "my-opendosm";
const API_URL = "https://api.data.gov.my/data-catalogue?id=air_pollution&limit=5000";
export const MY_NATIONAL_STATION_ID = `${MY_OPENDOSM_ID}:national`;

const rowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pollutant: z.string().min(1),
  concentration: z.number().nullable(),
});

const POLLUTANT_MAP: Record<string, { pollutant: Pollutant; unit: ConcentrationUnit }> = {
  pm25: { pollutant: "PM2.5", unit: "µg/m³" },
  pm10: { pollutant: "PM10", unit: "µg/m³" },
  so2: { pollutant: "SO2", unit: "ppm" },
  no2: { pollutant: "NO2", unit: "ppm" },
  o3: { pollutant: "O3", unit: "ppm" },
  co: { pollutant: "CO", unit: "ppm" },
};

const DIGITS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

/** "PM 2.5", "PM₂.₅", "pm2.5" -> "pm25". */
export function normalisePollutantLabel(label: string): string {
  return label
    .split("")
    .map((c) => DIGITS[c] ?? c)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export const nationalStation: Station = {
  id: MY_NATIONAL_STATION_ID,
  providerId: MY_OPENDOSM_ID,
  externalId: "national",
  name: "Malaysia, national monthly mean",
  countryCode: "MY",
  kind: "national_aggregate",
  latitude: null,
  longitude: null,
  area: "Malaysia (all DOE stations)",
};

export function parseOpenDosm(raw: unknown, meta: { retrievedAtUtc: string; sourceUrl: string }): AirResult {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
      ? (raw as { data: unknown[] }).data
      : null;
  if (!rows) throw new PayloadError(MY_OPENDOSM_ID, "expected an array of rows");

  const observations: ConcentrationObservation[] = [];
  const warnings: string[] = [];
  let invalidItems = 0;
  const unknownLabels = new Set<string>();

  for (const row of rows) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      invalidItems += 1;
      continue;
    }
    const mapping = POLLUTANT_MAP[normalisePollutantLabel(parsed.data.pollutant)];
    if (!mapping) {
      unknownLabels.add(parsed.data.pollutant);
      invalidItems += 1;
      continue;
    }
    const v = parsed.data.concentration;
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      invalidItems += 1;
      continue;
    }
    // The dataset dates each month by its first day. Interpret as local midnight in Malaysia.
    const ts = parseSourceTimestamp(`${parsed.data.date}T00:00`, "Asia/Kuala_Lumpur");
    observations.push({
      kind: "concentration",
      providerId: MY_OPENDOSM_ID,
      stationId: MY_NATIONAL_STATION_ID,
      countryCode: "MY",
      observedAtUtc: ts.utcIso,
      retrievedAtUtc: meta.retrievedAtUtc,
      original: { value: v, unit: mapping.unit, timestamp: parsed.data.date, timezone: "Asia/Kuala_Lumpur" },
      quality: "unvalidated",
      provenance: "provider",
      sourceUrl: meta.sourceUrl,
      pollutant: mapping.pollutant,
      value: v,
      unit: mapping.unit,
      averagingPeriod: "P1M",
    });
  }
  if (unknownLabels.size) warnings.push(`Unrecognised pollutant labels dropped: ${[...unknownLabels].join(", ")}.`);
  observations.sort((a, b) => (a.observedAtUtc < b.observedAtUtc ? -1 : 1));
  return { stations: [nationalStation], observations, invalidItems, warnings, httpStatus: 200, attempts: 1 };
}

export const myOpenDosm: AirProvider = {
  kind: "air",
  id: MY_OPENDOSM_ID,
  name: "Malaysia monthly pollutant averages (DOE via OpenDOSM)",
  operator: "Department of Environment Malaysia and Department of Statistics Malaysia",
  homepage: "https://open.dosm.gov.my/data-catalogue/air_pollution",
  docsUrl: "https://developer.data.gov.my/static-api/data-catalogue",
  licence: "CC BY 4.0",
  attribution: "Monthly Air Pollution, Department of Environment and Department of Statistics Malaysia, via OpenDOSM (CC BY 4.0).",
  countries: ["MY"],
  role: "historical",
  accessMethod: "documented_api",
  expectedIntervalMinutes: null,
  intervalNote:
    "Monthly national averages, published in batches with no fixed schedule. On 2026-10-23 the latest month available was December 2024.",
  cacheTtlSeconds: 86_400,
  zone: "Asia/Kuala_Lumpur",
  historyChunk: "all",
  maxHistoryDays: 366 * 30,
  knownStations: [nationalStation],
  series: [
    { metricKey: "concentration:PM2.5", label: "PM2.5, national monthly mean", unitLabel: "µg/m³", averagingPeriod: "P1M" },
    { metricKey: "concentration:PM10", label: "PM10, national monthly mean", unitLabel: "µg/m³", averagingPeriod: "P1M" },
    { metricKey: "concentration:O3", label: "O3, national monthly mean", unitLabel: "ppm", averagingPeriod: "P1M" },
    { metricKey: "concentration:NO2", label: "NO2, national monthly mean", unitLabel: "ppm", averagingPeriod: "P1M" },
    { metricKey: "concentration:SO2", label: "SO2, national monthly mean", unitLabel: "ppm", averagingPeriod: "P1M" },
    { metricKey: "concentration:CO", label: "CO, national monthly mean", unitLabel: "ppm", averagingPeriod: "P1M" },
  ],
  connection: () => ({ status: "connected" }),
  async fetchHistory(ctx) {
    const { response, attempts } = await fetchWithRetry(API_URL, {
      fetchImpl: ctx.fetchImpl,
      sleep: ctx.sleep,
      retries: ctx.retries,
      limiter: ctx.fetchImpl ? undefined : limiterFor("api.data.gov.my", 3, 60_000),
      timeoutMs: 20_000,
    });
    const json = await readJson(response, API_URL);
    const result = parseOpenDosm(json, { retrievedAtUtc: ctx.now.toISOString(), sourceUrl: API_URL });
    return { ...result, httpStatus: response.status, attempts };
  },
};

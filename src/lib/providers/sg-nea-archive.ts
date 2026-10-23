import type { ConcentrationObservation, IndexObservation, Observation } from "../domain/schemas";
import { ZONES } from "../domain/time";
import { fetchWithRetry, hostOf, HttpError, limiterFor, readJson } from "./http";
import { regionStation } from "./sg-nea-air";
import { PayloadError, type AdapterContext, type AggregateQuery, type AggregateResult, type AirProvider, type AirResult, type HistoryQuery } from "./types";

/**
 * Singapore NEA historical regional readings (data.gov.sg datasets, checked 2026-10-23):
 *
 *   Historical 24-hr PSI    d_b4cf557f8750260d229c49fd768e11ed   hourly, Apr 2014 onwards
 *   Historical 1-hr PM2.5   d_6c0d5fc34838b12472475fdb73c0af29   hourly, Apr 2014 onwards, µg/m³
 *
 * Access is the documented dataset download flow: `initiate-download`, then `poll-download` until a
 * file URL is returned, then the CSV itself. The download API allows about 5 requests per minute,
 * so each dataset is fetched at most once a day per server instance and kept in a compact columnar
 * form (one Float64Array of times, one Float32Array per region) rather than as objects.
 *
 * Timestamps are local Singapore time written as `d/m/yyyy H:mm`. Midnight appears as `0:00` on the
 * following day (`30/9/2026 23:00` is followed by `1/10/2026 0:00`). Blank or non-numeric cells are
 * missing values and become `null`.
 *
 * Licence: Singapore Open Data Licence v1.0.
 */

export const SG_NEA_ARCHIVE_ID = "sg-nea-archive";
const API = "https://api-open.data.gov.sg/v1/public/api/datasets";

export const ARCHIVE_DATASETS = {
  psi: { id: "d_b4cf557f8750260d229c49fd768e11ed", page: "https://data.gov.sg/datasets/d_b4cf557f8750260d229c49fd768e11ed/view" },
  pm25: { id: "d_6c0d5fc34838b12472475fdb73c0af29", page: "https://data.gov.sg/datasets/d_6c0d5fc34838b12472475fdb73c0af29/view" },
} as const;
type DatasetKey = keyof typeof ARCHIVE_DATASETS;

export const ARCHIVE_REGIONS = ["north", "south", "east", "west", "central"] as const;
export type ArchiveRegion = (typeof ARCHIVE_REGIONS)[number];

export interface ArchiveTable {
  /** UTC milliseconds, ascending. */
  times: Float64Array;
  /** Source timestamp strings, exactly as published. */
  rawTimes: string[];
  /** NaN = missing. */
  values: Record<ArchiveRegion, Float32Array>;
  /** Raw cell text, kept only where it was not a clean number (for provenance). */
  rawOddCells: Map<string, string>;
  invalidRows: number;
}

const SGT_OFFSET_MS = ZONES["Asia/Singapore"].offsetMinutes * 60_000;
const TS = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;

/** `d/m/yyyy H:mm` in Singapore time to UTC ms, or NaN. Rejects impossible dates. */
export function parseArchiveTimestamp(raw: string): number {
  const m = TS.exec(raw.trim());
  if (!m) return Number.NaN;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (h > 23 || mi > 59) return Number.NaN;
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(local);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return Number.NaN;
  return local - SGT_OFFSET_MS;
}

function splitCsvLine(line: string): string[] {
  // The archive has no quoted fields, but be safe with simple quoting.
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Parses an archive CSV into a compact table. Columns are matched by name, case-insensitively. */
export function parseArchiveCsv(csv: string): ArchiveTable {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitCsvLine(lines.shift() ?? "").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  const regionCol = Object.fromEntries(ARCHIVE_REGIONS.map((r) => [r, header.indexOf(r)])) as Record<ArchiveRegion, number>;
  const missing = ARCHIVE_REGIONS.filter((r) => regionCol[r] < 0);
  if (missing.length) throw new PayloadError(SG_NEA_ARCHIVE_ID, `archive CSV is missing columns: ${missing.join(", ")}`);
  // The timestamp column is the first one that is not a region (named "24hr_psi" or "1hr_pm25").
  const timeCol = header.findIndex((h) => !(ARCHIVE_REGIONS as readonly string[]).includes(h) && h !== "_id");

  const n = lines.length;
  const times = new Float64Array(n);
  const rawTimes: string[] = new Array(n);
  const values = Object.fromEntries(ARCHIVE_REGIONS.map((r) => [r, new Float32Array(n)])) as Record<ArchiveRegion, Float32Array>;
  const rawOddCells = new Map<string, string>();
  let k = 0;
  let invalidRows = 0;
  for (const line of lines) {
    const cells = splitCsvLine(line);
    const t = parseArchiveTimestamp(cells[timeCol] ?? "");
    if (Number.isNaN(t)) {
      invalidRows += 1;
      continue;
    }
    times[k] = t;
    rawTimes[k] = (cells[timeCol] ?? "").trim();
    for (const r of ARCHIVE_REGIONS) {
      const text = (cells[regionCol[r]] ?? "").trim();
      const v = text === "" ? Number.NaN : Number(text);
      const ok = Number.isFinite(v) && v >= 0;
      values[r][k] = ok ? v : Number.NaN;
      if (!ok && text !== "") rawOddCells.set(`${k}:${r}`, text);
    }
    k += 1;
  }
  // The file is expected in time order. If it is not, reorder every column consistently.
  let ordered = true;
  for (let i = 1; i < k; i++) if (times[i]! < times[i - 1]!) ordered = false;
  if (ordered) {
    return {
      times: times.slice(0, k),
      rawTimes: rawTimes.slice(0, k),
      values: Object.fromEntries(ARCHIVE_REGIONS.map((r) => [r, values[r].slice(0, k)])) as Record<ArchiveRegion, Float32Array>,
      rawOddCells,
      invalidRows,
    };
  }
  const order = Array.from({ length: k }, (_, i) => i).sort((a, b) => times[a]! - times[b]!);
  const newIndex = new Int32Array(k);
  order.forEach((oldI, newI) => (newIndex[oldI] = newI));
  return {
    times: Float64Array.from(order, (i) => times[i]!),
    rawTimes: order.map((i) => rawTimes[i]!),
    values: Object.fromEntries(ARCHIVE_REGIONS.map((r) => [r, Float32Array.from(order, (i) => values[r][i]!)])) as Record<ArchiveRegion, Float32Array>,
    rawOddCells: new Map(
      [...rawOddCells].map(([key, v]) => {
        const [row, r] = key.split(":");
        return [`${newIndex[Number(row)]}:${r}`, v] as const;
      }),
    ),
    invalidRows,
  };
}

/** Index of the first row with time >= t (binary search). */
export function lowerBound(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Local Singapore day range [from, to] (inclusive dates) as UTC ms [start, end). */
export function sgDayRange(from: string, to: string): [number, number] {
  return [Date.parse(`${from}T00:00:00Z`) - SGT_OFFSET_MS, Date.parse(`${to}T00:00:00Z`) + 86_400_000 - SGT_OFFSET_MS];
}

export function tableToObservations(
  table: ArchiveTable,
  dataset: DatasetKey,
  meta: { stationIds: readonly string[]; startMs: number; endMs: number; retrievedAtUtc: string },
): Observation[] {
  const sourceUrl = ARCHIVE_DATASETS[dataset].page;
  const regions = ARCHIVE_REGIONS.filter((r) => meta.stationIds.includes("all") || meta.stationIds.includes(`${SG_NEA_ARCHIVE_ID}:${r}`));
  const a = lowerBound(table.times, meta.startMs);
  const b = lowerBound(table.times, meta.endMs);
  const out: Observation[] = [];
  for (let i = a; i < b; i++) {
    const observedAtUtc = new Date(table.times[i]!).toISOString();
    for (const r of regions) {
      const v = table.values[r][i]!;
      const value = Number.isNaN(v) ? null : Math.round(v * 100) / 100;
      const base = {
        providerId: SG_NEA_ARCHIVE_ID,
        stationId: `${SG_NEA_ARCHIVE_ID}:${r}`,
        countryCode: "SG" as const,
        observedAtUtc,
        retrievedAtUtc: meta.retrievedAtUtc,
        original: {
          value: value ?? table.rawOddCells.get(`${i}:${r}`) ?? null,
          unit: dataset === "psi" ? null : "µg/m³",
          timestamp: table.rawTimes[i]!,
          timezone: "Asia/Singapore",
        },
        quality: "unvalidated" as const,
        provenance: "provider" as const,
        sourceUrl,
      };
      if (dataset === "psi") {
        out.push({ ...base, kind: "index", indexId: "SG_PSI", value, averagingPeriod: "PT24H", dominantPollutant: null } satisfies IndexObservation);
      } else {
        out.push({ ...base, kind: "concentration", pollutant: "PM2.5", value, unit: "µg/m³", averagingPeriod: "PT1H" } satisfies ConcentrationObservation);
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * Download flow with a module-level daily cache.
 * ------------------------------------------------------------------------------------------- */

const tables = new Map<DatasetKey, { table: ArchiveTable; loadedAtMs: number }>();
const loading = new Map<DatasetKey, Promise<ArchiveTable>>();
const TABLE_TTL_MS = 24 * 3_600_000;

export function clearArchiveCache(): void {
  tables.clear();
  loading.clear();
}

/** Overrides the cached table, for tests. */
export function primeArchive(dataset: DatasetKey, table: ArchiveTable, loadedAtMs = Date.now()): void {
  tables.set(dataset, { table, loadedAtMs });
}

async function downloadCsv(ctx: AdapterContext, dataset: DatasetKey): Promise<string> {
  const id = ARCHIVE_DATASETS[dataset].id;
  const headers: Record<string, string> = ctx.env.DATA_GOV_SG_API_KEY ? { "x-api-key": ctx.env.DATA_GOV_SG_API_KEY } : {};
  const limiter = ctx.fetchImpl ? undefined : limiterFor("api-open.data.gov.sg/v1", 4, 60_000);
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const common = { headers, fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, retries: ctx.retries, limiter, timeoutMs: 20_000 };

  await fetchWithRetry(`${API}/${id}/initiate-download`, common);
  for (let attempt = 0; attempt < 4; attempt++) {
    const pollUrl = `${API}/${id}/poll-download`;
    const { response } = await fetchWithRetry(pollUrl, common);
    const body = (await readJson(response, pollUrl)) as { code?: number; data?: { status?: string; url?: string }; errorMsg?: string };
    if (body?.data?.url) {
      const { response: file } = await fetchWithRetry(body.data.url, { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, retries: ctx.retries, timeoutMs: 60_000 });
      return await file.text();
    }
    if (body?.errorMsg) throw new PayloadError(SG_NEA_ARCHIVE_ID, body.errorMsg);
    await sleep(5_000);
  }
  throw new HttpError(`The download link from ${hostOf(API)} was not ready in time`, { status: null, url: `${API}/${id}/poll-download`, transient: true, attempts: 4 });
}

export async function loadArchive(ctx: AdapterContext, dataset: DatasetKey): Promise<{ table: ArchiveTable; loadedAtMs: number }> {
  const hit = tables.get(dataset);
  if (hit && ctx.now.getTime() - hit.loadedAtMs < TABLE_TTL_MS) return hit;
  let pending = loading.get(dataset);
  if (!pending) {
    pending = downloadCsv(ctx, dataset).then(parseArchiveCsv);
    loading.set(dataset, pending);
  }
  try {
    const table = await pending;
    const entry = { table, loadedAtMs: ctx.now.getTime() };
    tables.set(dataset, entry);
    return entry;
  } catch (error) {
    // A stale table is better than none; callers see its coverage end date.
    if (hit) return hit;
    throw error;
  } finally {
    loading.delete(dataset);
  }
}

export function datasetFor(metricKey: string, period: string): DatasetKey | null {
  if (metricKey === "index:SG_PSI" && period === "PT24H") return "psi";
  if (metricKey === "concentration:PM2.5" && period === "PT1H") return "pm25";
  return null;
}

export function archiveCoverage(table: ArchiveTable): { first: string | null; last: string | null } {
  const n = table.times.length;
  return {
    first: n ? new Date(table.times[0]!).toISOString() : null,
    last: n ? new Date(table.times[n - 1]!).toISOString() : null,
  };
}

export const ARCHIVE_STATIONS = ARCHIVE_REGIONS.map((r) => ({
  ...regionStation(r, null, null),
  id: `${SG_NEA_ARCHIVE_ID}:${r}`,
  providerId: SG_NEA_ARCHIVE_ID,
}));

export const sgNeaArchive: AirProvider = {
  kind: "air",
  id: SG_NEA_ARCHIVE_ID,
  name: "Singapore PSI and PM2.5 archive since 2014 (NEA)",
  operator: "National Environment Agency, Singapore, via data.gov.sg",
  homepage: "https://data.gov.sg/datasets/d_b4cf557f8750260d229c49fd768e11ed/view",
  docsUrl: "https://guide.data.gov.sg/developer-guide/dataset-apis/download-dataset",
  licence: "Singapore Open Data Licence v1.0",
  attribution:
    "Contains information from Historical 24-hr PSI and Historical 1-hr PM2.5 accessed from data.gov.sg, which is made available under the terms of the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).",
  countries: ["SG"],
  role: "historical",
  accessMethod: "documented_api",
  expectedIntervalMinutes: null,
  intervalNote:
    "Hourly readings published as dataset batches, not live. On 23 October 2026 the archive ran from April 2014 to 1 October 2026; the live feed covers recent days.",
  cacheTtlSeconds: 86_400,
  zone: "Asia/Singapore",
  historyChunk: "range",
  maxHistoryDays: 366,
  maxAggregateDays: 366 * 15,
  dayConvention: "NEA's archive lists each day's readings from 01:00 to 24:00, so the reading stamped 00:00 is counted in the day it closes.",
  knownStations: ARCHIVE_STATIONS,
  series: [
    { metricKey: "index:SG_PSI", label: "24-hour PSI (archive)", unitLabel: "index, no unit", averagingPeriod: "PT24H" },
    { metricKey: "concentration:PM2.5", label: "PM2.5, 1-hour (archive)", unitLabel: "µg/m³", averagingPeriod: "PT1H" },
  ],
  connection: () => ({ status: "connected" }),
  async fetchHistory(ctx, query: HistoryQuery): Promise<AirResult> {
    const dataset = datasetFor(query.metricKey, query.averagingPeriod);
    if (!dataset) throw new PayloadError(SG_NEA_ARCHIVE_ID, `no archive for ${query.metricKey} ${query.averagingPeriod}`);
    const { table, loadedAtMs } = await loadArchive(ctx, dataset);
    const [startMs, endMs] = sgDayRange(query.from, query.to);
    const observations = tableToObservations(table, dataset, {
      stationIds: [query.stationId],
      startMs,
      endMs,
      retrievedAtUtc: new Date(loadedAtMs).toISOString(),
    });
    const cov = archiveCoverage(table);
    const warnings: string[] = [];
    if (cov.last && endMs > Date.parse(cov.last) + 3_600_000) {
      warnings.push(`The archive currently ends at ${cov.last.slice(0, 10)} (UTC). Use the live source for later days.`);
    }
    if (table.invalidRows) warnings.push(`${table.invalidRows} archive row(s) had unreadable timestamps and were skipped.`);
    return { stations: [...ARCHIVE_STATIONS], observations, invalidItems: table.invalidRows, warnings, httpStatus: 200, attempts: 1 };
  },
  async fetchAggregate(ctx, query: AggregateQuery): Promise<AggregateResult> {
    const dataset = datasetFor(query.metricKey, query.averagingPeriod);
    if (!dataset) throw new PayloadError(SG_NEA_ARCHIVE_ID, `no archive for ${query.metricKey} ${query.averagingPeriod}`);
    const { table } = await loadArchive(ctx, dataset);
    // Day boundaries follow the source: hours 01:00 to 24:00 local time.
    const [startMs, endMs] = sgDayRange(query.from, query.to).map((x) => x + 1) as [number, number];
    const regions = ARCHIVE_REGIONS.filter((r) => query.stationId === "all" || query.stationId === `${SG_NEA_ARCHIVE_ID}:${r}`);
    const warnings: string[] = [];
    const cov = archiveCoverage(table);
    if (cov.last && endMs > Date.parse(cov.last) + 3_600_000) warnings.push(`The archive currently ends at ${cov.last.slice(0, 10)} (UTC).`);
    return {
      stations: ARCHIVE_STATIONS.filter((s) => regions.includes(s.externalId as ArchiveRegion)),
      series: regions.map((r) => ({ stationId: `${SG_NEA_ARCHIVE_ID}:${r}`, buckets: aggregateTable(table, r, startMs, endMs, query.granularity) })),
      warnings,
    };
  },
};

/* ---------------------------------------------------------------------------------------------
 * Server-side summaries over the compact table, so long ranges never become millions of objects.
 * Same rules as domain/stats: missing values are excluded and counted, never zero; no interpolation.
 * ------------------------------------------------------------------------------------------- */

export interface ArchiveBucket {
  key: string;
  count: number;
  missing: number;
  total: number;
  /** Rows the source would hold for this period at one per hour. */
  expected: number;
  completeness: number;
  incomplete: boolean;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** UTC time of the highest value, earliest on ties. */
  peakAtUtc: string | null;
}

function localKey(ms: number, granularity: "day" | "month"): string {
  const iso = new Date(ms + SGT_OFFSET_MS).toISOString();
  return granularity === "day" ? iso.slice(0, 10) : iso.slice(0, 7);
}

function expectedHours(key: string, granularity: "day" | "month"): number {
  if (granularity === "day") return 24;
  const [y, m] = key.split("-").map(Number) as [number, number];
  return 24 * new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function aggregateTable(
  table: ArchiveTable,
  region: ArchiveRegion,
  startMs: number,
  endMs: number,
  granularity: "day" | "month",
  minCoverage = 0.75,
): ArchiveBucket[] {
  const a = lowerBound(table.times, startMs);
  const b = lowerBound(table.times, endMs);
  const col = table.values[region];
  const out: ArchiveBucket[] = [];
  let cur: (ArchiveBucket & { sum: number }) | null = null;
  const flush = () => {
    if (!cur) return;
    const { sum, ...rest } = cur;
    rest.mean = rest.count ? Math.round((sum / rest.count) * 100) / 100 : null;
    rest.completeness = Math.min(1, rest.count / rest.expected);
    rest.incomplete = rest.completeness < minCoverage;
    out.push(rest);
  };
  for (let i = a; i < b; i++) {
    const t = table.times[i]!;
    // An hourly reading stamped 00:00 closes the previous local day, as the source writes midnight.
    const key = localKey(t - 1, granularity);
    if (!cur || cur.key !== key) {
      flush();
      cur = { key, count: 0, missing: 0, total: 0, expected: expectedHours(key, granularity), completeness: 0, incomplete: true, mean: null, min: null, max: null, peakAtUtc: null, sum: 0 };
    }
    cur.total += 1;
    const v = col[i]!;
    if (Number.isNaN(v)) {
      cur.missing += 1;
      continue;
    }
    cur.count += 1;
    cur.sum += v;
    if (cur.min === null || v < cur.min) cur.min = v;
    if (cur.max === null || v > cur.max) {
      cur.max = v;
      cur.peakAtUtc = new Date(t).toISOString();
    }
  }
  flush();
  return out;
}

export interface YearlyBandDays {
  year: number;
  /** Local days with at least one reading in any region. */
  daysWithData: number;
  /** Days in the year that the archive covers (partial first and last years). */
  daysCovered: number;
  /** Days on which any region's hourly 24-hour PSI reached each band's lower edge. */
  unhealthyOrWorse: number;
  veryUnhealthyOrWorse: number;
  hazardous: number;
  /** Highest hourly 24-hour PSI of the year in any region. */
  peak: number | null;
  peakAtUtc: string | null;
  peakRegion: ArchiveRegion | null;
}

/**
 * Counts, per calendar year in Singapore time, the days on which any region's published 24-hour PSI
 * reached 101 (Unhealthy), 201 (Very unhealthy) or 301 (Hazardous). Thresholds are NEA's published
 * PSI bands. A day counts once, however many hours or regions crossed the line.
 */
export function yearlyPsiBandDays(table: ArchiveTable): YearlyBandDays[] {
  const days = new Map<string, { max: number; any: boolean }>();
  const peaks = new Map<number, { v: number; t: number; r: ArchiveRegion }>();
  for (let i = 0; i < table.times.length; i++) {
    const t = table.times[i]!;
    const key = localKey(t - 1, "day");
    let dayMax = -1;
    let any = false;
    for (const r of ARCHIVE_REGIONS) {
      const v = table.values[r][i]!;
      if (Number.isNaN(v)) continue;
      any = true;
      if (v > dayMax) dayMax = v;
      const year = Number(key.slice(0, 4));
      const p = peaks.get(year);
      if (!p || v > p.v) peaks.set(year, { v, t, r });
    }
    const d = days.get(key) ?? { max: -1, any: false };
    if (dayMax > d.max) d.max = dayMax;
    d.any = d.any || any;
    days.set(key, d);
  }
  const byYear = new Map<number, YearlyBandDays>();
  for (const [key, d] of days) {
    const year = Number(key.slice(0, 4));
    const y = byYear.get(year) ?? { year, daysWithData: 0, daysCovered: 0, unhealthyOrWorse: 0, veryUnhealthyOrWorse: 0, hazardous: 0, peak: null, peakAtUtc: null, peakRegion: null };
    y.daysCovered += 1;
    if (d.any) y.daysWithData += 1;
    if (d.max >= 101) y.unhealthyOrWorse += 1;
    if (d.max >= 201) y.veryUnhealthyOrWorse += 1;
    if (d.max >= 301) y.hazardous += 1;
    byYear.set(year, y);
  }
  for (const [year, p] of peaks) {
    const y = byYear.get(year);
    if (y) {
      y.peak = p.v;
      y.peakAtUtc = new Date(p.t).toISOString();
      y.peakRegion = p.r;
    }
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

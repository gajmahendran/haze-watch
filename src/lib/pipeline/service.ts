import { assessFreshness } from "../domain/freshness";
import type { Hotspot, HotspotResponse, Observation, ProviderStatus, Snapshot, Station } from "../domain/schemas";
import type { FetchLike } from "../providers/http";
import { airProviders, findAirProvider, hotspotProviders } from "../providers/registry";
import { eachDate } from "../providers/sg-nea-air";
import {
  isDemoEnabled,
  type AdapterContext,
  type AggregateBucket,
  type AggregateResult,
  type AirProvider,
  type AirResult,
  type HotspotProvider,
  type HotspotResult,
  type ProviderEnv,
  type ProviderMeta,
} from "../providers/types";
import { formatUtc, isKnownTimezone, ZONES } from "../domain/time";
import { bucketSeries } from "../domain/stats";
import { archiveCoverage, loadArchive, sgNeaArchive, yearlyPsiBandDays, type YearlyBandDays } from "../providers/sg-nea-archive";

function zoneOffsetMs(zone: keyof typeof ZONES): number {
  return ZONES[zone].offsetMinutes * 60_000;
}
import { TtlCache } from "./cache";
import { describeError, latestLog, latestPerSeries, makeLog, recordLog, validateAir, validateHotspots } from "./ingest";

export interface ServiceOptions {
  env: ProviderEnv;
  now?: Date;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
}

const airCache = new TtlCache<AirResult>();
const aggregateCache = new TtlCache<AggregateResult>();
const hotspotCache = new TtlCache<HotspotResult>();

export function resetCaches(): void {
  airCache.clear();
  aggregateCache.clear();
  hotspotCache.clear();
}

function ctxOf(opts: ServiceOptions): AdapterContext {
  return { now: opts.now ?? new Date(), env: opts.env, fetchImpl: opts.fetchImpl, sleep: opts.sleep, retries: opts.retries ?? 1 };
}

export function providerStatus(p: ProviderMeta & { connection: AirProvider["connection"] }, env: ProviderEnv): ProviderStatus {
  return {
    id: p.id,
    name: p.name,
    operator: p.operator,
    homepage: p.homepage,
    docsUrl: p.docsUrl,
    licence: p.licence,
    attribution: p.attribution,
    countries: [...p.countries],
    role: p.role,
    accessMethod: p.accessMethod,
    expectedIntervalMinutes: p.expectedIntervalMinutes,
    intervalNote: p.intervalNote,
    connection: p.connection(env),
    lastIngestion: latestLog(p.id),
  };
}

/** Runs (or reuses) one cached provider call and records an ingestion log when a fetch happened. */
async function runCached<R>(
  cache: TtlCache<R>,
  key: string,
  provider: ProviderMeta,
  load: () => Promise<R>,
  summarise: (r: R) => { stations: number; inserted: number; invalid: number; duplicates: number; conflicts: number; httpStatus: number | null; attempts: number },
) {
  const startedAt = new Date();
  const hit = await cache.get(key, provider.cacheTtlSeconds * 1000, load);
  if (hit.error && !hit.cachedFailure) {
    const e = describeError(hit.error);
    recordLog(
      makeLog({ providerId: provider.id, startedAt, finishedAt: new Date(), status: "failed", httpStatus: e.httpStatus, attempts: e.attempts, message: e.message }),
    );
  } else if (!hit.fromCache && hit.value) {
    const s = summarise(hit.value);
    recordLog(
      makeLog({
        providerId: provider.id,
        startedAt,
        finishedAt: new Date(),
        status: s.invalid > 0 ? "partial" : "success",
        httpStatus: s.httpStatus,
        stationsSeen: s.stations,
        inserted: s.inserted,
        duplicates: s.duplicates,
        conflicts: s.conflicts,
        invalidItems: s.invalid,
        attempts: s.attempts,
      }),
    );
  }
  return hit;
}

function failureWarning(name: string, error: Error, storedAtMs: number | null): string {
  const msg = describeError(error).message;
  return storedAtMs
    ? `${name}: the latest refresh failed (${msg}). Showing the last successful retrieval from ${formatUtc(new Date(storedAtMs).toISOString())}.`
    : `${name} is unavailable right now (${msg}). No readings from this source are shown.`;
}

/* ---------------------------------------------------------------------------------------------
 * Live snapshot
 * ------------------------------------------------------------------------------------------- */

export async function getSnapshot(opts: ServiceOptions): Promise<Snapshot> {
  const ctx = ctxOf(opts);
  const providers = airProviders(opts.env);
  const stations = new Map<string, Station>();
  const observations: Observation[] = [];
  const warnings: string[] = [];

  await Promise.all(
    providers.map(async (p) => {
      if (p.role !== "live" || !p.fetchLatest) return;
      const conn = p.connection(opts.env);
      if (conn.status !== "connected") return;
      const fetchLatest = p.fetchLatest.bind(p);
      const hit = await runCached(airCache, `latest:${p.id}`, p, () => fetchLatest(ctx), (r) => {
        const v = validateAir(r);
        return { stations: v.stations.length, inserted: v.observations.length, invalid: v.invalid, duplicates: v.duplicates, conflicts: v.conflicts, httpStatus: r.httpStatus, attempts: r.attempts };
      });
      if (hit.error) warnings.push(failureWarning(p.name, hit.error, hit.storedAtMs));
      if (!hit.value) return;
      const v = validateAir(hit.value);
      for (const s of v.stations) stations.set(s.id, s);
      observations.push(...latestPerSeries(v.observations));
      for (const w of hit.value.warnings) warnings.push(`${p.name}: ${w}`);
    }),
  );

  return {
    generatedAtUtc: ctx.now.toISOString(),
    demoMode: isDemoEnabled(opts.env),
    providers: providers.map((p) => providerStatus(p, opts.env)),
    stations: [...stations.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.name.localeCompare(b.name)),
    observations,
    warnings: [...new Set(warnings)],
  };
}

/* ---------------------------------------------------------------------------------------------
 * History
 * ------------------------------------------------------------------------------------------- */

/** Pass as stationId to get every station of a provider in one call (they share upstream requests). */
export const ALL_STATIONS = "all";

export class HistoryRequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HistoryRequestError";
    this.status = status;
  }
}

export interface HistoryResponse {
  generatedAtUtc: string;
  provider: ProviderStatus;
  station: Station | null;
  /** Every station present in the response (one, or all when stationId is "all"). */
  stations: Station[];
  metricKey: string;
  averagingPeriod: string;
  from: string;
  to: string;
  zone: string;
  observations: Observation[];
  /** Days (or the whole series) that could not be retrieved. Shown as gaps, never as zeros. */
  failedChunks: string[];
  warnings: string[];
  source: "live" | "database";
}

function matchesMetric(o: Observation, metricKey: string, averagingPeriod: string): boolean {
  if (o.averagingPeriod !== averagingPeriod) return false;
  if (o.kind === "index") return metricKey === `index:${o.indexId}`;
  if (o.kind === "concentration") return metricKey === `concentration:${o.pollutant}`;
  return metricKey === `weather:${o.parameter}`;
}

export async function getHistory(
  opts: ServiceOptions,
  q: { providerId: string; stationId: string; metricKey: string; averagingPeriod: string; from: string; to: string },
): Promise<HistoryResponse> {
  const provider = findAirProvider(opts.env, q.providerId);
  if (!provider) throw new HistoryRequestError(`Unknown provider "${q.providerId}".`, 404);
  const conn = provider.connection(opts.env);
  if (conn.status !== "connected" || !provider.fetchHistory) {
    throw new HistoryRequestError(`${provider.name} is not connected, so no history is available.`, 409);
  }
  const series = provider.series.find((s) => s.metricKey === q.metricKey && s.averagingPeriod === q.averagingPeriod);
  if (!series) throw new HistoryRequestError(`${provider.name} does not provide ${q.metricKey} at ${q.averagingPeriod}.`);

  const days = eachDate(q.from, q.to);
  if (days.length === 0) throw new HistoryRequestError("The end date must be on or after the start date.");

  const ctx = ctxOf(opts);
  const warnings: string[] = [];
  const failedChunks: string[] = [];
  const results: AirResult[] = [];

  // Persistence first, when configured: it holds long ranges without hitting the source.
  const { readHistoryFromStore } = await import("../store/supabase");
  const stored = await readHistoryFromStore(opts.env, { ...q, zone: provider.zone }).catch((error: unknown) => {
    warnings.push(`Database read failed (${describeError(error).message}); falling back to the live source.`);
    return null;
  });
  if (stored && stored.observations.length > 0) {
    return {
      generatedAtUtc: ctx.now.toISOString(),
      provider: providerStatus(provider, opts.env),
      station: stored.station,
      stations: stored.station ? [stored.station] : [],
      metricKey: q.metricKey,
      averagingPeriod: q.averagingPeriod,
      from: q.from,
      to: q.to,
      zone: provider.zone,
      observations: stored.observations.filter((o) => matchesMetric(o, q.metricKey, q.averagingPeriod)),
      failedChunks: [],
      warnings,
      source: "database",
    };
  }

  if (days.length > provider.maxHistoryDays) {
    throw new HistoryRequestError(
      `Without the database configured, ${provider.name} history is limited to ${provider.maxHistoryDays} days per request, because each day is a separate call to the source. Narrow the range or configure persistence.`,
    );
  }

  const fetchHistory = provider.fetchHistory.bind(provider);
  const todayLocal = new Date(ctx.now.getTime() + zoneOffsetMs(provider.zone)).toISOString().slice(0, 10);
  const chunks =
    provider.historyChunk === "day"
      ? days.map((d) => ({ from: d, to: d, key: d }))
      : provider.historyChunk === "range"
        ? [{ from: q.from, to: q.to, key: `range:${q.stationId}:${q.from}:${q.to}` }]
        : [{ from: q.from, to: q.to, key: "all" }];

  for (const chunk of chunks) {
    // Past days do not change, so they are cached for a day; today's data for the provider TTL.
    const ttl = provider.historyChunk !== "day" ? provider.cacheTtlSeconds * 1000 : chunk.key < todayLocal ? 86_400_000 : provider.cacheTtlSeconds * 1000;
    const key = `history:${provider.id}:${provider.historyChunk === "all" ? "all" : `${q.metricKey}:${q.averagingPeriod}:${chunk.key}`}`;
    const hit = await airCache.get(key, ttl, () => fetchHistory(ctx, { stationId: q.stationId, metricKey: q.metricKey, averagingPeriod: series.averagingPeriod, from: chunk.from, to: chunk.to }), 7 * 86_400_000);
    if (hit.error && !hit.value) {
      failedChunks.push(chunk.key);
      warnings.push(`${provider.historyChunk === "day" ? chunk.key : "Series"}: ${describeError(hit.error).message}`);
      continue;
    }
    if (hit.error) warnings.push(failureWarning(provider.name, hit.error, hit.storedAtMs));
    if (hit.value) results.push(hit.value);
  }

  const merged: AirResult = {
    stations: results.flatMap((r) => r.stations),
    observations: results.flatMap((r) => r.observations),
    invalidItems: results.reduce((n, r) => n + r.invalidItems, 0),
    warnings: results.flatMap((r) => r.warnings),
    httpStatus: null,
    attempts: 0,
  };
  const v = validateAir(merged);
  if (v.invalid > 0) warnings.push(`${v.invalid} record(s) failed validation and were dropped.`);
  if (v.conflicts > 0) warnings.push(`${v.conflicts} conflicting duplicate record(s) were found; the first copy was kept.`);
  const fromMs = Date.parse(`${q.from}T00:00:00Z`) - zoneOffsetMs(provider.zone);
  const toMs = Date.parse(`${q.to}T00:00:00Z`) + 86_400_000 - zoneOffsetMs(provider.zone);

  return {
    generatedAtUtc: ctx.now.toISOString(),
    provider: providerStatus(provider, opts.env),
    station: v.stations.find((s) => s.id === q.stationId) ?? null,
    stations: q.stationId === ALL_STATIONS ? v.stations : v.stations.filter((s) => s.id === q.stationId),
    metricKey: q.metricKey,
    averagingPeriod: q.averagingPeriod,
    from: q.from,
    to: q.to,
    zone: provider.zone,
    observations: v.observations
      .filter((o) => (q.stationId === ALL_STATIONS || o.stationId === q.stationId) && matchesMetric(o, q.metricKey, q.averagingPeriod))
      .filter((o) => {
        const t = Date.parse(o.observedAtUtc);
        return t >= fromMs && t < toMs;
      })
      .sort((a, b) => (a.observedAtUtc < b.observedAtUtc ? -1 : 1)),
    failedChunks,
    warnings: [...new Set([...warnings, ...merged.warnings])],
    source: "live",
  };
}

/* ---------------------------------------------------------------------------------------------
 * Daily and monthly summaries
 * ------------------------------------------------------------------------------------------- */

export interface AggregateResponse {
  generatedAtUtc: string;
  provider: ProviderStatus;
  stations: Station[];
  metricKey: string;
  averagingPeriod: string;
  granularity: "day" | "month";
  from: string;
  to: string;
  zone: string;
  dayConvention: string;
  series: { stationId: string; buckets: AggregateBucket[] }[];
  failedChunks: string[];
  warnings: string[];
}

export async function getAggregate(
  opts: ServiceOptions,
  q: { providerId: string; stationId: string; metricKey: string; averagingPeriod: string; from: string; to: string; granularity: "day" | "month" },
): Promise<AggregateResponse> {
  const provider = findAirProvider(opts.env, q.providerId);
  if (!provider) throw new HistoryRequestError(`Unknown provider "${q.providerId}".`, 404);
  if (provider.connection(opts.env).status !== "connected" || !provider.fetchHistory) {
    throw new HistoryRequestError(`${provider.name} is not connected, so no history is available.`, 409);
  }
  const series = provider.series.find((s) => s.metricKey === q.metricKey && s.averagingPeriod === q.averagingPeriod);
  if (!series) throw new HistoryRequestError(`${provider.name} does not provide ${q.metricKey} at ${q.averagingPeriod}.`);
  const days = eachDate(q.from, q.to);
  if (days.length === 0) throw new HistoryRequestError("The end date must be on or after the start date.");
  const ctx = ctxOf(opts);
  const base = {
    generatedAtUtc: ctx.now.toISOString(),
    provider: providerStatus(provider, opts.env),
    metricKey: q.metricKey,
    averagingPeriod: q.averagingPeriod,
    granularity: q.granularity,
    from: q.from,
    to: q.to,
    zone: provider.zone,
    dayConvention: provider.dayConvention ?? "Days run from 00:00 to 23:59 local time.",
  };

  if (provider.fetchAggregate) {
    const max = provider.maxAggregateDays ?? provider.maxHistoryDays;
    if (days.length > max) throw new HistoryRequestError(`${provider.name} summaries are limited to ${max} days per request.`);
    const fetchAggregate = provider.fetchAggregate.bind(provider);
    const hit = await aggregateCache.get(
      `aggregate:${provider.id}:${q.stationId}:${q.metricKey}:${q.averagingPeriod}:${q.granularity}:${q.from}:${q.to}`,
      provider.cacheTtlSeconds * 1000,
      () => fetchAggregate(ctx, { stationId: q.stationId, metricKey: q.metricKey, averagingPeriod: series.averagingPeriod, from: q.from, to: q.to, granularity: q.granularity }),
    );
    if (!hit.value) throw new HistoryRequestError(`${provider.name} could not be retrieved: ${describeError(hit.error).message}`, 502);
    return {
      ...base,
      stations: hit.value.stations,
      series: hit.value.series,
      failedChunks: [],
      warnings: [...hit.value.warnings, ...(hit.error ? [failureWarning(provider.name, hit.error, hit.storedAtMs)] : [])],
    };
  }

  // Otherwise summarise raw readings, within the provider's normal history limit.
  const h = await getHistory(opts, q);
  const zone = isKnownTimezone(provider.zone) ? provider.zone : "UTC";
  const interval = series.averagingPeriod === "P1M" ? null : 60;
  const byStation = new Map<string, { t: string; v: number | null }[]>();
  for (const o of h.observations) {
    const list = byStation.get(o.stationId) ?? [];
    list.push({ t: o.observedAtUtc, v: o.value });
    byStation.set(o.stationId, list);
  }
  return {
    ...base,
    stations: h.stations,
    series: [...byStation].map(([stationId, points]) => ({
      stationId,
      buckets: bucketSeries(points, q.granularity, zone, { intervalMinutes: interval }).map((b) => ({
        key: b.key,
        count: b.count,
        missing: b.missing,
        total: b.total,
        expected: b.expected,
        completeness: b.completeness,
        incomplete: b.incomplete,
        mean: b.mean === null ? null : Math.round(b.mean * 100) / 100,
        min: b.min,
        max: b.max,
        peakAtUtc: b.peak?.t ?? null,
      })),
    })),
    failedChunks: h.failedChunks,
    warnings: h.warnings,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Insight: Singapore days per year in each PSI band, from NEA's archive
 * ------------------------------------------------------------------------------------------- */

export interface PsiBandDaysResponse {
  generatedAtUtc: string;
  provider: ProviderStatus;
  coverage: { first: string | null; last: string | null };
  years: YearlyBandDays[];
  method: string;
}

export async function getPsiBandDays(opts: ServiceOptions): Promise<PsiBandDaysResponse> {
  const ctx = ctxOf(opts);
  const { table } = await loadArchive(ctx, "psi");
  return {
    generatedAtUtc: ctx.now.toISOString(),
    provider: providerStatus(sgNeaArchive, opts.env),
    coverage: archiveCoverage(table),
    years: yearlyPsiBandDays(table),
    method:
      "A day is counted when any of Singapore's five regions published an hourly 24-hour PSI at or above the band's lower edge (101 Unhealthy, 201 Very unhealthy, 301 Hazardous). Days run from 01:00 to 24:00 Singapore time, as in NEA's archive. Counts are this site's calculation from NEA data, not an NEA statistic.",
  };
}

/** Stations and series each connected history provider can serve, for the explorer's selectors. */
export function historyCatalogue(env: ProviderEnv) {
  return airProviders(env)
    .filter((p) => p.fetchHistory && p.series.length > 0)
    .map((p) => ({
      provider: providerStatus(p, env),
      stations: [...p.knownStations],
      zone: p.zone,
      maxHistoryDays: p.maxHistoryDays,
      historyChunk: p.historyChunk,
      maxAggregateDays: p.maxAggregateDays ?? p.maxHistoryDays,
      dayConvention: p.dayConvention ?? null,
      series: p.series,
    }));
}

/* ---------------------------------------------------------------------------------------------
 * Hotspots
 * ------------------------------------------------------------------------------------------- */

export const MAX_HOTSPOTS_RETURNED = 6000;

export async function getHotspots(
  opts: ServiceOptions,
  q: { days: number; country: string | null; confidence: "all" | "nominal_high" | "high"; includeUnassigned: boolean },
): Promise<HotspotResponse[]> {
  const ctx = ctxOf(opts);
  const providers = hotspotProviders(opts.env);
  const days = Math.min(7, Math.max(1, Math.round(q.days)));
  const cutoff = ctx.now.getTime() - days * 86_400_000;

  return Promise.all(
    providers.map(async (p: HotspotProvider): Promise<HotspotResponse> => {
      const fetchHotspots = p.fetchHotspots.bind(p);
      const windowKey = days <= 1 ? 1 : days <= 2 ? 2 : 7;
      const hit = await runCached(hotspotCache, `hotspots:${p.id}:${windowKey}`, p, () => fetchHotspots(ctx, { days: windowKey }), (r) => {
        const v = validateHotspots(r);
        return { stations: 0, inserted: v.hotspots.length, invalid: v.invalid, duplicates: v.duplicates, conflicts: 0, httpStatus: r.httpStatus, attempts: r.attempts };
      });
      const warnings: string[] = [];
      if (hit.error) warnings.push(failureWarning(p.name, hit.error, hit.storedAtMs));
      const all = hit.value ? validateHotspots(hit.value).hotspots : [];
      if (hit.value) warnings.push(...hit.value.warnings);

      const matching = all.filter((h: Hotspot) => {
        if (Date.parse(h.acquiredAtUtc) < cutoff) return false;
        if (q.country && h.countryCode !== q.country) return false;
        if (!q.country && !q.includeUnassigned && h.countryCode === null) return false;
        const c = (h.confidenceRaw ?? "").toLowerCase();
        if (q.confidence === "high" && !(c === "high" || c === "h")) return false;
        if (q.confidence === "nominal_high" && (c === "low" || c === "l")) return false;
        return true;
      });
      const counts = new Map<string, number>();
      for (const h of matching) counts.set(h.acquiredAtUtc.slice(0, 10), (counts.get(h.acquiredAtUtc.slice(0, 10)) ?? 0) + 1);
      const daily = eachDate(new Date(cutoff).toISOString().slice(0, 10), ctx.now.toISOString().slice(0, 10)).map((date) => ({ date, count: counts.get(date) ?? 0 }));
      const latest = all.reduce<string | null>((m, h) => (m === null || h.acquiredAtUtc > m ? h.acquiredAtUtc : m), null);
      if (latest) {
        const f = assessFreshness({ observedAtUtc: latest, expectedIntervalMinutes: p.expectedIntervalMinutes, now: ctx.now });
        if (f.state === "stale") warnings.push(`The most recent detection in this feed is from ${formatUtc(latest)}. ${f.reason}`);
      }
      // Highest radiative power first, so the display cap drops the faintest detections.
      const sorted = [...matching].sort((a, b) => (b.frpMegawatts ?? -1) - (a.frpMegawatts ?? -1));
      const truncated = sorted.length > MAX_HOTSPOTS_RETURNED;
      return {
        generatedAtUtc: ctx.now.toISOString(),
        demoMode: isDemoEnabled(opts.env),
        provider: providerStatus(p, opts.env),
        windowDays: days,
        hotspots: truncated ? sorted.slice(0, MAX_HOTSPOTS_RETURNED) : sorted,
        totalMatching: matching.length,
        truncated,
        daily,
        latestAcquiredAtUtc: latest,
        warnings: [...new Set(warnings)],
      };
    }),
  );
}

export function providerStatuses(env: ProviderEnv): ProviderStatus[] {
  return [...airProviders(env), ...hotspotProviders(env)].map((p) => providerStatus(p, env));
}

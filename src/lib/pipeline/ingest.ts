import { hotspotSchema, observationKey, observationSchema, seriesKey, stationSchema, type Hotspot, type IngestionLog, type Observation, type Station } from "../domain/schemas";
import { HttpError } from "../providers/http";
import type { AirResult, HotspotResult } from "../providers/types";

/**
 * Validation, deduplication and logging shared by every provider.
 *
 * Adapters already validate their raw payloads. This second pass validates the canonical output
 * against the domain schemas, so a bug in one adapter cannot push malformed records to the UI or
 * the database.
 */

export interface ValidatedAir {
  stations: Station[];
  observations: Observation[];
  invalid: number;
  duplicates: number;
  conflicts: number;
}

export interface DedupeResult<T> {
  items: T[];
  duplicates: number;
  /** Same natural key, different value. The first record wins and the conflict is counted. */
  conflicts: number;
}

function sameObservation(a: Observation, b: Observation): boolean {
  return a.value === b.value && a.original.value === b.original.value;
}

export function dedupeObservations(observations: readonly Observation[]): DedupeResult<Observation> {
  const byKey = new Map<string, Observation>();
  let duplicates = 0;
  let conflicts = 0;
  for (const o of observations) {
    const key = observationKey(o);
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, o);
    else if (sameObservation(existing, o)) duplicates += 1;
    else conflicts += 1;
  }
  return { items: [...byKey.values()], duplicates, conflicts };
}

export function validateAir(result: AirResult): ValidatedAir {
  let invalid = result.invalidItems;
  const stations: Station[] = [];
  for (const s of result.stations) {
    const parsed = stationSchema.safeParse(s);
    if (parsed.success) stations.push(parsed.data);
    else invalid += 1;
  }
  const known = new Set(stations.map((s) => s.id));
  const valid: Observation[] = [];
  for (const o of result.observations) {
    const parsed = observationSchema.safeParse(o);
    if (parsed.success && known.has(parsed.data.stationId)) valid.push(parsed.data);
    else invalid += 1;
  }
  const deduped = dedupeObservations(valid);
  return { stations, observations: deduped.items, invalid, duplicates: deduped.duplicates, conflicts: deduped.conflicts };
}

export function validateHotspots(result: HotspotResult): { hotspots: Hotspot[]; invalid: number; duplicates: number } {
  let invalid = result.invalidItems;
  let duplicates = 0;
  const seen = new Set<string>();
  const hotspots: Hotspot[] = [];
  for (const h of result.hotspots) {
    const parsed = hotspotSchema.safeParse(h);
    if (!parsed.success) {
      invalid += 1;
      continue;
    }
    if (seen.has(parsed.data.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(parsed.data.id);
    hotspots.push(parsed.data);
  }
  return { hotspots, invalid, duplicates };
}

/** Latest observation for each series (station + metric + averaging period). */
export function latestPerSeries(observations: readonly Observation[]): Observation[] {
  const latest = new Map<string, Observation>();
  for (const o of observations) {
    const key = seriesKey(o);
    const current = latest.get(key);
    if (!current || o.observedAtUtc > current.observedAtUtc) latest.set(key, o);
  }
  return [...latest.values()];
}

/* ---------------------------------------------------------------------------------------------
 * Ingestion log. Kept in memory (last N per provider) and, when Supabase is configured, persisted.
 * ------------------------------------------------------------------------------------------- */

const LOG_LIMIT = 20;
const logs = new Map<string, IngestionLog[]>();
let counter = 0;

export function describeError(error: unknown): { message: string; httpStatus: number | null; attempts: number } {
  if (error instanceof HttpError) return { message: error.message, httpStatus: error.status, attempts: error.attempts };
  return { message: error instanceof Error ? error.message : String(error), httpStatus: null, attempts: 1 };
}

export function makeLog(input: {
  providerId: string;
  startedAt: Date;
  finishedAt: Date;
  status: IngestionLog["status"];
  httpStatus?: number | null;
  stationsSeen?: number;
  inserted?: number;
  duplicates?: number;
  conflicts?: number;
  invalidItems?: number;
  attempts?: number;
  message?: string | null;
}): IngestionLog {
  counter += 1;
  return {
    id: `${input.providerId}-${input.finishedAt.getTime()}-${counter}`,
    providerId: input.providerId,
    startedAtUtc: input.startedAt.toISOString(),
    finishedAtUtc: input.finishedAt.toISOString(),
    status: input.status,
    httpStatus: input.httpStatus ?? null,
    stationsSeen: input.stationsSeen ?? 0,
    inserted: input.inserted ?? 0,
    duplicates: input.duplicates ?? 0,
    conflicts: input.conflicts ?? 0,
    invalidItems: input.invalidItems ?? 0,
    attempts: input.attempts ?? 0,
    message: input.message ?? null,
  };
}

export function recordLog(log: IngestionLog): void {
  const list = logs.get(log.providerId) ?? [];
  list.unshift(log);
  logs.set(log.providerId, list.slice(0, LOG_LIMIT));
  if (log.status === "failed") console.warn(`[ingest] ${log.providerId} failed: ${log.message}`);
}

export function latestLog(providerId: string): IngestionLog | null {
  return logs.get(providerId)?.[0] ?? null;
}

export function recentLogs(providerId?: string): IngestionLog[] {
  if (providerId) return logs.get(providerId) ?? [];
  return [...logs.values()].flat().sort((a, b) => (a.finishedAtUtc < b.finishedAtUtc ? 1 : -1));
}

export function clearLogs(): void {
  logs.clear();
}

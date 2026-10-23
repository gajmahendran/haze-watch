import { airProviders, hotspotProviders } from "../providers/registry";
import type { ProviderEnv } from "../providers/types";
import { insertIngestionLog, isPersistenceConfigured, upsertHotspots, upsertObservations, upsertStations } from "../store/supabase";
import { describeError, makeLog, recordLog, validateAir, validateHotspots } from "./ingest";

/**
 * Scheduled ingestion: fetch every connected source once (bypassing the read cache), validate,
 * dedupe and persist. Demo providers are never persisted.
 */
export async function runIngestion(env: ProviderEnv, now = new Date()) {
  const persist = isPersistenceConfigured(env);
  const results: { providerId: string; status: string; inserted: number; message: string | null }[] = [];

  for (const p of airProviders(env)) {
    if (p.accessMethod === "demo" || p.connection(env).status !== "connected" || !p.fetchLatest) continue;
    const startedAt = new Date();
    try {
      const raw = await p.fetchLatest({ now, env });
      const v = validateAir(raw);
      let inserted = v.observations.length;
      if (persist) {
        await upsertStations(env, v.stations);
        inserted = await upsertObservations(env, v.observations);
      }
      const log = makeLog({
        providerId: p.id,
        startedAt,
        finishedAt: new Date(),
        status: v.invalid ? "partial" : "success",
        httpStatus: raw.httpStatus,
        stationsSeen: v.stations.length,
        inserted,
        duplicates: v.duplicates,
        conflicts: v.conflicts,
        invalidItems: v.invalid,
        attempts: raw.attempts,
        message: persist ? null : "Persistence not configured; validated but not stored.",
      });
      recordLog(log);
      await insertIngestionLog(env, log);
      results.push({ providerId: p.id, status: log.status, inserted, message: log.message });
    } catch (error) {
      const e = describeError(error);
      const log = makeLog({ providerId: p.id, startedAt, finishedAt: new Date(), status: "failed", httpStatus: e.httpStatus, attempts: e.attempts, message: e.message });
      recordLog(log);
      await insertIngestionLog(env, log);
      results.push({ providerId: p.id, status: "failed", inserted: 0, message: e.message });
    }
  }

  for (const p of hotspotProviders(env)) {
    if (p.accessMethod === "demo") continue;
    const startedAt = new Date();
    try {
      const raw = await p.fetchHotspots({ now, env }, { days: 1 });
      const v = validateHotspots(raw);
      const inserted = persist ? await upsertHotspots(env, v.hotspots) : v.hotspots.length;
      const log = makeLog({ providerId: p.id, startedAt, finishedAt: new Date(), status: v.invalid ? "partial" : "success", httpStatus: raw.httpStatus, inserted, duplicates: v.duplicates, invalidItems: v.invalid, attempts: raw.attempts });
      recordLog(log);
      await insertIngestionLog(env, log);
      results.push({ providerId: p.id, status: log.status, inserted, message: null });
    } catch (error) {
      const e = describeError(error);
      const log = makeLog({ providerId: p.id, startedAt, finishedAt: new Date(), status: "failed", httpStatus: e.httpStatus, attempts: e.attempts, message: e.message });
      recordLog(log);
      await insertIngestionLog(env, log);
      results.push({ providerId: p.id, status: "failed", inserted: 0, message: e.message });
    }
  }

  return { ranAtUtc: now.toISOString(), persisted: persist, results };
}

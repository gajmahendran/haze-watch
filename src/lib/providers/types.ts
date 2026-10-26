import type { CountryCode } from "../domain/countries";
import type {
  AveragingPeriod,
  Hotspot,
  Observation,
  ProviderConnection,
  ProviderStatus,
  Station,
} from "../domain/schemas";
import type { FetchLike } from "./http";

/**
 * The adapter contract. Every data source implements one of these interfaces and emits only the
 * canonical shapes in `domain/schemas.ts`. Pages and components never see a provider's raw format,
 * so a source can be swapped without touching the UI.
 *
 * To add a source: implement the interface in `src/lib/providers/<id>.ts`, add it to `registry.ts`,
 * and document access, licence and cadence in `docs/data-sources.md`.
 */

export type ProviderEnv = Readonly<Record<string, string | undefined>>;

export interface AdapterContext {
  now: Date;
  env: ProviderEnv;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Retries per request. User-facing reads use fewer than scheduled ingestion. */
  retries?: number;
}

export type ProviderMeta = Omit<ProviderStatus, "connection" | "lastIngestion"> & {
  /** How long a successful response is reused before the source is asked again. */
  cacheTtlSeconds: number;
};

export interface FetchStats {
  httpStatus: number | null;
  attempts: number;
  /** Raw items that failed validation and were dropped. Never silently replaced. */
  invalidItems: number;
  warnings: string[];
}

export interface AirResult extends FetchStats {
  stations: Station[];
  observations: Observation[];
}

export interface HotspotResult extends FetchStats {
  /** Detections in the source file that fall outside the map frame and were left out (a routine count). */
  outsideFrame?: number;
  hotspots: Hotspot[];
}

/** A metric the history service can serve, e.g. "index:SG_PSI" or "concentration:PM2.5". */
export interface SeriesDescriptor {
  metricKey: string;
  label: string;
  unitLabel: string;
  averagingPeriod: AveragingPeriod;
}

export interface HistoryQuery {
  stationId: string;
  metricKey: string;
  averagingPeriod: AveragingPeriod;
  /** Inclusive local dates, YYYY-MM-DD, in the provider's zone. */
  from: string;
  to: string;
}

/** A daily or monthly summary of one station's series. Missing values are counted, never zero. */
export interface AggregateBucket {
  key: string;
  count: number;
  missing: number;
  total: number;
  expected: number | null;
  completeness: number | null;
  incomplete: boolean;
  mean: number | null;
  min: number | null;
  max: number | null;
  peakAtUtc: string | null;
}

export interface AggregateQuery extends HistoryQuery {
  granularity: "day" | "month";
}

export interface AggregateResult {
  stations: Station[];
  series: { stationId: string; buckets: AggregateBucket[] }[];
  warnings: string[];
}

export interface AirProvider extends ProviderMeta {
  kind: "air";
  connection(env: ProviderEnv): ProviderConnection;
  /** Latest readings. Absent for history-only sources. */
  fetchLatest?(ctx: AdapterContext): Promise<AirResult>;
  /** Readings for a date range. */
  fetchHistory?(ctx: AdapterContext, query: HistoryQuery): Promise<AirResult>;
  /** What can be charted from this provider. */
  series: readonly SeriesDescriptor[];
  /** Stations the history explorer can offer before any live call has been made. */
  knownStations: readonly Station[];
  /**
   * How the history service should request and cache history: one call per local day, one call for
   * the whole series, or one call per requested range (for sources that cache their own dataset).
   */
  historyChunk: "day" | "all" | "range";
  /** Longest range one history request may cover without persistence configured. */
  maxHistoryDays: number;
  /** Optional server-side summaries over long ranges (for sources that hold the whole dataset). */
  fetchAggregate?(ctx: AdapterContext, query: AggregateQuery): Promise<AggregateResult>;
  /** Longest range a summary request may cover. Defaults to maxHistoryDays. */
  maxAggregateDays?: number;
  /** How the source assigns the midnight reading to a day, shown next to daily summaries. */
  dayConvention?: string;
  /** IANA zone for interpreting the provider's local dates. */
  zone: "Asia/Singapore" | "Asia/Kuala_Lumpur" | "UTC";
}

export interface HotspotProvider extends ProviderMeta {
  kind: "hotspots";
  connection(env: ProviderEnv): ProviderConnection;
  fetchHotspots(ctx: AdapterContext, options: { days: number }): Promise<HotspotResult>;
}

export type Provider = AirProvider | HotspotProvider;

export class ProviderNotConnectedError extends Error {
  constructor(providerId: string, detail: string) {
    super(`${providerId} is not connected: ${detail}`);
    this.name = "ProviderNotConnectedError";
  }
}

export class PayloadError extends Error {
  constructor(providerId: string, detail: string) {
    super(`${providerId} returned an unexpected payload: ${detail}`);
    this.name = "PayloadError";
  }
}

export function isDemoEnabled(env: ProviderEnv): boolean {
  // Demo data can never be switched on in a production build.
  return env.HAZE_DEMO_MODE === "true" && env.NODE_ENV !== "production";
}

export type { CountryCode };

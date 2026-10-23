import { localDateKey, localMonthKey, type KnownTimezone } from "./time";

/**
 * Time-series summaries.
 *
 * Rules enforced here:
 *  - A missing point is `null` (or NaN/undefined on input). It is excluded from every statistic and
 *    is never treated as zero. A genuine reading of 0 is a valid value and IS included.
 *  - No interpolation. Gaps stay gaps.
 *  - A bucket with no valid points has a `null` mean, not 0.
 */

export interface SeriesPoint {
  /** UTC ISO timestamp. */
  t: string;
  v: number | null | undefined;
}

export interface SeriesSummary {
  /** Points with a valid numeric value. */
  count: number;
  /** Points present in the series but without a value. */
  missing: number;
  total: number;
  /** count / total, or null for an empty series. */
  coverage: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  /** Highest value, earliest timestamp on ties. */
  peak: { t: string; v: number } | null;
}

function isValid(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function summarise(points: readonly SeriesPoint[]): SeriesSummary {
  let count = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  let peak: { t: string; v: number } | null = null;

  for (const p of points) {
    if (!isValid(p.v)) continue;
    count += 1;
    sum += p.v;
    if (min === null || p.v < min) min = p.v;
    if (max === null || p.v > max) max = p.v;
    if (peak === null || p.v > peak.v || (p.v === peak.v && p.t < peak.t)) peak = { t: p.t, v: p.v };
  }

  const total = points.length;
  return {
    count,
    missing: total - count,
    total,
    coverage: total === 0 ? null : count / total,
    min,
    max,
    mean: count === 0 ? null : sum / count,
    peak,
  };
}

export type Granularity = "day" | "month";

export interface Bucket extends SeriesSummary {
  /** YYYY-MM-DD or YYYY-MM in the chosen local zone. */
  key: string;
  /** Number of readings the bucket would hold if the source published on schedule. */
  expected: number | null;
  /** count / expected, capped at 1. */
  completeness: number | null;
  /** True when completeness is below `minCoverage`. The mean is still shown but must be flagged. */
  incomplete: boolean;
}

/** Platform default. This is an editorial threshold, not an official validity rule. */
export const DEFAULT_MIN_COVERAGE = 0.75;

function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function expectedCount(granularity: Granularity, key: string, intervalMinutes: number | null): number | null {
  if (intervalMinutes === null || intervalMinutes <= 0) return null;
  const perDay = Math.round(1440 / intervalMinutes);
  return granularity === "day" ? perDay : perDay * daysInMonth(key);
}

export function bucketSeries(
  points: readonly SeriesPoint[],
  granularity: Granularity,
  zone: KnownTimezone,
  options: { intervalMinutes?: number | null; minCoverage?: number } = {},
): Bucket[] {
  const keyOf = granularity === "day" ? localDateKey : localMonthKey;
  const groups = new Map<string, SeriesPoint[]>();
  for (const p of points) {
    const key = keyOf(p.t, zone);
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }

  const minCoverage = options.minCoverage ?? DEFAULT_MIN_COVERAGE;
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, group]) => {
      const summary = summarise(group);
      const expected = expectedCount(granularity, key, options.intervalMinutes ?? null);
      const completeness = expected === null ? null : Math.min(1, summary.count / expected);
      return {
        ...summary,
        key,
        expected,
        completeness,
        incomplete: completeness !== null && completeness < minCoverage,
      };
    });
}

export interface PeriodComparison {
  a: SeriesSummary;
  b: SeriesSummary;
  /** mean(b) - mean(a). Null when either period has no valid data. */
  meanDelta: number | null;
  /** meanDelta relative to mean(a), as a percentage. Null when mean(a) is 0 or undefined. */
  meanDeltaPercent: number | null;
  caveats: string[];
}

/** Compares two periods of the SAME series (same station, metric, unit and averaging period). */
export function comparePeriods(a: readonly SeriesPoint[], b: readonly SeriesPoint[]): PeriodComparison {
  const sa = summarise(a);
  const sb = summarise(b);
  const caveats: string[] = [];

  if (sa.count === 0) caveats.push("Period A has no valid readings.");
  if (sb.count === 0) caveats.push("Period B has no valid readings.");
  if (sa.coverage !== null && sa.coverage < DEFAULT_MIN_COVERAGE) {
    caveats.push(`Period A is missing ${sa.missing} of ${sa.total} readings.`);
  }
  if (sb.coverage !== null && sb.coverage < DEFAULT_MIN_COVERAGE) {
    caveats.push(`Period B is missing ${sb.missing} of ${sb.total} readings.`);
  }

  const meanDelta = sa.mean !== null && sb.mean !== null ? sb.mean - sa.mean : null;
  const meanDeltaPercent =
    meanDelta !== null && sa.mean !== null && sa.mean !== 0 ? (meanDelta / sa.mean) * 100 : null;

  return { a: sa, b: sb, meanDelta, meanDeltaPercent, caveats };
}

/**
 * Stale-data detection.
 *
 * A provider declares how often it expects to publish. A reading is judged against that cadence:
 *   fresh    age <= 1.5 x interval
 *   delayed  age <= 3   x interval
 *   stale    older than that
 *   unknown  we cannot judge (no declared cadence, unparseable or future timestamp)
 *
 * These multipliers are this platform's own editorial setting, not an official standard.
 * "Stale" data is still shown, always with its timestamp and a visible warning, never hidden.
 */

export const FRESH_FACTOR = 1.5;
export const STALE_FACTOR = 3;
/** Tolerance for small clock differences between source and viewer. */
const FUTURE_TOLERANCE_MINUTES = 5;

export type FreshnessState = "fresh" | "delayed" | "stale" | "unknown";

export interface FreshnessAssessment {
  state: FreshnessState;
  ageMinutes: number | null;
  reason: string;
}

export function assessFreshness(input: {
  observedAtUtc: string;
  expectedIntervalMinutes: number | null;
  now: Date;
}): FreshnessAssessment {
  const observedMs = Date.parse(input.observedAtUtc);
  if (Number.isNaN(observedMs)) {
    return { state: "unknown", ageMinutes: null, reason: "The reading's timestamp could not be parsed." };
  }
  const ageMinutes = (input.now.getTime() - observedMs) / 60_000;

  if (ageMinutes < -FUTURE_TOLERANCE_MINUTES) {
    return {
      state: "unknown",
      ageMinutes,
      reason: "The reading is timestamped in the future, which suggests a clock or timezone problem.",
    };
  }

  const interval = input.expectedIntervalMinutes;
  if (interval === null || interval <= 0) {
    return {
      state: "unknown",
      ageMinutes: Math.max(0, ageMinutes),
      reason: "This source does not declare an update interval, so freshness cannot be judged.",
    };
  }

  const age = Math.max(0, ageMinutes);
  if (age <= interval * FRESH_FACTOR) {
    return { state: "fresh", ageMinutes: age, reason: `Within the expected ${formatAge(interval)} update interval.` };
  }
  if (age <= interval * STALE_FACTOR) {
    return {
      state: "delayed",
      ageMinutes: age,
      reason: `Later than the expected ${formatAge(interval)} update interval.`,
    };
  }
  return {
    state: "stale",
    ageMinutes: age,
    reason: `Much older than the expected ${formatAge(interval)} update interval. The source may have stopped publishing.`,
  };
}

/** Human readable duration. "42 min", "5.5 h", "3 days". */
export function formatAge(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "unknown";
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} days`;
}

const SEVERITY: Record<FreshnessState, number> = { fresh: 0, delayed: 1, unknown: 2, stale: 3 };

/** The least reassuring state in a set. An empty set is "unknown", not "fresh". */
export function worstState(states: readonly FreshnessState[]): FreshnessState {
  if (states.length === 0) return "unknown";
  return states.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst));
}

export const FRESHNESS_LABEL: Record<FreshnessState, string> = {
  fresh: "Up to date",
  delayed: "Delayed",
  stale: "Stale",
  unknown: "Freshness unknown",
};

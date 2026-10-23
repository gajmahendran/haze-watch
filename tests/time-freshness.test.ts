import { describe, expect, it } from "vitest";
import { assessFreshness, formatAge, worstState } from "@/lib/domain/freshness";
import { formatInZone, localDateKey, parseSourceTimestamp, TimestampError } from "@/lib/domain/time";

describe("timestamp normalisation", () => {
  it("uses an explicit offset and keeps the original string", () => {
    const t = parseSourceTimestamp("2026-10-22T20:00:00+08:00");
    expect(t.utcIso).toBe("2026-10-22T12:00:00.000Z");
    expect(t.sourceTimestamp).toBe("2026-10-22T20:00:00+08:00");
    expect(t.sourceTimezone).toBe("+08:00");
  });

  it("applies a declared fallback zone to naive local times", () => {
    const t = parseSourceTimestamp("2026-10-22 08:00", "Asia/Jakarta");
    expect(t.utcIso).toBe("2026-10-22T01:00:00.000Z");
    expect(t.sourceTimezone).toBe("Asia/Jakarta");
  });

  it("handles Myanmar's half-hour offset", () => {
    expect(parseSourceTimestamp("2026-10-22T06:30", "Asia/Yangon").utcIso).toBe("2026-10-22T00:00:00.000Z");
  });

  it("refuses to guess a zone, and rejects impossible dates", () => {
    expect(() => parseSourceTimestamp("2026-10-22T08:00")).toThrow(TimestampError);
    expect(() => parseSourceTimestamp("2026-02-30T08:00", "UTC")).toThrow(/Impossible/);
    expect(() => parseSourceTimestamp("yesterday", "UTC")).toThrow(/Unrecognised/);
  });

  it("formats deterministically in the reader's zone with an abbreviation", () => {
    expect(formatInZone("2026-10-22T16:30:00.000Z", "Asia/Kuala_Lumpur")).toBe("23 Oct 2026, 00:30 MYT");
  });

  it("buckets by local day, not UTC day", () => {
    // 17:00 UTC is 01:00 the next day in Singapore.
    expect(localDateKey("2026-10-22T17:00:00.000Z", "Asia/Singapore")).toBe("2026-10-23");
    expect(localDateKey("2026-10-22T15:59:00.000Z", "Asia/Singapore")).toBe("2026-10-22");
  });
});

describe("stale data detection", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  it("grades age against the provider's declared interval", () => {
    expect(assessFreshness({ observedAtUtc: at(80), expectedIntervalMinutes: 60, now }).state).toBe("fresh");
    expect(assessFreshness({ observedAtUtc: at(150), expectedIntervalMinutes: 60, now }).state).toBe("delayed");
    expect(assessFreshness({ observedAtUtc: at(600), expectedIntervalMinutes: 60, now }).state).toBe("stale");
  });

  it("says 'unknown' rather than 'fresh' when it cannot judge", () => {
    expect(assessFreshness({ observedAtUtc: at(5), expectedIntervalMinutes: null, now }).state).toBe("unknown");
    expect(assessFreshness({ observedAtUtc: "not a date", expectedIntervalMinutes: 60, now }).state).toBe("unknown");
    expect(assessFreshness({ observedAtUtc: at(-120), expectedIntervalMinutes: 60, now }).state).toBe("unknown");
  });

  it("reports the least reassuring state, and an empty set is not fresh", () => {
    expect(worstState(["fresh", "stale", "delayed"])).toBe("stale");
    expect(worstState([])).toBe("unknown");
  });

  it("formats ages for people", () => {
    expect(formatAge(42)).toBe("42 min");
    expect(formatAge(330)).toBe("5.5 h");
    expect(formatAge(4320)).toBe("3 days");
  });
});

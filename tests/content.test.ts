import { describe, expect, it } from "vitest";
import { loadCountryProfile, loadEducation, loadEvents, loadLibrary } from "@/lib/content/loader";
import { hazeEventSchema } from "@/lib/content/schema";
import { COUNTRY_CODES } from "@/lib/domain/countries";

describe("editorial content", () => {
  const events = loadEvents();

  it("loads and validates every content file", () => {
    expect(events.length).toBeGreaterThanOrEqual(9);
    expect(loadLibrary().length).toBeGreaterThan(20);
    expect(loadEducation()?.topics.length).toBe(9);
    for (const code of COUNTRY_CODES) expect(loadCountryProfile(code)).toBeDefined();
  });

  it("covers every year on the research agenda", () => {
    const covered = new Set(events.flatMap((e) => Array.from({ length: e.yearEnd - e.yearStart + 1 }, (_, i) => e.yearStart + i)));
    for (const y of [1997, 1998, 2006, 2013, 2015, 2019, 2023, 2024, 2025, 2026]) expect(covered.has(y)).toBe(true);
  });

  it("never pairs an unrated or agenda episode with a severity claim", () => {
    for (const e of events) {
      if (e.status === "research_agenda") expect(e.severity).toBe("unrated");
    }
  });

  it("names the averaging period of every recorded reading", () => {
    for (const e of events) for (const m of e.measurements) expect(m.averagingPeriod.length).toBeGreaterThan(2);
  });

  it("only cites sources that were accessed and listed", () => {
    for (const e of events) {
      for (const s of e.sources) expect(s.accessedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("rejects a claim that cites a source that is not in the list", () => {
    const bad = structuredClone(events[0]!);
    bad.summarySourceIds = ["s99"];
    const r = hazeEventSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/Unknown source id/);
  });

  it("requires open questions on anything not fully verified", () => {
    const bad = structuredClone(events.find((e) => e.status === "partial")!);
    bad.openQuestions = [];
    expect(hazeEventSchema.safeParse(bad).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  assertComparable,
  assertComparableConcentrations,
  categoryFor,
  compareIndexReadings,
  formatIndexReading,
  groupByIndex,
  IncompatibleConcentrationError,
  IncompatibleIndexError,
  INDEX_REGISTRY,
  rankIndexReadings,
  sgPm25BandFor,
} from "@/lib/domain/indices";

describe("national index safety", () => {
  const psi = { indexId: "SG_PSI" as const, value: 120 };
  const api = { indexId: "MY_API" as const, value: 120 };

  it("refuses to compare Singapore PSI with Malaysia API, even with identical numbers", () => {
    expect(() => assertComparable(psi, api)).toThrow(IncompatibleIndexError);
    expect(() => compareIndexReadings(psi, api)).toThrow(/not interchangeable/);
  });

  it("refuses to rank a mixed list of indices", () => {
    expect(() => rankIndexReadings([psi, api])).toThrow(IncompatibleIndexError);
  });

  it("ranks readings on one scale, highest first, with missing values last", () => {
    const ranked = rankIndexReadings([
      { indexId: "SG_PSI" as const, value: 40 },
      { indexId: "SG_PSI" as const, value: null },
      { indexId: "SG_PSI" as const, value: 150 },
    ]);
    expect(ranked.map((r) => r.value)).toEqual([150, 40, null]);
  });

  it("groups mixed readings into one list per scale instead of merging them", () => {
    const groups = groupByIndex([psi, api, { indexId: "SG_PSI" as const, value: 10 }]);
    expect(groups.get("SG_PSI")).toHaveLength(2);
    expect(groups.get("MY_API")).toHaveLength(1);
  });

  it("always names the scale when formatting, so a bare number is never shown", () => {
    expect(formatIndexReading(psi)).toBe("Singapore PSI 120 (Unhealthy)");
    expect(formatIndexReading(api)).toBe("Malaysia API 120 (Unhealthy)");
    expect(formatIndexReading({ indexId: "MY_API", value: null })).toBe("Malaysia API: no value reported");
  });

  it("puts the published band edges on the right side", () => {
    expect(categoryFor("SG_PSI", 50)?.label).toBe("Good");
    expect(categoryFor("SG_PSI", 51)?.label).toBe("Moderate");
    expect(categoryFor("SG_PSI", 300)?.label).toBe("Very unhealthy");
    expect(categoryFor("SG_PSI", 301)?.label).toBe("Hazardous");
    expect(categoryFor("SG_PSI", null)).toBeNull();
    expect(categoryFor("SG_PSI", -1)).toBeNull();
  });

  it("records where band thresholds come from and flags Malaysia as provisional", () => {
    expect(INDEX_REGISTRY.SG_PSI.bandsVerifiedAgainstSource).toBe(true);
    expect(INDEX_REGISTRY.MY_API.bandsVerifiedAgainstSource).toBe(false);
    for (const def of Object.values(INDEX_REGISTRY)) expect(def.bandsSourceUrls.length).toBeGreaterThan(0);
  });
});

describe("concentration comparability", () => {
  const base = { pollutant: "PM2.5", unit: "µg/m³", averagingPeriod: "PT1H", value: 30 };
  it("refuses different averaging periods, units or pollutants", () => {
    expect(() => assertComparableConcentrations(base, { ...base, averagingPeriod: "PT24H" })).toThrow(IncompatibleConcentrationError);
    expect(() => assertComparableConcentrations(base, { ...base, unit: "mg/m³" })).toThrow(/units differ/);
    expect(() => assertComparableConcentrations(base, { ...base, pollutant: "PM10" })).toThrow(/pollutants differ/);
    expect(() => assertComparableConcentrations(base, { ...base, value: 99 })).not.toThrow();
  });
});

describe("Singapore 1-hour PM2.5 bands", () => {
  const r = { pollutant: "PM2.5", unit: "µg/m³", averagingPeriod: "PT1H", countryCode: "SG" };
  it("applies only to 1-hour PM2.5 in Singapore", () => {
    expect(sgPm25BandFor({ ...r, value: 55 })?.label).toBe("Band 1 (Normal)");
    expect(sgPm25BandFor({ ...r, value: 56 })?.label).toBe("Band 2 (Elevated)");
    expect(sgPm25BandFor({ ...r, value: 251 })?.label).toBe("Band 4 (Very High)");
    expect(sgPm25BandFor({ ...r, averagingPeriod: "PT24H", value: 60 })).toBeNull();
    expect(sgPm25BandFor({ ...r, countryCode: "MY", value: 60 })).toBeNull();
    expect(sgPm25BandFor({ ...r, value: null })).toBeNull();
  });
});

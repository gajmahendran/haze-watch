import { beforeEach, describe, expect, it } from "vitest";
import { getAggregate, getHistory, getPsiBandDays, resetCaches } from "@/lib/pipeline/service";
import {
  aggregateTable,
  clearArchiveCache,
  parseArchiveCsv,
  parseArchiveTimestamp,
  primeArchive,
  sgDayRange,
  tableToObservations,
  yearlyPsiBandDays,
} from "@/lib/providers/sg-nea-archive";

// The first three and last three rows were read from data.gov.sg dataset d_b4cf557f8750260d229c49fd768e11ed
// on 2026-10-23. Everything between them is hand-written to test edge cases and is not real data.
const CSV = [
  "24hr_psi,north,south,east,west,central",
  "1/4/2014 1:00,55,54,54,58,54",
  "1/4/2014 2:00,55,54,54,59,54",
  "1/4/2014 3:00,55,55,54,60,55",
  "15/9/2019 23:00,120,110,107,124,118", // hand-written
  "16/9/2019 0:00,121,,108,125,-", // hand-written: blank and dash are missing
  "16/9/2019 1:00,205,190,180,210,199", // hand-written
  "31/2/2020 1:00,1,1,1,1,1", // hand-written: impossible date, must be skipped
  "30/9/2026 22:00,83,94,99,102,102",
  "30/9/2026 23:00,81,92,97,99,99",
  "1/10/2026 0:00,79,89,95,96,96",
].join("\r\n");

describe("NEA archive parsing", () => {
  it("reads d/m/yyyy H:mm as Singapore time", () => {
    expect(new Date(parseArchiveTimestamp("1/10/2026 0:00")).toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(new Date(parseArchiveTimestamp("1/4/2014 1:00")).toISOString()).toBe("2014-03-31T17:00:00.000Z");
    expect(parseArchiveTimestamp("31/2/2020 1:00")).toBeNaN();
    expect(parseArchiveTimestamp("2020-02-01 01:00")).toBeNaN();
  });

  it("keeps missing cells missing and remembers odd raw text", () => {
    const t = parseArchiveCsv(CSV);
    expect(t.times.length).toBe(9);
    expect(t.invalidRows).toBe(1);
    const i = t.rawTimes.indexOf("16/9/2019 0:00");
    expect(t.values.south[i]).toBeNaN();
    expect(t.values.central[i]).toBeNaN();
    expect(t.rawOddCells.get(`${i}:central`)).toBe("-");
  });

  it("emits observations with original timestamps, for one region or all", () => {
    const t = parseArchiveCsv(CSV);
    const [a, b] = sgDayRange("2019-09-15", "2019-09-16");
    const west = tableToObservations(t, "psi", { stationIds: ["sg-nea-archive:west"], startMs: a, endMs: b, retrievedAtUtc: "2026-10-23T00:00:00.000Z" });
    expect(west.map((o) => o.value)).toEqual([124, 125, 210]);
    expect(west[0]!.original.timestamp).toBe("15/9/2019 23:00");
    expect(west[0]).toMatchObject({ kind: "index", indexId: "SG_PSI", averagingPeriod: "PT24H" });
    const all = tableToObservations(t, "psi", { stationIds: ["all"], startMs: a, endMs: b, retrievedAtUtc: "2026-10-23T00:00:00.000Z" });
    expect(all).toHaveLength(15);
    expect(all.find((o) => o.stationId === "sg-nea-archive:central" && o.original.timestamp === "16/9/2019 0:00")!.value).toBeNull();
  });
});

describe("archive summaries", () => {
  it("counts the 00:00 reading in the day it closes, as NEA's archive does", () => {
    const t = parseArchiveCsv(CSV);
    const [a, b] = sgDayRange("2019-09-15", "2019-09-16");
    const days = aggregateTable(t, "west", a + 1, b + 1, "day");
    expect(days.map((d) => d.key)).toEqual(["2019-09-15", "2019-09-16"]);
    expect(days[0]!.count).toBe(2); // 23:00 and 24:00 (written 16/9 0:00)
    expect(days[0]!.max).toBe(125);
    expect(days[0]!.incomplete).toBe(true);
  });

  it("excludes missing values from means and never treats them as zero", () => {
    const t = parseArchiveCsv(CSV);
    const [a, b] = sgDayRange("2019-09-15", "2019-09-15");
    const [day] = aggregateTable(t, "central", a + 1, b + 1, "day");
    expect(day!.count).toBe(1);
    expect(day!.missing).toBe(1);
    expect(day!.mean).toBe(118);
  });

  it("counts band days per year from any region", () => {
    const years = yearlyPsiBandDays(parseArchiveCsv(CSV));
    const y2019 = years.find((y) => y.year === 2019)!;
    expect(y2019.unhealthyOrWorse).toBe(2);
    expect(y2019.veryUnhealthyOrWorse).toBe(1);
    expect(y2019.hazardous).toBe(0);
    expect(y2019.peak).toBe(210);
    expect(y2019.peakRegion).toBe("west");
    const y2026 = years.find((y) => y.year === 2026)!;
    expect(y2026.unhealthyOrWorse).toBe(1); // west and central reached 102 on 30 Sep
  });
});

describe("archive through the service", () => {
  beforeEach(() => {
    resetCaches();
    clearArchiveCache();
    primeArchive("psi", parseArchiveCsv(CSV), Date.parse("2026-10-23T00:00:00Z"));
  });
  const now = new Date("2026-10-23T01:00:00Z");

  it("serves raw history without touching the network once the table is loaded", async () => {
    const fetchImpl = async () => {
      throw new Error("network should not be used");
    };
    const h = await getHistory(
      { env: {}, now, fetchImpl },
      { providerId: "sg-nea-archive", stationId: "sg-nea-archive:west", metricKey: "index:SG_PSI", averagingPeriod: "PT24H", from: "2019-09-15", to: "2019-09-16" },
    );
    expect(h.observations.map((o) => o.value)).toEqual([124, 125, 210]);
  });

  it("summarises up to the long-range limit and rejects longer", async () => {
    const agg = await getAggregate(
      { env: {}, now },
      { providerId: "sg-nea-archive", stationId: "all", metricKey: "index:SG_PSI", averagingPeriod: "PT24H", from: "2014-04-01", to: "2026-10-01", granularity: "month" },
    );
    expect(agg.series).toHaveLength(5);
    expect(agg.series[0]!.buckets[0]!.key).toBe("2014-04");
    await expect(
      getAggregate({ env: {}, now }, { providerId: "sg-nea-archive", stationId: "all", metricKey: "index:SG_PSI", averagingPeriod: "PT24H", from: "2000-01-01", to: "2026-10-01", granularity: "month" }),
    ).rejects.toThrow(/limited to/);
  });

  it("still refuses raw ranges over a year", async () => {
    await expect(
      getHistory({ env: {}, now }, { providerId: "sg-nea-archive", stationId: "all", metricKey: "index:SG_PSI", averagingPeriod: "PT24H", from: "2019-01-01", to: "2021-01-01" }),
    ).rejects.toThrow(/limited to 366 days/);
  });

  it("publishes the band-day method with the figures", async () => {
    const r = await getPsiBandDays({ env: {}, now });
    expect(r.method).toMatch(/not an NEA statistic/);
    expect(r.coverage.first).toBe("2014-03-31T17:00:00.000Z");
  });
});

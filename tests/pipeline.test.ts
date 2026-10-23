import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Observation } from "@/lib/domain/schemas";
import { backoffDelay, fetchWithRetry, HttpError, parseRetryAfter, RateLimiter } from "@/lib/providers/http";
import { TtlCache } from "@/lib/pipeline/cache";
import { clearLogs, dedupeObservations, latestPerSeries, validateAir } from "@/lib/pipeline/ingest";
import { getHistory, getHotspots, getSnapshot, HistoryRequestError, resetCaches } from "@/lib/pipeline/service";
import { airProviders } from "@/lib/providers/registry";
import { isDemoEnabled } from "@/lib/providers/types";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const noSleep = async () => {};

function response(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

describe("HTTP retries", () => {
  it("retries transient failures with backoff and then succeeds", async () => {
    const calls: number[] = [];
    const sleeps: number[] = [];
    const fetchImpl = async () => {
      calls.push(1);
      return calls.length < 3 ? response(503, "busy") : response(200, "{}");
    };
    const r = await fetchWithRetry("https://x.test/a", { fetchImpl, sleep: async (ms) => void sleeps.push(ms), random: () => 1 });
    expect(r.attempts).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("does not retry a permanent client error", async () => {
    let n = 0;
    const fetchImpl = async () => (n++, response(404, "no"));
    await expect(fetchWithRetry("https://x.test/a", { fetchImpl, sleep: noSleep })).rejects.toMatchObject({ status: 404, transient: false });
    expect(n).toBe(1);
  });

  it("honours Retry-After on 429, capped", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fetchImpl = async () => (n++ === 0 ? response(429, "slow down", { "retry-after": "3" }) : response(200, "{}"));
    await fetchWithRetry("https://x.test/a", { fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([3000]);
    expect(parseRetryAfter("120")).toBe(120_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(backoffDelay(10, 500, 8000, () => 1)).toBe(8000);
  });

  it("turns network failures into a transient HttpError after the last attempt", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    const err = await fetchWithRetry("https://x.test/a", { fetchImpl, sleep: noSleep, retries: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.transient).toBe(true);
    expect(err.attempts).toBe(2);
  });

  it("rate limiter waits when the window is full", async () => {
    let t = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(2, 10_000, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(waits.length).toBe(1);
    expect(t).toBeGreaterThanOrEqual(10_000);
  });
});

const obs = (over: Partial<Observation> = {}): Observation =>
  ({
    kind: "concentration", providerId: "p", stationId: "p:a", countryCode: "SG",
    observedAtUtc: "2026-10-22T12:00:00.000Z", retrievedAtUtc: "2026-10-22T12:05:00.000Z",
    original: { value: 30, unit: "µg/m³", timestamp: "2026-10-22T20:00:00+08:00", timezone: "+08:00" },
    quality: "unvalidated", provenance: "provider", sourceUrl: "https://x.test/",
    pollutant: "PM2.5", value: 30, unit: "µg/m³", averagingPeriod: "PT1H", ...over,
  }) as Observation;

describe("duplicate prevention", () => {
  it("drops exact re-ingestions and counts conflicting duplicates separately", () => {
    const r = dedupeObservations([obs(), obs(), obs({ value: 31, original: { value: 31, unit: "µg/m³", timestamp: "x", timezone: "+08:00" } }), obs({ averagingPeriod: "PT24H" })]);
    expect(r.items).toHaveLength(2);
    expect(r.duplicates).toBe(1);
    expect(r.conflicts).toBe(1);
  });

  it("keeps the latest reading per series", () => {
    const latest = latestPerSeries([obs({ observedAtUtc: "2026-10-22T10:00:00.000Z" }), obs({ observedAtUtc: "2026-10-22T13:00:00.000Z" })]);
    expect(latest).toHaveLength(1);
    expect(latest[0]!.observedAtUtc).toBe("2026-10-22T13:00:00.000Z");
  });

  it("rejects canonical records that fail validation or reference unknown stations", () => {
    const station = { id: "p:a", providerId: "p", externalId: "a", name: "A", countryCode: "SG" as const, kind: "station" as const, latitude: 1, longitude: 103, area: null };
    const v = validateAir({
      stations: [station],
      observations: [obs(), obs({ stationId: "p:missing" }), obs({ value: -5 } as Partial<Observation>), obs({ observedAtUtc: "yesterday" })],
      invalidItems: 0, warnings: [], httpStatus: 200, attempts: 1,
    });
    expect(v.observations).toHaveLength(1);
    expect(v.invalid).toBe(3);
  });
});

describe("cache", () => {
  it("coalesces concurrent loads and serves the last good value with the error on failure", async () => {
    let t = 0;
    const cache = new TtlCache<number>(() => t);
    let loads = 0;
    const load = async () => (loads++, 42);
    const [a, b] = await Promise.all([cache.get("k", 1000, load), cache.get("k", 1000, load)]);
    expect(loads).toBe(1);
    expect(a.value).toBe(42);
    expect(b.value).toBe(42);
    t = 5000;
    const failed = await cache.get("k", 1000, async () => {
      throw new Error("down");
    });
    expect(failed.value).toBe(42);
    expect(failed.fromCache).toBe(true);
    expect(failed.error?.message).toBe("down");
    expect(failed.storedAtMs).toBe(0);
  });

  it("remembers a failure briefly instead of hammering a dead source, then retries", async () => {
    let t = 0;
    const cache = new TtlCache<number>(() => t, 10, 60_000);
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("down");
    };
    expect((await cache.get("k", 600_000, failing)).error?.message).toBe("down");
    t = 30_000;
    const second = await cache.get("k", 600_000, failing);
    expect(second.error?.message).toBe("down");
    expect(second.value).toBeNull();
    expect(calls).toBe(1);
    t = 61_000;
    await cache.get("k", 600_000, async () => 7);
    expect((await cache.get("k", 600_000, failing)).value).toBe(7);
  });
});

describe("snapshot", () => {
  beforeEach(() => {
    resetCaches();
    clearLogs();
  });

  it("shows an honest warning and no readings when a live source fails", async () => {
    const fetchImpl = async () => response(503, "down");
    const snap = await getSnapshot({ env: {}, fetchImpl, sleep: noSleep, now: new Date("2026-10-22T14:30:00Z") });
    expect(snap.observations).toHaveLength(0);
    expect(snap.demoMode).toBe(false);
    expect(snap.warnings.some((w) => /Singapore PSI and PM2.5 \(NEA\) is unavailable/.test(w))).toBe(true);
    const nea = snap.providers.find((p) => p.id === "sg-nea-air")!;
    expect(nea.lastIngestion?.status).toBe("failed");
    expect(snap.providers.find((p) => p.id === "my-doe-apims")!.connection.status).toBe("not_connected");
  });

  it("assembles real readings from the adapters when the source responds", async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/psi")) return response(200, fixture("nea-psi-2026-10-22.json"));
      if (url.endsWith("/pm25")) return response(200, fixture("nea-pm25-2026-10-22.json"));
      return response(503, "weather down");
    };
    const snap = await getSnapshot({ env: {}, fetchImpl, sleep: noSleep, now: new Date("2026-10-22T14:30:00Z") });
    expect(snap.stations.filter((s) => s.providerId === "sg-nea-air")).toHaveLength(5);
    expect(snap.observations.filter((o) => o.kind === "index")).toHaveLength(5);
    expect(snap.observations.every((o) => o.provenance === "provider")).toBe(true);
  });

  it("can never enable demo data in production", () => {
    expect(isDemoEnabled({ HAZE_DEMO_MODE: "true", NODE_ENV: "production" })).toBe(false);
    expect(isDemoEnabled({ HAZE_DEMO_MODE: "true", NODE_ENV: "development" })).toBe(true);
    expect(airProviders({ HAZE_DEMO_MODE: "true", NODE_ENV: "production" }).some((p) => p.accessMethod === "demo")).toBe(false);
  });

  it("labels demo readings as demo when demo mode is on", async () => {
    const fetchImpl = async () => response(503, "down");
    const snap = await getSnapshot({ env: { HAZE_DEMO_MODE: "true", NODE_ENV: "test" }, fetchImpl, sleep: noSleep });
    const demo = snap.observations.filter((o) => o.provenance === "demo");
    expect(demo.length).toBeGreaterThan(0);
    expect(snap.stations.filter((s) => s.providerId === "demo-air").every((s) => s.name.startsWith("DEMO"))).toBe(true);
  });
});

describe("history", () => {
  beforeEach(() => resetCaches());

  it("refuses ranges longer than the live limit instead of silently truncating", async () => {
    await expect(
      getHistory({ env: {} }, { providerId: "sg-nea-air", stationId: "sg-nea-air:west", metricKey: "index:SG_PSI", averagingPeriod: "PT24H", from: "2026-09-01", to: "2026-10-01" }),
    ).rejects.toBeInstanceOf(HistoryRequestError);
  });

  it("refuses history from a source that is not connected", async () => {
    await expect(
      getHistory({ env: {} }, { providerId: "my-doe-apims", stationId: "x", metricKey: "index:MY_API", averagingPeriod: "PT1H", from: "2026-10-01", to: "2026-10-01" }),
    ).rejects.toThrow(/not connected/);
  });

  it("returns failed days as gaps, not zeros", async () => {
    let n = 0;
    const fetchImpl = async () => (n++ === 0 ? response(200, fixture("nea-psi-2026-10-22.json")) : response(500, "x"));
    const h = await getHistory(
      { env: {}, fetchImpl, sleep: noSleep, now: new Date("2026-10-23T02:00:00Z") },
      { providerId: "sg-nea-air", stationId: "sg-nea-air:west", metricKey: "index:SG_PSI", averagingPeriod: "PT24H", from: "2026-10-22", to: "2026-10-23" },
    );
    expect(h.observations.map((o) => o.value)).toEqual([89]);
    expect(h.failedChunks).toEqual(["2026-10-23"]);
  });
});

describe("hotspots service", () => {
  beforeEach(() => resetCaches());

  it("filters by polygon country and reports daily counts", async () => {
    const csv = fixture("firms-sample.csv");
    const fetchImpl = async () => response(200, csv);
    const [feed] = await getHotspots(
      { env: {}, fetchImpl, sleep: noSleep, now: new Date("2026-10-18T00:00:00Z") },
      { days: 2, country: "MY", confidence: "all", includeUnassigned: false },
    );
    expect(feed!.hotspots.every((h) => h.countryCode === "MY")).toBe(true);
    expect(feed!.totalMatching).toBe(1);
    expect(feed!.daily.find((d) => d.date === "2026-10-17")?.count).toBe(1);
  });
});

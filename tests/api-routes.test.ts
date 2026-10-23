import { describe, expect, it, vi } from "vitest";

// Route handlers call `connection()`, which needs a Next request scope. Outside Next it is a no-op.
vi.mock("next/server", () => ({ connection: async () => {} }));

describe("API input validation and error handling", () => {
  it("history rejects malformed parameters with a 400 and a reason", async () => {
    const { GET } = await import("@/app/api/history/route");
    const res = await GET(new Request("http://x.test/api/history?provider=sg-nea-air&station=x&metric=DROP%20TABLE&period=PT1H&from=2026-10-01&to=2026-10-02"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.issues.join(" ")).toMatch(/metric/);
  });

  it("history returns 409 for a source that is not connected, never empty data", async () => {
    const { GET } = await import("@/app/api/history/route");
    const res = await GET(new Request("http://x.test/api/history?provider=my-doe-apims&station=x&metric=index:MY_API&period=PT1H&from=2026-10-01&to=2026-10-01"));
    expect(res.status).toBe(409);
  });

  it("history without parameters lists the available series", async () => {
    const { GET } = await import("@/app/api/history/route");
    const res = await GET(new Request("http://x.test/api/history"));
    const body = await res.json();
    expect(body.catalogue.map((c: { provider: { id: string } }) => c.provider.id)).toContain("sg-nea-air");
  });

  it("hotspots rejects an unknown country code", async () => {
    const { GET } = await import("@/app/api/hotspots/route");
    const res = await GET(new Request("http://x.test/api/hotspots?country=XX"));
    expect(res.status).toBe(400);
  });

  it("ingestion refuses to run without a configured secret, and rejects a wrong token", async () => {
    const { POST } = await import("@/app/api/ingest/route");
    const before = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await POST(new Request("http://x.test/api/ingest", { method: "POST" }))).status).toBe(503);
    process.env.CRON_SECRET = "a-long-enough-test-secret";
    const wrong = await POST(new Request("http://x.test/api/ingest", { method: "POST", headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  });

  it("rate limits a client that floods an endpoint", async () => {
    const { takeToken } = await import("@/lib/api/guard");
    let allowed = 0;
    for (let i = 0; i < 40; i++) if (takeToken("flood-test", 30, 30, 1_000)) allowed++;
    expect(allowed).toBe(30);
    expect(takeToken("flood-test", 30, 30, 1_000 + 60_000)).toBe(true);
  });
});

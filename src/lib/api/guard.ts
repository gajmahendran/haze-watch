import { z } from "zod";

/**
 * Helpers for public API routes: a best-effort per-client rate limit and consistent JSON errors.
 *
 * The limit is per server instance and keyed on the forwarded client address. It protects the
 * upstream sources from accidental hammering; it is not a security boundary. Put a CDN or platform
 * firewall in front for real abuse protection (see docs/deployment.md).
 */

interface Bucket {
  tokens: number;
  updatedMs: number;
}

const buckets = new Map<string, Bucket>();

export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "anonymous";
}

/** Token bucket: `capacity` requests, refilled at `perMinute` per minute. */
export function takeToken(key: string, capacity = 30, perMinute = 30, nowMs = Date.now()): boolean {
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedMs: nowMs };
  const refill = ((nowMs - bucket.updatedMs) / 60_000) * perMinute;
  bucket.tokens = Math.min(capacity, bucket.tokens + refill);
  bucket.updatedMs = nowMs;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  if (buckets.size > 10_000) buckets.delete(buckets.keys().next().value as string);
  return true;
}

export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { status, message, ...extra } }, { status, headers: { "cache-control": "no-store" } });
}

export function tooManyRequests(): Response {
  return new Response(JSON.stringify({ error: { status: 429, message: "Too many requests. Please wait a minute and try again." } }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "60", "cache-control": "no-store" },
  });
}

export function parseQuery<S extends z.ZodType>(url: URL, schema: S): { ok: true; data: z.infer<S> } | { ok: false; response: Response } {
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`);
    return { ok: false, response: jsonError(400, "Invalid query parameters.", { issues }) };
  }
  return { ok: true, data: parsed.data };
}

export function serverEnv(): Record<string, string | undefined> {
  return process.env;
}

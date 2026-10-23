/**
 * Outbound HTTP for provider adapters.
 *
 *  - Per-request timeout.
 *  - Retries only transient failures: network errors, timeouts, HTTP 429 and 5xx.
 *    4xx other than 429 is a permanent failure and is not retried.
 *  - Exponential backoff with jitter. A `Retry-After` header is honoured, capped at `maxDelayMs`.
 *  - A per-host limiter keeps us inside each provider's published rate limit.
 *
 * `fetch`, `sleep` and `random` are injectable so the behaviour is fully testable.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  readonly status: number | null;
  readonly url: string;
  readonly transient: boolean;
  readonly attempts: number;
  constructor(message: string, opts: { status: number | null; url: string; transient: boolean; attempts: number }) {
    super(message);
    this.name = "HttpError";
    this.status = opts.status;
    this.url = opts.url;
    this.transient = opts.transient;
    this.attempts = opts.attempts;
  }
}

export interface RetryOptions {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  limiter?: RateLimiter;
}

export interface FetchResult {
  response: Response;
  attempts: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Parses Retry-After (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  return null;
}

export function backoffDelay(attempt: number, base: number, max: number, random: () => number): number {
  const exp = base * 2 ** (attempt - 1);
  // Full jitter between 50% and 100% of the exponential step.
  return Math.min(max, Math.round(exp * (0.5 + random() * 0.5)));
}

export async function fetchWithRetry(url: string, options: RetryOptions = {}): Promise<FetchResult> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 8_000;
  const doFetch = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: HttpError | null = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (options.limiter) await options.limiter.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(url, {
        headers: { accept: "application/json, text/csv;q=0.9, */*;q=0.5", ...options.headers },
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (response.ok) return { response, attempts: attempt };

      const transient = isTransientStatus(response.status);
      lastError = new HttpError(`HTTP ${response.status} from ${hostOf(url)}`, {
        status: response.status,
        url,
        transient,
        attempts: attempt,
      });
      if (!transient || attempt > retries) throw lastError;
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      await sleep(Math.min(max, retryAfter ?? backoffDelay(attempt, base, max, random)));
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof HttpError) {
        if (!error.transient || attempt > retries) throw error;
        continue;
      }
      const aborted = error instanceof Error && error.name === "AbortError";
      lastError = new HttpError(
        aborted ? `Timed out after ${timeoutMs} ms contacting ${hostOf(url)}` : `Network error contacting ${hostOf(url)}`,
        { status: null, url, transient: true, attempts: attempt },
      );
      if (attempt > retries) throw lastError;
      await sleep(backoffDelay(attempt, base, max, random));
    }
  }
  throw lastError ?? new HttpError("Request failed", { status: null, url, transient: true, attempts: retries + 1 });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown host";
  }
}

/**
 * Sliding-window limiter: at most `limit` acquisitions per `windowMs`. In a serverless deployment
 * each instance has its own limiter, which is why every provider is also cached.
 */
export class RateLimiter {
  private readonly stamps: number[] = [];
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      while (this.stamps.length && t - this.stamps[0]! >= this.windowMs) this.stamps.shift();
      if (this.stamps.length < this.limit) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(this.windowMs - (t - this.stamps[0]!) + 5);
    }
  }
}

const limiters = new Map<string, RateLimiter>();

/** Shared limiter per host, created on first use. */
export function limiterFor(host: string, limit: number, windowMs: number): RateLimiter {
  let limiter = limiters.get(host);
  if (!limiter) {
    limiter = new RateLimiter(limit, windowMs);
    limiters.set(host, limiter);
  }
  return limiter;
}

export async function readJson(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`Response from ${hostOf(url)} was not valid JSON`, {
      status: response.status,
      url,
      transient: false,
      attempts: 1,
    });
  }
}

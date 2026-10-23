/**
 * In-memory TTL cache with request coalescing and last-good fallback.
 *
 *  - Concurrent callers for the same key share one in-flight request.
 *  - On failure, the last good value is returned (if younger than `maxStaleMs`) together with the
 *    error, so callers can show older data WITH its original timestamps and a warning. The cache
 *    never invents a value and never hides that the refresh failed.
 *
 * Per-instance only. In serverless deployments each instance keeps its own cache; persistence
 * (Supabase) is the shared layer.
 */

export interface CacheHit<T> {
  value: T | null;
  storedAtMs: number | null;
  fromCache: boolean;
  /** Set when the latest refresh failed. `value` may still hold an older good result. */
  error: Error | null;
  /** True when the error is a remembered recent failure and no new attempt was made. */
  cachedFailure?: boolean;
}

interface Entry<T> {
  value: T;
  storedAtMs: number;
  expiresAtMs: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<CacheHit<T>>>();
  /** Recent failures, remembered briefly so a dead upstream is not retried on every request. */
  private readonly failures = new Map<string, { error: Error; untilMs: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 500,
    private readonly failureTtlMs = 60_000,
  ) {}

  peek(key: string): Entry<T> | undefined {
    return this.entries.get(key);
  }

  async get(key: string, ttlMs: number, load: () => Promise<T>, maxStaleMs = 6 * 3_600_000): Promise<CacheHit<T>> {
    const entry = this.entries.get(key);
    const t = this.now();
    if (entry && entry.expiresAtMs > t) {
      return { value: entry.value, storedAtMs: entry.storedAtMs, fromCache: true, error: null };
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const failed = this.failures.get(key);
    if (failed && failed.untilMs > t) {
      if (entry && t - entry.storedAtMs <= maxStaleMs) {
        return { value: entry.value, storedAtMs: entry.storedAtMs, fromCache: true, error: failed.error, cachedFailure: true };
      }
      return { value: null, storedAtMs: null, fromCache: true, error: failed.error, cachedFailure: true };
    }

    const promise = (async (): Promise<CacheHit<T>> => {
      try {
        const value = await load();
        const storedAtMs = this.now();
        this.set(key, { value, storedAtMs, expiresAtMs: storedAtMs + ttlMs });
        this.failures.delete(key);
        return { value, storedAtMs, fromCache: false, error: null };
      } catch (raw) {
        const error = raw instanceof Error ? raw : new Error(String(raw));
        this.failures.set(key, { error, untilMs: this.now() + Math.min(this.failureTtlMs, ttlMs) });
        const previous = this.entries.get(key);
        if (previous && this.now() - previous.storedAtMs <= maxStaleMs) {
          return { value: previous.value, storedAtMs: previous.storedAtMs, fromCache: true, error };
        }
        return { value: null, storedAtMs: null, fromCache: false, error };
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  private set(key: string, entry: Entry<T>) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear() {
    this.failures.clear();
    this.entries.clear();
    this.inflight.clear();
  }
}

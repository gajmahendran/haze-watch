"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ApiState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null; fetchedAt: number }
  | { status: "error"; data: T | null; error: string; fetchedAt: number | null };

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    /* not JSON */
  }
  return `The server answered with HTTP ${res.status}.`;
}

/** Requests for the same URL within a few seconds share one network call. */
const shared = new Map<string, { at: number; promise: Promise<unknown> }>();
const SHARE_MS = 5_000;

function sharedFetch<T>(url: string, force: boolean): Promise<T> {
  const hit = shared.get(url);
  if (!force && hit && Date.now() - hit.at < SHARE_MS) return hit.promise as Promise<T>;
  const promise = fetch(url, { headers: { accept: "application/json" } }).then(async (res) => {
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as T;
  });
  shared.set(url, { at: Date.now(), promise });
  promise.catch(() => shared.delete(url));
  return promise;
}

/**
 * Fetches JSON from one of this site's API routes. Optional polling pauses while the tab is
 * hidden. On a failed refresh the previous data is kept and the error is exposed, so components
 * can show both the older readings (with their timestamps) and the failure.
 */
export function useApi<T>(url: string | null, options: { intervalMs?: number } = {}): ApiState<T> & { reload: () => void } {
  const [state, setState] = useState<ApiState<T> & { url: string | null }>({ status: "loading", data: null, error: null, url: null });
  const dataRef = useRef<T | null>(null);
  const urlRef = useRef<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;
    if (urlRef.current !== url) {
      dataRef.current = null;
      urlRef.current = url;
    }
    const controller = new AbortController();
    sharedFetch<T>(url, tick > 0)
      .then((data) => {
        if (controller.signal.aborted) return;
        dataRef.current = data;
        setState({ status: "ready", data, error: null, fetchedAt: Date.now(), url });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error && err.message !== "Failed to fetch" ? err.message : "This site's server could not be reached.";
        setState({ status: "error", data: dataRef.current, error: message, fetchedAt: dataRef.current ? Date.now() : null, url });
      });
    return () => controller.abort();
  }, [url, tick]);

  useEffect(() => {
    if (!options.intervalMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    }, options.intervalMs);
    return () => window.clearInterval(id);
  }, [options.intervalMs]);

  // A new URL means new data is on its way: never show the previous URL's result as if it were current.
  if (state.url !== url) return { status: "loading", data: null, error: null, reload };
  const { url: _ignored, ...rest } = state;
  void _ignored;
  return { ...(rest as ApiState<T>), reload };
}

/** Current time, refreshed on an interval, for relative ages. Null until mounted (avoids hydration mismatch). */
export function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const first = window.setTimeout(update, 0);
    const id = window.setInterval(update, intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

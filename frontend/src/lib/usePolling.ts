import { useCallback, useEffect, useRef, useState } from "react";

export interface UsePollingResult<T> {
  data: T | null;
  error: unknown | null;
  loading: boolean;
  refresh: () => void;
}

/** Pure scheduling decision for one poll tick. Extracted so it can be unit
 * tested without a DOM or renderer. */
export interface PollingPlan {
  fetchNow: boolean;
  nextIntervalMs: number | null;
}

export function planPolling({
  active,
  intervalMs,
  lastFetchTime,
  now,
}: {
  active: boolean;
  intervalMs: number;
  lastFetchTime: number | null;
  now: number;
}): PollingPlan {
  if (!active) return { fetchNow: false, nextIntervalMs: null };
  const due = lastFetchTime === null || now - lastFetchTime >= intervalMs;
  return { fetchNow: due, nextIntervalMs: intervalMs };
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  active: boolean,
): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetching = useRef(false);
  const mounted = useRef(true);

  // Keep the fetcher in a ref so a changing function identity (e.g. a new
  // useCallback on every parent render) never restarts polling or refetches.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetchOnce = useCallback(
    async (initial: boolean): Promise<void> => {
      if (fetching.current || !mounted.current) return;
      fetching.current = true;
      if (initial) setLoading(true);
      try {
        const next = await fetcherRef.current();
        if (!mounted.current) return;
        setData(next);
        setError(null);
      } catch (problem) {
        if (!mounted.current) return;
        setError(problem);
      } finally {
        fetching.current = false;
        if (initial) setLoading(false);
      }
    },
    [], // stable: reads only refs; never recreated
  );

  // Mount / unmount lifecycle: stop timers and mark unmounted so in-flight
  // fetches from a previous mount cannot write state after teardown.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);

  // Immediate first fetch on mount. Runs once because fetchOnce is stable.
  useEffect(() => {
    void fetchOnce(true);
  }, [fetchOnce]);

  // Poll while active; one final fetch when active turns false. Restarts the
  // schedule only when active, intervalMs, or fetcher identity actually changes.
  useEffect(() => {
    if (!active) {
      void fetchOnce(false);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    const schedule = () => {
      timer.current = setTimeout(async () => {
        await fetchOnce(false);
        schedule();
      }, intervalMs);
    };
    schedule();
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [active, intervalMs, fetchOnce]);

  // Pause polling while the page is hidden; resume on visibility change.
  useEffect(() => {
    if (!active) return;
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
      } else if (!timer.current && fetching.current === false) {
        void fetchOnce(false);
        const schedule = () => {
          timer.current = setTimeout(async () => {
            await fetchOnce(false);
            schedule();
          }, intervalMs);
        };
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [active, fetchOnce, intervalMs]);

  const refresh = useCallback(() => {
    void fetchOnce(false);
  }, [fetchOnce]);

  return { data, error, loading, refresh };
}

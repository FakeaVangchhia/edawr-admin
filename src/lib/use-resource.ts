'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { errorMessage } from '@/lib/api';

/**
 * Fetch something, with loading and error state that cannot go stale.
 *
 * **The structural rule this exists to satisfy:** never set state synchronously
 * inside an effect. `react-hooks/set-state-in-effect` is an error in this
 * project, and the fix is not a suppression — it is to stop storing what can be
 * derived. So instead of a `loading` flag that an effect flips on and off:
 *
 *   - the result is **tagged with the query key that produced it**, and
 *   - `loading` is **derived** by comparing that tag against the current key.
 *
 * That falls out correct for the case a boolean gets wrong: type "mil", then
 * "milk", and the response for "mil" arrives second. A `setLoading(false)`
 * design renders "mil"'s results under the word "milk". Here the tag does not
 * match the current key, so the late response is discarded — the race is closed
 * by construction rather than by an abort that may or may not land in time.
 *
 * Refreshing is a token bump from an event handler, never an effect.
 *
 * @param key    Changes whenever the query changes. Must be a stable string.
 * @param fetcher Receives an AbortSignal; should pass it to the request.
 */
export interface Resource<T> {
  data: T | null;
  error: string;
  loading: boolean;
  /** Re-run the current query. Call from an event handler or a timer. */
  refresh: () => void;
  /** Replace the data locally, for an optimistic update after a mutation. */
  setData: (next: T) => void;
}

interface Tagged<T> {
  key: string;
  data: T | null;
  error: string;
}

export function useResource<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: { enabled?: boolean } = {},
): Resource<T> {
  const enabled = options.enabled ?? true;
  const [token, setToken] = useState(0);
  const [result, setResult] = useState<Tagged<T>>({ key: '', data: null, error: '' });

  // The key the current data must match to count as current. The refresh token
  // is part of it, so bumping the token marks the existing data stale and the
  // derived `loading` flips to true without anything assigning to it.
  const currentKey = useMemo(() => `${key}::${token}`, [key, token]);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();

    fetcher(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setResult({ key: currentKey, data, error: '' });
      })
      .catch((caught) => {
        // An abort is this component cancelling its own request — a keystroke,
        // or an unmount. Rendering "could not reach the server" over a working
        // screen because the user typed another letter is a bug, not an error.
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setResult({ key: currentKey, data: null, error: errorMessage(caught) });
      });

    return () => controller.abort();
    // `fetcher` is intentionally excluded: callers define it inline, so it is a
    // new function on every render and including it would refetch forever. The
    // key is the declared dependency — if a change should refetch, it belongs
    // in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, enabled]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  const setData = useCallback(
    (next: T) => setResult((previous) => ({ ...previous, data: next })),
    [],
  );

  const settled = result.key === currentKey;

  return {
    // Stale data from the previous query is still shown while the next one is
    // in flight. A table that blanks on every keystroke is harder to use than
    // one that goes slightly out of date for 200ms.
    data: result.data,
    error: settled ? result.error : '',
    loading: enabled && !settled,
    refresh,
    setData,
  };
}

/**
 * Debounce a value — for search boxes, so typing does not fire a request per
 * keystroke.
 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Re-run something on an interval, and **only while the tab is visible**.
 *
 * A console left open on a back tab overnight is otherwise 5,760 requests
 * nobody reads. `visibilitychange` also fires on return, which refreshes
 * immediately — so coming back to the tab shows current data rather than
 * whatever was on screen when it was hidden, then waiting out the interval.
 */
export function usePolling(callback: () => void, intervalMs: number, enabled = true): void {
  /**
   * The interval must not depend on the callback's identity.
   *
   * With `callback` in the dependency list, a caller who passes anything that
   * is a new function each render — an inline arrow, or a `useCallback` keyed
   * on the object `useResource` returns fresh every time — tears the interval
   * down and builds a new one on every render. The countdown restarts from
   * zero each time, so a manager typing in the search box (a render per
   * keystroke, plus the debounce) keeps the fulfilment board from ever
   * refreshing, for exactly as long as they keep working.
   *
   * Reading through a ref means the timer is created once and always calls the
   * newest callback. This is a ref, not state, so the effect below is not
   * setting state inside an effect.
   */
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => latest.current();

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}

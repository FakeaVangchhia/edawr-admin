/**
 * `localStorage`, on the assumption that it may not be there.
 *
 * Touching `window.localStorage` throws a `SecurityError` when storage is
 * blocked — Safari's "block all cookies", some private windows, a sandboxed
 * frame. Two of the callers run inside `useSyncExternalStore` on every render,
 * where a throw lands on `error.tsx` for the whole console. A missing store is
 * the signed-out, light-theme shape; it is never worth a white screen.
 */

export function storageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the caller has already updated its in-memory state.
  }
}

export function storageRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // As above.
  }
}

/**
 * The console's stored session.
 *
 * `localStorage`, not `sessionStorage`, and a different key from the
 * storefront's `edawr-admin-session`. Two reasons for the split, and the second
 * is the one that would bite:
 *
 * - A manager working a shift should not be signed out by closing a tab, which
 *   is precisely what `sessionStorage` does. The storefront console chose
 *   session storage for a screen you dip into; this is a screen you live in.
 * - The two apps deploy to different origins and therefore cannot see each
 *   other's storage anyway — but if they are ever served from one origin, a
 *   shared key would have them overwriting each other's sessions with
 *   differently-shaped objects.
 *
 * **The stored role is a hint, not a permission.** It decides which navigation
 * to draw. Every request is re-authorised server-side against the database row,
 * so editing this object in devtools buys a menu item that returns 403.
 */

import type { ConsoleSession, Role } from '@/types';

export const SESSION_KEY = 'edawr-console-v1';

const ROLES: readonly Role[] = ['admin', 'manager'];

/**
 * Parse defensively. `localStorage` is user-writable and survives deploys, so
 * anything read from it may be truncated JSON, a session from an older shape,
 * or something a person typed. A malformed entry is discarded rather than
 * allowed to crash the app on boot — being logged out is recoverable, a white
 * screen on every load is not.
 */
export function readSession(): ConsoleSession | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ConsoleSession>;
    if (
      typeof parsed?.accessToken !== 'string' ||
      !parsed.accessToken ||
      typeof parsed.email !== 'string' ||
      !ROLES.includes(parsed.role as Role)
    ) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return {
      email: parsed.email,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      role: parsed.role as Role,
      accessToken: parsed.accessToken,
    };
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function writeSession(session: ConsoleSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  notify();
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_KEY);
  notify();
}

export function readToken(): string {
  return readSession()?.accessToken ?? '';
}

/* --------------------------------------------------------------------------
   A tiny external store, so every component sees the same session.

   Modelled on the storefront's cart store and for the same reason: no provider
   to forget to mount, no context boundary to cross, and two open tabs stay in
   step because the `storage` event fires across them. That last property is
   what makes signing out in one tab sign out in the other — which for a console
   holding write access to the catalogue is a security property, not a nicety.
   -------------------------------------------------------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * The snapshot for `useSyncExternalStore`, cached by its serialised form.
 *
 * React calls this on every render and bails out only if the result is
 * reference-equal. Parsing the JSON afresh each time returns a new object every
 * call, which is an infinite render loop. Caching on the raw string means a new
 * object is produced only when the stored text actually changed.
 */
let cachedRaw: string | null = null;
let cachedSession: ConsoleSession | null = null;

export function getSnapshot(): ConsoleSession | null {
  const raw =
    typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSession = readSession();
  }
  return cachedSession;
}

/** The server has no localStorage; it always renders the signed-out shape. */
export function getServerSnapshot(): ConsoleSession | null {
  return null;
}

/**
 * The customer's signed-in session, on this device.
 *
 * A bearer token in localStorage, replayed as `Authorization: Bearer <token>`
 * by `authRequest` in `api.ts`. Same shape as the console's `session.ts` and
 * the rider app's, and deliberately so — three clients storing a credential
 * three different ways is three places to get it wrong.
 *
 * **Why not an httpOnly cookie, which is the usual advice.** That advice
 * assumes the page and the API are same-site. Here they are not: the storefront
 * deploys to Vercel and the API to Cloud Run, different registrable domains, so
 * a session cookie would have to be `SameSite=None; Secure` — a third-party
 * cookie, which browsers are steadily restricting — and it would additionally
 * require `CORS_ALLOW_CREDENTIALS` and Django's CSRF middleware, which
 * `config/settings.py` omits on purpose and argues about at length. The defence
 * that makes localStorage acceptable is the CSP in `proxy.ts`:
 * `script-src 'strict-dynamic'` with a per-request nonce means there is no
 * ordinary way to get script into this page to read the token.
 *
 * That does raise what `proxy.ts` is protecting. This token grants read access
 * to a customer's order history, which includes their delivery address — so the
 * CSP is now a control over customer data, not only over script integrity.
 *
 * The key is versioned and distinct from `edawr-console-v1`, so the two apps
 * never collide if they are ever served from one origin.
 */

import { createLocalStore } from './local-store';

export interface CustomerSession {
  accessToken: string;
  id: number;
  phone: string;
  name: string;
  /** Whether the number has been proved, which gates older order history. */
  phoneVerified: boolean;
}

const store = createLocalStore<CustomerSession | null>({
  key: 'edawr-customer-v1',
  empty: null,
  parse: (raw) => {
    if (typeof raw !== 'object' || raw === null) return null;
    const candidate = raw as Partial<CustomerSession>;
    // Strict on the two fields everything else depends on. A session with no
    // token cannot authenticate anything, and one with no id cannot be matched
    // to a row — either way, treating it as signed-out is the honest outcome,
    // and better than sending `Bearer undefined` on every request.
    if (typeof candidate.accessToken !== 'string' || !candidate.accessToken) return null;
    if (typeof candidate.id !== 'number' || !Number.isFinite(candidate.id)) return null;
    return {
      accessToken: candidate.accessToken,
      id: candidate.id,
      phone: typeof candidate.phone === 'string' ? candidate.phone : '',
      name: typeof candidate.name === 'string' ? candidate.name : '',
      phoneVerified: candidate.phoneVerified === true,
    };
  },
});

export const subscribeToSession = store.subscribe;
export const getSessionSnapshot = store.getSnapshot;
export const getSessionServerSnapshot = store.getServerSnapshot;
export const readSession = store.read;

export function saveSession(session: CustomerSession): void {
  store.write(session);
}

export function clearSession(): void {
  store.write(null);
}

/**
 * The token to send, or `''` when signed out.
 *
 * Read fresh on every request rather than captured once, so signing out in
 * another tab takes effect on this tab's next call instead of whenever it
 * happens to re-render.
 *
 * Note this leaves a malformed stored value on disk rather than deleting it —
 * `parse` returning null is enough to treat the customer as signed out, and the
 * next write overwrites it. The console's version removes the key instead; the
 * difference is deliberate and not worth reconciling.
 */
export function readToken(): string {
  return store.read()?.accessToken ?? '';
}

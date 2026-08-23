/**
 * One name for one attempt to place an order.
 *
 * The backend deduplicates checkout on an `Idempotency-Key` header: send the
 * same key twice and the second request returns the first request's order
 * instead of creating a second one. That is only worth anything if the client
 * reuses the key across a retry, which is the whole job of this module.
 *
 * **What a retry actually looks like here.** A customer in Aizawl taps Place
 * order on mobile data. The request reaches the server, commits, and the
 * response is lost on the way back. The customer sees a spinner, then an error,
 * and taps again — or gives up, reloads the page, and taps again. Both of those
 * are the same attempt, and both must carry the same key. Holding the key in a
 * React ref covers the first; persisting it covers the second, which is the one
 * a ref alone gets wrong.
 *
 * **Why the key is tied to the basket.** A key that outlived the basket would
 * be worse than none: the customer places an order, adds more shopping, checks
 * out again, and the server recognises the key and hands back the *first*
 * order — a second order silently never placed. So the stored key records the
 * basket it belongs to, and a different basket gets a different key. Same
 * tag-and-derive shape as `useDraft`, and for the same reason: deriving from
 * what the value was made against beats trying to remember to invalidate it.
 *
 * Deliberately not a `createLocalStore`: nothing renders this, so it needs no
 * subscription, no snapshot identity and no cross-tab event. It is two
 * functions over one key.
 */

const STORAGE_KEY = 'edawr-checkout-attempt-v1';

interface StoredAttempt {
  key: string;
  basket: string;
}

/**
 * A stable name for the contents of a basket.
 *
 * Sorted by product id so the same items added in a different order are the
 * same basket — otherwise reordering the cart would silently mint a new key and
 * a retry would place a duplicate.
 */
export function basketSignature(lines: Array<{ productId: number; quantity: number }>): string {
  return lines
    .map(({ productId, quantity }) => `${productId}:${quantity}`)
    .sort()
    .join('|');
}

function readStored(): StoredAttempt | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as StoredAttempt).key !== 'string' ||
      typeof (parsed as StoredAttempt).basket !== 'string'
    ) {
      return null;
    }
    return parsed as StoredAttempt;
  } catch {
    // Private browsing, a cleared quota, or a shape written by an older
    // version. A missing key means the next attempt is simply a first attempt,
    // which is the behaviour this app had before idempotency existed.
    return null;
  }
}

function newKey(): string {
  // `randomUUID` needs a secure context, which every deployed page is (the CSP
  // sets upgrade-insecure-requests and Vercel is HTTPS-only). The fallback is
  // for an http:// dev server on a LAN IP, where `crypto.randomUUID` is absent
  // — a weaker key there is fine, because nothing about this is a credential:
  // it only has to be unlikely to collide with another customer's.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The key to send with a checkout of this basket.
 *
 * Returns the stored one when the basket is unchanged — that is the retry — and
 * mints and stores a fresh one otherwise. Idempotent within one basket, so
 * calling it twice for the same contents is safe and is in fact the point.
 */
export function checkoutAttemptKey(basket: string): string {
  if (typeof window === 'undefined') return newKey();

  const stored = readStored();
  if (stored && stored.basket === basket) return stored.key;

  const attempt: StoredAttempt = { key: newKey(), basket };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // Unstorable. The key still works for retries within this page's lifetime,
    // because the caller holds it; only the survive-a-reload case is lost.
  }
  return attempt.key;
}

/**
 * Forget the attempt, once the order is placed and the basket is cleared.
 *
 * Not strictly required — the basket signature would no longer match an empty
 * cart anyway — but leaving a used key in storage means the next checkout's
 * first action is to read a stale one, and a key that has already been redeemed
 * sitting in a customer's browser is untidy in a way that eventually confuses
 * somebody debugging a duplicate order.
 */
export function clearCheckoutAttempt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do, and nothing depends on it having worked.
  }
}

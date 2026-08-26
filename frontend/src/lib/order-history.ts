/**
 * One list of orders out of two sources.
 *
 * A customer can have orders in two places at once, and both are real:
 *
 *   - **the server**, for anyone signed in — complete, live, and the same on
 *     every device;
 *   - **`recent-orders.ts`**, this browser's list of tracking tokens — which is
 *     all a guest has, and which still holds anything placed before the
 *     customer signed in on this device.
 *
 * Merged rather than switched between, because switching would make orders
 * disappear at the moment someone signs in — the exact opposite of what an
 * account is for.
 *
 * Extracted as a pure function because `frontend/` has no Testing Library and
 * cannot render `OrdersPage` in a test. Logic left inside the component is
 * logic with no coverage.
 */

import type { RememberedOrder } from './recent-orders';
import type { TrackedOrder } from '@/types';

export interface HistoryEntry {
  /** The tracking token, which is also the identity of a row in this list. */
  token: string;
  orderId: number;
  /** ISO timestamp used only for sorting; the row renders the fetched value. */
  placedAt: string;
  /** What this browser remembered, if anything. */
  remembered: RememberedOrder | null;
  /** The server's copy, when the customer is signed in and it is theirs. */
  order: TrackedOrder | null;
}

/**
 * Merge the two sources, newest first, one row per tracking token.
 *
 * **The server row wins on collision**, which is the common case for a
 * signed-in customer: the same order is remembered locally *and* returned by
 * the API. The server's is live and complete; the local one is a snapshot taken
 * at checkout and never updated.
 *
 * A local row that the server did not return is kept rather than dropped. It is
 * either a guest order from before the account existed, or one placed on this
 * device while signed out — losing it would be losing the only record.
 */
export function mergeOrderHistory(
  serverOrders: TrackedOrder[],
  remembered: RememberedOrder[],
): HistoryEntry[] {
  const byToken = new Map<string, HistoryEntry>();

  for (const entry of remembered) {
    byToken.set(entry.token, {
      token: entry.token,
      orderId: entry.orderId,
      placedAt: entry.placedAt,
      remembered: entry,
      order: null,
    });
  }

  for (const order of serverOrders) {
    const existing = byToken.get(order.tracking_token);
    byToken.set(order.tracking_token, {
      token: order.tracking_token,
      orderId: order.id,
      placedAt: order.created_at,
      remembered: existing?.remembered ?? null,
      order,
    });
  }

  return [...byToken.values()].sort((a, b) => {
    // By time, then by id, so two orders placed in the same second do not swap
    // places between renders. Matches the server's own `-created_at, -id`.
    const byTime = Date.parse(b.placedAt) - Date.parse(a.placedAt);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
    return b.orderId - a.orderId;
  });
}

/**
 * The tokens that still need fetching one at a time.
 *
 * Everything the server already returned is complete, so only local-only rows
 * go through the per-token tracking requests. For a signed-in customer whose
 * history is entirely on the server, this is empty and the page makes exactly
 * one request.
 */
export function tokensNeedingFetch(entries: HistoryEntry[]): string[] {
  return entries.filter((entry) => entry.order === null).map((entry) => entry.token);
}

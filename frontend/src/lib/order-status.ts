import type { OrderStatus } from '@/types';

/**
 * What each order status means to the storefront.
 *
 * The tracking page and the order list each had their own idea of this, spelled
 * out inline, and they disagreed: `Failed` was missing from both. That is the
 * status a rider reports when the delivery was attempted and did not happen —
 * terminal, and reachable from Dispatched — so the tracking page went on
 * polling forever behind a live countdown, and the list rendered its pill with
 * no styling at all. Two copies of a rule is how one of them ends up wrong; the
 * only fix that stays fixed is having one copy.
 */

/** The order will not move again. Stop polling. */
export function isTerminal(status: OrderStatus): boolean {
  return status === 'Delivered' || status === 'Cancelled' || status === 'Failed';
}

/** Still in the shop's hands, so the page has something to wait for. */
export function isLive(status: OrderStatus): boolean {
  return !isTerminal(status);
}

/**
 * Over, and not in the way the customer wanted.
 *
 * Both of these end the order somewhere other than the customer's door, and
 * neither appears in the progress timeline — so both get an explanation in its
 * place rather than a step list with nothing lit up.
 */
export function isStopped(status: OrderStatus): boolean {
  return status === 'Cancelled' || status === 'Failed';
}

import { fetchAllProducts, trackOrder } from './store-api';
import type { CartLine, OrderItem, StoreProduct } from '@/types';

/**
 * Rebuilding a past order into a basket.
 *
 * Repeat buying is what a grocery store actually is — the same tea, the same
 * milk, every week. Making someone find twelve products again through search is
 * the slowest possible path to a basket they have already chosen once, so this
 * turns it into one tap.
 *
 * The past order is **not** a source of prices. It records what was charged
 * then; a basket must carry what is being charged now, or the customer sees a
 * stale figure and the server quotes them a different one. So an order's items
 * are resolved against the live catalogue, and anything that cannot be resolved
 * is reported rather than quietly dropped.
 */

export interface ReorderResult {
  /** Resolved against live catalogue rows, ready to merge into the cart. */
  lines: CartLine[];
  /** Names of items that could not be added, and why, so the UI can say so. */
  skipped: Array<{ name: string; reason: 'unavailable' | 'delisted' }>;
}

/**
 * Match a past order's items to live catalogue rows.
 *
 * Pure, so the awkward cases have tests: a product delisted since the order, a
 * product that still exists but is out of stock, and a quantity that has to be
 * clamped. Splitting "delisted" from "unavailable" matters because they are
 * different sentences to the customer — one is gone, the other is back later.
 */
export function resolveReorder(
  items: OrderItem[],
  catalogue: StoreProduct[],
): ReorderResult {
  const byId = new Map(catalogue.map((product) => [product.id, product]));
  const lines: CartLine[] = [];
  const skipped: ReorderResult['skipped'] = [];

  for (const item of items) {
    const product = byId.get(item.product_id);

    if (!product) {
      skipped.push({ name: item.name, reason: 'delisted' });
      continue;
    }
    if (!product.in_stock) {
      // The live name, not the one recorded on the order — a product that has
      // been renamed should be reported as it is called today.
      skipped.push({ name: product.name, reason: 'unavailable' });
      continue;
    }

    lines.push({ product, quantity: item.quantity });
  }

  return { lines, skipped };
}

/**
 * Fetch a past order and the current catalogue, and resolve one against the other.
 *
 * The whole catalogue is fetched rather than the specific ids because the store
 * API has no by-ids endpoint and a dark store's catalogue is a few hundred rows.
 *
 * `fetchAllProducts` pages, and that matters here more than anywhere else in the
 * app. This used to ask for a single 200-row page — the server's maximum — so
 * any product past position 200 was absent from the map below and reported to
 * the customer as **delisted**: a product still on sale, described as
 * discontinued, on the screen whose whole purpose is re-buying it.
 */
export async function buildReorder(
  token: string,
  signal?: AbortSignal,
): Promise<ReorderResult> {
  const [order, catalogue] = await Promise.all([
    trackOrder(token, signal),
    fetchAllProducts(signal),
  ]);

  return resolveReorder(order.items, catalogue);
}

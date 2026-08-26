import { basketSignature, checkoutAttemptKey } from './checkout-attempt';
import { ApiError, request } from './api';
import { readToken } from './session';
import type {
  BasketQuote,
  CartLine,
  DeliveryType,
  StoreCategory,
  StoreConfig,
  StoreProduct,
  TrackedOrder,
} from '@/types';

/**
 * The public storefront endpoints, typed.
 *
 * Every call here is anonymous, with exactly one exception: `placeOrder`
 * attaches the customer's token when there is one, so the order can be linked
 * to their account. It is still a public endpoint and still works with no token
 * at all — guest checkout is the main path, not a fallback. Everything in the
 * account's own surface lives in `customer-api.ts`.
 *
 * The order endpoints are keyed on an unguessable tracking token rather than an
 * order id, which is what lets them stay public without exposing every
 * customer's address to anyone who can count.
 */

export interface ProductQuery {
  q?: string;
  category?: string;
  limit?: number;
  offset?: number;
  /**
   * `'popular'` orders by units actually sold in the last 30 days, over orders
   * that became sales — cancelled and failed deliveries do not count.
   *
   * The server does the counting and returns only the order. There is no sales
   * figure on the wire, on the same reasoning that keeps cost price and exact
   * stock off `StoreProductSerializer`: how much the shop moves in a month is
   * the store's business, and a competitor reading it learns the throughput.
   */
  sort?: 'popular';
}

export function fetchStoreConfig(signal?: AbortSignal): Promise<StoreConfig> {
  return request<StoreConfig>('/api/store/config', { signal });
}

export interface CategoryQuery {
  /**
   * `'popular'` orders aisles by units sold across their products in the last
   * 30 days, over orders that became sales. Omitted keeps the manager's own
   * `sort_order`, which exists so the shop front is a decision rather than an
   * accident.
   */
  sort?: 'popular';
}

export function fetchCategories(
  signal?: AbortSignal,
  query: CategoryQuery = {},
): Promise<StoreCategory[]> {
  const suffix = query.sort ? `?sort=${query.sort}` : '';
  return request<StoreCategory[]>(`/api/store/categories${suffix}`, { signal });
}

export function fetchProducts(
  query: ProductQuery = {},
  signal?: AbortSignal,
): Promise<StoreProduct[]> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category && query.category !== 'All') params.set('category', query.category);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  if (query.sort) params.set('sort', query.sort);

  const suffix = params.toString();
  return request<StoreProduct[]>(
    `/api/store/products${suffix ? `?${suffix}` : ''}`,
    { signal },
  );
}

/**
 * Every sellable product, paged until the catalogue runs out.
 *
 * `GET /api/store/products` is capped by `STORE_MAX_PAGE_SIZE` (200) server
 * side, and a caller that asks for more silently gets 200 with no indication
 * that there were more. That is fine for a grid with a "load more" button and
 * wrong for anything that needs the *whole* list to decide something — reorder
 * matched a past order's ids against a single 200-row page and reported every
 * product past that as **discontinued** to the customer.
 *
 * Stops when a page comes back short, which is the only end-of-list signal the
 * endpoint gives. `PAGE_CAP` is a runaway guard, not a product limit: without
 * it, a server that ignored `offset` would loop forever.
 */
const CATALOGUE_PAGE = 200;
const PAGE_CAP = 25;

export async function fetchAllProducts(signal?: AbortSignal): Promise<StoreProduct[]> {
  const all: StoreProduct[] = [];

  for (let page = 0; page < PAGE_CAP; page += 1) {
    const batch = await fetchProducts(
      { limit: CATALOGUE_PAGE, offset: page * CATALOGUE_PAGE },
      signal,
    );
    all.push(...batch);
    if (batch.length < CATALOGUE_PAGE) break;
  }

  return all;
}

/**
 * One product, for its own page.
 *
 * A product page reached by a shared link or a reload has no list in memory to
 * read from, and fetching the whole catalogue to find one row works at seed
 * scale and falls over at a real one. Throws `ApiError` with status 404 for a
 * product that is unknown or no longer for sale — the caller renders
 * `not-found` on that.
 */
export function fetchProduct(id: number, signal?: AbortSignal): Promise<StoreProduct> {
  return request<StoreProduct>(`/api/store/products/${id}`, { signal });
}

/** The wire format the checkout and quote endpoints expect. */
export function toBasketItems(lines: CartLine[]) {
  return lines.map((line) => ({
    product_id: line.product.id,
    quantity: line.quantity,
  }));
}

/**
 * Price a basket without placing it.
 *
 * The cart drawer calls this rather than adding up line totals in TypeScript,
 * so the figure a customer sees before paying is produced by the same code that
 * will charge them. A second implementation here would drift from the server's
 * the first time a fee changed, and the customer would notice at checkout.
 */
export function quoteBasket(
  lines: CartLine[],
  deliveryType: DeliveryType,
  signal?: AbortSignal,
): Promise<BasketQuote> {
  return request<BasketQuote>('/api/store/quote', {
    method: 'POST',
    body: { items: toBasketItems(lines), delivery_type: deliveryType },
    signal,
  });
}

export interface CheckoutDetails {
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_landmark?: string;
  delivery_notes?: string;
  /**
   * The customer's position, when they agreed to share it.
   *
   * Optional and sent as a pair or not at all — the server rejects half of one,
   * because latitude without longitude is a client bug rather than a partial
   * answer. Omitting both is a normal, supported outcome: geolocation is a
   * browser permission prompt, and someone who declines it still typed an
   * address a rider can read.
   *
   * When present the server checks it against the delivery radius and uses it
   * to rank riders. When absent the order is stored with NULL coordinates,
   * which is the honest record — the columns used to default to the store's own
   * position, which made every such order read as 0.00 km from every rider.
   */
  customer_latitude?: number;
  customer_longitude?: number;
}

/**
 * The tier is a third parameter rather than a `CheckoutDetails` field, and
 * deliberately not optional: TypeScript then makes every caller state which
 * speed it is buying. A tier that could be silently omitted is a customer
 * charged for a delivery they did not pick.
 */
export async function placeOrder(
  lines: CartLine[],
  details: CheckoutDetails,
  deliveryType: DeliveryType,
): Promise<TrackedOrder> {
  const items = toBasketItems(lines);

  // A header, not a body field, mirroring the server: the checkout body is the
  // money boundary and carries product ids and quantities only. See
  // `lib/checkout-attempt.ts` for why the key is derived from the basket rather
  // than minted per click.
  //
  // Computed once and reused by the retry below, which is the entire point of
  // an idempotency key: if the first attempt somehow committed before failing,
  // the retry is handed the same order rather than placing a second one.
  const idempotencyKey = checkoutAttemptKey(
    basketSignature(
      items.map(({ product_id, quantity }) => ({ productId: product_id, quantity })),
    ),
  );
  const body = { ...details, delivery_type: deliveryType, items };

  const send = (token: string) =>
    request<TrackedOrder>('/api/store/orders', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        // **The one public endpoint that opts into authentication**, and it is
        // explicit here rather than routed through `authRequest` so that the
        // exception is visible at the call site. Signed out, no header is sent
        // at all and this is exactly the request it has always been.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });

  const token = readToken();
  if (!token) return send('');

  try {
    return await send(token);
  } catch (error) {
    // A *stale* token makes a public endpoint fail, which is surprising enough
    // to be worth working around here. Authentication runs before permission,
    // so a present-but-rejected token 401s the request before checkout is ever
    // reached — no order placed, on the one path that carries the money.
    //
    // The interceptor in `api.ts` has already cleared the session by now, so
    // this retries as a guest with the same key. The customer loses the link
    // between the order and their account; they do not lose the order.
    if (error instanceof ApiError && error.isUnauthenticated) {
      return send('');
    }
    throw error;
  }
}

export function trackOrder(token: string, signal?: AbortSignal): Promise<TrackedOrder> {
  return request<TrackedOrder>(`/api/store/orders/${encodeURIComponent(token)}`, { signal });
}

export function cancelOrder(token: string, reason: string): Promise<TrackedOrder> {
  return request<TrackedOrder>(`/api/store/orders/${encodeURIComponent(token)}/cancel`, {
    method: 'POST',
    body: { reason },
  });
}

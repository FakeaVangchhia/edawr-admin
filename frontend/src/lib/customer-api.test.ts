import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, authRequest, setSessionExpiredHandler } from '@/lib/api';
import { placeOrder } from '@/lib/store-api';
import { clearSession, readSession, saveSession } from '@/lib/session';
import type { CartLine } from '@/types';

/**
 * Where the session meets the network.
 *
 * Three properties, each of which fails in a way nobody would notice quickly:
 *
 *   1. **A 401 ends the session; a 403 and a dropped connection do not.** Sign
 *      someone out because their wifi blinked and they lose their basket on a
 *      train.
 *   2. **`placeOrder` sends no `Authorization` header at all when signed out**,
 *      so guest checkout is byte-for-byte the request it has always been.
 *   3. **A stale token does not cost the customer their order.** Authentication
 *      runs before permission on the server, so a rejected token 401s even this
 *      public endpoint — the retry is what turns that into a guest order rather
 *      than a failed one.
 */

const fetchMock = vi.fn();

const SESSION = {
  accessToken: 'a-token',
  id: 7,
  phone: '+919812345678',
  name: 'Lalringa',
  phoneVerified: false,
};

const LINES: CartLine[] = [
  {
    // Only `id` and `quantity` reach the wire, so the rest of the product is
    // not worth constructing; `unknown` first because the partial shape does
    // not overlap StoreProduct enough for a direct assertion.
    product: { id: 3, name: 'Milk', price: 62 } as unknown as CartLine['product'],
    quantity: 2,
  },
];

const DETAILS = {
  customer_name: 'Lalringa',
  customer_phone: '+919812345678',
  customer_address: 'Chanmari, Aizawl, near the church',
};

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  // Through the store, not just localStorage: `createLocalStore` caches its
  // parsed snapshot, so clearing storage alone leaves the previous test's
  // session still attached to every request.
  clearSession();
  window.localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  setSessionExpiredHandler(undefined);
  clearSession();
  window.localStorage.clear();
});

const headerOf = (call: number) =>
  new Headers(fetchMock.mock.calls[call][1].headers).get('Authorization');

describe('authRequest', () => {
  it('attaches the stored token', async () => {
    saveSession(SESSION);
    fetchMock.mockImplementation(json({ ok: true }));

    await authRequest('/api/customer/orders');

    expect(headerOf(0)).toBe('Bearer a-token');
  });

  it('sends no header when signed out', async () => {
    fetchMock.mockImplementation(json({ ok: true }));

    await authRequest('/api/customer/orders');

    expect(headerOf(0)).toBeNull();
  });

  it('reads the token fresh on every call', async () => {
    // Signing out in another tab has to take effect on this tab's next
    // request, not whenever it happens to re-render.
    saveSession(SESSION);
    fetchMock.mockImplementation(json({ ok: true }));

    await authRequest('/api/customer/orders');
    saveSession({ ...SESSION, accessToken: 'a-newer-token' });
    await authRequest('/api/customer/orders');

    expect(headerOf(1)).toBe('Bearer a-newer-token');
  });
});

describe('what ends a session', () => {
  it('a 401 clears the stored session and calls the handler', async () => {
    saveSession(SESSION);
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    fetchMock.mockImplementation(json({ detail: 'Signed out.' }, 401));

    await expect(authRequest('/api/customer/orders')).rejects.toBeInstanceOf(ApiError);

    expect(readSession()).toBeNull();
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it('a 403 does not', async () => {
    // "I know who you are and you may not do this" must leave the customer
    // signed in.
    saveSession(SESSION);
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    fetchMock.mockImplementation(json({ detail: 'Not allowed.' }, 403));

    await expect(authRequest('/api/customer/orders')).rejects.toBeInstanceOf(ApiError);

    expect(readSession()).not.toBeNull();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('a network failure does not', async () => {
    saveSession(SESSION);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(authRequest('/api/customer/orders')).rejects.toBeTruthy();

    expect(readSession()).not.toBeNull();
  });
});

describe('placeOrder and the session', () => {
  it('sends no Authorization header for a guest', async () => {
    fetchMock.mockImplementation(json({ id: 1, tracking_token: 't' }));

    await placeOrder(LINES, DETAILS, 'instant');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(headerOf(0)).toBeNull();
  });

  it('attaches the token when signed in', async () => {
    saveSession(SESSION);
    fetchMock.mockImplementation(json({ id: 1, tracking_token: 't' }));

    await placeOrder(LINES, DETAILS, 'instant');

    expect(headerOf(0)).toBe('Bearer a-token');
  });

  it('retries as a guest, with the same key, when the token is stale', async () => {
    saveSession(SESSION);
    fetchMock
      .mockImplementationOnce(json({ detail: 'Signed out.' }, 401))
      .mockImplementationOnce(json({ id: 1, tracking_token: 't' }));

    const order = await placeOrder(LINES, DETAILS, 'instant');

    expect(order.tracking_token).toBe('t');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headerOf(1)).toBeNull();

    // The same idempotency key on both attempts. If the first one somehow
    // committed before answering 401, the retry is handed that order rather
    // than placing a second one.
    const keyOf = (call: number) =>
      new Headers(fetchMock.mock.calls[call][1].headers).get('Idempotency-Key');
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('still carries no money in the body', async () => {
    // The money boundary, guarded cheaply from this side too: ids, quantities
    // and contact details only. The server reads no price, fee or total.
    saveSession(SESSION);
    fetchMock.mockImplementation(json({ id: 1, tracking_token: 't' }));

    await placeOrder(LINES, DETAILS, 'instant');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(
      ['customer_address', 'customer_name', 'customer_phone', 'delivery_type', 'items'].sort(),
    );
    expect(body.items).toEqual([{ product_id: 3, quantity: 2 }]);
  });
});

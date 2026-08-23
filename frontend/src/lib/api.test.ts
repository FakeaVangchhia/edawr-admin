import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, NetworkError, request } from '@/lib/api';

/**
 * The fetch wrapper, which had no test and is on the path of every screen.
 *
 * The two behaviours added here are the ones worth pinning: a hung backend must
 * not leave a spinner forever, and a retry must never apply to a POST. The
 * second is the important one — checkout writes an order and moves stock, and
 * a client that retried it on its own initiative would be creating exactly the
 * duplicate that `Idempotency-Key` exists to prevent.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/**
 * A fresh Response per call.
 *
 * `mockResolvedValue(new Response(...))` hands the *same* object to every
 * attempt, and a Response body can only be read once — so a retry reads a
 * consumed body and the test fails for a reason unrelated to the code. Every
 * mock here therefore goes through `mockImplementation`.
 */
const ok = (body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const failure = (status: number, detail = 'nope') => () =>
  new Response(JSON.stringify({ detail }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Let the retry backoff elapse without actually waiting for it. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const result = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await result;
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

describe('request', () => {
  it('returns the parsed body', async () => {
    fetchMock.mockImplementation(ok({ id: 7 }));

    await expect(settle(request('/api/x'))).resolves.toEqual({ id: 7 });
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockImplementation(() => new Response(null, { status: 204 }));

    await expect(settle(request('/api/x'))).resolves.toBeUndefined();
  });

  it('throws ApiError carrying the backend detail', async () => {
    fetchMock.mockImplementation(failure(400, 'Minimum order value is 49.00.'));

    await expect(settle(request('/api/x'))).rejects.toThrow(
      'Minimum order value is 49.00.',
    );
  });

  it('keeps the payload on a 409, which the cart reads', async () => {
    fetchMock.mockImplementation(
      () =>
        new Response(
          JSON.stringify({ detail: 'gone', unavailable: [{ product_id: 3 }] }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const error = await settle(request('/api/x')).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isConflict).toBe(true);
    expect((error as ApiError).payload.unavailable).toEqual([{ product_id: 3 }]);
  });

  // --- retries ---------------------------------------------------------
  it('retries a GET that fails at the network', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(ok({ id: 1 }));

    await expect(settle(request('/api/x'))).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a GET on a 503', async () => {
    fetchMock
      .mockImplementationOnce(failure(503))
      .mockImplementationOnce(ok({ id: 1 }));

    await expect(settle(request('/api/x'))).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(settle(request('/api/x'))).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404', async () => {
    // A missing order does not become present because you asked again, and the
    // orders page distinguishes 404 from unreachable — retrying would delay
    // that answer by a second for nothing.
    fetchMock.mockImplementation(failure(404));

    await expect(settle(request('/api/x'))).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a POST', async () => {
    // The whole point. A retried checkout is a second order and a second stock
    // decrement; `Idempotency-Key` makes the *customer's* retry safe, and this
    // keeps the client from retrying behind their back.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      settle(request('/api/store/orders', { method: 'POST', body: {} })),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a POST that 503s either', async () => {
    fetchMock.mockImplementation(failure(503));

    await expect(
      settle(request('/api/store/orders', { method: 'POST', body: {} })),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // --- aborts ----------------------------------------------------------
  it('re-throws the caller abort rather than laundering it', async () => {
    // The search overlay aborts on every keystroke. Turning that into a
    // NetworkError flashes "Could not reach the store" as the customer types.
    const controller = new AbortController();
    const abortError = new DOMException('Aborted', 'AbortError');
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(abortError);
    });

    await expect(
      settle(request('/api/x', { signal: controller.signal })),
    ).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a timeout signal so a hung backend cannot spin forever', async () => {
    fetchMock.mockImplementation(ok({}));

    await settle(request('/api/x'));

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sets a JSON content type for a body, and none without one', async () => {
    fetchMock.mockImplementation(ok({}));

    await settle(request('/api/x', { method: 'POST', body: { a: 1 } }));
    const withBody = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(withBody.headers).get('Content-Type')).toBe('application/json');
    expect(withBody.body).toBe('{"a":1}');

    fetchMock.mockClear();
    await settle(request('/api/x'));
    const without = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(without.headers).get('Content-Type')).toBeNull();
  });

  it('passes a caller header through, which is how checkout sends its key', async () => {
    fetchMock.mockImplementation(ok({}));

    await settle(
      request('/api/store/orders', {
        method: 'POST',
        body: {},
        headers: { 'Idempotency-Key': 'abc' },
      }),
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('abc');
  });
});

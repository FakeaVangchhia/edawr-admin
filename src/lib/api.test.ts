import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  NetworkError,
  authPage,
  authRequest,
  setSessionExpiredHandler,
} from '@/lib/api';
import { SESSION_KEY, readSession, writeSession } from '@/lib/session';

/**
 * The console's fetch layer — the most consequential module in the package and
 * previously the only untested one.
 *
 * Its docblock is the longest in the codebase because of what it gets wrong
 * when it gets it wrong: conflating 401 with 403 signs a Manager out every time
 * they click an Admin-only link, and clearing the session in a bare `catch`
 * deletes a perfectly good token because the wifi dropped. Both are asserted
 * here rather than left to the comment.
 */

const fetchMock = vi.fn();

const session = {
  email: 'owner@edawr.test',
  name: 'Owner',
  role: 'admin' as const,
  accessToken: 'a-token',
};

beforeEach(() => {
  window.localStorage.clear();
  writeSession(session);
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  setSessionExpiredHandler(null);
  window.localStorage.clear();
});

/**
 * A fresh Response per call.
 *
 * `mockResolvedValue(new Response(...))` hands the *same* object to every
 * attempt, and a Response body can only be read once — so the second read
 * throws "Body is unusable" and the test fails for a reason that has nothing to
 * do with the code. Every mock below therefore goes through
 * `mockImplementation` and builds a new one.
 */
const ok = (body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const failure = (status: number, detail = 'nope') => () =>
  new Response(JSON.stringify({ detail }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Let the retry backoff elapse without actually waiting for it. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const settled = await outcome;
  if (settled.ok) return settled.value;
  throw settled.error;
}

describe('authRequest', () => {
  it('attaches the stored bearer token', async () => {
    fetchMock.mockImplementation(ok({ id: 1 }));

    await settle(authRequest('/api/products'));

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer a-token');
  });

  it('reads the token fresh on every call', async () => {
    // Signing out in another tab has to take effect on the next request, not
    // whenever this module happens to be re-evaluated.
    fetchMock.mockImplementation(ok({}));
    await settle(authRequest('/api/products'));

    writeSession({ ...session, accessToken: 'a-newer-token' });
    await settle(authRequest('/api/products'));

    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(new Headers(second.headers).get('Authorization')).toBe('Bearer a-newer-token');
  });

  describe('the 401 / 403 interceptor', () => {
    it('clears the session on 401', async () => {
      const expired = vi.fn();
      setSessionExpiredHandler(expired);
      fetchMock.mockImplementation(failure(401, 'Not authenticated.'));

      await expect(settle(authRequest('/api/products'))).rejects.toBeInstanceOf(ApiError);

      expect(readSession()).toBeNull();
      expect(expired).toHaveBeenCalledOnce();
    });

    it('keeps the session on 403', async () => {
      // A Manager clicking an Admin-only link must be told no, not signed out.
      // This is the distinction the rider app gets wrong and this file exists
      // to get right.
      const expired = vi.fn();
      setSessionExpiredHandler(expired);
      fetchMock.mockImplementation(failure(403, 'Admins only.'));

      const error = await settle(authRequest('/api/admins')).catch((e: unknown) => e);

      expect((error as ApiError).isForbidden).toBe(true);
      expect((error as ApiError).isUnauthenticated).toBe(false);
      expect(readSession()).not.toBeNull();
      expect(expired).not.toHaveBeenCalled();
    });

    it('keeps the session when the network fails', async () => {
      // The other half of the same rule. A blip, a CORS misconfiguration and a
      // CSP block all land in the same catch as an auth failure, and deleting a
      // valid token over any of them is how a session disappears mid-shift.
      const expired = vi.fn();
      setSessionExpiredHandler(expired);
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(settle(authRequest('/api/products'))).rejects.toBeInstanceOf(
        NetworkError,
      );

      expect(window.localStorage.getItem(SESSION_KEY)).not.toBeNull();
      expect(expired).not.toHaveBeenCalled();
    });

    it('keeps the session on a 500', async () => {
      fetchMock.mockImplementation(failure(500, 'Server error.'));

      await expect(settle(authRequest('/api/products'))).rejects.toBeInstanceOf(ApiError);

      expect(readSession()).not.toBeNull();
    });
  });

  describe('retries', () => {
    it('retries a GET that fails at the network', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockImplementationOnce(ok({ id: 1 }));

      await expect(settle(authRequest('/api/products'))).resolves.toEqual({ id: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries a GET on a 503 and gives up after three', async () => {
      fetchMock.mockImplementation(failure(503));

      await expect(settle(authRequest('/api/products'))).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('never retries a write', async () => {
      // Everything the console writes is a real action, and several are guarded
      // by a 409 that a blind retry would turn into an error the manager did
      // not cause.
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        settle(authRequest('/api/orders/1/status', { method: 'PATCH', body: {} })),
      ).rejects.toBeInstanceOf(NetworkError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry a 401', async () => {
      // Retrying would clear the session three times and fire the redirect
      // three times.
      fetchMock.mockImplementation(failure(401));

      await expect(settle(authRequest('/api/products'))).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('sends a timeout signal', async () => {
    fetchMock.mockImplementation(ok({}));

    await settle(authRequest('/api/products'));

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockImplementation(() => new Response(null, { status: 204 }));

    await expect(settle(authRequest('/api/auth/logout', { method: 'POST' })))
      .resolves.toBeUndefined();
  });

  it('exposes field errors from a DRF serializer', async () => {
    // The real shape: `detail_exception_handler` flattens a DRF validation
    // error to one sentence and keeps the structure under `errors`.
    fetchMock.mockImplementation(
      () =>
        new Response(
          JSON.stringify({ detail: 'name: required', errors: { name: ['required'] } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const error = await settle(authRequest('/api/products')).catch((e: unknown) => e);

    expect((error as ApiError).fieldErrors).toEqual({ name: ['required'] });
  });
});

describe('authPage', () => {
  it('reads the unpaged total from X-Total-Count', async () => {
    fetchMock.mockImplementation(ok([{ id: 1 }], { 'X-Total-Count': '97' }));

    await expect(settle(authPage('/api/products'))).resolves.toEqual({
      rows: [{ id: 1 }],
      total: 97,
    });
  });

  it('falls back to the page length when the header is missing', async () => {
    // A proxy that strips the header should degrade to "one page" rather than
    // showing a total of zero beside a screen full of rows.
    fetchMock.mockImplementation(ok([{ id: 1 }, { id: 2 }]));

    await expect(settle(authPage('/api/products'))).resolves.toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      total: 2,
    });
  });

  it('falls back when the header is not a number', async () => {
    fetchMock.mockImplementation(ok([{ id: 1 }], { 'X-Total-Count': 'lots' }));

    const { total } = await settle(authPage('/api/products'));
    expect(total).toBe(1);
  });

  it('goes through the same interceptor as authRequest', async () => {
    // The point of the shared `send`: two copies of the 401 handling is one
    // copy that eventually stops matching the other.
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    fetchMock.mockImplementation(failure(401));

    await expect(settle(authPage('/api/products'))).rejects.toBeInstanceOf(ApiError);

    expect(readSession()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });

  it('retries a list request, since it is a GET', async () => {
    fetchMock
      .mockImplementationOnce(failure(502))
      .mockImplementationOnce(ok([{ id: 1 }], { 'X-Total-Count': '1' }));

    await expect(settle(authPage('/api/products'))).resolves.toEqual({
      rows: [{ id: 1 }],
      total: 1,
    });
  });

  it('returns no rows when the body is not an array', async () => {
    fetchMock.mockImplementation(ok({ detail: 'unexpected' }));

    await expect(settle(authPage('/api/products'))).resolves.toEqual({
      rows: [],
      total: 0,
    });
  });
});

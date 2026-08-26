import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSession, readSession, readToken, saveSession } from '@/lib/session';

/**
 * The stored customer session.
 *
 * localStorage is untrusted input: it survives deploys, so it may hold a shape
 * written by an older build, and the customer can edit it by hand. Every one of
 * these asserts the same property from a different angle — a value that is not
 * a usable session reads as *signed out*, never as a session with holes in it.
 *
 * The failure being prevented is concrete: a stored object missing its token
 * would otherwise send `Authorization: Bearer undefined` on every request, and
 * the customer would see a signed-in header above a 401 on everything.
 */

const KEY = 'edawr-customer-v1';

const VALID = {
  accessToken: 'a-token',
  id: 7,
  phone: '+919812345678',
  name: 'Lalringa',
  phoneVerified: false,
};

beforeEach(() => {
  // `clearSession()` as well as clearing storage: the store keeps an
  // in-memory snapshot, so emptying localStorage alone leaves the previous
  // test's session still readable through the module.
  clearSession();
  window.localStorage.clear();
});

afterEach(() => {
  clearSession();
  window.localStorage.clear();
});

describe('session storage', () => {
  it('round-trips a session', () => {
    saveSession(VALID);

    expect(readSession()).toEqual(VALID);
    expect(readToken()).toBe('a-token');
  });

  it('clears back to signed out', () => {
    saveSession(VALID);
    clearSession();

    expect(readSession()).toBeNull();
    expect(readToken()).toBe('');
  });

  it('reads as signed out when nothing is stored', () => {
    expect(readSession()).toBeNull();
    expect(readToken()).toBe('');
  });
});

describe('rejecting anything that is not a usable session', () => {
  /**
   * Read a raw stored value through a *fresh* copy of the module.
   *
   * `createLocalStore` parses localStorage once and then caches the result —
   * that caching is not incidental, it is what stops `useSyncExternalStore`
   * seeing a new object on every render and looping forever, and the factory
   * says so. Writing to localStorage behind the store's back therefore does
   * nothing to an already-hydrated module. Resetting the module registry is
   * what puts each case back at the un-hydrated state a real page load starts
   * from, which is the only state in which `parse` runs at all.
   */
  const stored = async (raw: string) => {
    window.localStorage.setItem(KEY, raw);
    vi.resetModules();
    const fresh = await import('@/lib/session');
    return fresh.readSession();
  };

  it('rejects malformed JSON', async () => {
    expect(await stored('{not json')).toBeNull();
  });

  it('rejects a JSON value that is not an object', async () => {
    expect(await stored('"a string"')).toBeNull();
    expect(await stored('42')).toBeNull();
    expect(await stored('null')).toBeNull();
  });

  it('rejects a session with no token', async () => {
    expect(await stored(JSON.stringify({ id: 7, name: 'Lalringa' }))).toBeNull();
  });

  it('rejects an empty token', async () => {
    expect(await stored(JSON.stringify({ ...VALID, accessToken: '' }))).toBeNull();
  });

  it('rejects a non-numeric id', async () => {
    expect(await stored(JSON.stringify({ ...VALID, id: '7' }))).toBeNull();
  });

  it('defaults the soft fields rather than rejecting', async () => {
    // A missing name is cosmetic — the header falls back to "Account" — so it
    // must not cost the customer their session.
    const session = await stored(JSON.stringify({ accessToken: 'a-token', id: 7 }));

    expect(session).toEqual({
      accessToken: 'a-token',
      id: 7,
      phone: '',
      name: '',
      phoneVerified: false,
    });
  });

  it('treats phoneVerified as false unless it is exactly true', async () => {
    // The gate on order history. Anything ambiguous has to read as unverified,
    // because the failure in the other direction is showing someone a
    // stranger's address.
    expect((await stored(JSON.stringify({ ...VALID, phoneVerified: 'yes' })))?.phoneVerified)
      .toBe(false);
    expect((await stored(JSON.stringify({ ...VALID, phoneVerified: 1 })))?.phoneVerified)
      .toBe(false);
    expect((await stored(JSON.stringify({ ...VALID, phoneVerified: true })))?.phoneVerified)
      .toBe(true);
  });
});

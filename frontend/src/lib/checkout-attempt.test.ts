import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  basketSignature,
  checkoutAttemptKey,
  clearCheckoutAttempt,
} from '@/lib/checkout-attempt';

/**
 * The client half of idempotent checkout.
 *
 * The server deduplicates on the key; this module decides what the key is, and
 * both of its failure modes are silent and expensive. Mint a new key on a retry
 * and the customer is charged twice. Reuse a key across a *different* basket
 * and their second order is never placed — the server recognises the key and
 * hands back the first order, which looks like a success.
 */

const STORAGE_KEY = 'edawr-checkout-attempt-v1';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('basketSignature', () => {
  it('is stable regardless of the order lines were added in', () => {
    // Otherwise moving an item in the cart mints a new key, and the retry that
    // follows places a duplicate order.
    const forwards = basketSignature([
      { productId: 1, quantity: 2 },
      { productId: 7, quantity: 1 },
    ]);
    const backwards = basketSignature([
      { productId: 7, quantity: 1 },
      { productId: 1, quantity: 2 },
    ]);

    expect(forwards).toBe(backwards);
  });

  it('changes when a quantity changes', () => {
    expect(basketSignature([{ productId: 1, quantity: 2 }])).not.toBe(
      basketSignature([{ productId: 1, quantity: 3 }]),
    );
  });

  it('changes when an item is added', () => {
    expect(basketSignature([{ productId: 1, quantity: 1 }])).not.toBe(
      basketSignature([
        { productId: 1, quantity: 1 },
        { productId: 2, quantity: 1 },
      ]),
    );
  });

  it('distinguishes baskets that concatenate to the same string', () => {
    // "1:11" from one line must not equal "1:1" plus "1" from two. The
    // delimiter is what stops that, and a test is the only thing that stops
    // somebody simplifying it away.
    expect(basketSignature([{ productId: 1, quantity: 11 }])).not.toBe(
      basketSignature([
        { productId: 1, quantity: 1 },
        { productId: 11, quantity: 1 },
      ]),
    );
  });

  it('is empty for an empty basket', () => {
    expect(basketSignature([])).toBe('');
  });
});

describe('checkoutAttemptKey', () => {
  it('returns the same key for the same basket', () => {
    // This is the retry. Two calls, one attempt, one order.
    const basket = basketSignature([{ productId: 1, quantity: 2 }]);

    expect(checkoutAttemptKey(basket)).toBe(checkoutAttemptKey(basket));
  });

  it('survives a reload', () => {
    const basket = basketSignature([{ productId: 1, quantity: 2 }]);
    const first = checkoutAttemptKey(basket);

    // What a reload looks like from here: the module's own memory is gone and
    // only localStorage remains. A ref-only implementation fails this, and the
    // customer who reloads after a timeout places a second order.
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(first);
    expect(checkoutAttemptKey(basket)).toBe(first);
  });

  it('mints a new key when the basket changes', () => {
    // The dangerous direction. Reusing a key here means the server returns the
    // *previous* order and the new one is silently never placed.
    const first = checkoutAttemptKey(basketSignature([{ productId: 1, quantity: 1 }]));
    const second = checkoutAttemptKey(basketSignature([{ productId: 1, quantity: 2 }]));

    expect(second).not.toBe(first);
  });

  it('forgets the key once the order is placed', () => {
    const basket = basketSignature([{ productId: 1, quantity: 1 }]);
    const first = checkoutAttemptKey(basket);

    clearCheckoutAttempt();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(checkoutAttemptKey(basket)).not.toBe(first);
  });

  it('ignores a stored value of the wrong shape', () => {
    // localStorage survives deploys, so this may have been written by an older
    // build. Falling back to a fresh key is the safe direction: an extra order
    // is bad, but a key read out of a value we do not understand could be
    // anything at all.
    window.localStorage.setItem(STORAGE_KEY, '{"key":42}');

    expect(() => checkoutAttemptKey('1:1')).not.toThrow();
    expect(checkoutAttemptKey('1:1')).toEqual(expect.any(String));
  });

  it('ignores unparseable storage', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json');

    expect(checkoutAttemptKey('1:1')).toEqual(expect.any(String));
  });

  it('still returns a key when storage cannot be written', () => {
    // Private browsing. The key works for retries within this page's lifetime
    // because the caller holds it; only the survive-a-reload case is lost, and
    // that must not be paid for with an exception on the checkout path.
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

    expect(() => checkoutAttemptKey('1:1')).not.toThrow();
    expect(checkoutAttemptKey('1:1')).toEqual(expect.any(String));

    setItem.mockRestore();
  });

  it('produces keys the server will accept', () => {
    // `CheckoutView.MAX_KEY_LENGTH` is 64 and an over-long key is a 400, not a
    // truncation — so a client that generated something longer would fail every
    // checkout, on the happy path, in production.
    const key = checkoutAttemptKey('1:1');

    expect(key.length).toBeGreaterThan(8);
    expect(key.length).toBeLessThanOrEqual(64);
  });

  it('does not collide across baskets', () => {
    const keys = new Set(
      Array.from({ length: 50 }, (_, i) => checkoutAttemptKey(`${i}:1`)),
    );

    expect(keys.size).toBe(50);
  });
});

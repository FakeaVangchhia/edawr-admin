import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELIVERY_TYPE,
  FALLBACK_TIERS,
  deliveryFeeLabel,
  feeForTier,
  quoteSignature,
  tierFor,
  tiersFrom,
} from './delivery';
import type { BasketQuote, CartLine, StoreConfig, StoreProduct } from '@/types';

/**
 * Delivery tier lookups.
 *
 * Nothing here computes a fee — the server does that. What these guard is the
 * set of ways the UI could show a customer one tier's number under another
 * tier's label: a quote keyed on the basket alone, a fallback that resolves
 * downward to the cheap tier, or a fee rendered as "Free" before anyone had
 * priced it.
 */

function line(id: number, quantity: number): CartLine {
  return {
    product: { id, name: `Product ${id}`, price: 50 } as StoreProduct,
    quantity,
  };
}

function config(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return {
    store_name: 'eDawr',
    store_city: 'Aizawl',
    delivery_tiers: [
      { key: 'instant', label: 'Instant', fee: 15, promise_minutes: 15 },
      { key: 'slow', label: 'Slow', fee: 5, promise_minutes: 45 },
    ],
    free_delivery_above: 199,
    handling_fee: 5,
    min_order_value: 49,
    promise_minutes: 15,
    delivery_fee: 15,
    is_open: true,
    closed_reason: '',
    opens_at: '07:00:00',
    closes_at: '22:00:00',
    delivery_radius_km: 8,
    store_latitude: 23.7272,
    store_longitude: 92.7178,
    ...overrides,
  };
}

function quote(overrides: Partial<BasketQuote> = {}): BasketQuote {
  return {
    items_total: 100,
    delivery_fee: 15,
    handling_fee: 5,
    grand_total: 120,
    free_delivery_shortfall: 99,
    meets_minimum: true,
    unavailable: [],
    lines: [],
    delivery_type: 'instant',
    promised_minutes: 15,
    ...overrides,
  };
}

describe('quoteSignature', () => {
  it('changes when the tier changes and the basket does not', () => {
    // The regression this whole function exists for. Keyed on the lines alone,
    // switching to Slow would leave the Instant price on screen until something
    // unrelated happened to invalidate it.
    const basket = [line(1, 2), line(2, 1)];

    expect(quoteSignature(basket, 'instant')).not.toBe(quoteSignature(basket, 'slow'));
  });

  it('changes when a quantity changes and the tier does not', () => {
    expect(quoteSignature([line(1, 2)], 'instant')).not.toBe(
      quoteSignature([line(1, 3)], 'instant'),
    );
  });

  it('is stable for the same basket and tier', () => {
    expect(quoteSignature([line(1, 2)], 'slow')).toBe(quoteSignature([line(1, 2)], 'slow'));
  });

  it('distinguishes an empty basket per tier', () => {
    expect(quoteSignature([], 'instant')).not.toBe(quoteSignature([], 'slow'));
  });
});

describe('tiersFrom', () => {
  it('returns the store tiers in the order the server sent them', () => {
    expect(tiersFrom(config()).map((tier) => tier.key)).toEqual(['instant', 'slow']);
  });

  it('falls back when config never arrived', () => {
    // Storefront swallows a failed config fetch, so without this the picker
    // would silently not render and the customer would never see the choice.
    expect(tiersFrom(null)).toBe(FALLBACK_TIERS);
    expect(tiersFrom(undefined)).toBe(FALLBACK_TIERS);
  });

  it('falls back when the server sends an empty list', () => {
    expect(tiersFrom(config({ delivery_tiers: [] }))).toBe(FALLBACK_TIERS);
  });
});

describe('tierFor', () => {
  it('finds a tier by key', () => {
    expect(tierFor(config(), 'slow').promise_minutes).toBe(45);
    expect(tierFor(config(), 'instant').fee).toBe(15);
  });

  it('resolves an unknown key to the fastest tier, never the cheapest', () => {
    // Same rule as the server's resolve_tier: quietly giving someone a slower
    // delivery than they think they bought is the expensive mistake.
    expect(tierFor(config(), 'teleport' as 'instant').key).toBe('instant');
  });

  it('resolves against the fallback when config is missing', () => {
    expect(tierFor(null, 'slow').promise_minutes).toBe(45);
  });

  it('defaults to instant', () => {
    expect(DEFAULT_DELIVERY_TYPE).toBe('instant');
    expect(tierFor(config(), DEFAULT_DELIVERY_TYPE).key).toBe('instant');
  });
});

describe('deliveryFeeLabel', () => {
  const money = (value: number) => `₹${value}`;

  it('renders an uncalculated fee as an em dash, never as Free', () => {
    // The invariant BillRow already holds: a fee that has not been calculated
    // is unknown, not free. Saying "Free" here is a promise the bill breaks.
    expect(deliveryFeeLabel(undefined, money)).toBe('—');
  });

  it('renders exactly zero as Free', () => {
    expect(deliveryFeeLabel(0, money)).toBe('Free');
  });

  it('renders a real fee as money', () => {
    expect(deliveryFeeLabel(15, money)).toBe('₹15');
  });
});

describe('feeForTier', () => {
  const [instant, slow] = config().delivery_tiers;

  it('uses the quote for the tier the quote priced', () => {
    expect(feeForTier(instant, 'instant', quote({ delivery_fee: 15 }))).toBe(15);
  });

  it('uses the list price for the tier the quote did not price', () => {
    expect(feeForTier(slow, 'instant', quote({ delivery_fee: 15 }))).toBe(5);
  });

  it('shows both tiers as free once the basket earns free delivery', () => {
    // Free delivery is earned by basket size, not by speed. Showing ₹5 beside
    // the unselected tier here would tell the customer switching costs money
    // when it does not.
    const earned = quote({ items_total: 250, delivery_fee: 0 });

    expect(feeForTier(instant, 'instant', earned)).toBe(0);
    expect(feeForTier(slow, 'instant', earned)).toBe(0);
  });

  it('falls back to the list price before any quote lands', () => {
    expect(feeForTier(instant, 'instant', null)).toBe(15);
    expect(feeForTier(slow, 'instant', null)).toBe(5);
  });
});

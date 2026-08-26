import { describe, expect, it } from 'vitest';

import { mergeOrderHistory, tokensNeedingFetch } from '@/lib/order-history';
import type { RememberedOrder } from '@/lib/recent-orders';
import type { TrackedOrder } from '@/types';

/**
 * Merging the account's orders with this browser's.
 *
 * The property that matters is that **nothing disappears when someone signs
 * in**. A customer with three guest orders on this phone who then creates an
 * account must still see three orders — switching sources instead of merging
 * them would empty the page at the exact moment the account was supposed to
 * make things safer.
 */

const remembered = (token: string, orderId: number, placedAt: string): RememberedOrder => ({
  token,
  orderId,
  placedAt,
  total: 143,
  itemCount: 2,
});

const server = (token: string, id: number, createdAt: string): TrackedOrder =>
  ({
    id,
    tracking_token: token,
    created_at: createdAt,
    grand_total: 143,
    status: 'Placed',
    status_label: 'Placed',
    items: [],
  }) as unknown as TrackedOrder;

describe('mergeOrderHistory', () => {
  it('keeps local-only orders', () => {
    // A guest order from before the account existed. It exists nowhere else.
    const entries = mergeOrderHistory([], [remembered('t1', 1, '2026-08-01T10:00:00Z')]);

    expect(entries).toHaveLength(1);
    expect(entries[0].token).toBe('t1');
    expect(entries[0].order).toBeNull();
    expect(entries[0].remembered).not.toBeNull();
  });

  it('keeps server-only orders', () => {
    // Placed on another device, or claimed. Nothing local to match it.
    const entries = mergeOrderHistory([server('t2', 2, '2026-08-02T10:00:00Z')], []);

    expect(entries).toHaveLength(1);
    expect(entries[0].order).not.toBeNull();
    expect(entries[0].remembered).toBeNull();
  });

  it('collapses an order held by both into one row', () => {
    const entries = mergeOrderHistory(
      [server('t1', 1, '2026-08-01T10:00:00Z')],
      [remembered('t1', 1, '2026-08-01T10:00:00Z')],
    );

    expect(entries).toHaveLength(1);
    // The server's copy is live and complete; the local one is a snapshot from
    // checkout that is never updated.
    expect(entries[0].order).not.toBeNull();
    expect(entries[0].remembered).not.toBeNull();
  });

  it('loses nothing when a guest signs in', () => {
    // Three remembered, two of which the account also knows about.
    const local = [
      remembered('t1', 1, '2026-08-01T10:00:00Z'),
      remembered('t2', 2, '2026-08-02T10:00:00Z'),
      remembered('t3', 3, '2026-08-03T10:00:00Z'),
    ];
    const account = [
      server('t2', 2, '2026-08-02T10:00:00Z'),
      server('t3', 3, '2026-08-03T10:00:00Z'),
    ];

    const entries = mergeOrderHistory(account, local);

    expect(entries.map((entry) => entry.token).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('sorts newest first', () => {
    const entries = mergeOrderHistory(
      [server('t3', 3, '2026-08-03T10:00:00Z')],
      [
        remembered('t1', 1, '2026-08-01T10:00:00Z'),
        remembered('t2', 2, '2026-08-02T10:00:00Z'),
      ],
    );

    expect(entries.map((entry) => entry.token)).toEqual(['t3', 't2', 't1']);
  });

  it('breaks a tie on id, so the order is stable between renders', () => {
    const sameMoment = '2026-08-01T10:00:00Z';
    const entries = mergeOrderHistory(
      [],
      [remembered('t1', 1, sameMoment), remembered('t2', 2, sameMoment)],
    );

    expect(entries.map((entry) => entry.orderId)).toEqual([2, 1]);
  });

  it('handles both sources being empty', () => {
    expect(mergeOrderHistory([], [])).toEqual([]);
  });
});

describe('tokensNeedingFetch', () => {
  it('asks for nothing when the server covered everything', () => {
    // The common case for a signed-in customer: one request, then done.
    const entries = mergeOrderHistory(
      [server('t1', 1, '2026-08-01T10:00:00Z')],
      [remembered('t1', 1, '2026-08-01T10:00:00Z')],
    );

    expect(tokensNeedingFetch(entries)).toEqual([]);
  });

  it('names only the rows the server did not return', () => {
    const entries = mergeOrderHistory(
      [server('t2', 2, '2026-08-02T10:00:00Z')],
      [
        remembered('t1', 1, '2026-08-01T10:00:00Z'),
        remembered('t2', 2, '2026-08-02T10:00:00Z'),
      ],
    );

    expect(tokensNeedingFetch(entries)).toEqual(['t1']);
  });
});

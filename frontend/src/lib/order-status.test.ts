import { describe, expect, it } from 'vitest';

import { isLive, isStopped, isTerminal } from '@/lib/order-status';
import type { OrderStatus } from '@/types';

/**
 * The storefront's reading of the order state machine.
 *
 * `Failed` is what these exist for. It was missing from both places that
 * classified a status, and the consequences were quiet ones: the tracking page
 * kept polling a dead order behind a countdown that would never arrive, and the
 * order list drew its status pill with no styling, so a delivery that never
 * happened looked like an ordinary note.
 *
 * The list below is exhaustive on purpose. Adding a status to `OrderStatus`
 * without deciding which bucket it falls in is precisely the mistake that got
 * us here, and a `Record<OrderStatus, ...>` will not compile until the decision
 * is made.
 */

const EXPECTED: Record<OrderStatus, { terminal: boolean; stopped: boolean }> = {
  Placed: { terminal: false, stopped: false },
  Packing: { terminal: false, stopped: false },
  Ready: { terminal: false, stopped: false },
  Dispatched: { terminal: false, stopped: false },
  Delivered: { terminal: true, stopped: false },
  Cancelled: { terminal: true, stopped: true },
  // Terminal — the order will not move again, so stop polling. Stopped — it
  // ended somewhere other than the customer's door, so explain rather than
  // showing a progress timeline.
  Failed: { terminal: true, stopped: true },
};

describe('order status', () => {
  for (const [status, expected] of Object.entries(EXPECTED) as Array<
    [OrderStatus, { terminal: boolean; stopped: boolean }]
  >) {
    it(`classifies ${status}`, () => {
      expect(isTerminal(status)).toBe(expected.terminal);
      expect(isLive(status)).toBe(!expected.terminal);
      expect(isStopped(status)).toBe(expected.stopped);
    });
  }

  it('treats a failed delivery as finished, not as still on its way', () => {
    // The regression in one line: this returning true is what left the
    // tracking page polling every ten seconds forever.
    expect(isLive('Failed')).toBe(false);
  });

  it('keeps Delivered out of the stopped bucket', () => {
    // Terminal, but it ended the way everyone wanted — it gets the completed
    // timeline, not an apology.
    expect(isTerminal('Delivered')).toBe(true);
    expect(isStopped('Delivered')).toBe(false);
  });
});

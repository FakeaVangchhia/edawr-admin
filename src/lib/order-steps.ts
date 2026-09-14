import { money } from '@/lib/format';
import type { Order, OrderStatus } from '@/types';

/**
 * The moves a manager may request from each state, and what to say when one
 * lands. One table, read by both the order board and the order drawer, so the
 * two cannot offer different buttons for the same status.
 *
 * Mirrors `Order.TRANSITIONS` on the backend intersected with `ADMIN_TARGETS`,
 * and the backend re-checks both — this exists so the console offers only
 * buttons that will work, not so it can decide. An illegal move returns 409.
 *
 * `Dispatched` offers no *cancel*, and that is correct: the goods have left the
 * building, and cancelling restores stock under a lock. It offers **Delivery
 * failed** instead. `Failed` is terminal and moves no stock by itself; returning
 * the units is the separate "Return stock to shelf" action, taken when the
 * rider is actually back.
 */
export interface OrderStep {
  status: OrderStatus;
  label: string;
  /**
   * What the operator is told once it lands — and it names the side effect
   * rather than repeating the button. Every one of these moves does something
   * to stock or to money that is invisible on screen: marking an order
   * delivered records the cash, cancelling puts the units back, failing does
   * not. "Saved" would be true and useless.
   */
  done: (order: Order) => string;
}

export const START_PACKING: OrderStep = {
  status: 'Packing',
  label: 'Start packing',
  done: (order) => `Order #${order.id} is being packed.`,
};

export const MARK_READY: OrderStep = {
  status: 'Ready',
  label: 'Mark ready',
  done: (order) => `Order #${order.id} is ready — a rider is being found for it.`,
};

export const NEXT_STEPS: Record<OrderStatus, OrderStep[]> = {
  Placed: [START_PACKING],
  Packing: [MARK_READY],
  Ready: [
    {
      status: 'Packing',
      label: 'Back to packing',
      done: (order) => `Order #${order.id} is back in packing.`,
    },
  ],
  Dispatched: [
    {
      status: 'Delivered',
      label: 'Mark delivered',
      done: (order) =>
        `Order #${order.id} delivered. ${money(order.grand_total)} recorded as collected.`,
    },
    {
      status: 'Ready',
      label: 'Return to pool',
      done: (order) => `Order #${order.id} is back in the pool for another rider.`,
    },
  ],
  Delivered: [],
  Cancelled: [],
  Failed: [],
};

/** Where the goods are still in the store, so cancelling can restore stock. */
export const CANCELLABLE: readonly OrderStatus[] = ['Placed', 'Packing', 'Ready'];

/** Where a delivery can fail: only from the rider's hands. */
export const FAILABLE: readonly OrderStatus[] = ['Dispatched'];

/** Over, one way or another. Nothing may be assigned or moved from here. */
export const TERMINAL: readonly OrderStatus[] = ['Delivered', 'Cancelled', 'Failed'];

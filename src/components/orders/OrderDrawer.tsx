'use client';

import { AlertTriangle, MapPin, Phone, User } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog, Drawer, ErrorBanner, StatusBadge, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { advanceOrder, assignOrder, restockOrder } from '@/lib/queries';
import { dateTime, minutes, money, phone as formatPhone } from '@/lib/format';
import type { Order, OrderStatus, StaffUser } from '@/types';

/**
 * The moves a manager may request from each state.
 *
 * Mirrors `Order.TRANSITIONS` on the backend intersected with `ADMIN_TARGETS`,
 * and the backend re-checks both — this is here so the console offers only
 * buttons that will work, not so it can decide. An illegal move returns 409.
 *
 * Note `Dispatched` still offers no *cancel*, and that remains correct: the
 * goods have left the building, and cancelling restores stock under a lock.
 * What it now offers instead is **Delivery failed** — the exit that was missing.
 * Until it existed, a customer who refused the bag, an address nobody answered
 * and a stolen bike all had the same only button, "Mark delivered", so the
 * goods were recorded as sold and paid for and the stock never came back.
 *
 * `Failed` is terminal and moves no stock by itself. Returning the units is the
 * separate `Return stock to shelf` action below, taken when the rider is
 * actually back — see `restockOrder`.
 */
interface Step {
  status: OrderStatus;
  label: string;
  /**
   * What the operator is told once it lands — and it names the side effect
   * rather than repeating the button. Every one of these moves does something
   * to stock or to money that is invisible on this screen: marking an order
   * delivered records the cash, cancelling puts the units back, failing does
   * not. "Saved" would be true and useless.
   */
  done: (order: Order) => string;
}

const NEXT_STEPS: Record<OrderStatus, Step[]> = {
  Placed: [
    {
      status: 'Packing',
      label: 'Start packing',
      done: (order) => `Order #${order.id} is being packed.`,
    },
  ],
  Packing: [
    {
      status: 'Ready',
      label: 'Mark ready',
      done: (order) => `Order #${order.id} is ready — a rider is being found for it.`,
    },
  ],
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

const CANCELLABLE: OrderStatus[] = ['Placed', 'Packing', 'Ready'];

/** Where a delivery can fail. Only from the rider's hands. */
const FAILABLE: OrderStatus[] = ['Dispatched'];

export function OrderDrawer({
  order,
  riders,
  onClose,
  onChanged,
}: {
  order: Order | null;
  riders: StaffUser[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [riderId, setRiderId] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmFail, setConfirmFail] = useState(false);
  /**
   * One box, two dialogs — and therefore cleared whenever either opens.
   *
   * Without that, a reason typed for a failed delivery survives into the next
   * Cancel dialog, which opens pre-filled with "Customer refused the order at
   * the door" and writes it as the cancellation reason on one click. Both
   * fields are free text that ends up on the order and in the audit log, so a
   * carried-over sentence is a false record rather than a cosmetic slip.
   */
  const [reason, setReason] = useState('');

  const openCancel = () => {
    setReason('');
    setConfirmCancel(true);
  };

  const openFail = () => {
    setReason('');
    setConfirmFail(true);
  };

  if (!order) return null;

  /**
   * `success` is required rather than optional. Every action in this drawer
   * closes it, so without a confirmation the only evidence anything happened is
   * that the board looks slightly different — and on a slow connection that is
   * indistinguishable from a click the browser dropped, which is how an order
   * gets advanced twice.
   */
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      toast.success(success);
      onChanged();
    } catch (caught) {
      // A 409 here is informative, not a failure of the console: somebody else
      // moved this order between the page loading and the click. Showing the
      // server's sentence is better than a generic "could not update".
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const steps = NEXT_STEPS[order.status] ?? [];
  const canCancel = CANCELLABLE.includes(order.status);
  const canFail = FAILABLE.includes(order.status);
  // A failed order whose goods are not yet back on the shelf. This is the
  // manager's next action on it, and the only place in any of the three apps
  // that returns the stock.
  const awaitingRestock = order.status === 'Failed' && order.restocked_at === null;
  const availableRiders = riders.filter((rider) => rider.is_active);

  return (
    <>
      <Drawer
        open
        wide
        onClose={onClose}
        title={`Order #${order.id}`}
        description={`${order.status_label} · placed ${dateTime(order.created_at)}`}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {steps.map((step) => (
                <button
                  key={step.status}
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run(() => advanceOrder(order.id, step.status), step.done(order))}
                >
                  {step.label}
                </button>
              ))}
            </div>
            {canCancel ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={openCancel}
              >
                Cancel order
              </button>
            ) : null}
            {canFail ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={openFail}
              >
                Delivery failed
              </button>
            ) : null}
            {awaitingRestock ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  run(
                    () => restockOrder(order.id),
                    `The units from order #${order.id} are back on the shelf.`,
                  )
                }
              >
                Return stock to shelf
              </button>
            ) : null}
          </div>
        }
      >
        <div className="space-y-4">
          {error ? <ErrorBanner message={error} /> : null}

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} label={order.status_label} />
            <span className="badge badge-neutral">{order.delivery_type_label}</span>
            {order.is_late ? (
              <span className="badge badge-danger">
                <AlertTriangle size={11} aria-hidden="true" />
                Past its promise
              </span>
            ) : null}
          </div>

          {/* --- customer --- */}
          <section className="panel p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Customer
            </h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-start gap-2">
                <User size={14} className="mt-0.5 text-ink-faint" aria-hidden="true" />
                <dd>{order.customer_name}</dd>
              </div>
              <div className="flex items-start gap-2">
                <Phone size={14} className="mt-0.5 text-ink-faint" aria-hidden="true" />
                {/* A real tel: link — the manager's next action after opening
                    this panel is almost always to ring them. */}
                <dd>
                  <a className="text-accent hover:underline" href={`tel:${order.customer_phone}`}>
                    {formatPhone(order.customer_phone)}
                  </a>
                </dd>
              </div>
              <div className="flex items-start gap-2">
                <MapPin size={14} className="mt-0.5 text-ink-faint" aria-hidden="true" />
                <dd>
                  {order.customer_address}
                  {order.customer_landmark ? (
                    <span className="block text-xs text-ink-faint">
                      Landmark: {order.customer_landmark}
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
            {order.delivery_notes ? (
              <p className="mt-2 rounded-[0.3rem] bg-raised px-2 py-1.5 text-xs text-ink-soft">
                {order.delivery_notes}
              </p>
            ) : null}
          </section>

          {/* --- items --- */}
          <section className="panel-flush">
            <div className="border-b border-line px-3 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Items
              </h3>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name}
                      {item.unit ? (
                        <span className="block text-2xs text-ink-faint">{item.unit}</span>
                      ) : null}
                    </td>
                    <td className="num">{item.quantity}</td>
                    <td className="num">{money(item.price)}</td>
                    {/* Straight from the server's `line_total`. Multiplying
                        price by quantity here would be a second pricing engine,
                        and it would disagree the first time a rule changes. */}
                    <td className="num">{money(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1 border-t border-line px-3 py-2.5 text-sm">
              <Row label="Items" value={money(order.items_total)} />
              <Row label="Delivery" value={money(order.delivery_fee)} />
              <Row label="Handling" value={money(order.handling_fee)} />
              <Row label="Total" value={money(order.grand_total)} strong />
            </dl>
          </section>

          {/* --- fulfilment --- */}
          <section className="panel p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Fulfilment
            </h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <Row label="Promised" value={minutes(order.promised_minutes)} />
              <Row
                label="Actual"
                value={
                  order.fulfilment_minutes === null ? '—' : minutes(order.fulfilment_minutes)
                }
              />
              <Row label="Packed" value={dateTime(order.packed_at)} />
              <Row label="Dispatched" value={dateTime(order.dispatched_at)} />
              <Row label="Delivered" value={dateTime(order.delivered_at)} />
              <Row label="Rider" value={order.rider?.name ?? 'Unassigned'} />
            </dl>

            {order.cancellation_reason ? (
              <p className="mt-2 rounded-[0.3rem] border border-danger bg-danger-quiet px-2 py-1.5 text-xs text-danger">
                Cancelled: {order.cancellation_reason}
              </p>
            ) : null}

            {/* The picker is an override, not the normal path. Riders are
                chosen automatically the moment an order is marked Ready (see
                api/dispatch.py), so this stays available on an order that
                already has one — reassigning is now the common reason to open
                it — and an order that is Ready with nobody on it means
                automatic dispatch found no candidate, which is the one state a
                manager has to act on. */}
            {order.status !== 'Cancelled' && order.status !== 'Delivered' ? (
              <div className="mt-3 border-t border-line pt-3">
                {!order.rider && order.status === 'Ready' ? (
                  <p className="mb-2 rounded-[0.3rem] border border-danger bg-danger-quiet px-2 py-1.5 text-xs text-danger">
                    No rider was found automatically. Nobody on shift is within
                    range of this address, or everyone in range has declined it.
                  </p>
                ) : null}
                <label className="label" htmlFor="assign-rider">
                  {order.rider ? 'Hand to a different rider' : 'Assign a rider'}
                </label>
                <div className="flex gap-2">
                  <select
                    id="assign-rider"
                    className="field"
                    value={riderId}
                    onChange={(event) => setRiderId(event.target.value)}
                  >
                    <option value="">Choose a rider…</option>
                    {availableRiders.map((rider) => (
                      <option key={rider.id} value={rider.id}>
                        {rider.name}
                        {rider.is_available ? '' : ' (off duty)'}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!riderId || busy}
                    onClick={() =>
                      run(
                        () => assignOrder(order.id, Number(riderId)),
                        `Order #${order.id} is on its way with ${
                          availableRiders.find((rider) => rider.id === Number(riderId))?.name ??
                          'the chosen rider'
                        }.`,
                      )
                    }
                  >
                    {order.rider ? 'Reassign' : 'Assign'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  {order.rider
                    ? 'Overrides the automatic choice and moves the order to whoever you pick.'
                    : 'Normally automatic once the order is Ready. Assigning by hand walks it forward to Dispatched and overrides both the automatic choice and the queue in the rider app.'}
                </p>
              </div>
            ) : null}
          </section>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmCancel}
        destructive
        busy={busy}
        title={`Cancel order #${order.id}?`}
        confirmLabel="Cancel order"
        message={
          <div className="space-y-2">
            <p>
              The stock will be returned to the shelf. This cannot be undone —
              cancellation is a terminal state.
            </p>
            <div>
              <label className="label" htmlFor="cancel-reason">
                Reason
              </label>
              <input
                id="cancel-reason"
                className="field"
                placeholder="Nobody home after three calls"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {/* Recorded against the order and in the activity log. Before
                  this field existed the console sent a hardcoded "Cancelled by
                  store", which is the one thing nobody needs to be told. */}
              <p className="mt-1 text-xs text-ink-faint">
                Saved with the order and the activity log.
              </p>
            </div>
          </div>
        }
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          run(
            () => advanceOrder(order.id, 'Cancelled', reason.trim()),
            `Order #${order.id} cancelled. The stock is back on the shelf.`,
          );
        }}
      />

      <ConfirmDialog
        open={confirmFail}
        destructive
        busy={busy}
        title={`Record order #${order.id} as a failed delivery?`}
        confirmLabel="Record failure"
        // The API rejects an empty reason with a 400. The copy below says
        // "Required"; this is what makes it true before a round trip.
        confirmDisabled={reason.trim().length === 0}
        message={
          <div className="space-y-2">
            <p>
              This ends the order without recording a sale. The stock is{' '}
              <strong>not</strong> returned yet — the bag is with the rider. Use{' '}
              <em>Return stock to shelf</em> once the goods are physically back.
            </p>
            <div>
              <label className="label" htmlFor="fail-reason">
                What happened
              </label>
              <input
                id="fail-reason"
                className="field"
                placeholder="Customer refused the order at the door"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {/* Required by the API, not merely encouraged. This is the one
                  transition whose whole value is the sentence attached to it —
                  it is what the store reads when the customer rings. */}
              <p className="mt-1 text-xs text-ink-faint">
                Required. Saved with the order and the activity log.
              </p>
            </div>
          </div>
        }
        onCancel={() => setConfirmFail(false)}
        onConfirm={() => {
          setConfirmFail(false);
          run(
            () => advanceOrder(order.id, 'Failed', reason.trim()),
            `Order #${order.id} recorded as a failed delivery. The stock is still with the rider.`,
          );
        }}
      />
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={strong ? 'font-semibold numeric' : 'numeric'}>{value}</dd>
    </div>
  );
}

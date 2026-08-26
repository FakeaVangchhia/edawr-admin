'use client';

/* eslint-disable @next/next/no-img-element -- Product and category images are
   served by the Django backend, and its hostname is only known at runtime from
   NEXT_PUBLIC_API_URL. next/image needs `remotePatterns` configured at build
   time, which would mean baking the API host into the bundle — the one thing
   `lib/api.ts` exists to avoid. Plain <img> it is. */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bike,
  Check,
  ChefHat,
  Loader2,
  MapPin,
  PackageCheck,
  PackageX,
  PhoneCall,
  Receipt,
  Store,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, assetUrl } from '@/lib/api';
import {
  formatClockTime,
  formatCountdown,
  formatDateTime,
  formatMoney,
  formatMoneyExact,
  formatPhone,
} from '@/lib/format';
import { isLive, isStopped } from '@/lib/order-status';
import { forgetOrder } from '@/lib/recent-orders';
import { cancelOrder, trackOrder } from '@/lib/store-api';
import { claimOrder } from '@/lib/customer-api';
import { useSession } from '@/hooks/useStoreData';
import { ImageFallback } from '@/components/ProductCard';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { OrderStatus, TrackedOrder } from '@/types';

/**
 * Live tracking for one order.
 *
 * The prototype this design came from invented five stages and a rider, and
 * animated between them on a timer. This shows the **real state machine** from
 * `Order.TRANSITIONS`, polled from the server, with the actual rider attached
 * at Ready or nobody at all. A progress bar that moves on a clock rather than
 * on the order is a lie the customer discovers at the door.
 *
 * The order is authorised by possession of the tracking token in the URL, and
 * still is now that accounts exist: this page is public, because the customer
 * who placed the order may well not have one. That is why a 404 forgets the
 * token locally — it is either wrong or the order is gone, and continuing to
 * advertise it on /orders helps nobody.
 *
 * A signed-in customer is offered the chance to attach this order to their
 * account. It needs no verified number precisely because the token is already
 * the credential: claiming grants nothing that reading this page did not.
 */

const POLL_MS = 10_000;

const STEPS: Array<{ status: OrderStatus; label: string; note: string; icon: typeof Check }> = [
  {
    status: 'Placed',
    label: 'Order confirmed',
    note: 'We have your order and the store is on it.',
    icon: Receipt,
  },
  {
    status: 'Packing',
    label: 'Packing your order',
    note: 'Your items are being picked off the shelf.',
    icon: ChefHat,
  },
  {
    status: 'Ready',
    label: 'Ready for a rider',
    note: 'Packed and waiting for the nearest rider.',
    icon: PackageCheck,
  },
  {
    status: 'Dispatched',
    label: 'On the way',
    note: 'Your rider has the bag and is moving.',
    icon: Bike,
  },
  {
    status: 'Delivered',
    label: 'Delivered',
    note: 'Handed over. Enjoy.',
    icon: Check,
  },
];

const STAMPS: Partial<Record<OrderStatus, keyof TrackedOrder>> = {
  Placed: 'created_at',
  Packing: 'packed_at',
  Dispatched: 'dispatched_at',
  Delivered: 'delivered_at',
};

export function OrderTracker({ token }: { token: string }) {
  const [state, setState] = useState<{ order: TrackedOrder | null; error: string } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const session = useSession();
  const [claimed, setClaimed] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  /**
   * Bumped to re-run the fetch. Refreshing by changing state that the effect
   * depends on — rather than by calling a fetch function from inside it —
   * is what keeps every setState on an async or event-handler path.
   */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    trackOrder(token, controller.signal)
      .then((order) => setState({ order, error: '' }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof ApiError && caught.status === 404) {
          // A token that 404s is one this browser should stop advertising.
          forgetOrder(token);
          setState((current) => ({
            order: current?.order ?? null,
            error: 'We could not find that order. Check the link and try again.',
          }));
          return;
        }
        setState((current) => ({
          order: current?.order ?? null,
          error: caught instanceof Error ? caught.message : 'Could not load that order.',
        }));
      });

    return () => controller.abort();
  }, [token, reloadToken]);

  const order = state?.order ?? null;
  const live = order !== null && isLive(order.status);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setReloadToken((value) => value + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [live]);

  if (state === null) return <TrackingSkeleton />;

  if (!order) {
    return (
      <div className="container-page py-20 text-center lg:py-28">
        <h1 className="text-2xl font-semibold">We couldn&apos;t find that order</h1>
        <p className="mt-2 text-sm text-muted-foreground">{state.error}</p>
        <Link
          href="/orders"
          className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
        >
          Your orders
        </Link>
      </div>
    );
  }

  const delivered = order.status === 'Delivered';
  const failed = order.status === 'Failed';
  // Neither Cancelled nor Failed appears in STEPS, so findIndex returns -1 and
  // every step renders as not-yet-started — a Dispatched order that failed
  // would show a completely greyed-out timeline. Both get an explanation in
  // place of the step list instead.
  const stopped = isStopped(order.status);
  const currentStep = STEPS.findIndex((step) => step.status === order.status);

  const cancel = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      const updated = await cancelOrder(token, 'Cancelled by customer');
      setState({ order: updated, error: '' });
      toast.success('Order cancelled', { description: 'Your items have gone back on the shelf.' });
    } catch (caught: unknown) {
      toast.error(
        caught instanceof Error ? caught.message : 'We could not cancel that order.',
        // A 409 here is the state machine refusing, which is the useful part.
        { description: 'A rider may already have collected it.' },
      );
      setReloadToken((value) => value + 1);
    } finally {
      setIsCancelling(false);
    }
  };

  /**
   * Attach this order to the signed-in account.
   *
   * Offered here because this is the moment the customer is holding the
   * proof: the tracking token is in the address bar, and possession of it is
   * already the whole credential for this page. The server checks nothing
   * else, and does not need to — it grants no access that reading this page
   * did not already grant.
   *
   * The button only appears when there is something to do: signed in, and
   * this order not already linked to somebody.
   */
  const claim = async () => {
    if (isClaiming) return;
    setIsClaiming(true);
    try {
      const updated = await claimOrder(token);
      setState({ order: updated, error: '' });
      setClaimed(true);
      toast.success('Saved to your account');
    } catch (caught: unknown) {
      toast.error(
        caught instanceof Error ? caught.message : 'Could not save that to your account.',
      );
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="container-page py-8 lg:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Order</p>
          <h1 className="num text-3xl font-semibold lg:text-4xl">#{order.id}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed {formatDateTime(order.created_at)}
          </p>

          {/*
            The account offer, at the moment it is most likely to be taken: the
            order has gone through and the customer is watching it come.
            Research on this is consistent — right after a good outcome beats
            anywhere in the checkout flow.
          */}
          {!session ? (
            <p className="mt-3 text-sm text-muted-foreground">
              <Link
                href={`/signup?next=${encodeURIComponent(`/order/${token}`)}`}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Create an account
              </Link>{' '}
              to keep this order when you change phone.
            </p>
          ) : claimed ? (
            <p className="mt-3 text-sm text-success">Saved to your account.</p>
          ) : (
            <button
              type="button"
              onClick={claim}
              disabled={isClaiming}
              className="mt-3 text-sm font-medium underline underline-offset-4 disabled:opacity-60"
            >
              {isClaiming ? 'Saving…' : 'Save this order to my account'}
            </button>
          )}
        </div>

        {/* The one thing on this page that changes on its own.
            It is polled every ten seconds, so a customer who is not watching
            the screen — the whole point of a tracking page — got no signal at
            all that their order had moved. `role="status"` announces the change
            politely, without stealing focus.

            The element is always mounted and only its text changes. Wrapping it
            in a condition would put the region into the DOM at the same moment
            its content first changed, which most screen readers do not
            announce. */}
        <span
          role="status"
          aria-live="polite"
          className={cn(
            'rounded-full px-4 py-2 text-sm font-semibold',
            stopped && 'bg-destructive-soft text-destructive',
            delivered && 'bg-success-soft text-success',
            !stopped && !delivered && 'bg-amber-soft text-amber-foreground',
          )}
        >
          {order.status_label}
        </span>
      </div>

      {/* Always mounted, empty when there is nothing wrong. A polling failure
          on a tracking page is exactly the kind of thing a screen reader user
          needs told, and exactly the kind of conditionally-rendered region that
          is never announced. */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.error ? `${state.error} Showing the last update we received.` : ''}
      </p>
      {state.error && (
        <p
          aria-hidden
          className="mt-4 rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive"
        >
          {state.error} Showing the last update we received.
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
        <div className="space-y-6">
          {!stopped && !delivered && (
            <section className="flex items-center gap-4 rounded-4xl bg-primary p-6 text-primary-foreground">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber">
                <Zap className="size-6 text-amber-foreground" aria-hidden />
              </span>
              <div>
                <p className="num text-2xl font-semibold">
                  {formatCountdown(order.minutes_remaining)}
                </p>
                <p className="text-sm text-primary-foreground/70">
                  {order.is_late
                    ? 'Running late — it is on its way.'
                    : `${order.delivery_type_label} · arriving by ${formatClockTime(order.promised_at)}`}
                </p>
              </div>
            </section>
          )}

          <section className="rounded-4xl border border-border/70 p-6">
            <h2 className="text-lg font-semibold">Progress</h2>

            {stopped ? (
              <div className="mt-5 flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive-soft">
                  {failed ? (
                    <PackageX className="size-5 text-destructive" aria-hidden />
                  ) : (
                    <XCircle className="size-5 text-destructive" aria-hidden />
                  )}
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    {failed ? 'Delivery could not be completed' : 'Order cancelled'}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {/* The rider is required to give a reason for a failed
                        delivery, and the server stores it here. It is the whole
                        point of the transition — it is what the store reads
                        back when the customer rings about it. */}
                    {order.cancellation_reason ??
                      (failed
                        ? 'Your rider could not complete this delivery.'
                        : 'This order was cancelled.')}
                  </p>
                  {failed ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      You have not been charged — this order was cash on
                      delivery. Place it again whenever you are ready.
                    </p>
                  ) : null}
                  {!failed && order.cancelled_at && (
                    <p className="num mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(order.cancelled_at)}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <ol className="mt-5 space-y-1">
                {STEPS.map((step, index) => {
                  const done = index < currentStep;
                  const active = index === currentStep;
                  const stampKey = STAMPS[step.status];
                  const stamp = stampKey ? (order[stampKey] as string | null) : null;
                  const Icon = step.icon;

                  return (
                    <li key={step.status} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={cn(
                            'grid size-9 shrink-0 place-items-center rounded-full transition-colors',
                            done && 'bg-success-soft text-success',
                            active && 'animate-pulse-soft bg-amber text-amber-foreground',
                            !done && !active && 'bg-secondary text-muted-foreground',
                          )}
                        >
                          <Icon className="size-4" aria-hidden />
                        </span>
                        {index < STEPS.length - 1 && (
                          <span
                            className={cn(
                              'my-1 w-px flex-1',
                              done ? 'bg-success/40' : 'bg-border',
                            )}
                          />
                        )}
                      </div>

                      <div className={cn('pb-5', !done && !active && 'opacity-50')}>
                        <p className="text-sm font-semibold">{step.label}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{step.note}</p>
                        {stamp && (done || active) && (
                          <p className="num mt-0.5 text-xs text-muted-foreground">
                            {formatClockTime(stamp)}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="rounded-4xl border border-border/70 p-6">
            <h2 className="text-lg font-semibold">Your rider</h2>
            {order.rider ? (
              <div className="mt-4 flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-secondary">
                  <Bike className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{order.rider.name}</p>
                  <p className="num text-xs text-muted-foreground">
                    {formatPhone(order.rider.phone)}
                  </p>
                </div>
                <a
                  href={`tel:${order.rider.phone}`}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
                >
                  <PhoneCall className="size-4" aria-hidden />
                  Call
                </a>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-3 rounded-3xl bg-surface p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-secondary">
                  <Store className="size-5 text-muted-foreground" aria-hidden />
                </span>
                <p className="text-sm text-muted-foreground">
                  {riderNote(order.status)}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-4xl border border-border/70 p-6">
            <h2 className="text-lg font-semibold">Delivering to</h2>
            <div className="mt-4 flex items-start gap-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
              <div className="text-sm">
                <p className="font-medium">{order.customer_name}</p>
                <p className="mt-0.5 text-muted-foreground">{order.customer_address}</p>
                {order.customer_landmark && (
                  <p className="text-muted-foreground">Near {order.customer_landmark}</p>
                )}
                {order.delivery_notes && (
                  <p className="mt-2 text-muted-foreground">Note: {order.delivery_notes}</p>
                )}
              </div>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-6 rounded-4xl border border-border/70 p-6">
            <div>
              <h2 className="text-lg font-semibold">
                {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
              </h2>
              <ul className="mt-4 space-y-3">
                {order.items.map((item) => {
                  const image = assetUrl(item.image_url);
                  return (
                    <li key={item.id} className="flex items-center gap-3">
                      {image ? (
                        <img
                          src={image}
                          alt=""
                          loading="lazy"
                          width={100}
                          height={100}
                          className="size-11 shrink-0 rounded-xl bg-surface object-cover"
                        />
                      ) : (
                        <ImageFallback name={item.name} className="size-11 shrink-0 rounded-xl" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.name}</span>
                        <span className="num block text-xs text-muted-foreground">
                          Qty {item.quantity} · {formatMoney(item.price)}
                        </span>
                      </span>
                      <span className="num text-sm font-semibold">
                        {formatMoney(item.line_total)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/*
              Every figure below was computed by the server when the order was
              created and is simply being read back. Nothing here re-adds them.
            */}
            <dl className="space-y-3 border-t pt-6 text-sm">
              <Row label="Item total" value={order.items_total} />
              <Row label="Delivery" value={order.delivery_fee} />
              <Row label="Handling" value={order.handling_fee} />
              <div className="flex items-center justify-between border-t pt-3 text-base font-semibold">
                <dt>Total</dt>
                <dd className="num">{formatMoneyExact(order.grand_total)}</dd>
              </div>
              {/* Cash on delivery means the money changes hands at the door,
                  so an order that never reached the door was never paid. Saying
                  "paid" under the total of a cancelled or failed order reads as
                  a charge the customer then goes looking for. */}
              <p className="pt-1 text-xs text-muted-foreground">
                {delivered
                  ? 'Paid by cash on delivery.'
                  : stopped
                    ? 'Nothing was charged for this order.'
                    : 'To be paid by cash on delivery.'}
              </p>
            </dl>

            {order.can_cancel && (
              <button
                type="button"
                onClick={cancel}
                disabled={isCancelling}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border text-sm font-semibold transition-colors hover:bg-destructive-soft hover:text-destructive disabled:pointer-events-none disabled:opacity-60"
              >
                {isCancelling && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {isCancelling ? 'Cancelling…' : 'Cancel this order'}
              </button>
            )}

            <Link
              href="/orders"
              className="block text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              All your orders
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * What to say when the tracking payload carries no rider.
 *
 * The server attaches one only while the order is Dispatched, so "nobody is
 * attached" means something different at each end of the lifecycle: not yet for
 * a live order, no longer for one that has stopped. A failed delivery is the
 * case where the flat "no rider was assigned" reads as plainly false — someone
 * did try.
 */
function riderNote(status: OrderStatus): string {
  if (status === 'Failed') return 'The rider who attempted this delivery has been released from it.';
  if (status === 'Delivered' || status === 'Cancelled') return 'No rider is attached to this order.';
  return 'A rider is assigned once your order is packed and ready.';
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('num', value === 0 && 'text-amber-foreground')}>
        {value === 0 ? 'Free' : formatMoneyExact(value)}
      </dd>
    </div>
  );
}

function TrackingSkeleton() {
  return (
    <div className="container-page py-8 lg:py-12">
      <Skeleton className="h-12 w-48 rounded-2xl" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
        <div className="space-y-6">
          <Skeleton className="h-24 rounded-4xl" />
          <Skeleton className="h-80 rounded-4xl" />
        </div>
        <Skeleton className="h-96 rounded-4xl" />
      </div>
    </div>
  );
}

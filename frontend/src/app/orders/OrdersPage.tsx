'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, Package, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { mergeLines } from '@/lib/cart-store';
import { formatDateTime, formatMoneyExact } from '@/lib/format';
import { isLive, isStopped } from '@/lib/order-status';
import { buildReorder } from '@/lib/reorder';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecentOrders, useSession } from '@/hooks/useStoreData';
import { cn } from '@/lib/utils';
import type { TrackedOrder } from '@/types';
import { ApiError } from '@/lib/api';
import { mapWithLimit } from '@/lib/concurrency';
import { trackOrder } from '@/lib/store-api';
import { fetchMyOrders } from '@/lib/customer-api';
import { mergeOrderHistory } from '@/lib/order-history';

/**
 * The customer's order history.
 *
 * Two sources, merged into one list by `lib/order-history.ts`. A signed-in
 * customer's orders come from the server in one request; anything this browser
 * remembers and the server did not return — a guest order, or one placed here
 * while signed out — is fetched per token from `lib/recent-orders.ts` and kept
 * alongside. Merged rather than switched between, because switching would make
 * orders vanish the moment someone signed in, which is the opposite of what an
 * account is for.
 *
 * Local-only rows are re-fetched for their live status, because a remembered
 * order that still says "Placed" three hours later is worse than no status.
 *
 * Orders whose tokens 404 are dropped by `OrderTracker` when they are opened;
 * here they render as gone rather than vanishing mid-list.
 *
 * **"Gone" and "we cannot reach the store" are shown differently**, and they
 * used to be the same word. Both took the same `.catch(() => null)` branch and
 * both rendered "Unavailable", so a backend outage looked exactly like ten
 * deleted orders — the single most alarming thing this page could tell a
 * customer, and in that case it was not even true.
 */

/** What we know about one remembered token after trying to fetch it. */
type OrderState = TrackedOrder | 'gone' | 'unreachable';

/** How many tracking requests to have in flight at once. See lib/concurrency.ts. */
const FETCH_CONCURRENCY = 3;

export function OrdersPage() {
  const remembered = useRecentOrders();
  const session = useSession();
  const [reordering, setReordering] = useState<string | null>(null);

  /**
   * The set of tokens this browser remembers, as one string.
   *
   * It doubles as the cache key for the fetch below: `remembered` is a fresh
   * array reference on every render, so depending on it directly would re-fetch
   * forever, and tagging the result with it is what makes the loading flag
   * derivable instead of stored. The account id joins it for the same reason —
   * signing in or out has to re-run this, and the id is what changed.
   */
  const tokens = remembered.map((entry) => entry.token).join(',');
  const queryKey = `${session?.id ?? 'guest'}:${tokens}`;
  const [fetched, setFetched] = useState<{
    key: string;
    server: TrackedOrder[];
    orders: Record<string, OrderState>;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // One request for the whole account, when there is one. A signed-in
    // customer's history usually arrives entirely from here, and the per-token
    // requests below then have nothing left to do.
    //
    // A failure is not fatal: the remembered tokens are still fetchable, so an
    // account whose orders cannot be loaded degrades to what a guest would
    // see rather than to an error page.
    const account = session
      ? fetchMyOrders(controller.signal).catch(() => [] as TrackedOrder[])
      : Promise.resolve([] as TrackedOrder[]);

    account.then((server) => {
      if (controller.signal.aborted) return;

      const covered = new Set(server.map((order) => order.tracking_token));
      const outstanding = (tokens ? tokens.split(',') : []).filter(
        (token) => !covered.has(token),
      );

      // An empty list still resolves — the "no orders" state is a result, not a
      // pending one, and returning early here would leave it loading forever.
      return mapWithLimit(outstanding, FETCH_CONCURRENCY, (token) =>
        trackOrder(token, controller.signal)
          .then((order) => [token, order] as const)
          .catch((error: unknown) => {
            // A failed token never fails the whole list — one reseeded database
            // should not hide the orders that are still fine — but *why* it
            // failed decides what the customer is told. A 404 means the order
            // is genuinely gone; anything else means we could not ask.
            const gone = error instanceof ApiError && error.status === 404;
            return [token, gone ? 'gone' : 'unreachable'] as const;
          }),
      ).then((entries) => {
        if (controller.signal.aborted) return;
        setFetched({ key: queryKey, server, orders: Object.fromEntries(entries) });
      });
    });

    return () => controller.abort();
    // `tokens` and `session?.id` are both inside `queryKey`; listing it alone
    // keeps the effect keyed on exactly the string the result is tagged with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  // Derived, not stored: results belong to the query that produced them.
  const current = fetched?.key === queryKey ? fetched : null;
  const orders = current?.orders ?? {};
  const loaded = current !== null;

  // One row per tracking token, server copies preferred. A local-only row is
  // kept rather than dropped: it is either a guest order from before the
  // account existed or one placed on this device while signed out, and losing
  // it would be losing the only record of it.
  const history = mergeOrderHistory(current?.server ?? [], remembered);

  const reorder = async (token: string) => {
    if (reordering) return;
    setReordering(token);
    try {
      const { lines, skipped } = await buildReorder(token);
      if (lines.length === 0) {
        toast.error('Nothing from that order is available right now.');
        return;
      }
      mergeLines(lines);
      toast.success('Added to your basket', {
        description:
          skipped.length > 0
            ? `${skipped.length} item${skipped.length === 1 ? '' : 's'} could not be added.`
            : undefined,
      });
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : 'Could not rebuild that basket.');
    } finally {
      setReordering(null);
    }
  };

  if (!loaded) {
    return (
      <div className="container-page py-10 lg:py-16">
        <Skeleton className="h-12 w-56 rounded-2xl" />
        <div className="mt-10 space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-4xl" />
          ))}
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="container-page py-20 text-center lg:py-28">
        <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-secondary">
          <Package className="size-7 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-semibold">No orders yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {session
            ? 'Orders you place while signed in are saved to your account, so they follow you to any device.'
            : 'Orders you place are remembered on this device so you can track them. Sign in and they are saved to your account instead.'}
        </p>
        <Link
          href="/products"
          className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
        >
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="container-page py-10 lg:py-16">
      <h1 className="text-3xl font-semibold lg:text-5xl">Your orders</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Saved on this device. Tracking is authorised by the link itself, so anyone with it can see
        the order.
      </p>

      <ul className="mt-10 space-y-4">
        {history.map((entry) => {
          // A row the server already returned needs no per-token state:
          // it arrived complete. Only local-only rows have a `gone` or
          // `unreachable` outcome to report.
          const state = entry.order ?? orders[entry.token];
          // Narrowed once, here, so every branch below reads an order or reads
          // nothing — rather than each one re-checking which of the three
          // states it is looking at.
          const order = typeof state === 'object' ? state : null;
          const live = order ? isLive(order.status) : false;

          return (
            <li
              key={entry.token}
              className="rounded-4xl border border-border/70 p-6 transition-shadow hover:shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="num text-lg font-semibold">#{entry.orderId}</p>
                  <p className="num mt-0.5 text-sm text-muted-foreground">
                    {formatDateTime(order?.created_at ?? entry.placedAt)} ·{' '}
                    {order?.items.length ?? entry.remembered?.itemCount ?? 0}{' '}
                    {(order?.items.length ?? entry.remembered?.itemCount ?? 0) === 1 ? 'item' : 'items'}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="num text-lg font-semibold">
                    {formatMoneyExact(order?.grand_total ?? entry.remembered?.total ?? 0)}
                  </span>
                  {order ? (
                    <span
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-semibold',
                        // Failed is styled with Cancelled rather than left to
                        // fall through all three: an unmatched status renders
                        // an unstyled pill, which reads as an ordinary note
                        // rather than as the order having gone wrong.
                        isStopped(order.status) && 'bg-destructive-soft text-destructive',
                        order.status === 'Delivered' && 'bg-success-soft text-success',
                        live && 'bg-amber-soft text-amber-foreground',
                      )}
                    >
                      {order.status_label}
                    </span>
                  ) : state === 'gone' ? (
                    <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      No longer available
                    </span>
                  ) : (
                    // The store is unreachable, not the order missing. Saying
                    // "unavailable" here told a customer their order had been
                    // deleted when in fact the API was down for thirty seconds.
                    <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      Status unavailable
                    </span>
                  )}
                </div>
              </div>

              {live && order && (
                <p className="num mt-3 text-sm text-amber-foreground">
                  Arriving in about {order.minutes_remaining} min
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-5">
                <Link
                  href={`/order/${entry.token}`}
                  className="inline-flex h-10 items-center gap-1 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
                >
                  {live ? 'Track order' : 'View order'}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>

                <button
                  type="button"
                  onClick={() => reorder(entry.token)}
                  disabled={reordering !== null || !order}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-50"
                >
                  {reordering === entry.token ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="size-4" aria-hidden />
                  )}
                  Order again
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

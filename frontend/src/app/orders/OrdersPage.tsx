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
import { useRecentOrders } from '@/hooks/useStoreData';
import { cn } from '@/lib/utils';
import type { TrackedOrder } from '@/types';
import { trackOrder } from '@/lib/store-api';

/**
 * The customer's order history.
 *
 * There is no account, so "history" is the set of tracking tokens this browser
 * saved at checkout — see `lib/recent-orders.ts`. Each one is re-fetched for
 * its live status, because a remembered order that still says "Placed" three
 * hours later is worse than no status at all.
 *
 * Orders whose tokens 404 are dropped by `OrderTracker` when they are opened;
 * here they simply render as unavailable rather than vanishing mid-list.
 */

export function OrdersPage() {
  const remembered = useRecentOrders();
  const [reordering, setReordering] = useState<string | null>(null);

  /**
   * The set of tokens this browser remembers, as one string.
   *
   * It doubles as the cache key for the fetch below: `remembered` is a fresh
   * array reference on every render, so depending on it directly would re-fetch
   * forever, and tagging the result with it is what makes the loading flag
   * derivable instead of stored.
   */
  const tokens = remembered.map((entry) => entry.token).join(',');
  const [fetched, setFetched] = useState<{
    tokens: string;
    orders: Record<string, TrackedOrder | null>;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // An empty list still resolves — the "no orders" state is a result, not a
    // pending one, and returning early here would leave it loading forever.
    Promise.all(
      (tokens ? tokens.split(',') : []).map((token) =>
        trackOrder(token, controller.signal)
          .then((order) => [token, order] as const)
          // A token that no longer resolves is shown as unavailable rather than
          // failing the whole list; one reseeded database should not hide the
          // orders that are still fine.
          .catch(() => [token, null] as const),
      ),
    ).then((entries) => {
      if (controller.signal.aborted) return;
      setFetched({ tokens, orders: Object.fromEntries(entries) });
    });

    return () => controller.abort();
  }, [tokens]);

  // Derived, not stored: results belong to the token list that produced them.
  const current = fetched?.tokens === tokens ? fetched : null;
  const orders = current?.orders ?? {};
  const loaded = current !== null;

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

  if (remembered.length === 0) {
    return (
      <div className="container-page py-20 text-center lg:py-28">
        <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-secondary">
          <Package className="size-7 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-semibold">No orders yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Orders you place are remembered on this device so you can track them. They are not tied
          to an account, so clearing your browser data clears this list.
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
        {remembered.map((entry) => {
          const order = orders[entry.token];
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
                    {order?.items.length ?? entry.itemCount}{' '}
                    {(order?.items.length ?? entry.itemCount) === 1 ? 'item' : 'items'}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="num text-lg font-semibold">
                    {formatMoneyExact(order?.grand_total ?? entry.total)}
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
                  ) : (
                    <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      Unavailable
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

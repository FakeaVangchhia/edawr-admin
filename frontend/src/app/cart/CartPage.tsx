'use client';

/* eslint-disable @next/next/no-img-element -- Product and category images are
   served by the Django backend, and its hostname is only known at runtime from
   NEXT_PUBLIC_API_URL. next/image needs `remotePatterns` configured at build
   time, which would mean baking the API host into the bundle — the one thing
   `lib/api.ts` exists to avoid. Plain <img> it is. */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { assetUrl } from '@/lib/api';
import { addOne, clearCart, removeLine, setQuantity } from '@/lib/cart-store';
import { DEFAULT_DELIVERY_TYPE } from '@/lib/delivery';
import { formatMoney } from '@/lib/format';
import {
  BillLines,
  DeliveryTierPicker,
  FreeDeliveryNudge,
  MinimumOrderNotice,
} from '@/components/BasketSummary';
import { ImageFallback } from '@/components/ProductCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useCart, useStoreConfig } from '@/hooks/useStoreData';
import { useQuote } from '@/hooks/useQuote';
import { cn } from '@/lib/utils';
import type { DeliveryType } from '@/types';

/**
 * The basket.
 *
 * **No line total is computed here.** Every figure on this page is the
 * server's, from `useQuote`. A `price × quantity` column written in TypeScript
 * would be a second pricing engine doing arithmetic in floats, which is exactly
 * what `api/pricing.py` exists to prevent.
 *
 * The row totals now come from `quote.lines`, which `BasketQuoteSerializer`
 * added for this. Before that field existed the page could only show a per-unit
 * price and leave the customer to multiply — the rule was being followed by
 * showing less, because the server had the number and was throwing it away.
 *
 * The chosen tier lives here rather than in the checkout page because it
 * changes the bill the customer is looking at right now, and it is carried
 * forward through the URL when they continue.
 */
export function CartPage() {
  const { lines, hydrated } = useCart();
  const config = useStoreConfig();
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(DEFAULT_DELIVERY_TYPE);
  const { quote, isLoading, error } = useQuote(lines, deliveryType);

  // Row totals, keyed by product, exactly as the server quantised them. Empty
  // while a quote is in flight, which is why the render below falls back to the
  // per-unit price rather than to a locally computed product.
  const lineTotals = new Map(
    (quote?.lines ?? []).map((row) => [row.product_id, row.line_total]),
  );
  const storeClosed = config ? !config.is_open : false;

  if (!hydrated) return <CartSkeleton />;

  if (lines.length === 0) {
    return (
      <div className="container-page py-20 text-center lg:py-28">
        <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-secondary">
          <ShoppingBag className="size-7 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-semibold">Your basket is empty</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Add a few things and they will be at your door in minutes.
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

  const canCheckout =
    Boolean(quote?.meets_minimum) && quote?.unavailable.length === 0 && !storeClosed;
  const unavailableIds = new Set(quote?.unavailable.map((item) => item.product_id) ?? []);

  return (
    <div className="container-page py-8 pb-32 lg:py-12 lg:pb-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold lg:text-5xl">Your basket</h1>
          <p className="num mt-2 text-muted-foreground">
            {lines.length} {lines.length === 1 ? 'product' : 'products'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            clearCart();
            toast.success('Basket cleared');
          }}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-destructive"
        >
          Clear all
        </button>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
        <ul className="space-y-3">
          {lines.map((line) => {
            const image = assetUrl(line.product.image_url);
            const unavailable = unavailableIds.has(line.product.id);

            return (
              <li
                key={line.product.id}
                className={cn(
                  'flex items-center gap-4 rounded-3xl border p-4 transition-colors',
                  unavailable ? 'border-destructive/40 bg-destructive-soft' : 'border-border/70',
                )}
              >
                <Link href={`/product/${line.product.id}`} className="shrink-0">
                  {image ? (
                    <img
                      src={image}
                      alt=""
                      loading="lazy"
                      width={160}
                      height={160}
                      className="size-16 rounded-2xl bg-surface object-cover"
                    />
                  ) : (
                    <ImageFallback name={line.product.name} className="size-16 rounded-2xl" />
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/product/${line.product.id}`}
                    className="block truncate text-[15px] font-semibold transition-colors hover:text-muted-foreground"
                  >
                    {line.product.name}
                  </Link>
                  <p className="num mt-0.5 text-xs text-muted-foreground">
                    {formatMoney(line.product.price)}
                    {line.product.unit ? ` · ${line.product.unit}` : ''}
                  </p>
                  {lineTotals.has(line.product.id) && (
                    <p className="num mt-0.5 text-[13px] font-semibold">
                      {formatMoney(lineTotals.get(line.product.id)!)}
                    </p>
                  )}
                  {unavailable && (
                    <p className="mt-1 text-xs font-medium text-destructive">
                      {quote?.unavailable.find((item) => item.product_id === line.product.id)
                        ?.reason ?? 'No longer available'}
                    </p>
                  )}
                </div>

                <div className="flex h-9 shrink-0 items-center justify-between rounded-full bg-primary px-1.5 text-primary-foreground">
                  <button
                    type="button"
                    aria-label={`Decrease quantity of ${line.product.name}`}
                    onClick={() => setQuantity(line.product, line.quantity - 1)}
                    className="grid size-8 place-items-center rounded-full transition-colors hover:bg-primary-foreground/12 active:scale-90"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <span key={line.quantity} className="animate-pop num w-7 text-center text-sm font-semibold">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase quantity of ${line.product.name}`}
                    onClick={() => addOne(line.product)}
                    className="grid size-8 place-items-center rounded-full transition-colors hover:bg-primary-foreground/12 active:scale-90"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                </div>

                <button
                  type="button"
                  aria-label={`Remove ${line.product.name}`}
                  onClick={() => removeLine(line.product.id)}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-6 rounded-4xl border border-border/70 p-6">
            <div>
              <h2 className="text-lg font-semibold">Delivery speed</h2>
              <div className="mt-4">
                <DeliveryTierPicker
                  config={config}
                  quote={quote}
                  selected={deliveryType}
                  onSelect={setDeliveryType}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="border-t pt-6">
              <h2 className="mb-4 text-lg font-semibold">Bill</h2>
              <BillLines quote={quote} />
              {isLoading && (
                <p className="animate-pulse-soft mt-3 text-xs text-muted-foreground">
                  Pricing your basket…
                </p>
              )}
              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            </div>

            <FreeDeliveryNudge quote={quote} />
            <MinimumOrderNotice quote={quote} config={config} />

            {storeClosed && (
              <div
                role="status"
                className="mt-4 rounded-2xl bg-amber-soft px-4 py-3 text-sm text-amber"
              >
                <p className="font-semibold">The store is closed</p>
                {/* The server's own sentence — the same one checkout would
                    refuse with. Two implementations of "are we open?" is how a
                    shop shows one message and enforces another. */}
                <p className="mt-1">{config?.closed_reason}</p>
                <p className="mt-1 text-xs">
                  Your basket is saved and will still be here when we open.
                </p>
              </div>
            )}

            <Link
              href={`/checkout?tier=${deliveryType}`}
              aria-disabled={!canCheckout}
              onClick={(event) => {
                if (!canCheckout) event.preventDefault();
              }}
              className={cn(
                'hidden h-13 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] lg:flex',
                canCheckout
                  ? 'hover:-translate-y-0.5 hover:shadow-lift'
                  : 'pointer-events-none opacity-50',
              )}
            >
              {storeClosed ? 'Store closed' : 'Checkout'}
              {!storeClosed && <ArrowRight className="size-4" aria-hidden />}
            </Link>
          </div>
        </aside>
      </div>

      {/* Sticky checkout — mobile. Sits above the tab bar, not over it. */}
      <div className="fixed inset-x-0 bottom-[68px] z-30 border-t border-border/70 bg-background/92 px-5 py-3 backdrop-blur-xl lg:hidden">
        <Link
          href={`/checkout?tier=${deliveryType}`}
          aria-disabled={!canCheckout}
          onClick={(event) => {
            if (!canCheckout) event.preventDefault();
          }}
          className={cn(
            'flex h-13 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground transition-transform duration-300 ease-[var(--ease-apple)] active:scale-[0.99]',
            !canCheckout && 'pointer-events-none opacity-50',
          )}
        >
          {storeClosed ? 'Store closed' : 'Checkout'}
          {!storeClosed && quote && (
            <span className="num">· {formatMoney(quote.grand_total)}</span>
          )}
        </Link>
      </div>
    </div>
  );
}

function CartSkeleton() {
  return (
    <div className="container-page py-8 lg:py-12">
      <Skeleton className="h-12 w-56 rounded-2xl" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-3xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-4xl" />
      </div>
    </div>
  );
}

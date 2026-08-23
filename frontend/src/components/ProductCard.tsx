'use client';

/* eslint-disable @next/next/no-img-element -- Product and category images are
   served by the Django backend, and its hostname is only known at runtime from
   NEXT_PUBLIC_API_URL. next/image needs `remotePatterns` configured at build
   time, which would mean baking the API host into the bundle — the one thing
   `lib/api.ts` exists to avoid. Plain <img> it is. */

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Minus, Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { assetUrl } from '@/lib/api';
import { addOne, getServerSnapshot, getSnapshot, setQuantity, subscribe } from '@/lib/cart-store';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { StoreProduct } from '@/types';

/**
 * The product tile and its add control, used on every catalogue surface.
 *
 * Prices here are **display only**. They are the numbers the server sent with
 * the catalogue, rendered as-is; nothing on this page multiplies a price by a
 * quantity or adds two of them together. The bill comes from
 * `/api/store/quote`, and the two would drift the first time a fee changed.
 */

function useCartQuantity(productId: number): number {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return snapshot.lines.find((line) => line.product.id === productId)?.quantity ?? 0;
}

export function AddControl({
  product,
  size = 'sm',
}: {
  product: StoreProduct;
  size?: 'sm' | 'lg';
}) {
  const quantity = useCartQuantity(product.id);
  const big = size === 'lg';

  /**
   * The announcement, and why it lives out here.
   *
   * The live region used to be the `<span>` showing the number, inside the
   * stepper — which only renders once the quantity is non-zero. A region
   * inserted into the DOM at the same moment its content first changes is not
   * announced by most screen readers: they watch regions that were already
   * there. So the first "Add", the one interaction that matters most, said
   * nothing, and only the second tap onward was read out.
   *
   * Rendering it unconditionally next to all three branches below fixes that.
   * It is visually hidden, so the sighted layout is unchanged.
   */
  const announcement =
    quantity === 0 ? '' : `${product.name}, ${quantity} in basket`;

  const liveRegion = (
    <span role="status" aria-live="polite" className="sr-only">
      {announcement}
    </span>
  );

  // Out of stock disables rather than fails on submit. Letting someone fill a
  // basket the server will reject at checkout wastes the one interaction that
  // actually matters.
  if (!product.in_stock) {
    return (
      <>
        {liveRegion}
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-secondary font-medium text-muted-foreground',
            big ? 'h-13 px-8 text-base' : 'h-9 px-4 text-xs',
          )}
        >
          Out of stock
        </span>
      </>
    );
  }

  if (quantity === 0) {
    return (
      <>
        {liveRegion}
        <button
        type="button"
        aria-label={`Add ${product.name} to cart`}
        onClick={(event) => {
          // These tiles sit inside a <Link>; without this the tap navigates to
          // the product page instead of adding to the basket.
          event.preventDefault();
          event.stopPropagation();
          addOne(product);
          toast.success(`${product.name} added`);
        }}
        className={cn(
          'animate-pop rounded-full bg-primary font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift active:scale-95',
          big ? 'h-13 px-8 text-base' : 'h-9 px-5 text-sm',
        )}
      >
        Add
        </button>
      </>
    );
  }

  return (
    <>
      {liveRegion}
      <div
      className={cn(
        'animate-pop flex items-center justify-between rounded-full bg-primary text-primary-foreground',
        big ? 'h-13 w-40 px-2' : 'h-9 w-24 px-1.5',
      )}
    >
      <button
        type="button"
        aria-label={`Decrease quantity of ${product.name}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setQuantity(product, quantity - 1);
        }}
        className="grid size-8 place-items-center rounded-full transition-colors hover:bg-primary-foreground/12 active:scale-90"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span key={quantity} className="animate-pop num text-sm font-semibold" aria-hidden>
        {quantity}
      </span>
      <button
        type="button"
        aria-label={`Increase quantity of ${product.name}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          addOne(product);
        }}
        className="grid size-8 place-items-center rounded-full transition-colors hover:bg-primary-foreground/12 active:scale-90"
      >
        <Plus className="size-4" aria-hidden />
      </button>
      </div>
    </>
  );
}

/**
 * The delivery promise, as a chip.
 *
 * One number, from `/api/store/config`, passed down rather than looked up here
 * — a component that fetched its own promise would fire a request per tile.
 */
export function EtaChip({ minutes, subtle }: { minutes: number | null; subtle?: boolean }) {
  if (minutes === null) return null;
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium',
        subtle ? 'bg-secondary text-muted-foreground' : 'bg-amber-soft text-amber-foreground',
      )}
    >
      <Zap className="size-3 text-amber" aria-hidden />
      {minutes} min
    </span>
  );
}

/**
 * The stand-in for a product or category with no photo uploaded yet.
 *
 * Nothing in a fresh database has an image — `manage.py seed` sets no
 * `image_url` on any of the 33 products or 8 categories — so this is not a rare
 * edge case, it is what the entire storefront looks like until someone starts
 * uploading. A single letter in a box was legible but read as a missing asset;
 * the placeholder illustration reads as a product tile with no photo yet, which
 * is what it is.
 *
 * `name` is still taken and still unused for display. It stays in the signature
 * because it is the natural thing to key a per-item image off later, and
 * because every call site already passes it.
 *
 * The whole element is `aria-hidden` with an empty `alt`: at all nine call
 * sites the name is rendered as text immediately beside this, and announcing a
 * decorative placeholder would say the product's name twice.
 */
export function ImageFallback({ className }: { name: string; className?: string }) {
  return (
    <span
      className={cn('grid place-items-center bg-amber-soft', className)}
      aria-hidden
    >
      {/* Sized as a fraction of the box rather than fixed: this renders at
          everything from a 44px cart thumbnail to a full-width category
          banner, and `object-contain` keeps the illustration from stretching
          in the 16/10 and square boxes alike. The file is same-origin from
          `public/`, which `img-src 'self'` already covers. */}
      <img
        src="/product-placeholder.svg"
        alt=""
        loading="lazy"
        className="size-[58%] max-h-full max-w-full object-contain opacity-90"
      />
    </span>
  );
}

export function ProductCard({
  product,
  promiseMinutes = null,
}: {
  product: StoreProduct;
  promiseMinutes?: number | null;
}) {
  const image = assetUrl(product.image_url);

  return (
    <Link
      href={`/product/${product.id}`}
      className={cn(
        'group flex h-full flex-col rounded-3xl border border-border/70 bg-card p-3 transition-all duration-400 ease-[var(--ease-apple)] hover:-translate-y-1 hover:border-transparent hover:shadow-lift',
        !product.in_stock && 'opacity-70',
      )}
    >
      <div className="relative overflow-hidden rounded-2xl bg-surface">
        {image ? (
          <img
            src={image}
            alt={product.name}
            loading="lazy"
            width={800}
            height={800}
            className="aspect-square w-full object-cover transition-transform duration-700 ease-[var(--ease-apple)] group-hover:scale-105"
          />
        ) : (
          <ImageFallback name={product.name} className="aspect-square w-full" />
        )}

        {product.discount_percent > 0 && (
          <span className="num absolute left-2 top-2 rounded-full bg-amber px-2 py-0.5 text-[11px] font-semibold text-amber-foreground">
            {product.discount_percent}% off
          </span>
        )}
        {product.in_stock && product.low_stock && (
          <span className="absolute right-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm">
            Low stock
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-1 pt-3">
        <EtaChip minutes={promiseMinutes} subtle />
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug">{product.name}</h3>
        {product.unit && <p className="text-xs text-muted-foreground">{product.unit}</p>}

        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <div>
            <div className="num text-base font-semibold">{formatMoney(product.price)}</div>
            {product.mrp > product.price && (
              <div className="num text-xs text-muted-foreground line-through">
                {formatMoney(product.mrp)}
              </div>
            )}
          </div>
          <AddControl product={product} />
        </div>
      </div>
    </Link>
  );
}

/** A horizontal rail of tiles on mobile, a grid on desktop. */
export function ProductRail({
  title,
  subtitle,
  items,
  href,
  accent,
  promiseMinutes = null,
}: {
  title: string;
  subtitle?: string;
  items: StoreProduct[];
  href?: string;
  accent?: boolean;
  promiseMinutes?: number | null;
}) {
  if (items.length === 0) return null;

  return (
    <section className="py-8">
      <div className="container-page">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
              {accent && <Zap className="size-5 text-amber" aria-hidden />}
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {href && (
            <Link
              href={href}
              className="shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
            </Link>
          )}
        </div>

        <div className="no-scrollbar -mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
          {items.slice(0, 10).map((product) => (
            <div key={product.id} className="w-[170px] shrink-0 snap-start sm:w-[200px] lg:w-auto">
              <ProductCard product={product} promiseMinutes={promiseMinutes} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

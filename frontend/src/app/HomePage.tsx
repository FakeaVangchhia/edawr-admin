'use client';

/* eslint-disable @next/next/no-img-element -- Product and category images are
   served by the Django backend, and its hostname is only known at runtime from
   NEXT_PUBLIC_API_URL. next/image needs `remotePatterns` configured at build
   time, which would mean baking the API host into the bundle — the one thing
   `lib/api.ts` exists to avoid. Plain <img> it is. */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Flame, PackageCheck, ShieldCheck, Zap } from 'lucide-react';
import { assetUrl } from '@/lib/api';
import { buildHomeRows, slugify, type ProductRow } from '@/lib/catalogue';
import { formatMoney } from '@/lib/format';
import { fetchCategories, fetchProducts } from '@/lib/store-api';
import { AddControl, EtaChip, ImageFallback, ProductRail } from '@/components/ProductCard';
import { ProductGrid } from '@/components/ProductGrid';
import { Skeleton } from '@/components/ui/skeleton';
import { selectedAddress } from '@/lib/addresses';
import { useAddressBook, useStoreConfig } from '@/hooks/useStoreData';
import type { StoreCategory, StoreProduct } from '@/types';

/**
 * The storefront home.
 *
 * The prototype this design came from drove its six rows off hardcoded tags —
 * "Trending Near You", "Picked for You". `Product` has no tag field and this
 * system has no personalisation, so those rows would have been decoration
 * dressed as data. `buildHomeRows` derives every row from something the API
 * actually says instead; see `lib/catalogue.ts`.
 *
 * The stat strip is the same principle. It shows the store's real promise and
 * its real catalogue size, and nothing else — the prototype's "4.9 customer
 * rating" had no rating system behind it.
 */

/** One page of the catalogue is plenty to build every row from. */
const HOME_PRODUCT_LIMIT = 120;

/**
 * How many products the home grid shows before "View all".
 *
 * Twenty is four full rows at the grid's widest breakpoint (five columns) and
 * ten at its narrowest (two) — enough that the page is visibly a shop rather
 * than a sample, without turning the home page into /products, which exists and
 * pages properly.
 */
const SHELF_SIZE = 20;

/**
 * How many products the hero features.
 *
 * Two, and the number is doing work. One is a promotion and reads as an advert;
 * four is a product row, which the page already has three of further down. Two
 * side by side stay large enough to be photographs of food rather than
 * thumbnails, at every width from a phone upward.
 */
const FEATURED_COUNT = 2;

interface Loaded {
  categories: StoreCategory[];
  rows: ProductRow[];
  /** In-stock products, in the order the API returned them — the shop grid. */
  shelf: StoreProduct[];
  /** The two most-ordered items, for the hero cards. */
  featured: StoreProduct[];
  productCount: number;
}

export function HomePage() {
  const config = useStoreConfig();
  const book = useAddressBook();
  const address = selectedAddress(book);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetchCategories(controller.signal),
      fetchProducts({ limit: HOME_PRODUCT_LIMIT }, controller.signal),
      // A separate request rather than a client-side sort of the list above,
      // because the ranking is not derivable from a product: it is units sold
      // over the last thirty days, which only the server can count.
      fetchProducts({ sort: 'popular', limit: FEATURED_COUNT }, controller.signal),
    ])
      .then(([categories, products, popular]) => {
        setData({
          categories,
          rows: buildHomeRows(products, categories),
          // Out-of-stock rows are filtered here rather than hidden with CSS so
          // the grid below never renders a short row of tiles nobody can buy.
          shelf: products.filter((product) => product.in_stock),
          featured: popular.filter((product) => product.in_stock).slice(0, FEATURED_COUNT),
          productCount: products.length,
        });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'Could not load the store.');
      });

    return () => controller.abort();
  }, []);

  const city = address?.city || config?.store_city || 'Aizawl';
  const promise = config?.promise_minutes ?? null;

  return (
    <>
      {/*
        A band, not a landing page.

        This used to be a two-column hero at `lg:py-24` with a 68px headline, a
        three-stat strip and a 2x2 grid of category tiles — most of a laptop
        viewport, and every pixel of it above the first product. For a shop
        whose whole promise is speed, the slowest thing on the page was reaching
        something you could buy.

        What went, and why:
        - The category tiles. They repeated "Shop by aisle", which sits directly
          below with every aisle rather than four of them.
        - The stat strip's own row. The same three facts are now inline in the
          line under the headline, where they read as a sentence instead of
          occupying a bordered block.
        - Two thirds of the type scale and most of the padding.

        What stayed: the promise, the city, and one primary action. That is what
        a returning customer needs; the rest was for a first visit that only
        happens once.
      */}
      <section className="border-b border-border/70">
        <div className="container-page flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-6 lg:py-8">
          <div className="animate-rise">
            <h1 className="text-[26px] font-semibold leading-[1.1] sm:text-[32px]">
              Everything you need,{' '}
              <span className="text-muted-foreground">
                {promise ? `in ${promise} minutes.` : 'in minutes.'}
              </span>
            </h1>

            {/* The three facts from the old stat block, as one line. */}
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Zap className="size-3.5 text-amber" aria-hidden />
                {address ? `Deliver to ${address.label} · ${city}` : `Delivering across ${city}`}
              </span>
              {config && (
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-amber" aria-hidden />
                  Free over {formatMoney(config.free_delivery_above)}
                </span>
              )}
              {data && (
                <span className="inline-flex items-center gap-1.5">
                  <PackageCheck className="size-3.5 text-amber" aria-hidden />
                  {data.categories.length} aisles
                </span>
              )}
            </p>
          </div>

          <Link
            href="/products"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
          >
            Shop all
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        {/*
          The two most-ordered items, and "most ordered" is literal.

          `?sort=popular` ranks by units actually sold over the last thirty
          days, counting only orders that became sales — a run of cancellations
          or refused deliveries cannot promote a product. The alternative was to
          label the two cheapest items "most ordered", which is the mistake this
          file's own docstring warns about: the prototype's "Trending Near You"
          row with no trend data behind it.

          No sales figure is shown, because none is sent. The server ranks and
          returns the order; how many units the shop moves in a month is the
          store's business, exactly as cost price and exact stock are.

          The space is reserved while loading rather than left empty. Rendering
          nothing until the fetch lands means the hero grows and shoves the rest
          of the page down — layout shift in the most prominent place there is,
          and a customer who taps where a card is about to appear hits whatever
          arrives instead. The grid further down already reserves its space the
          same way, so the page settles once rather than twice.

          Nothing is rendered at all if the shop turns out to have no sellable
          products: an empty band beats two placeholder cards for items that do
          not exist.
        */}
        {(data === null || data.featured.length > 0) && (
          <div className="container-page pb-6 lg:pb-8">
            <div className="grid gap-4 sm:grid-cols-2">
              {data
                ? data.featured.map((product, index) => (
                    <FeaturedCard
                      key={product.id}
                      product={product}
                      promiseMinutes={promise}
                      rank={index + 1}
                    />
                  ))
                : Array.from({ length: FEATURED_COUNT }, (_, index) => (
                    <Skeleton key={index} className="aspect-[16/10] rounded-4xl" />
                  ))}
            </div>
          </div>
        )}
      </section>

      <section className="border-b border-border/70 py-10">
        <div className="container-page">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="text-2xl font-semibold sm:text-[28px]">Shop by aisle</h2>
            <Link
              href="/categories"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
            </Link>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="no-scrollbar -mx-5 flex gap-4 overflow-x-auto px-5 lg:mx-0 lg:grid lg:grid-cols-8 lg:px-0">
            {data
              ? data.categories.map((category) => (
                  <Link
                    key={category.name}
                    href={`/category/${slugify(category.name)}`}
                    className="group w-28 shrink-0 text-center lg:w-auto"
                  >
                    <div className="overflow-hidden rounded-3xl border border-border/70 bg-surface transition-all duration-400 ease-[var(--ease-apple)] group-hover:-translate-y-1 group-hover:shadow-card">
                      <CategoryImage category={category} />
                    </div>
                    <p className="mt-2.5 text-[13px] font-medium">{category.name}</p>
                  </Link>
                ))
              : Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="w-28 shrink-0 lg:w-auto">
                    <Skeleton className="aspect-square rounded-3xl" />
                  </div>
                ))}
          </div>
        </div>
      </section>

      {/*
        The shop itself, and the reason the hero above is a band.

        The home page used to reach its first product only after a full-height
        hero and an aisle strip, and then only as horizontal rails — where
        anything past the fourth tile is off-screen and has to be discovered by
        swiping. A grid puts real stock in front of a customer immediately and
        shows twenty of them at once.

        The rails below still earn their place: they are *cuts* of the same
        catalogue — cheapest, best discount, per aisle — which is a different
        question from "what is in the shop". This answers that one.

        `ProductGrid` rather than a bespoke layout, so the column counts match
        /products, /category and /search exactly. A customer who scrolls from
        here to the full catalogue should not notice the boundary.
      */}
      <section className="py-10">
        <div className="container-page">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold sm:text-[28px]">In the shop now</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {data
                  ? `${data.shelf.length} of ${data.productCount} items in stock today`
                  : 'Loading the shelves…'}
              </p>
            </div>
            <Link
              href="/products"
              className="shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
            </Link>
          </div>

          <ProductGrid
            products={data ? data.shelf.slice(0, SHELF_SIZE) : []}
            isLoading={data === null}
            promiseMinutes={promise}
            emptyTitle="The shelves are empty right now"
            emptyBody="Everything is out of stock at the moment. Please check back shortly."
          />
        </div>
      </section>

      {data?.rows.map((row) => (
        <ProductRail
          key={row.key}
          title={row.title}
          subtitle={row.subtitle}
          items={row.items}
          href={row.href}
          accent={row.accent}
          promiseMinutes={promise}
        />
      ))}

      {config && (
        <section className="py-12">
          <div className="container-page">
            <div className="flex flex-col items-start justify-between gap-6 rounded-4xl bg-primary p-10 text-primary-foreground sm:flex-row sm:items-center lg:p-14">
              <div>
                <h2 className="text-3xl font-semibold lg:text-4xl">
                  Free delivery over {formatMoney(config.free_delivery_above)}.
                </h2>
                <p className="mt-3 max-w-lg text-primary-foreground/70">
                  Applied automatically at checkout — no code to remember. Live tracking on every
                  order.
                </p>
              </div>
              <Link
                href="/products"
                className="inline-flex h-13 shrink-0 items-center gap-2 rounded-full bg-amber px-8 text-base font-semibold text-amber-foreground transition-transform duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5"
              >
                Start shopping
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

/**
 * One hero card: a big picture, the price, and the add control.
 *
 * Wider and taller than a `ProductCard` on purpose — this is the one place on
 * the page where a product is the headline rather than a tile in a grid, so the
 * image gets a 16:10 crop instead of a square and the name gets room to be read
 * rather than truncated.
 *
 * The whole card is a link to the product, except the add control, which stops
 * the click from propagating. That is the same arrangement `ProductCard` uses
 * and for the same reason: tapping the picture should open the product, and
 * tapping Add should add it.
 */
function FeaturedCard({
  product,
  promiseMinutes,
  rank,
}: {
  product: StoreProduct;
  promiseMinutes: number | null;
  rank: number;
}) {
  const image = assetUrl(product.image_url);

  return (
    <Link
      href={`/product/${product.id}`}
      className="group relative flex flex-col overflow-hidden rounded-4xl border border-border/70 bg-surface transition-all duration-400 ease-[var(--ease-apple)] hover:-translate-y-1 hover:shadow-card"
    >
      <div className="relative">
        {image ? (
          <img
            src={image}
            alt=""
            loading={rank === 1 ? 'eager' : 'lazy'}
            width={1200}
            height={750}
            className="aspect-[16/10] w-full object-cover"
          />
        ) : (
          <ImageFallback name={product.name} className="aspect-[16/10] w-full text-3xl" />
        )}

        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-background/92 px-3 py-1.5 text-[11px] font-semibold shadow-lift backdrop-blur-xl">
          <Flame className="size-3.5 text-amber" aria-hidden />
          Most ordered
        </span>
      </div>

      <div className="flex flex-1 items-end justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold sm:text-base">{product.name}</p>
          <p className="num mt-1 flex items-baseline gap-2">
            <span className="text-xl font-semibold sm:text-2xl">
              {formatMoney(product.price)}
            </span>
            {product.unit && (
              <span className="text-xs text-muted-foreground">{product.unit}</span>
            )}
          </p>
          {promiseMinutes !== null && (
            <span className="mt-2 inline-block">
              <EtaChip minutes={promiseMinutes} subtle />
            </span>
          )}
        </div>

        {/* Stops the card's own navigation, so Add adds rather than opens. */}
        <span
          className="shrink-0"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <AddControl product={product} size="lg" />
        </span>
      </div>
    </Link>
  );
}


function CategoryImage({ category }: { category: StoreCategory }) {
  const image = assetUrl(category.image_url);
  if (!image) return <ImageFallback name={category.name} className="aspect-square w-full" />;
  return (
    <img
      src={image}
      alt=""
      loading="lazy"
      width={800}
      height={800}
      className="aspect-square w-full object-cover"
    />
  );
}

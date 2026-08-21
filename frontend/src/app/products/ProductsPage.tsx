'use client';

import { useEffect, useState } from 'react';
import { SORT_LABELS, sortProducts, type SortKey } from '@/lib/catalogue';
import { fetchCategories, fetchProducts } from '@/lib/store-api';
import { ProductGrid } from '@/components/ProductGrid';
import { usePromiseMinutes } from '@/hooks/useStoreData';
import { cn } from '@/lib/utils';
import type { StoreCategory, StoreProduct } from '@/types';

/**
 * The whole catalogue, filterable by aisle.
 *
 * The aisle filter is a **server** filter — it re-fetches with `?category=`
 * rather than filtering an array that was already downloaded. The sort is
 * client-side, because it only reorders the page that came back; it never
 * changes which products are in it.
 *
 * Fetched data is tagged with the aisle that produced it, so a slow response
 * for one aisle cannot land after a fast one for another and show the wrong
 * products under the right heading. The loading flag is derived from that tag
 * rather than stored, which keeps every `setState` off the synchronous path of
 * an effect.
 */

const PAGE_SIZE = 60;
const ALL = 'All';

/**
 * The loaded grid, tagged with the exact request that produced it.
 *
 * `key` is `aisle|page` rather than just the aisle, because paging adds a
 * second axis a response can be stale on: switching aisle while a "load more"
 * is in flight would otherwise append page 2 of Dairy under the Snacks heading.
 *
 * `exhausted` is what makes the count honest. A short page is the only
 * end-of-list signal the endpoint gives, so until one arrives the page knows it
 * has *at least* this many items and must not claim it has all of them.
 */
interface Loaded {
  key: string;
  aisle: string;
  products: StoreProduct[];
  error: string;
  exhausted: boolean;
}

const keyFor = (aisle: string, page: number) => `${aisle}|${page}`;

export function ProductsPage({ initialCategory }: { initialCategory?: string }) {
  const [aisle, setAisle] = useState(initialCategory ?? ALL);
  const [sort, setSort] = useState<SortKey>('recommended');
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Bumped from the "Load more" handler, never from inside an effect.
  const [page, setPage] = useState(0);
  const promiseMinutes = usePromiseMinutes();

  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch(() => {
        /* The filter chips are a convenience; the grid still loads. */
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const key = keyFor(aisle, page);

    fetchProducts(
      { category: aisle, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      controller.signal,
    )
      .then((batch) => {
        if (controller.signal.aborted) return;
        setLoaded((previous) => {
          // Page 0 replaces; a later page appends, but only onto the page
          // immediately before it in the same aisle. Anything else is a
          // response that outlived the state it belonged to.
          const carry =
            page > 0 && previous?.key === keyFor(aisle, page - 1) ? previous.products : [];
          return {
            key,
            aisle,
            products: [...carry, ...batch],
            error: '',
            // A short page is the end of the list. Asking for 60 and getting 60
            // means there may be more; it never means there are not.
            exhausted: batch.length < PAGE_SIZE,
          };
        });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          key,
          aisle,
          products: [],
          error: caught instanceof Error ? caught.message : 'Could not load the catalogue.',
          exhausted: true,
        });
      });

    return () => controller.abort();
  }, [aisle, page]);

  const current = loaded?.key === keyFor(aisle, page) ? loaded : null;

  // While a *later* page is in flight, keep showing what is already on screen.
  //
  // `current` is null for the whole round trip after "Load more" bumps `page`,
  // and treating that as `isLoading` made the grid swap sixty rendered products
  // for a skeleton and then show a hundred and twenty at once — the button
  // vanishing along with them. A first load has nothing to hold on to and
  // should still show the skeleton; a subsequent page has everything.
  const carried = loaded?.aisle === aisle ? loaded : null;
  const shown = current ?? (page > 0 ? carried : null);

  const isLoading = shown === null;
  const isLoadingMore = current === null && shown !== null;
  const products = shown ? sortProducts(shown.products, sort) : [];
  const hasMore = Boolean(shown && !shown.exhausted);

  const changeAisle = (next: string) => {
    setAisle(next);
    // Back to the top of the new aisle. Without this, switching filters while
    // on page 3 asks for offset 180 of a category that may have twelve rows and
    // renders an empty grid.
    setPage(0);
  };

  return (
    <div className="container-page py-10 lg:py-16">
      <h1 className="text-3xl font-semibold lg:text-5xl">Shop everything</h1>
      <p className="mt-3 text-muted-foreground">
        The full catalogue, filterable by aisle. Everything arrives on the same promise.
      </p>

      <div className="no-scrollbar -mx-5 mt-8 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0">
        <FilterChip label="All" active={aisle === ALL} onClick={() => changeAisle(ALL)} />
        {categories.map((category) => (
          <FilterChip
            key={category.name}
            label={category.name}
            count={category.product_count}
            active={aisle === category.name}
            onClick={() => changeAisle(category.name)}
          />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="num text-sm text-muted-foreground">
          {isLoading
            ? 'Loading…'
            : `${hasMore ? `${products.length}+` : products.length} ${
                products.length === 1 ? 'item' : 'items'
              }`}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="h-10 rounded-full border border-border bg-surface px-4 text-sm outline-none transition-colors focus:border-primary/25"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {current?.error && <p className="mt-6 text-sm text-destructive">{current.error}</p>}

      <div className="mt-6">
        <ProductGrid
          products={products}
          isLoading={isLoading}
          promiseMinutes={promiseMinutes}
          emptyTitle="This aisle is empty"
          emptyBody="Nothing is in stock here right now. Try another aisle."
        />
      </div>

      {hasMore && (
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={() => setPage((currentPage) => currentPage + 1)}
            className="inline-flex h-12 items-center rounded-full border border-border px-7 text-sm font-semibold transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60"
          >
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ease-[var(--ease-apple)]',
        active
          ? 'bg-primary text-primary-foreground'
          : 'border border-border bg-surface hover:bg-secondary',
      )}
    >
      {label}
      {count !== undefined && <span className="num ml-1.5 text-xs opacity-60">{count}</span>}
    </button>
  );
}

'use client';

/* eslint-disable @next/next/no-img-element -- Product and category images are
   served by the Django backend, and its hostname is only known at runtime from
   NEXT_PUBLIC_API_URL. next/image needs `remotePatterns` configured at build
   time, which would mean baking the API host into the bundle — the one thing
   `lib/api.ts` exists to avoid. Plain <img> it is. */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Clock, Search, TrendingUp } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { assetUrl } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { slugify } from '@/lib/catalogue';
import { formatMoney } from '@/lib/format';
import { rememberSearch } from '@/lib/recent-searches';
import { fetchCategories, fetchProducts } from '@/lib/store-api';
import { useRecentSearches } from '@/hooks/useStoreData';
import { AddControl, ImageFallback } from '@/components/ProductCard';
import type { StoreCategory, StoreProduct } from '@/types';

/**
 * The ⌘K search overlay.
 *
 * Results come from `/api/store/products?q=`, not from filtering an array in
 * the browser. Filtering client-side would mean shipping the whole catalogue on
 * first paint to make search work, which is fine for a demo and indefensible
 * for a real inventory.
 *
 * The result state is **tagged with the query that produced it**. Without that
 * tag, a slow response for "mi" can land after a fast one for "milk" and
 * silently replace the right results with stale ones. Tagging also means the
 * loading flag is derived rather than stored, so nothing sets state
 * synchronously inside an effect.
 */

const DEBOUNCE_MS = 250;

interface Results {
  query: string;
  products: StoreProduct[];
  error: string;
}

export function SearchOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const recent = useRecentSearches();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [categories, setCategories] = useState<StoreCategory[]>([]);

  const term = query.trim();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch(() => {
        /* The rail is a shortcut; search still works without it. */
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!term) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchProducts({ q: term, limit: 8 }, controller.signal)
        .then((products) => setResults({ query: term, products, error: '' }))
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setResults({
            query: term,
            products: [],
            error:
              caught instanceof ApiError || caught instanceof Error
                ? caught.message
                : 'Search is unavailable right now.',
          });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  // Derived, not stored: results are stale whenever they were produced by a
  // different query than the one currently typed.
  const isLoading = term.length > 0 && results?.query !== term;
  const shown = results?.query === term ? results : null;

  const go = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    rememberSearch(trimmed);
    onOpenChange(false);
    setQuery('');
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="top-[8%] max-w-2xl translate-y-0 gap-0 overflow-hidden rounded-3xl p-0">
        <DialogTitle className="sr-only">Search the store</DialogTitle>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            go(query);
          }}
          className="flex items-center gap-3 border-b border-border/70 px-5 py-4"
        >
          <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for groceries, snacks, household…"
            aria-label="Search products"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </form>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {!term && (
            <div className="space-y-5 p-2">
              {recent.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden />
                    Recent
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {recent.map((entry) => (
                      <button
                        key={entry}
                        type="button"
                        onClick={() => go(entry)}
                        className="rounded-full bg-secondary px-3.5 py-1.5 text-sm transition-colors hover:bg-accent"
                      >
                        {entry}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {categories.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <TrendingUp className="size-3.5" aria-hidden />
                    Browse aisles
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {categories.slice(0, 8).map((category) => (
                      <Link
                        key={category.name}
                        href={`/category/${slugify(category.name)}`}
                        onClick={() => onOpenChange(false)}
                        className="rounded-full bg-secondary px-3.5 py-1.5 text-sm transition-colors hover:bg-accent"
                      >
                        {category.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {isLoading && (
            <p className="animate-pulse-soft p-4 text-sm text-muted-foreground">Searching…</p>
          )}

          {shown?.error && <p className="p-4 text-sm text-destructive">{shown.error}</p>}

          {shown && !shown.error && shown.products.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              Nothing matches “{shown.query}”. Try a shorter word.
            </p>
          )}

          {shown?.products.map((product) => {
            const image = assetUrl(product.image_url);
            return (
              <div key={product.id} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-secondary">
                <Link
                  href={`/product/${product.id}`}
                  onClick={() => onOpenChange(false)}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
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
                    <ImageFallback name={product.name} className="size-11 shrink-0 rounded-xl" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{product.name}</span>
                    <span className="num block text-xs text-muted-foreground">
                      {formatMoney(product.price)}
                      {product.unit ? ` · ${product.unit}` : ''}
                    </span>
                  </span>
                </Link>
                <AddControl product={product} />
              </div>
            );
          })}

          {shown && shown.products.length > 0 && (
            <button
              type="button"
              onClick={() => go(term)}
              className="mt-1 w-full rounded-2xl px-4 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              See all results for “{term}”
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

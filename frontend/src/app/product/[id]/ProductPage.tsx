'use client';

/* eslint-disable @next/next/no-img-element -- Product and category images are
   served by the Django backend, and its hostname is only known at runtime from
   NEXT_PUBLIC_API_URL. next/image needs `remotePatterns` configured at build
   time, which would mean baking the API host into the bundle — the one thing
   `lib/api.ts` exists to avoid. Plain <img> it is. */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, PackageCheck, RotateCcw, ShieldCheck, Zap } from 'lucide-react';
import { ApiError, assetUrl } from '@/lib/api';
import { slugify } from '@/lib/catalogue';
import { formatMoney } from '@/lib/format';
import { fetchProduct, fetchProducts } from '@/lib/store-api';
import { AddControl, ImageFallback, ProductRail } from '@/components/ProductCard';
import { Skeleton } from '@/components/ui/skeleton';
import { usePromiseMinutes, useStoreConfig } from '@/hooks/useStoreData';
import type { StoreProduct } from '@/types';

/**
 * One product.
 *
 * The prototype's version of this page carried a star rating, a review count
 * and a bulleted "what's included" list. None of those exist in the API and
 * none of them were real, so they are gone rather than faked — `description`
 * and `unit` are what the store actually knows about a product, and the trust
 * signals below are statements about the store's own policy, not invented
 * social proof.
 */

interface Loaded {
  product: StoreProduct | null;
  related: StoreProduct[];
  /** Set when the product is unknown or withdrawn, as opposed to a failed request. */
  missing: boolean;
  error: string;
}

export function ProductPage({ id }: { id: number }) {
  const [state, setState] = useState<Loaded | null>(null);
  const config = useStoreConfig();
  const promiseMinutes = usePromiseMinutes();

  useEffect(() => {
    const controller = new AbortController();

    fetchProduct(id, controller.signal)
      .then(async (product) => {
        const related = product.category
          ? await fetchProducts({ category: product.category, limit: 12 }, controller.signal)
          : [];
        return {
          product,
          related: related.filter((item) => item.id !== product.id),
          missing: false,
          error: '',
        };
      })
      .then(setState)
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        // A 404 here means "no such product", which is a page state rather than
        // a failure — the request itself worked perfectly.
        if (caught instanceof ApiError && caught.status === 404) {
          setState({ product: null, related: [], missing: true, error: '' });
          return;
        }
        setState({
          product: null,
          related: [],
          missing: false,
          error: caught instanceof Error ? caught.message : 'Could not load this product.',
        });
      });

    return () => controller.abort();
  }, [id]);

  if (state === null) return <ProductSkeleton />;

  if (state.missing || (!state.product && !state.error)) {
    return (
      <div className="container-page py-20 text-center lg:py-28">
        <h1 className="text-2xl font-semibold">This product isn&apos;t available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It has sold out or been withdrawn from the catalogue.
        </p>
        <Link
          href="/products"
          className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
        >
          Shop everything
        </Link>
      </div>
    );
  }

  if (!state.product) {
    return (
      <div className="container-page py-20 text-center lg:py-28">
        <h1 className="text-2xl font-semibold">This page didn&apos;t load</h1>
        <p className="mt-2 text-sm text-destructive">{state.error}</p>
      </div>
    );
  }

  const { product, related } = state;
  const image = assetUrl(product.image_url);
  const saving = product.mrp > product.price ? product.mrp - product.price : 0;

  return (
    <>
      <div className="container-page py-8 lg:py-12">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          <Link href="/" className="transition-colors hover:text-foreground">
            Home
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          {product.category && (
            <>
              <Link
                href={`/category/${slugify(product.category)}`}
                className="transition-colors hover:text-foreground"
              >
                {product.category}
              </Link>
              <ChevronRight className="size-3.5" aria-hidden />
            </>
          )}
          <span className="truncate text-foreground">{product.name}</span>
        </nav>

        <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="relative overflow-hidden rounded-4xl bg-surface">
            {image ? (
              <img
                src={image}
                alt={product.name}
                width={1200}
                height={1200}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <ImageFallback name={product.name} className="aspect-square w-full" />
            )}
            {product.discount_percent > 0 && (
              <span className="num absolute left-4 top-4 rounded-full bg-amber px-3 py-1 text-sm font-semibold text-amber-foreground">
                {product.discount_percent}% off
              </span>
            )}
          </div>

          <div>
            {product.brand && (
              <p className="text-sm font-medium text-muted-foreground">{product.brand}</p>
            )}
            <h1 className="mt-1 text-3xl font-semibold lg:text-4xl">{product.name}</h1>
            {product.unit && <p className="mt-2 text-muted-foreground">{product.unit}</p>}

            <div className="mt-6 flex flex-wrap items-end gap-3">
              <span className="num text-4xl font-semibold">{formatMoney(product.price)}</span>
              {saving > 0 && (
                <>
                  <span className="num text-lg text-muted-foreground line-through">
                    {formatMoney(product.mrp)}
                  </span>
                  <span className="num rounded-full bg-amber-soft px-3 py-1 text-sm font-semibold text-amber-foreground">
                    Save {formatMoney(saving)}
                  </span>
                </>
              )}
            </div>

            {promiseMinutes !== null && (
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm text-muted-foreground">
                <Zap className="size-3.5 text-amber" aria-hidden />
                Arrives in about {promiseMinutes} minutes
              </p>
            )}

            {!product.in_stock && (
              <p className="mt-4 rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive">
                Out of stock. It will return once the shelf is restocked.
              </p>
            )}
            {product.in_stock && product.low_stock && (
              <p className="mt-4 rounded-2xl bg-amber-soft px-4 py-3 text-sm text-amber-foreground">
                Low stock — only a few left.
              </p>
            )}

            <div className="mt-8">
              <AddControl product={product} size="lg" />
            </div>

            {product.description && (
              <div className="mt-10 border-t pt-8">
                <h2 className="text-lg font-semibold">About this product</h2>
                <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground">
                  {product.description}
                </p>
              </div>
            )}

            <dl className="mt-10 grid gap-4 border-t pt-8 sm:grid-cols-3">
              <Assurance
                icon={<Zap className="size-4 text-amber" aria-hidden />}
                title={promiseMinutes ? `${promiseMinutes}-minute promise` : 'Quick delivery'}
                body="Tracked live from the moment you confirm."
              />
              <Assurance
                icon={<PackageCheck className="size-4 text-amber" aria-hidden />}
                title={
                  config ? `Free over ${formatMoney(config.free_delivery_above)}` : 'Free delivery'
                }
                body="Applied automatically at checkout."
              />
              <Assurance
                icon={<RotateCcw className="size-4 text-amber" aria-hidden />}
                title="Cancel while packing"
                body="Free until a rider collects it."
              />
            </dl>

            <p className="mt-8 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
              Every price is confirmed by the store when you check out, so what you see in the
              basket is what you pay.
            </p>
          </div>
        </div>
      </div>

      {product.category && (
        <ProductRail
          title={`More from ${product.category}`}
          items={related}
          href={`/category/${slugify(product.category)}`}
          promiseMinutes={promiseMinutes}
        />
      )}
    </>
  );
}

function Assurance({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {title}
      </dt>
      <dd className="mt-1 text-xs text-muted-foreground">{body}</dd>
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="container-page py-8 lg:py-12">
      <Skeleton className="h-5 w-64 rounded-full" />
      <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <Skeleton className="aspect-square rounded-4xl" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-3/4 rounded-2xl" />
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-12 w-48 rounded-2xl" />
          <Skeleton className="h-13 w-40 rounded-full" />
          <Skeleton className="h-32 rounded-3xl" />
        </div>
      </div>
    </div>
  );
}

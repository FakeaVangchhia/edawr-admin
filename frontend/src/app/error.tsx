'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reportClientError } from '@/lib/report-error';

/**
 * The route error boundary.
 *
 * It reports to `POST /api/client-errors`, which is same-origin and already
 * allowed by `connect-src` — the reason this used to report to the console and
 * nowhere else was that no such endpoint existed and the CSP would have blocked
 * a third-party collector. See `api/views/reports.py`.
 *
 * The console call stays alongside it: in development nobody is reading the
 * Django log while clicking around the storefront.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportClientError({
      client: 'storefront',
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-16 text-center">
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">This page didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. Your basket is safe — try again, or head back home.
        </p>
        {error.digest && (
          <p className="num mt-3 text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-12 items-center rounded-full border border-border px-7 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

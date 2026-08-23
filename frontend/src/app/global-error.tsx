'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-error';

/**
 * The last boundary: an error thrown by the root layout itself.
 *
 * `error.tsx` is nested *inside* the root layout, so it cannot catch a failure
 * in the thing rendering it. Without this file that case falls through to
 * Next.js's built-in screen — unstyled, in English regardless of anything, and
 * saying "Application error: a client-side exception has occurred", which tells
 * a customer nothing and tells the store even less.
 *
 * **It replaces `<html>` and `<body>`**, which no other component here does.
 * That is a requirement of the slot, not a stylistic choice: the layout that
 * would normally provide them is the thing that failed.
 *
 * Everything here is deliberately self-contained — inline styles, no fonts, no
 * imports beyond the reporter. A global error means something fundamental did
 * not load, and a fallback that depends on the stylesheet, the font or a
 * component library is a fallback that fails in exactly the situation it exists
 * for. The inline styles are also why this page is unaffected by the CSP's
 * `style-src`: attribute styles are not inline `<style>` blocks.
 */
export default function GlobalError({
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
      // Distinguished from a route-level crash in the log, because the two mean
      // very different things: one screen is broken versus the whole app is.
      message: `[global] ${error.message}`,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: '#ffffff',
          color: '#111111',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
            eDawr didn&apos;t load
          </h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6 }}>
            Something went wrong before the page could start. Your basket is saved on
            this device — reloading usually fixes it.
          </p>
          {error.digest && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', opacity: 0.65 }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '2rem',
              height: '3rem',
              padding: '0 1.75rem',
              borderRadius: '9999px',
              border: 'none',
              background: '#111111',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}

'use client';

import { useEffect } from 'react';

import { reportConsoleError } from '@/lib/report-error';

/**
 * The last boundary: an error thrown by the root layout itself.
 *
 * `error.tsx` renders *inside* the root layout, so it cannot catch a failure in
 * the thing rendering it — a broken font import, a theme bootstrap that throws,
 * anything in `layout.tsx`. Without this file that case reaches Next's built-in
 * screen and the console looks dead.
 *
 * **It replaces `<html>` and `<body>`**, which nothing else here does. That is
 * a requirement of the slot rather than a choice: the layout that would supply
 * them is what failed.
 *
 * Everything is inline and self-contained — no fonts, no stylesheet, no
 * component kit. A global error means something fundamental did not load, and a
 * fallback that depends on `globals.css` is a fallback that fails in exactly
 * the case it exists for. Inline *attribute* styles are also unaffected by the
 * CSP's `style-src`, which governs inline `<style>` blocks.
 */
export default function ConsoleGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportConsoleError({
      // Marked, because "one screen is broken" and "the whole console is
      // broken" call for very different responses from whoever reads the log.
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
          background: '#f5f6fa',
          color: '#0e1424',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
            The console didn&apos;t start
          </h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6 }}>
            Something failed before any screen could render. Nothing has been lost —
            the console stores nothing of its own. Reloading usually fixes it; if it
            does not, the store keeps running and orders keep arriving.
          </p>
          {error.digest ? (
            <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', opacity: 0.65 }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.75rem',
              height: '2.5rem',
              padding: '0 1.25rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#0e1424',
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

/**
 * Tell the backend that the console just broke.
 *
 * The console had no error boundary at all — a render throw on any screen
 * produced Next's bare "Application error: a client-side exception has
 * occurred" — and nothing anywhere reported a failure. On the application that
 * holds write access to the whole catalogue, every order and every account,
 * that meant a crash was invisible until a manager rang to say a page had
 * stopped working.
 *
 * Mirrors the storefront's version deliberately rather than sharing one: the
 * two packages deploy separately and have no shared module, and a copied
 * fifty-line file is a smaller cost than a package boundary invented for it.
 * The `client` field is what keeps their reports apart in the log.
 *
 * Three properties matter more than completeness, because this runs at the
 * moment the app is already failing: it cannot throw, it cannot block, and it
 * sends only what the server's allowlist accepts. In particular no order data,
 * no customer details and — since this is the authenticated app — no token.
 */

import { apiUrl } from '@/lib/api';

export interface ConsoleErrorReport {
  route?: string;
  message?: string;
  /**
   * Next.js hands a client boundary a `digest` and withholds the message for an
   * error thrown during server rendering, deliberately, so a stack never
   * reaches a browser. The digest is what ties this report to the full
   * traceback already in the server log.
   */
  digest?: string;
  stack?: string;
}

export function reportConsoleError(report: ConsoleErrorReport): void {
  if (typeof window === 'undefined') return;

  try {
    void fetch(apiUrl('/api/client-errors'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No Authorization header, on purpose. The endpoint is public and does
      // not want one, and attaching a bearer token to a fire-and-forget request
      // sent from inside a crash is a way to leak a credential into a log.
      //
      // `keepalive` because the manager is about to click "Reload".
      keepalive: true,
      body: JSON.stringify({
        client: 'console',
        route: window.location?.pathname ?? '',
        ...report,
      }),
    }).catch(() => {
      // The API is unreachable. Very often that is why we are here.
    });
  } catch {
    // `fetch` can throw synchronously on a malformed URL — which is one of the
    // failures this exists to report, so it must not become one.
  }
}

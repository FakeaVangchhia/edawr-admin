/**
 * Tell the backend that this app just broke.
 *
 * Until `POST /api/client-errors` existed there was nowhere to send this, and
 * the error boundary said so in its own docblock: no endpoint, and the CSP
 * would have blocked a third-party collector anyway. So the first anyone knew
 * about a broken deploy was a phone call from the shop.
 *
 * Three properties matter more than completeness here, because this runs at the
 * exact moment the app is already failing:
 *
 * **It cannot throw.** A reporter that raises inside an error boundary turns
 * one broken page into a boundary that cannot render, and React's fallback for
 * that is a blank screen. Every failure path here is swallowed.
 *
 * **It cannot block.** Fire and forget, with `keepalive` so the request
 * survives the navigation that a customer clicking "Go home" is about to cause.
 *
 * **It sends nothing it was not asked to.** The fields below are the allowlist
 * the server also enforces; in particular no cart contents, no address, no
 * phone number. An error report is not a place to discover you have shipped
 * customer data to a log.
 */

import { apiUrl } from './api';

export interface ClientErrorReport {
  /** Which app. The server keeps storefront and console crashes apart. */
  client: 'storefront' | 'console';
  route?: string;
  message?: string;
  /**
   * Next.js gives a client boundary a `digest` and withholds the message for an
   * error thrown during server rendering — deliberately, so a stack trace never
   * reaches a browser. The digest is the only thing that ties this report to
   * the full traceback already sitting in the server log.
   */
  digest?: string;
  stack?: string;
}

export function reportClientError(report: ClientErrorReport): void {
  if (typeof window === 'undefined') return;

  try {
    void fetch(apiUrl('/api/client-errors'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The page is very likely about to unload — the customer is reading a
      // "try again" button. Without this the browser cancels the request on
      // navigation and the report is lost precisely when it is most wanted.
      keepalive: true,
      body: JSON.stringify({
        route: window.location?.pathname ?? '',
        ...report,
      }),
      // Deliberately not `request()` from lib/api: that retries, throws typed
      // errors and has a timeout, all of which are the wrong behaviour for a
      // best-effort report sent from inside a failure.
    }).catch(() => {
      // The store is unreachable. That is very often *why* we are here.
    });
  } catch {
    // `fetch` itself can throw synchronously on a malformed URL — which is one
    // of the failure modes this exists to report, so it must not become one.
  }
}

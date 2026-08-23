import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request security headers, chiefly the Content Security Policy.
 *
 * `proxy.ts` is what this version of Next.js calls middleware — the file was
 * renamed in v16 and the functionality is unchanged. It is the only place a
 * per-request nonce can be generated, which is what a script CSP needs.
 *
 * The static headers (X-Frame-Options, nosniff, Referrer-Policy) live in
 * `next.config.ts` instead, because they never vary per request and belong
 * where they can be read without tracing a function.
 */

/**
 * The API origin has to be named in `connect-src` and `img-src`, or the
 * storefront cannot fetch its own catalogue and every product image is blocked.
 * This is the single easiest way to ship a CSP that breaks the site, so it is
 * derived from the same variable the client fetches with rather than written
 * out a second time.
 */
function apiOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const api = apiOrigin();

  /**
   * Where the browser posts a violation.
   *
   * Worth having because every way this policy can be wrong produces the same
   * symptom — a page that paints and then does nothing — and none of them
   * reaches a server log. `script-src 'strict-dynamic'` fails silently on a
   * prerendered route; `img-src` and `connect-src` are built from a build-time
   * environment variable that can be stale. The first symptom used to be a
   * phone call.
   *
   * Note this needs **no `connect-src` entry**: a violation report is sent by
   * the browser's own reporting agent, not by page script, so the CSP does not
   * police it. That is precisely what makes a same-origin collector practical
   * here when a third-party one would have meant widening the policy.
   */
  const reportTo = api ? `${api}/api/csp-report` : '';

  const directives = [
    "default-src 'self'",

    // 'strict-dynamic' lets the nonce-carrying Next.js bootstrap load the rest
    // of the app's chunks, so individual script URLs never need listing.
    // 'unsafe-eval' is required in development only: React uses eval to
    // reconstruct server-side error stacks in the browser.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,

    // 'unsafe-inline' for styles, knowingly. Tailwind v4 and next/font both
    // inject inline <style> blocks during hydration, and nonce-ing every one of
    // them is fragile across framework upgrades. The application itself ships
    // no inline <style> — the one that existed, in LiquidBackdrop, went with
    // the dark theme. Inline *styles* cannot exfiltrate data or execute code
    // the way inline scripts can, so this is the weakest link in the policy by
    // some distance and still not a hole.
    "style-src 'self' 'unsafe-inline'",

    // next/font self-hosts its files, so no external font origin is needed.
    "font-src 'self' data:",

    // Product images are served by the Django backend.
    `img-src 'self' blob: data:${api ? ` ${api}` : ''}`,

    // Where the app is allowed to talk to. Without the API origin here, every
    // fetch in the storefront fails.
    `connect-src 'self'${api ? ` ${api}` : ''}${isDev ? ' ws: wss:' : ''}`,

    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Belt and braces with the X-Frame-Options header in next.config.ts: this
    // is the modern directive, that one is for older browsers.
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),

    // Both spellings, because browsers disagree and neither is going away.
    // `report-uri` is deprecated and is what Safari and older Chrome send;
    // `report-to` names a group defined by the `Reporting-Endpoints` header
    // below and is what current Chrome sends. Listing one would silently lose
    // half the reports, which is worse than knowing you have no reporting.
    ...(reportTo ? [`report-uri ${reportTo}`, 'report-to csp-endpoint'] : []),
  ];

  const csp = directives.join('; ');

  // Next.js reads the nonce off the *request* header to stamp it onto the
  // scripts it renders, so it has to be set on both the request and response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  if (reportTo) {
    // Defines the group `report-to` above refers to. Without this header that
    // directive names nothing and is ignored.
    response.headers.set('Reporting-Endpoints', `csp-endpoint="${reportTo}"`);
  }
  return response;
}

export const config = {
  /**
   * Skip Next's own static output and the icon/manifest assets. Those are
   * immutable files served straight from disk; running this on each of them
   * costs a function invocation and buys nothing, and a nonce on a cached asset
   * is meaningless.
   *
   * `manifest-src` is deliberately absent from the policy above — it falls back
   * to `default-src 'self'`, which is already correct.
   */
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request security headers for the console, chiefly the Content Security
 * Policy. Copied from the storefront's proxy rather than shared, because the
 * two apps deploy separately and a shared file across package boundaries would
 * couple their release cycles for forty lines.
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
 * console cannot fetch anything and every product image is blocked.
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

/**
 * Where product images are read from. Must be named in `img-src` or the
 * browser blocks every one of them.
 *
 * Empty when unset, and empty when it is the same origin as the API — in which
 * case `api` already covers it and repeating it only makes the header longer.
 * That is the un-migrated case: with UPLOAD_BACKEND=local the Django API still
 * serves /uploads itself.
 */
function mediaOrigin(api: string): string {
  const raw = (process.env.NEXT_PUBLIC_MEDIA_URL || '').trim();
  if (!raw) return '';
  try {
    const origin = new URL(raw).origin;
    return origin === api ? '' : origin;
  } catch {
    return '';
  }
}

export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const api = apiOrigin();
  const media = mediaOrigin(api);

  /**
   * Where the browser posts a violation. Same reasoning as the storefront's
   * copy: every way this policy can be wrong produces one symptom — a screen
   * that paints and never hydrates — and none of them reaches a log.
   *
   * Needs no `connect-src` entry: a violation report is sent by the browser's
   * reporting agent rather than by page script, so the policy does not police
   * it. That is what makes a same-origin collector workable here.
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
    // them is fragile across framework upgrades. Inline *styles* cannot
    // exfiltrate data or execute code the way inline scripts can, so this is
    // the weakest link in the policy by some distance and still not a hole.
    //
    // The charts are inline <svg> in the component tree, not injected style, so
    // they need nothing further here.
    "style-src 'self' 'unsafe-inline'",

    // next/font self-hosts its files, so no external font origin is needed.
    "font-src 'self' data:",

    // Product images. `api` because the backend still serves /uploads when
    // UPLOAD_BACKEND=local; `media` because it does not when the images are in
    // Cloudflare R2 and the browser fetches them from there.
    `img-src 'self' blob: data:${api ? ` ${api}` : ''}${media ? ` ${media}` : ''}`,

    // Where the app is allowed to talk to. Without the API origin here, every
    // fetch in the console fails.
    `connect-src 'self'${api ? ` ${api}` : ''}${isDev ? ' ws: wss:' : ''}`,

    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Belt and braces with the X-Frame-Options header in next.config.ts: this
    // is the modern directive, that one is for older browsers.
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),

    // Both spellings. `report-uri` is deprecated and is what Safari and older
    // Chrome send; `report-to` names the group defined by the
    // `Reporting-Endpoints` header below. Listing one loses half the reports.
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
    // Defines the group `report-to` refers to. Without this header that
    // directive names nothing and is ignored.
    response.headers.set('Reporting-Endpoints', `csp-endpoint="${reportTo}"`);
  }
  return response;
}

export const config = {
  /**
   * Skip Next's own static output and the icon assets. Those are immutable
   * files served straight from disk; running this on each of them costs a
   * function invocation and buys nothing, and a nonce on a cached asset is
   * meaningless.
   *
   * The console has no web manifest, deliberately — it is `noindex` and is not
   * something anyone installs to a home screen. `favicon.ico`, `icon.png` and
   * `apple-icon.png` are the App Router metadata files in `src/app/`, which
   * Next serves at exactly those paths.
   */
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

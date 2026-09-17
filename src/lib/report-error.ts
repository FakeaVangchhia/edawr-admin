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

/**
 * Which build this is, if the deployment says.
 *
 * A crash line that cannot name a build cannot be triaged: "is this the deploy
 * from an hour ago, or has it been broken all week?" is the first question
 * asked, and the log could not answer it. The server has allowlisted `release`
 * since the endpoint existed; nothing was ever sending it.
 *
 * Written as a literal `process.env.NEXT_PUBLIC_*` reference because that is
 * what Next inlines at build time, so the value describes the bundle the
 * browser is running rather than whatever the server happens to be now.
 * `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` is Vercel's own and is exposed
 * automatically; the explicit variable wins so another host can set one. Unset
 * is supported — the field is omitted, which is exactly today's behaviour.
 *
 * The storefront's copy is identical, for the reason the docblock above gives
 * about the two packages deploying separately.
 */
const RELEASE = (
  process.env.NEXT_PUBLIC_RELEASE ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  ''
).slice(0, 64);

/**
 * Caps every string before it goes on the wire.
 *
 * The obvious reason is that the server truncates anyway — `MAX_FIELD` and
 * `MAX_STACK` in `api/views/reports.py` — so everything past those caps is
 * bandwidth spent to be discarded on arrival, which on Aizawl mobile data is
 * not free.
 *
 * The one that actually bites is quieter. A `keepalive` request draws on a
 * **64 KB quota shared across the origin**, and over it the browser rejects the
 * fetch outright. An unusually large stack would therefore lose the whole
 * report, silently, at the moment it is most wanted — the failure mode this
 * module exists to prevent, arriving through the flag that exists to prevent it.
 */
const MAX_FIELD = 2000;
const MAX_STACK = 8000;

function cap(value: string | undefined, limit: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, limit);
}

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
        // The raw path, unlike the storefront's, which rewrites `/order/<token>`
        // before sending it. Every console route is static — `/orders`,
        // `/products`, `/audit` — so there is no credential in a path here to
        // keep out of the log. Add a dynamic route that carries one and this
        // becomes the storefront's problem too; `api/views/reports.py` redacts
        // a tracking token server-side whatever a client sends.
        route: window.location?.pathname ?? '',
        ...(RELEASE ? { release: RELEASE } : {}),
        ...report,
        // Capped after the spread, so a caller cannot get past it by passing a
        // longer one. `undefined` is dropped by JSON.stringify.
        message: cap(report.message, MAX_FIELD),
        stack: cap(report.stack, MAX_STACK),
      }),
    }).catch(() => {
      // The API is unreachable. Very often that is why we are here.
    });
  } catch {
    // `fetch` can throw synchronously on a malformed URL — which is one of the
    // failures this exists to report, so it must not become one.
  }
}

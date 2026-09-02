import type { NextConfig } from "next";

/**
 * Refuse to produce a build that cannot talk to the API.
 *
 * `src/proxy.ts` derives the CSP's `connect-src` and `img-src` from
 * NEXT_PUBLIC_API_URL, and it is written to degrade quietly: an unset or
 * unparseable value yields an empty origin, the policy comes out as
 * `connect-src 'self'`, and the browser blocks every request the console makes.
 * The console then renders perfectly and loads no data — and because it is the
 * *browser* refusing, nothing appears in a deploy log, a health check or an
 * error report. A hosting dashboard where nobody filled the variable in
 * produces exactly this, and it stays invisible until a person opens the site.
 *
 * That is too quiet a failure for the most consequential variable here, so the
 * build stops instead. Development is exempt: `next dev` is where you are
 * allowed to have half a configuration.
 *
 * CI sets a syntactically valid placeholder — nothing is fetched at build time,
 * so any absolute http(s) URL satisfies this.
 */
if (process.env.NODE_ENV === "production") {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  let origin = "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      origin = parsed.origin;
    }
  } catch {
    // Leaves origin empty, which the check below reports.
  }

  if (!origin) {
    const what = raw ? `not a usable http(s) URL (got ${JSON.stringify(raw)})` : "unset";
    throw new Error(
      [
        `NEXT_PUBLIC_API_URL is ${what}.`,
        "",
        "It names the Django API in the CSP's connect-src and img-src, and is",
        "baked into the client bundle — so a build without it ships a console",
        "whose screens render and whose data never arrives.",
        "",
        "Set it on the deployment (and in .env locally), scheme included and no",
        "trailing slash, e.g. https://api.example.com — then rebuild. Changing",
        "it needs a rebuild, not a restart.",
      ].join("\n"),
    );
  }
}

/**
 * Static security headers for the console.
 *
 * The per-request Content Security Policy lives in `src/proxy.ts`, because it
 * carries a nonce and a nonce cannot be static. These are the headers that
 * never vary, kept where they can be read without tracing a function.
 */
const securityHeaders = [
  // The console must never be framed. It holds an authenticated session with
  // full write access to the catalogue, so clickjacking it is worth more to an
  // attacker than clickjacking the shop.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Stricter than the storefront's: an admin URL can carry an order id or a
  // customer's details in the path, and there is no reason to leak even the
  // origin to anywhere they might click through to.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // The console needs none of these. The storefront allows geolocation for
  // checkout; nothing here has any use for a camera, a microphone or a position.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Not a shop. Keeping it out of search results costs nothing and removes a
  // login page from the public index.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

/**
 * HSTS, one year, production builds only.
 *
 * The API already sends this (`SECURE_HSTS_SECONDS` in the backend's settings),
 * and a console that does not is the weaker half of the pair: this is where the
 * password is typed, so a first request over plain HTTP is a password on the
 * wire. The header tells the browser never to try HTTP for this host again.
 *
 * `includeSubDomains` is scoped to subdomains of the console's own host, which
 * is a subdomain itself — it says nothing about the apex or about the
 * storefront. No `preload`: that is a submission to a browser-vendor list,
 * belongs on the apex domain rather than here, and is close to irreversible.
 *
 * Guarded on NODE_ENV because a header a browser ignores over plain HTTP is
 * still a header worth not sending in development, where the answer to "why is
 * localhost forcing HTTPS" costs an afternoon.
 */
const productionOnlyHeaders =
  process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : [];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders, ...productionOnlyHeaders] },
    ];
  },
};

export default nextConfig;

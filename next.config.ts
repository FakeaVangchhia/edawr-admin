import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

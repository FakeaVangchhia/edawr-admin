import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { connection } from 'next/server';

import './globals.css';

/**
 * Inter and JetBrains Mono, where the storefront uses IBM Plex Sans and
 * Manrope. A different typographic voice is the cheapest way to make it
 * obvious which of the two applications you are looking at — and both choices
 * earn their place beyond that: Inter's `tnum` gives the tabular figures every
 * table here depends on, and a real monospace makes SKUs, order ids and audit
 * diffs scannable in a way a proportional face cannot.
 *
 * Self-hosted by next/font, so `font-src 'self'` in the CSP needs no external
 * origin and there is no third-party request on first paint.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-face',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'eDawr Console',
  description: 'Admin and manager console for the eDawr store.',
  // Belt and braces with the X-Robots-Tag header in next.config.ts. A login
  // page has no business in a search index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Both themes are declared, so the browser paints the right colour behind
  // the page before React has rendered anything — without this the first frame
  // of the dark console is a white flash.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6fa' },
    { media: '(prefers-color-scheme: dark)', color: '#070b13' },
  ],
};

/**
 * Read the stored theme before first paint.
 *
 * This has to be inline and synchronous: anything deferred runs after the
 * browser has already painted, and the operator sees a white flash before the
 * dark theme applies. It is nonce-carrying, which is why it satisfies the
 * strict CSP in `proxy.ts`, and it is the only inline script in the app.
 *
 * It writes `data-theme` only when a choice was stored. With no attribute the
 * CSS falls through to `prefers-color-scheme`, which is the right default.
 */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var stored = localStorage.getItem('edawr-console-theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Forces every route to render per request. This is load-bearing, not
  // ceremony: `proxy.ts` issues a fresh CSP nonce per request, and a statically
  // prerendered page would ship HTML whose script tags carry a nonce from build
  // time. The browser would reject every one of them and the app would never
  // hydrate — a blank page with a console full of CSP violations.
  await connection();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}

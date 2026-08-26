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
  // One value, because the console has one default and it is white. This is
  // the colour the browser paints before React has rendered anything, so it
  // has to match what the stylesheet will settle on — and the stylesheet no
  // longer consults the operating system. Keying this on prefers-color-scheme,
  // as it used to, would now paint a dark frame and then reveal a light app.
  //
  // The cost lands on the minority who chose dark: they get a brief white frame
  // before the bootstrap below stamps the attribute. A meta tag cannot read
  // localStorage, so that is the trade, and it now falls on the smaller group.
  themeColor: '#f5f6fa',
};

/**
 * Read the stored theme before first paint.
 *
 * This has to be inline and synchronous: anything deferred runs after the
 * browser has already painted, and someone who chose dark sees a white flash
 * before it applies. It is nonce-carrying, which is why it satisfies the strict
 * CSP in `proxy.ts`, and it is the only inline script in the app.
 *
 * It writes `data-theme` only for a stored *dark* choice. No attribute means
 * light, which is the console's default — so for everyone who has never opened
 * the toggle this script does nothing at all, which is the correct amount.
 */
const THEME_BOOTSTRAP = `
(function () {
  try {
    if (localStorage.getItem('edawr-console-theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
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

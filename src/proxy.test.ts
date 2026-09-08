import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The console's CSP.
 *
 * A near-verbatim copy of the storefront's, deliberately — the two packages
 * deploy separately and share no module — which is exactly why it needs its own
 * test. A copy with no test is a copy that drifts, and the drift is invisible
 * until a manager reports a screen that loads and does nothing.
 *
 * The console has one requirement the storefront does not: `layout.tsx` ships a
 * nonced inline script that reads the stored theme before first paint, so a
 * policy that stopped emitting a nonce would give every manager a white flash
 * on every navigation.
 */

const API = 'https://api.edawr.test';
const MEDIA = 'https://pub-test.r2.dev';

async function headersFor(
  apiUrl: string | undefined,
  nodeEnv = 'production',
  mediaUrl = '',
) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_URL', apiUrl ?? '');
  vi.stubEnv('NEXT_PUBLIC_MEDIA_URL', mediaUrl);
  vi.stubEnv('NODE_ENV', nodeEnv);

  const { proxy } = await import('@/proxy');
  return proxy(new NextRequest('https://console.edawr.test/orders')).headers;
}

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(';').map((part) => {
      const [name, ...rest] = part.trim().split(/\s+/);
      return [name, rest.join(' ')];
    }),
  );

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the console CSP', () => {
  it('names the API origin in connect-src and img-src', async () => {
    const d = directives(
      (await headersFor(API)).get('Content-Security-Policy') ?? '',
    );

    expect(d['connect-src']).toContain(API);
    // Product images appear in the product drawer and the order drawer.
    expect(d['img-src']).toContain(API);
  });

  it('names the media origin in img-src when images live elsewhere', async () => {
    // Product images are in a Cloudflare R2 bucket, not on the API host. Miss
    // this and every image in the console is blocked by the browser, with
    // nothing in a deploy log, a health check or an error report to say so.
    const d = directives(
      (await headersFor(API, 'production', MEDIA)).get('Content-Security-Policy') ?? '',
    );

    expect(d['img-src']).toContain(MEDIA);
    expect(d['img-src']).toContain(API);
    // Images are <img> fetches, not fetch() calls: the bucket has no business
    // in connect-src, and putting it there would widen the policy for nothing.
    expect(d['connect-src']).not.toContain(MEDIA);
  });

  it('does not repeat the API origin when images are served from it', async () => {
    // UPLOAD_BACKEND=local, the un-migrated case: Django serves /uploads itself.
    const d = directives(
      (await headersFor(API, 'production', API)).get('Content-Security-Policy') ?? '',
    );

    expect(d['img-src'].match(new RegExp(API, 'g'))).toHaveLength(1);
  });

  it('carries a nonce, which the theme bootstrap depends on', async () => {
    // `layout.tsx` inlines a script that reads `edawr-console-theme` before
    // paint. Drop the nonce and 'strict-dynamic' blocks it, and every screen
    // flashes white before settling into the manager's chosen theme.
    const d = directives(
      (await headersFor(API)).get('Content-Security-Policy') ?? '',
    );

    expect(d['script-src']).toMatch(/'nonce-[^']+'/);
    expect(d['script-src']).toContain("'strict-dynamic'");
  });

  it('reports violations to the API, both spellings', async () => {
    const headers = await headersFor(API);

    expect(headers.get('Content-Security-Policy')).toContain(
      `report-uri ${API}/api/csp-report`,
    );
    expect(headers.get('Content-Security-Policy')).toContain('report-to csp-endpoint');
    expect(headers.get('Reporting-Endpoints')).toBe(
      `csp-endpoint="${API}/api/csp-report"`,
    );
  });

  it('did not widen connect-src to make reporting work', async () => {
    const d = directives(
      (await headersFor(API)).get('Content-Security-Policy') ?? '',
    );

    expect(d['connect-src']).toBe(`'self' ${API}`);
  });

  it('locks down the dangerous directives', async () => {
    const d = directives(
      (await headersFor(API)).get('Content-Security-Policy') ?? '',
    );

    expect(d['object-src']).toBe("'none'");
    expect(d['frame-ancestors']).toBe("'none'");
    expect(d['base-uri']).toBe("'self'");
    expect(d['form-action']).toBe("'self'");
  });

  it('degrades rather than throwing when the API URL is missing', async () => {
    const headers = await headersFor(undefined);

    expect(headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(headers.get('Content-Security-Policy')).not.toContain('report-uri');
    expect(headers.get('Reporting-Endpoints')).toBeNull();
  });
});

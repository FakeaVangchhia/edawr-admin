import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The CSP, which has never had a test and is the single easiest thing here to
 * ship broken.
 *
 * Every way this policy can be wrong produces the same symptom — a page that
 * paints and then does nothing — and none of them reaches a server log or fails
 * a build. `connect-src` and `img-src` are derived from a build-time variable
 * that can be stale or missing; `script-src 'strict-dynamic'` makes a CSP3
 * browser ignore `'self'` entirely and trust only nonced scripts. A test is the
 * only cheap feedback available before a customer sees a blank storefront.
 *
 * `NEXT_PUBLIC_API_URL` is read at module scope in `proxy.ts`, so each case
 * re-imports the module with `resetModules` after setting the variable.
 */

const API = 'https://api.edawr.test';

async function headersFor(apiUrl: string | undefined, nodeEnv = 'production') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_URL', apiUrl ?? '');
  vi.stubEnv('NODE_ENV', nodeEnv);

  const { proxy } = await import('@/proxy');
  const response = proxy(new NextRequest('https://shop.edawr.test/cart'));
  return response.headers;
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

describe('the storefront CSP', () => {
  it('names the API origin in connect-src and img-src', async () => {
    // Get this wrong and the browser blocks the catalogue and every product
    // image, and the store renders empty. It is the first thing to check when
    // nothing loads.
    const csp = (await headersFor(API)).get('Content-Security-Policy') ?? '';
    const d = directives(csp);

    expect(d['connect-src']).toContain(API);
    expect(d['img-src']).toContain(API);
  });

  it('takes the origin, not the whole URL', async () => {
    // A path in a CSP source is legal but means something different, and a
    // trailing slash is a common way to get it subtly wrong.
    const d = directives(
      (await headersFor(`${API}/api/`)).get('Content-Security-Policy') ?? '',
    );

    expect(d['connect-src']).toContain(API);
    expect(d['connect-src']).not.toContain('/api/');
  });

  it('carries a nonce and strict-dynamic', async () => {
    const d = directives(
      (await headersFor(API)).get('Content-Security-Policy') ?? '',
    );

    expect(d['script-src']).toMatch(/'nonce-[^']+'/);
    expect(d['script-src']).toContain("'strict-dynamic'");
  });

  it('gives a different nonce to every request', async () => {
    // A reused nonce is no better than 'unsafe-inline'.
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_URL', API);
    const { proxy } = await import('@/proxy');

    const first = proxy(new NextRequest('https://shop.edawr.test/'));
    const second = proxy(new NextRequest('https://shop.edawr.test/'));

    const nonceOf = (r: Response) =>
      /'nonce-([^']+)'/.exec(r.headers.get('Content-Security-Policy') ?? '')?.[1];

    expect(nonceOf(first)).toBeTruthy();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it('locks down the dangerous directives', async () => {
    const d = directives(
      (await headersFor(API)).get('Content-Security-Policy') ?? '',
    );

    expect(d['object-src']).toBe("'none'");
    expect(d['frame-ancestors']).toBe("'none'");
    expect(d['base-uri']).toBe("'self'");
    expect(d['form-action']).toBe("'self'");
    expect(d['default-src']).toBe("'self'");
  });

  it('does not allow unsafe-eval outside development', async () => {
    const d = directives(
      (await headersFor(API)).get('Content-Security-Policy') ?? '',
    );

    expect(d['script-src']).not.toContain('unsafe-eval');
  });

  describe('violation reporting', () => {
    it('names the report endpoint both ways', async () => {
      // Browsers disagree about which directive they honour, and listening for
      // one silently loses half the reports.
      const headers = await headersFor(API);
      const csp = headers.get('Content-Security-Policy') ?? '';

      expect(csp).toContain(`report-uri ${API}/api/csp-report`);
      expect(csp).toContain('report-to csp-endpoint');
    });

    it('defines the group report-to refers to', async () => {
      // Without this header the `report-to` directive names nothing and is
      // ignored — the failure is silent in both directions.
      const headers = await headersFor(API);

      expect(headers.get('Reporting-Endpoints')).toBe(
        `csp-endpoint="${API}/api/csp-report"`,
      );
    });

    it('needs no connect-src entry of its own', async () => {
      // The reason a same-origin collector is practical here: a violation
      // report is sent by the browser's reporting agent, not by page script, so
      // the policy does not police it. This asserts we did not widen anything
      // to make reporting work.
      const d = directives(
        (await headersFor(API)).get('Content-Security-Policy') ?? '',
      );

      expect(d['connect-src']).toBe(`'self' ${API}`);
    });
  });

  describe('when NEXT_PUBLIC_API_URL is missing or unparseable', () => {
    it('emits a policy rather than throwing', async () => {
      // A proxy that throws takes down every route. Degrading is right; the
      // store will not work either way, and a blank page beats a 500.
      const csp = (await headersFor(undefined)).get('Content-Security-Policy');

      expect(csp).toContain("default-src 'self'");
    });

    it('omits the report endpoint rather than emitting a broken one', async () => {
      const headers = await headersFor('not a url');

      expect(headers.get('Content-Security-Policy')).not.toContain('report-uri');
      expect(headers.get('Reporting-Endpoints')).toBeNull();
    });
  });
});

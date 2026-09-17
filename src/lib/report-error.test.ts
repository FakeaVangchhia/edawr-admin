import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportConsoleError } from '@/lib/report-error';

/**
 * The console's crash reporter, and the one property it must never lose.
 *
 * It runs inside an error boundary, so a reporter that raises turns one broken
 * screen into a boundary that cannot render — and Next's fallback for that is
 * the bare "Application error" page the boundary was added to replace. Every
 * branch below is a real failure mode: a malformed API URL makes `fetch` throw
 * synchronously before it returns a promise, and an unreachable API makes it
 * reject, which is very often *why* the console is failing in the first place.
 *
 * Mirrors `edawr-frontend/src/lib/report-error.test.ts`, as the modules
 * themselves mirror each other.
 */
describe('reportConsoleError', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const report = { message: 'boom', stack: 'at OrdersPage' };

  it('does not throw when fetch throws synchronously', () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError('Failed to parse URL');
    });

    expect(() => reportConsoleError(report)).not.toThrow();
  });

  it('does not throw, or reject, when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError when attempting to fetch'));

    expect(() => reportConsoleError(report)).not.toThrow();
    // Settle the rejection here, so an unhandled one fails this test rather
    // than becoming a warning nobody reads.
    await Promise.resolve();
  });

  it('returns nothing and awaits nothing', () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    expect(reportConsoleError(report)).toBeUndefined();
  });

  it('names itself as the console, and carries no credential', () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    reportConsoleError(report);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.client).toBe('console');
    // The endpoint is public and does not want a token. Attaching one to a
    // fire-and-forget request sent from inside a crash is how a credential
    // ends up in a log.
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('caps the fields before they go on the wire', () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    reportConsoleError({ message: 'm'.repeat(5_000), stack: 's'.repeat(20_000) });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // The server truncates to exactly these, and past 64 KB a `keepalive`
    // request is dropped by the browser entirely, losing the report.
    expect(body.message).toHaveLength(2_000);
    expect(body.stack).toHaveLength(8_000);
  });
});

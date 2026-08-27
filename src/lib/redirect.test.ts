import { describe, expect, it } from 'vitest';

import { safeNext } from '@/lib/redirect';

/**
 * The `?next=` guard.
 *
 * Two separate things are being protected. The obvious one is the open
 * redirect: this value reaches `router.replace` immediately after a manager
 * types a password, which is the worst possible moment to be sent somewhere
 * else. The quieter one is that the login page has to keep working when the
 * parameter is absent — most sign-ins have no `next` at all, and returning
 * something falsy there would replace to an empty URL.
 */
describe('safeNext', () => {
  it('keeps an in-app path', () => {
    expect(safeNext('/orders')).toBe('/orders');
    expect(safeNext('/products?status=active')).toBe('/products?status=active');
  });

  it('falls back to the dashboard when there is nothing to honour', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('')).toBe('/');
  });

  it('refuses anything that leaves the console', () => {
    expect(safeNext('https://not-edawr.example/console')).toBe('/');
    expect(safeNext('http://not-edawr.example')).toBe('/');
    // Protocol-relative: reads as a path, resolves to another host.
    expect(safeNext('//not-edawr.example/console')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
  });
});

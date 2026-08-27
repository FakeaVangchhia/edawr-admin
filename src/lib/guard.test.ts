import { describe, expect, it } from 'vitest';

import { CAPABILITIES, can, type Capability } from '@/lib/guard';
import type { Role } from '@/types';

/**
 * The capability matrix, checked exhaustively.
 *
 * This is a **specification test**, not a coverage exercise: it enumerates every
 * capability against every role and asserts the full grid, so adding a
 * capability without deciding who may use it fails here rather than shipping
 * with whatever the default happened to be.
 *
 * What it does *not* test — and cannot — is whether the server enforces any of
 * this. `can()` decides what to draw. The gate that matters is `IsOwnerAdmin`
 * on the backend, covered by `api/tests/test_roles.py`, which asserts a Manager
 * gets 403 from `/api/admins` no matter what the client believes.
 */

const ADMIN_ONLY: Capability[] = ['accounts', 'audit'];

const MANAGER_ALLOWED: Capability[] = [
  'orders',
  'products',
  'categories',
  'staff',
  'analytics',
  'settings',
];

describe('can()', () => {
  it('lets an Admin do everything', () => {
    for (const capability of CAPABILITIES) {
      expect(can('admin', capability), capability).toBe(true);
    }
  });

  it('lets a Manager run the store', () => {
    for (const capability of MANAGER_ALLOWED) {
      expect(can('manager', capability), capability).toBe(true);
    }
  });

  it('refuses a Manager the console-administration capabilities', () => {
    for (const capability of ADMIN_ONLY) {
      expect(can('manager', capability), capability).toBe(false);
    }
  });

  it('covers every declared capability', () => {
    // Guards against a capability being added to the type and to the nav but
    // never assigned to a role here — which would let it default silently.
    expect([...CAPABILITIES].sort()).toEqual(
      [...ADMIN_ONLY, ...MANAGER_ALLOWED].sort(),
    );
  });

  it('lets a Manager manage riders but not console accounts', () => {
    // The distinction the whole role split rests on. Riders are operational
    // records; console accounts are credentials. A store that cannot take on a
    // rider at the weekend without ringing the owner is a broken store.
    expect(can('manager', 'staff')).toBe(true);
    expect(can('manager', 'accounts')).toBe(false);
  });

  it('denies everything when there is no role', () => {
    for (const capability of CAPABILITIES) {
      expect(can(null, capability), capability).toBe(false);
      expect(can(undefined, capability), capability).toBe(false);
    }
  });

  it('denies an unrecognised role rather than defaulting open', () => {
    // A role string the client does not know about — an older bundle meeting a
    // newer server, say — must fail closed. It reaches the non-admin branch and
    // is refused the Admin-only set.
    const unknown = 'superuser' as Role;
    expect(can(unknown, 'accounts')).toBe(false);
    expect(can(unknown, 'audit')).toBe(false);
  });
});

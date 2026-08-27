/**
 * What each role may do — one map, and the only place the UI asks.
 *
 * **This decides what to draw, never what is allowed.** The server is the
 * authority: `IsOwnerAdmin` re-reads the role from the database on every
 * request, so a Manager who edited their stored session, or simply typed
 * `/accounts` into the address bar, gets a 403 from the API regardless of what
 * this file says. Gating is three layers deep — hide the link, refuse the
 * route, reject the request — and only the third one is a security control.
 *
 * The reason it is a map rather than `role === 'admin' && ...` scattered
 * through components: a new screen should have to name its capability once, in
 * a file whose whole purpose is to be read when someone asks "who can see
 * what?". Permission logic spread across twelve components cannot be answered
 * that way, and the answer is exactly what an audit asks for.
 */

import type { Role } from '@/types';

export type Capability =
  | 'orders'
  | 'products'
  | 'categories'
  | 'staff'
  | 'analytics'
  | 'settings'
  /** Console logins and role assignment. */
  | 'accounts'
  /** The record of what everyone did. */
  | 'audit';

/**
 * Capabilities reserved to the ADMIN role.
 *
 * Everything not listed here is available to both roles, and that default is
 * deliberate: a Manager runs the store. They price it, stock it, staff it,
 * cancel orders and read every number. What an Admin adds is authority over
 * *who runs the store* — minting accounts, changing roles — and the ability to
 * review what was done with that authority.
 *
 * Note what is NOT here: staff. A Manager can hire and deactivate riders. Riders
 * are operational records; console accounts are credentials. Conflating them is
 * how a store ends up unable to add a rider on a Sunday.
 */
const ADMIN_ONLY: ReadonlySet<Capability> = new Set<Capability>([
  'accounts',
  'audit',
]);

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  return !ADMIN_ONLY.has(capability);
}

/** Every capability, for exhaustive iteration in tests and in the nav. */
export const CAPABILITIES: readonly Capability[] = [
  'orders',
  'products',
  'categories',
  'staff',
  'analytics',
  'settings',
  'accounts',
  'audit',
] as const;

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
};

/**
 * What a Manager is told when they reach an Admin-only screen.
 *
 * Phrased as a fact about the account rather than an accusation, and it names
 * who can help — a dead end that only says "Forbidden" turns into a support
 * call. It never says "your session expired", because it has not: conflating
 * "you may not" with "who are you?" is what signs people out mid-shift.
 */
export const DENIED_MESSAGE =
  'This section is limited to Admin accounts. Ask an Admin if you need access.';

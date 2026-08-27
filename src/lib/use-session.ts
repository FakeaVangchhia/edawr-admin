'use client';

import { useSyncExternalStore } from 'react';

import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/session';
import type { ConsoleSession } from '@/types';

/**
 * The current session, live.
 *
 * `useSyncExternalStore` over `localStorage` rather than a React context, for
 * the same reasons the storefront's cart is an external store: no provider to
 * mount, no hydration mismatch, and the `storage` event keeps two open tabs in
 * step. That last one matters more here than it does for a shopping basket —
 * signing out in one tab must sign out the console in every tab, because each
 * one holds write access to the catalogue.
 */
export function useSession(): ConsoleSession | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

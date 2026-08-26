'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getAddressesServerSnapshot,
  getAddressesSnapshot,
  subscribeToAddresses,
} from '@/lib/addresses';
import {
  getServerSnapshot as getCartServerSnapshot,
  getSnapshot as getCartSnapshot,
  subscribe as subscribeToCart,
} from '@/lib/cart-store';
import { tierFor } from '@/lib/delivery';
import { getProfileServerSnapshot, getProfileSnapshot, subscribeToProfile } from '@/lib/profile';
import { getSessionServerSnapshot, getSessionSnapshot, subscribeToSession } from '@/lib/session';
import {
  getRecentOrdersServerSnapshot,
  getRecentOrdersSnapshot,
  subscribeToRecentOrders,
} from '@/lib/recent-orders';
import {
  getRecentSearchesServerSnapshot,
  getRecentSearchesSnapshot,
  subscribeToRecentSearches,
} from '@/lib/recent-searches';
import { fetchStoreConfig } from '@/lib/store-api';
import type { DeliveryType, StoreConfig } from '@/types';

/**
 * The hooks every storefront page reads its ambient state through.
 *
 * The local ones are thin `useSyncExternalStore` wrappers — the reason they are
 * hooks at all is that the three-argument call is easy to get subtly wrong (a
 * missing server snapshot is a hydration mismatch that only shows up in a
 * production build), so it is written once.
 *
 * `useStoreConfig` is the odd one out: it fetches. Note that it never calls
 * `setState` in the body of an effect — only inside a promise callback, which
 * is an async path. Setting state synchronously in an effect is an error in
 * this codebase (`react-hooks/set-state-in-effect`), and the fix is structural
 * rather than a suppression.
 */

export function useCart() {
  return useSyncExternalStore(subscribeToCart, getCartSnapshot, getCartServerSnapshot);
}

export function useAddressBook() {
  return useSyncExternalStore(
    subscribeToAddresses,
    getAddressesSnapshot,
    getAddressesServerSnapshot,
  );
}

export function useProfile() {
  return useSyncExternalStore(subscribeToProfile, getProfileSnapshot, getProfileServerSnapshot);
}

export function useRecentOrders() {
  return useSyncExternalStore(
    subscribeToRecentOrders,
    getRecentOrdersSnapshot,
    getRecentOrdersServerSnapshot,
  );
}

/**
 * The signed-in customer, or `null`.
 *
 * Returns `null` from the server snapshot, like every store in this file, so a
 * signed-in customer sees the signed-out header for one frame before hydration
 * replaces it. That is correct by construction rather than a bug — it is what
 * guarantees the server-rendered HTML and the first client render agree, and
 * the cart badge has behaved this way since it was written.
 */
export function useSession() {
  return useSyncExternalStore(
    subscribeToSession,
    getSessionSnapshot,
    getSessionServerSnapshot,
  );
}

export function useRecentSearches() {
  return useSyncExternalStore(
    subscribeToRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
  );
}

/**
 * The store's own rules: name, city, delivery tiers, fees, the promise — and
 * whether the shop is open right now.
 *
 * Cached at module scope so the twelve components that want the delivery
 * promise share one request rather than each firing their own.
 *
 * **The cache has a lifetime, and that is new.** It used to be permanent, on
 * the reasoning that this is configuration rather than inventory and a stale
 * fee costs nothing because no fee here is ever charged — every figure that
 * bills the customer comes from `/api/store/quote`. That reasoning was sound
 * while the payload was only prices. It stopped being sound when `is_open` and
 * `closed_reason` joined it: those are live operational state, and a permanent
 * cache means a customer who loaded the page at 21:55 still sees "Checkout" at
 * 22:05, fills in the whole address form, and is refused with a 503 at the last
 * step — the exact failure the closed-store gate exists to prevent. It fails the
 * other way too: a tab opened while the shop was shut says "Store closed"
 * forever after it reopens.
 *
 * Sixty seconds is chosen against what it is protecting: closing time and a
 * manager's kill switch during a power cut. A minute of staleness on either is
 * an acceptable cost; a whole session of it is not.
 */
const CONFIG_TTL_MS = 60_000;

let cached: StoreConfig | null = null;
let cachedAt = 0;
/** Shared between mounted components so a burst of them makes one request. */
let inFlight: Promise<StoreConfig> | null = null;

function isFresh(): boolean {
  return cached !== null && Date.now() - cachedAt < CONFIG_TTL_MS;
}

function loadConfig(signal?: AbortSignal): Promise<StoreConfig> {
  if (inFlight) return inFlight;

  inFlight = fetchStoreConfig(signal)
    .then((loaded) => {
      cached = loaded;
      cachedAt = Date.now();
      return loaded;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function useStoreConfig(): StoreConfig | null {
  const [config, setConfig] = useState<StoreConfig | null>(cached);
  // Bumped by the interval below. It is a render trigger, not state that
  // anything reads — the value always comes from the module cache.
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      if (isFresh()) {
        // Still adopt it: a component mounting inside the window needs the
        // cached value even though no request is due.
        if (!cancelled && cached) setConfig(cached);
        return;
      }
      loadConfig()
        .then((loaded) => {
          if (!cancelled) setConfig(loaded);
        })
        .catch(() => {
          // A store that cannot read its own config still sells. The tier
          // fallbacks in `lib/delivery.ts` cover the picker, and the bill was
          // never computed from this in the first place. Crucially the *last
          // known* value is kept rather than cleared: a network blip must not
          // black out the storefront's delivery promise.
        });
    };

    refresh();

    // Re-checked on a timer rather than only on mount, because the pages that
    // care — the cart and checkout — are exactly the ones a customer sits on
    // without navigating.
    const timer = setInterval(() => {
      if (!cancelled) {
        setTick((n) => n + 1);
        refresh();
      }
    }, CONFIG_TTL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return config;
}

/**
 * The promise, in minutes, for a given speed — or null before config lands.
 *
 * Null rather than a guess: an ETA chip that renders "15 min" from a hardcoded
 * default is a promise the store has not made. Better to show nothing for the
 * half second before the real number arrives.
 */
export function usePromiseMinutes(deliveryType?: DeliveryType): number | null {
  const config = useStoreConfig();
  if (!config) return null;
  if (!deliveryType) return config.promise_minutes;
  return tierFor(config, deliveryType).promise_minutes;
}

/**
 * Whether the browser thinks it has a connection.
 *
 * The storefront had no offline handling at all: on a dead connection every
 * navigation produced the browser's own error page and every fetch produced
 * "Could not reach the store", with nothing to say the problem was this side.
 * Aizawl mobile data drops, and a customer who has just lost signal deserves to
 * be told that rather than to conclude the shop is broken.
 *
 * `navigator.onLine` is famously weak — it reports whether there is *a* network
 * interface, not whether anything is reachable — so this is used for a banner
 * and never to decide whether to attempt a request. False is a reliable "no
 * connection"; true means only "worth trying", which is what the request layer
 * assumes anyway.
 *
 * An external store rather than an effect, matching everything else here: the
 * server snapshot is always `true`, so the server-rendered HTML and the first
 * client render agree and no state is set synchronously inside an effect.
 */
const onlineListeners = new Set<() => void>();
let onlineSnapshot = true;

function emitOnline() {
  onlineSnapshot = navigator.onLine;
  for (const listener of onlineListeners) listener();
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      onlineListeners.add(listener);
      if (onlineListeners.size === 1) {
        window.addEventListener('online', emitOnline);
        window.addEventListener('offline', emitOnline);
        // The page may have loaded from cache while already offline, so the
        // first subscriber reads the current value rather than waiting for a
        // transition that has already happened.
        onlineSnapshot = navigator.onLine;
      }
      return () => {
        onlineListeners.delete(listener);
        if (onlineListeners.size === 0) {
          window.removeEventListener('online', emitOnline);
          window.removeEventListener('offline', emitOnline);
        }
      };
    },
    () => onlineSnapshot,
    () => true,
  );
}

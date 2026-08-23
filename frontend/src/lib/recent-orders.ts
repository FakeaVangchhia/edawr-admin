/**
 * Remembering the customer's own orders, without an account.
 *
 * Order tracking is authorised by possession of an unguessable token, and that
 * token is handed over exactly once — in the checkout response. If the customer
 * closes the tab, the order is gone as far as they are concerned: there is no
 * login to find it behind, and no way for them to prove it was theirs.
 *
 * So the token is kept in localStorage. It is the same trust model as a paper
 * receipt: whoever holds it can see the order, and losing it means losing
 * access. Clearing site data is therefore destructive, which is worth knowing
 * before treating this as a database.
 *
 * Exposed as an external store, for the same reasons as the cart (see
 * `cart-store.ts`): reading localStorage from an effect would mean setting
 * state synchronously inside one, which is an error in this codebase.
 */

const STORAGE_KEY = 'edawr-recent-orders-v1';
const MAX_REMEMBERED = 10;

export interface RememberedOrder {
  token: string;
  orderId: number;
  placedAt: string;
  total: number;
  itemCount: number;
}

const NONE: RememberedOrder[] = [];

/**
 * `useSyncExternalStore` compares snapshots by reference, so this must be a
 * stable array rather than a fresh parse on every call — otherwise every render
 * sees a "changed" store and loops forever.
 */
let snapshot: RememberedOrder[] = NONE;
let hydrated = false;
const listeners = new Set<() => void>();

/**
 * True when this entry is safe to render.
 *
 * **Every field, not just two.** The previous version checked `token` and
 * `orderId` and let the rest through, so an entry written by an older build
 * reached the list with `undefined` where the total and the item count should
 * be — and the orders page rendered "₹undefined" and "undefined items" rather
 * than dropping a row it could not display. localStorage survives deploys; a
 * partial check is a promise that the shape never changed again.
 */
function isRemembered(entry: unknown): entry is RememberedOrder {
  if (typeof entry !== 'object' || entry === null) return false;
  const candidate = entry as Record<string, unknown>;
  return (
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    typeof candidate.orderId === 'number' &&
    typeof candidate.placedAt === 'string' &&
    typeof candidate.total === 'number' &&
    Number.isFinite(candidate.total) &&
    typeof candidate.itemCount === 'number'
  );
}

function parse(raw: string | null): RememberedOrder[] {
  if (!raw) return NONE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NONE;

    const valid = parsed.filter(isRemembered);
    return valid.length > 0 ? valid : NONE;
  } catch {
    return NONE;
  }
}

/**
 * Whether the last write reached disk.
 *
 * The write is allowed to fail — private browsing and a full quota both throw,
 * and crashing the page over a lost receipt would be a worse outcome than
 * losing it. What was wrong was failing *silently*: the in-memory snapshot was
 * updated regardless, so the order appeared in the list, looked remembered, and
 * vanished on the next reload with no explanation. The checkout page reads this
 * to tell the customer to keep the link.
 */
let lastWriteFailed = false;

export function recentOrdersArePersisted(): boolean {
  return !lastWriteFailed;
}

function write(next: RememberedOrder[]): void {
  snapshot = next.length > 0 ? next : NONE;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    lastWriteFailed = false;
  } catch {
    // Private browsing throws, and so does a full quota. The order still exists
    // server-side and the customer still has the URL they were just redirected
    // to — but this device will not remember it, and saying so beats a list
    // that empties itself overnight.
    lastWriteFailed = true;
  }
  for (const listener of listeners) listener();
}

export function readRecentOrders(): RememberedOrder[] {
  if (typeof window === 'undefined') return NONE;
  if (!hydrated) {
    hydrated = true;
    snapshot = parse(window.localStorage.getItem(STORAGE_KEY));
  }
  return snapshot;
}

export function rememberOrder(order: RememberedOrder): void {
  if (typeof window === 'undefined') return;
  const existing = readRecentOrders().filter((entry) => entry.token !== order.token);
  write([order, ...existing].slice(0, MAX_REMEMBERED));
}

export function forgetOrder(token: string): void {
  if (typeof window === 'undefined') return;
  write(readRecentOrders().filter((entry) => entry.token !== token));
}

// --- external store plumbing -------------------------------------------
function onStorage(event: StorageEvent) {
  // Another tab placed or dismissed an order. `key === null` means the whole
  // store was cleared.
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  snapshot = parse(event.newValue);
  for (const listener of listeners) listener();
}

export function subscribeToRecentOrders(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener('storage', onStorage);
    readRecentOrders();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function getRecentOrdersSnapshot(): RememberedOrder[] {
  return snapshot;
}

/** The server has no localStorage, so the first render must agree that it is empty. */
export function getRecentOrdersServerSnapshot(): RememberedOrder[] {
  return NONE;
}

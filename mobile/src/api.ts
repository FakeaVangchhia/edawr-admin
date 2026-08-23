import { apiUrl } from './config';
import { DeliveryDashboard, Order, OrderStatus, RiderSession, User } from './types';

/** Every backend error is `{"detail": "..."}` — see backend/api/exceptions.py. */
async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);
  return payload?.detail ?? `Request failed (${response.status}).`;
}

/** Thrown when the rider's token is missing, expired or rejected.
 *
 * Distinct from a generic failure so the UI can sign the rider out and show the
 * login screen instead of an alert they can only dismiss.
 */
export class UnauthorizedError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Thrown when the request never reached the server.
 *
 * Riders lose signal constantly — stairwells, basements, the road out of
 * Aizawl. That is an expected condition, not a fault, and it must not look
 * like one: the UI shows a quiet "you are offline" banner for this rather than
 * the same red alert it shows for a real error.
 */
export class OfflineError extends Error {
  constructor() {
    super('No connection. The app will retry when you are back online.');
    this.name = 'OfflineError';
  }
}

/**
 * Thrown when the server knows exactly who this rider is and says no anyway.
 *
 * **403 is not 401, and conflating them signs riders out mid-shift.** The
 * backend uses 403 for *authorization of an action*, not for a bad token:
 * `PermissionDenied("This order is not assigned to you.")` is a 403, and so is
 * every `IsRider` check on a valid rider token. This client used to throw
 * `UnauthorizedError` for both, and every consumer treats that as "session
 * over" — so if a manager returned an order to the pool between two polls, the
 * rider tapped Mark Delivered, got a 403, and was signed out and told their
 * session had expired. Which was false, and which cost them their PIN and a
 * working signal to get back in.
 *
 * The rule, the same one `admin/src/lib/api.ts` states: 401 means the server
 * does not know who you are and is the *only* thing that ends a session. 403
 * means it knows and this is not yours — surface the message, keep the session.
 */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Thrown when the order has moved on without this rider — someone else took
 * it, or it was cancelled. Separated because it needs a refresh and a calm
 * explanation, not a retry.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

/** Give up rather than leave a rider staring at a spinner on a dying signal. */
const TIMEOUT_MS = 15_000;

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  // React Native's fetch has no built-in timeout: on a flaky connection it can
  // hang indefinitely, and the rider has no way to tell that from a slow store.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    // `apiUrl()` rather than a module constant: resolution can fail on a
    // misconfigured release build, and it now reports that by throwing here
    // instead of during import, where nothing could catch it. In practice
    // App.tsx renders the explanation before any request is attempted.
    response = await fetch(`${apiUrl()}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        // The rider token, replayed the same way the web admin's authFetch does.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (caught) {
    // fetch rejects on network failure and on abort; both mean "could not
    // reach the server", which is the same thing to a rider.
    //
    // Deliberately narrow: only a real fetch rejection becomes OfflineError. A
    // bare `catch {}` here also swallowed programming errors — a malformed
    // API_URL, a body that will not serialise — and reported them to the rider
    // as "No connection", which is the one diagnosis that stops anyone looking
    // further.
    if (caught instanceof TypeError || (caught as Error)?.name === 'AbortError') {
      throw new OfflineError();
    }
    throw caught;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    throw new UnauthorizedError(await readError(response));
  }
  if (response.status === 403) {
    throw new ForbiddenError(await readError(response));
  }
  if (response.status === 409) {
    throw new ConflictError(await readError(response));
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  // 204 has no body; nothing in this app relies on the parsed value there.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------
export function riderLogin(phone: string, pin: string): Promise<RiderSession> {
  return request('/api/auth/rider/login', {
    method: 'POST',
    body: { phone, pin },
  });
}

/** Revalidate a stored token on launch, and get a fresh one back. */
export function fetchRiderSession(token: string): Promise<RiderSession> {
  return request('/api/auth/rider/me', { token });
}

/**
 * Retire this rider's tokens server-side.
 *
 * Deleting the SecureStore entry removes *our* copy of a credential that keeps
 * working for another twelve hours in anyone else's — and a rider's phone is
 * the device most likely to be handed over, lost or shared at the end of a
 * shift. This is what actually ends the session: the backend increments the
 * rider's `token_version`, which every request compares against.
 *
 * Swallows its own failure, deliberately. A rider signing out in a basement
 * must still be signed out of the phone in front of them, and `App.tsx` clears
 * the local token whether this succeeded or not.
 */
export async function riderLogout(token: string): Promise<void> {
  try {
    await request('/api/auth/rider/logout', { method: 'POST', token });
  } catch {
    // Offline, or the token had already expired. Nothing to say, nothing to
    // retry — the local clear is what the rider is waiting on.
  }
}

// --------------------------------------------------------------------------
// Delivery
// --------------------------------------------------------------------------
export function fetchDashboard(riderId: number, token: string): Promise<DeliveryDashboard> {
  return request(`/api/delivery/${riderId}/dashboard`, { token });
}

/**
 * The rider's own on/off switch. Distinct from `is_active`, which is the
 * manager's — going offline pauses new offers, it does not surrender the job.
 */
export function setAvailability(isAvailable: boolean, token: string): Promise<User> {
  return request('/api/delivery/availability', {
    method: 'PATCH',
    body: { is_available: isAvailable },
    token,
  });
}

// The rider is identified by the token, so none of these take a rider id — the
// backend ignores anything the body might claim. See backend/api/views/orders.py.
export function acceptOrder(orderId: number, token: string): Promise<Order> {
  return request(`/api/orders/${orderId}/accept`, { method: 'POST', token });
}

/**
 * Decline an order.
 *
 * This used to be decoration: it cleared a column nothing ever set, and the
 * order reappeared on the next refresh. The backend now records the decline,
 * and this rider stops being offered that order while everyone else still is.
 */
export function rejectOrder(orderId: number, token: string): Promise<{ success: boolean }> {
  return request(`/api/orders/${orderId}/reject`, { method: 'POST', token });
}

/**
 * Move an order the rider is carrying.
 *
 * `status` used to be typed `'Delivered'` and nothing else, which made the
 * app's whole vocabulary one word. A rider with a broken bike, a wrong address
 * or a customer who would not answer had exactly two options: mark it delivered
 * — a lie the till then has to absorb — or leave it stranded in `Dispatched`
 * forever, which also blocked them from being offered anything new.
 *
 * The three the backend accepts from a rider are now all reachable:
 *   Delivered  it arrived
 *   Ready      hand it back to the pool (someone else can take it)
 *   Failed     it was attempted and did not happen
 *
 * `reason` is required by the server for `Failed`, and ignored for the others.
 */
/**
 * `amountCollected` is the cash actually taken, and only `Delivered` accepts it.
 *
 * Omitting it records the full `grand_total`, which the server stamps in
 * `advance_status` — so the common case needs nothing here and there is no way
 * to reach Delivered without a collection on record. It is sent only when the
 * rider says the customer paid short, because that is the number the store
 * cannot reconstruct and the one the till will be missing.
 */
export function setOrderStatus(
  orderId: number,
  status: OrderStatus,
  token: string,
  reason?: string,
  amountCollected?: number,
): Promise<Order> {
  return request(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    body: {
      status,
      ...(reason ? { reason } : {}),
      // `!== undefined`, not a truthiness check: zero is a real answer here —
      // "they took the bag and paid nothing" — and `0 &&` would drop it and
      // record a full collection instead, which is the single worst way this
      // could be wrong.
      ...(amountCollected !== undefined ? { amount_collected: amountCollected } : {}),
    },
    token,
  });
}

/**
 * The single place the backend URL appears.
 *
 * Everything that talks to Django goes through `request()`, so repointing the
 * app at a different backend is a one-variable change. Never hardcode a host in
 * a component.
 *
 * There is no authenticated variant here, and there should not be. This package
 * is the customer-facing storefront: every endpoint it touches is public,
 * because a customer has no account. Staff traffic belongs to `admin/`, which
 * has its own client and its own token handling.
 */
const rawApiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();

export const API_BASE_URL = rawApiBaseUrl.replace(/\/+$/, '');

const isAbsoluteUrl = (value: string) => /^[a-z][a-z\d+\-.]*:\/\//i.test(value);

export const apiUrl = (path: string) => {
  if (!path) return API_BASE_URL || '';
  if (isAbsoluteUrl(path)) return path;
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
};

/**
 * Product and category images are stored as relative paths ("/uploads/x.png")
 * so the hostname is never baked into the database. This puts it back.
 */
export const assetUrl = (path: string | null | undefined) => (path ? apiUrl(path) : '');

/**
 * A failed API call, carrying enough to render something useful.
 *
 * `payload` matters for checkout: a 409 comes back with an `unavailable` array
 * naming the items that ran out, and the cart uses it to mark exactly those
 * rows rather than showing a generic "something went wrong".
 */
export class ApiError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }

  /** True when the caller's credentials are missing, expired or rejected. */
  get isUnauthorized() {
    return this.status === 401 || this.status === 403;
  }

  /** True when the request was fine but the world changed underneath it. */
  get isConflict() {
    return this.status === 409;
  }
}

/** Thrown when the request never reached the server at all. */
export class NetworkError extends Error {
  constructor() {
    super('Could not reach the store. Check your connection and try again.');
    this.name = 'NetworkError';
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

/**
 * How long to wait before deciding the store is not going to answer.
 *
 * There was no timeout at all, and `fetch` has none of its own — a request to a
 * backend that accepts the connection and then stops responding hangs until the
 * browser gives up, which can be minutes. On the storefront that renders as a
 * spinner nobody can get out of. The rider app has had a 15s ceiling since it
 * was written; this matches it rather than inventing a second number.
 */
const TIMEOUT_MS = 15_000;

/** Attempts, not retries: 1 means "try once and give up". */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;

/** Server-side failures that are worth trying again in a moment. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True for a request that can safely be sent twice.
 *
 * Only GET. A retried POST is the bug the backend's `Idempotency-Key` exists to
 * prevent — checkout writes an order and moves stock — and the two mechanisms
 * must not be confused for each other: the key makes a retry the *customer*
 * chooses safe, and this keeps the client from retrying on its own behalf.
 */
const isReplayable = (method: string | undefined) =>
  (method ?? 'GET').toUpperCase() === 'GET';

/**
 * One fetch wrapper for the whole app.
 *
 * Every error the backend can produce is `{"detail": "..."}` (enforced by
 * `api/exceptions.py`), so this reads that one field and throws an `ApiError`.
 * The alternative — checking `response.ok` at forty call sites — is how a
 * failed request ends up rendering as an empty list with no explanation.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);

  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const attempts = isReplayable(rest.method) ? MAX_ATTEMPTS : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await attemptRequest<T>(path, requestHeaders, body, rest);
    } catch (error) {
      lastError = error;

      // The caller cancelled — a changed search query, a navigation. Never a
      // reason to try again, and never a reason to wait.
      if (rest.signal?.aborted) throw error;

      const worthRetrying =
        error instanceof NetworkError ||
        (error instanceof ApiError && RETRYABLE_STATUSES.has(error.status));

      if (!worthRetrying || attempt === attempts) throw error;

      // Exponential, so a store that is briefly overloaded is not hammered by
      // every open tab retrying in lockstep.
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

async function attemptRequest<T>(
  path: string,
  requestHeaders: Headers,
  body: unknown,
  rest: Omit<RequestOptions, 'body' | 'headers'>,
): Promise<T> {
  // Composed rather than replacing the caller's signal: the search overlay
  // aborts its own in-flight request on every keystroke and must keep being
  // able to, while the timeout applies to every request whether the caller
  // thought about it or not.
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = rest.signal ? AbortSignal.any([rest.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...rest,
      signal,
      headers: requestHeaders,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
  } catch (error) {
    // An aborted request is not a network failure — it is this app cancelling
    // its own work because the query changed. Laundering it into a NetworkError
    // means any caller that renders `error.message` without first re-checking
    // `signal.aborted` flashes "Could not reach the store" on every keystroke
    // of the debounced search. Re-throw so the abort stays recognisable.
    //
    // Note this checks the *caller's* signal, not the composed one: a timeout
    // also aborts, and a timeout is exactly the network failure this reports.
    if (rest.signal?.aborted) throw error;
    // fetch() rejects only on a network-level failure; an HTTP 500 resolves.
    throw new NetworkError();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      (payload && typeof payload.detail === 'string' && payload.detail) ||
      `Request failed (${response.status}).`;
    throw new ApiError(detail, response.status, payload ?? {});
  }

  return payload as T;
}

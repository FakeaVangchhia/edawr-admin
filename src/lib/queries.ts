/**
 * Every API call the console makes, named and typed, in one file.
 *
 * Components call these rather than `authRequest('/api/...')` directly, so the
 * set of endpoints this app depends on can be read in one place — which is also
 * the list to check against `backend/api/urls.py` after a backend change.
 */

import { authPage, authRequest, publicRequest, query } from '@/lib/api';
import type {
  AdminAccount,
  AnalyticsSummary,
  AuditEntry,
  CategoryShare,
  Category,
  ConsoleSession,
  CashReconciliation,
  DeliveryPerformance,
  InventoryHealth,
  Order,
  OrderStatus,
  Product,
  RevenuePoint,
  RiderLocation,
  StaffUser,
  StoreConfig,
  StoreSettings,
  TopProduct,
} from '@/types';

/* --- auth ---------------------------------------------------------------- */

interface LoginResponse {
  access_token: string;
  email: string;
  name: string;
  role: ConsoleSession['role'];
}

export async function login(email: string, password: string): Promise<ConsoleSession> {
  const data = await publicRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: { email: email.trim().toLowerCase(), password },
  });
  return {
    email: data.email,
    name: data.name || '',
    role: data.role,
    accessToken: data.access_token,
  };
}

/**
 * Verify a stored token and take a fresh one.
 *
 * `/api/auth/me` re-issues on every call, which is how a working session
 * extends itself. It also returns the *current* role, so an account promoted or
 * demoted since sign-in gets the right navigation on the next page load without
 * having to sign out.
 */
export async function verifySession(): Promise<ConsoleSession> {
  const data = await authRequest<LoginResponse>('/api/auth/me');
  return {
    email: data.email,
    name: data.name || '',
    role: data.role,
    accessToken: data.access_token,
  };
}

/**
 * Retire this account's tokens server-side.
 *
 * Clearing localStorage deletes *our* copy of a credential that keeps working
 * for another twelve hours in anyone else's — a laptop left open in the shop, a
 * token lifted by an XSS, a browser profile on a shared machine. This is what
 * actually ends the session: it increments the account's `token_version`, which
 * every request compares against, so the token stops being accepted at once.
 *
 * Never let it block signing out. A manager tapping "Sign out" on a console
 * whose network has dropped must still be signed out of that browser, and an
 * error here would leave them staring at a screen full of their own data. The
 * local clear happens either way; this is the part that can fail.
 *
 * Note it signs out every device this account is using, which is the documented
 * trade — see the docstring on `AdminUser.token_version`.
 */
export async function endSession(): Promise<void> {
  try {
    await authRequest<void>('/api/auth/logout', { method: 'POST' });
  } catch {
    // Offline, or the token had already expired. Either way there is nothing
    // useful to say and nothing to retry.
  }
}

/* --- products ------------------------------------------------------------ */

export interface ProductFilters {
  q?: string;
  category?: string;
  status?: string;
  stock?: 'low' | 'out' | '';
  limit?: number;
  offset?: number;
}

export function listProducts(filters: ProductFilters = {}, signal?: AbortSignal) {
  return authPage<Product>(`/api/products${query({ ...filters })}`, { signal });
}

export function createProduct(body: Partial<Product>) {
  return authRequest<Product>('/api/products', { method: 'POST', body });
}

/**
 * The only way to edit a product.
 *
 * PATCH writes only the fields sent, under a row lock, so a sale landing while
 * the editor was open is not overwritten. There is deliberately no
 * `replaceProduct` beside it any more: `PUT /api/products/{id}` was removed
 * from the API because a full-row replace writes a stale `stock` back over
 * concurrent decrements — atomically or otherwise. The helper outlived the
 * endpoint by one commit and would have returned 405 to whoever called it next.
 */
export function updateProduct(id: number, body: Partial<Product>) {
  return authRequest<Product>(`/api/products/${id}`, { method: 'PATCH', body });
}

export function deleteProduct(id: number) {
  return authRequest<{ success: boolean }>(`/api/products/${id}`, { method: 'DELETE' });
}

export async function uploadProductImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const data = await authRequest<{ image_url: string }>(
    '/api/uploads/products/image',
    { method: 'POST', body: form },
  );
  return data.image_url;
}

/* --- categories ---------------------------------------------------------- */

/**
 * Categories, paged.
 *
 * `limit: 200` used to be hardcoded with no offset, which is a page-one-only
 * list wearing the clothes of a complete one: `X-Total-Count` reported the true
 * total while the table showed at most 200 rows, so a store past that saw a
 * count it could not reach. `limit` and `offset` are now the caller's, and the
 * default is a screenful.
 */
export function listCategories(
  params: { q?: string; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  return authPage<Category>(`/api/categories${query({ limit: 50, ...params })}`, { signal });
}

export function createCategory(body: Partial<Category>) {
  return authRequest<Category>('/api/categories', { method: 'POST', body });
}

/**
 * The category PUT is **not** partial: an omitted field is reset to its
 * default. Callers must send the whole row, which is what `categoryPutBody`
 * exists to build — omitting `image_url` or `sort_order` silently wipes them.
 */
export function updateCategory(id: number, body: Partial<Category>) {
  return authRequest<Category>(`/api/categories/${id}`, { method: 'PUT', body });
}

export function deleteCategory(id: number) {
  return authRequest<{ success: boolean }>(`/api/categories/${id}`, { method: 'DELETE' });
}

/**
 * Build a complete body for the non-partial category PUT.
 *
 * Every optional field is named explicitly, including the ones the form did not
 * touch. This is the whole reason the function exists: `PUT` applies serializer
 * defaults to anything absent, so a form that edits only the name and posts
 * `{name}` clears the category's image and resets its position in the rail.
 * Nothing errors; the rail just quietly loses its pictures.
 */
export function categoryPutBody(
  category: Category,
  changes: Partial<Category>,
): Record<string, unknown> {
  const merged = { ...category, ...changes };
  return {
    name: merged.name,
    description: merged.description ?? null,
    parent_id: merged.parent_id ?? null,
    image_url: merged.image_url ?? null,
    sort_order: merged.sort_order ?? 0,
    status: merged.status ?? 'active',
  };
}

/* --- orders -------------------------------------------------------------- */

export interface OrderFilters {
  status?: string;
  open?: boolean;
  stalled?: boolean;
  q?: string;
  rider?: number | string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function listOrders(filters: OrderFilters = {}, signal?: AbortSignal) {
  return authPage<Order>(`/api/orders${query({ ...filters })}`, { signal });
}

export function advanceOrder(id: number, status: OrderStatus, reason?: string) {
  return authRequest<Order>(`/api/orders/${id}/status`, {
    method: 'PATCH',
    body: reason ? { status, reason } : { status },
  });
}

export function assignOrder(id: number, riderId: number) {
  return authRequest<Order>(`/api/orders/${id}/assign`, {
    method: 'POST',
    body: { delivery_boy_id: riderId },
  });
}

/**
 * Return a failed delivery's goods to the shelf.
 *
 * The second half of the failed-delivery path, and a separate call on purpose:
 * marking an order Failed records the outcome at the customer's door, and the
 * stock does not come back until the rider does. Idempotent server-side through
 * `restocked_at`, so two managers clicking at once cannot double the inventory
 * — a second call answers 409 rather than adding the units twice.
 */
export function restockOrder(id: number) {
  return authRequest<Order>(`/api/orders/${id}/restock`, { method: 'POST' });
}

/* --- staff --------------------------------------------------------------- */

export function listStaff(
  params: {
    role?: string;
    q?: string;
    active?: string;
    limit?: number;
    offset?: number;
  } = {},
  signal?: AbortSignal,
) {
  return authPage<StaffUser>(`/api/users${query({ limit: 50, ...params })}`, { signal });
}

export function listRiders(signal?: AbortSignal) {
  return authRequest<StaffUser[]>('/api/delivery/riders', { signal });
}

/**
 * Where every active rider is, for the live board.
 *
 * Separate from `listRiders` rather than folded into it, because the two are
 * asked at completely different rates: the roster is a page load, this is a
 * poll. Merging them would make every refresh of a moving map re-fetch names
 * and service radii that change once a month.
 *
 * Returns one row per *active* rider, including riders who have never reported
 * — position null, `is_stale` true. Do not filter those out; see `RiderLocation`.
 */
export function listRiderLocations(signal?: AbortSignal) {
  return authRequest<RiderLocation[]>('/api/delivery/locations', { signal });
}

export function createStaff(body: Partial<StaffUser> & { pin?: string }) {
  return authRequest<StaffUser>('/api/users', { method: 'POST', body });
}

/** The staff PUT *is* partial on the backend, deliberately: a write-only `pin`
 *  cannot be read back, so replace semantics would clear it on every save. */
export function updateStaff(id: number, body: Partial<StaffUser> & { pin?: string }) {
  return authRequest<StaffUser>(`/api/users/${id}`, { method: 'PUT', body });
}

export function deleteStaff(id: number) {
  return authRequest<{ success: boolean; detail?: string }>(`/api/users/${id}`, {
    method: 'DELETE',
  });
}

/* --- console accounts (Admin only) --------------------------------------- */

export function listAccounts(
  params: { q?: string; role?: string; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  return authPage<AdminAccount>(`/api/admins${query({ limit: 50, ...params })}`, { signal });
}

export function createAccount(body: {
  email: string;
  name?: string;
  role: string;
  password: string;
}) {
  return authRequest<AdminAccount>('/api/admins', { method: 'POST', body });
}

export function updateAccount(id: number, body: Partial<AdminAccount> & { password?: string }) {
  return authRequest<AdminAccount>(`/api/admins/${id}`, { method: 'PUT', body });
}

export function deactivateAccount(id: number) {
  return authRequest<{ success: boolean; detail?: string }>(`/api/admins/${id}`, {
    method: 'DELETE',
  });
}

/* --- audit (Admin only) --------------------------------------------------- */

export interface AuditFilters {
  actor?: string;
  entity?: string;
  action?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function listAudit(filters: AuditFilters = {}, signal?: AbortSignal) {
  return authPage<AuditEntry>(`/api/audit${query({ ...filters })}`, { signal });
}

/* --- analytics ------------------------------------------------------------ */

export interface Window {
  from?: string;
  to?: string;
}

export function analyticsSummary(range: Window = {}, signal?: AbortSignal) {
  return authRequest<AnalyticsSummary>(`/api/analytics/summary${query({ ...range })}`, { signal });
}

export function analyticsRevenue(range: Window = {}, signal?: AbortSignal) {
  return authRequest<RevenuePoint[]>(`/api/analytics/revenue${query({ ...range })}`, { signal });
}

export function analyticsProducts(
  range: Window & { limit?: number; direction?: 'top' | 'bottom' } = {},
  signal?: AbortSignal,
) {
  return authRequest<TopProduct[]>(`/api/analytics/products${query({ ...range })}`, { signal });
}

export function analyticsCategories(range: Window = {}, signal?: AbortSignal) {
  return authRequest<CategoryShare[]>(`/api/analytics/categories${query({ ...range })}`, { signal });
}

/**
 * The till: what each rider owes, and where it does not add up.
 *
 * Buckets by when the cash arrived rather than when the order was placed — the
 * one analytics endpoint that does — so an order placed at 23:50 and delivered
 * at 00:05 reconciles against the day the money reached the shop.
 */
export function analyticsCash(range: Window = {}, signal?: AbortSignal) {
  return authRequest<CashReconciliation>(`/api/analytics/cash${query({ ...range })}`, { signal });
}

export function analyticsDelivery(range: Window = {}, signal?: AbortSignal) {
  return authRequest<DeliveryPerformance>(`/api/analytics/delivery${query({ ...range })}`, { signal });
}

/** Stock is a fact about now, so this endpoint takes no date range. */
export function analyticsInventory(signal?: AbortSignal) {
  return authRequest<InventoryHealth>('/api/analytics/inventory', { signal });
}

/* --- store config --------------------------------------------------------- */

export function storeConfig(signal?: AbortSignal) {
  return publicRequest<StoreConfig>('/api/store/config', { signal });
}

/* --- store settings ------------------------------------------------------- */

export function storeSettings(signal?: AbortSignal) {
  return authRequest<StoreSettings>('/api/settings', { signal });
}

/**
 * Change only what was sent.
 *
 * PATCH, and there is no PUT behind it. A full replace would mean the pause
 * switch had to be resent with every edit to the opening hours, and a screen
 * that forgot would silently reopen a store somebody had deliberately shut.
 */
export function updateStoreSettings(body: Partial<StoreSettings>) {
  return authRequest<StoreSettings>('/api/settings', { method: 'PATCH', body });
}

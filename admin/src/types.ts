/**
 * The shapes the Django API returns, mirrored by hand.
 *
 * Deliberately not generated from the OpenAPI schema: the backend serves
 * `/api/schema`, but generating types would tie a build of this app to a
 * running instance of that one, and the two deploy separately. Hand-written
 * types are checked against `backend/api/serializers.py` by reading it.
 *
 * The split that matters most is repeated from the backend and is worth
 * restating: `Product` here is the **admin** shape and carries `cost_price`,
 * supplier details and exact `stock`. The storefront's `StoreProduct` carries
 * none of them. They are two types because they are two audiences, and merging
 * them is how margin data ends up in a customer's browser.
 */

export type Role = 'admin' | 'manager';
export type StaffRole = 'manager' | 'delivery';
export type CatalogueStatus = 'active' | 'inactive';

export type OrderStatus =
  | 'Placed'
  | 'Packing'
  | 'Ready'
  | 'Dispatched'
  | 'Delivered'
  | 'Cancelled'
  /**
   * A delivery that was attempted and did not happen — refused at the door,
   * nobody home, the bike went down.
   *
   * Terminal, and it deliberately does **not** return the stock. When the rider
   * reports it the bag is on a bike somewhere; restocking then would list units
   * the store cannot pick. `POST /api/orders/{id}/restock` is the separate step
   * a manager takes once the goods are physically back on the shelf.
   */
  | 'Failed';

export type DeliveryType = 'instant' | 'slow';

/** The console's own session. Note it carries a role, which the storefront's
 *  `AdminSession` does not — it had nothing to gate on. */
export interface ConsoleSession {
  email: string;
  name: string;
  role: Role;
  accessToken: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** A free-text label, not a foreign key to Category. Renaming a category
   *  updates these in the same transaction — see the backend's category PUT. */
  category: string | null;
  brand: string | null;
  unit: string | null;
  price: number;
  cost_price: number;
  mrp: number;
  stock: number;
  reorder_level: number;
  status: CatalogueStatus;
  location: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  description: string | null;
  image_url: string | null;
  discount_percent: number;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  image_url: string | null;
  sort_order: number;
  status: CatalogueStatus;
  created_at?: string;
}

export interface OrderItem {
  id: number;
  product_id: number | null;
  quantity: number;
  name: string;
  price: number;
  mrp: number;
  unit: string | null;
  image_url: string | null;
  line_total: number;
}

export interface RiderSummary {
  id: number;
  name: string;
  phone: string;
}

export interface Order {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_landmark: string | null;
  customer_latitude: number | null;
  customer_longitude: number | null;
  delivery_notes: string | null;
  status: OrderStatus;
  status_label: string;
  cancellation_reason: string | null;
  items_total: number;
  delivery_fee: number;
  handling_fee: number;
  grand_total: number;
  payment_method: string;
  delivery_type: DeliveryType;
  delivery_type_label: string;
  promised_minutes: number;
  promised_at: string;
  minutes_remaining: number;
  is_late: boolean;
  fulfilment_minutes: number | null;
  delivery_boy_id: number | null;
  rider: RiderSummary | null;
  items: OrderItem[];
  created_at: string;
  packed_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  /**
   * When a failed delivery's goods were returned to the shelf. `null` means
   * they have not been — which for a Failed order is the manager's next action.
   */
  restocked_at: string | null;
}

/** Store staff: managers and riders. A different table from console accounts. */
export interface StaffUser {
  id: number;
  name: string;
  role: StaffRole;
  phone: string;
  is_active: boolean;
  is_available: boolean;
  base_latitude?: number;
  base_longitude?: number;
  service_radius_km?: number;
  created_at?: string;
}

/** A console login. Only an Admin may read or write these. */
export interface AdminAccount {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AuditEntry {
  id: number;
  actor_kind: 'admin' | 'rider' | 'system';
  actor_id: number | null;
  actor_label: string;
  actor_role: string;
  action: 'create' | 'update' | 'delete' | 'login' | 'status' | 'assign' | 'cancel';
  action_label: string;
  entity: string;
  entity_id: number | null;
  summary: string;
  changes: Record<string, [string | null, string | null]> | null;
  created_at: string;
}

/* --- analytics ---------------------------------------------------------- */

/** A headline figure beside the same figure for the preceding period. The
 *  comparison comes from the server so two screens cannot define "previous"
 *  differently. */
export interface Metric {
  value: number;
  previous: number;
}

export interface AnalyticsSummary {
  revenue: Metric;
  orders: Metric;
  average_order_value: Metric;
  on_time_rate: Metric;
  cancellation_rate: Metric;
  from_date: string;
  to_date: string;
}

export interface RevenuePoint {
  date: string;
  revenue: number;
  orders: number;
}

export interface TopProduct {
  product_id: number | null;
  name: string;
  units: number;
  revenue: number;
}

export interface CategoryShare {
  category: string;
  units: number;
  revenue: number;
}

export interface RiderPerformance {
  rider_id: number;
  name: string;
  delivered: number;
  late: number;
  average_minutes: number | null;
}

export interface DeliveryPerformance {
  delivered: number;
  late: number;
  on_time_rate: number;
  average_minutes: number | null;
  riders: RiderPerformance[];
}

export interface InventoryHealth {
  total_products: number;
  active_products: number;
  out_of_stock: number;
  low_stock: number;
  stock_units: number;
  stock_value: number;
  items: TopProduct[];
}

export interface StoreConfig {
  store_name: string;
  store_city: string;
  free_delivery_above: number;
  handling_fee: number;
  min_order_value: number;
  default_delivery_type: DeliveryType;
  delivery_tiers: {
    type: DeliveryType;
    label: string;
    fee: number;
    promise_minutes: number;
  }[];
}

/**
 * The operational settings, read and written by /settings.
 *
 * Separate from `StoreConfig`, which is the public read-only shape the
 * storefront gets. These are the four things a manager changes during a shift,
 * and the reason /settings stopped being read-only: they live in a database
 * table rather than in environment variables precisely so changing them does
 * not need a deploy.
 */
export interface StoreSettings {
  /** The kill switch. Independent of the hours — a shop inside its opening
   *  hours can still be shut for a stock-take or a power cut. */
  is_accepting_orders: boolean;
  /** Shown to the customer verbatim when checkout is off. Blank falls back to a
   *  generic sentence, so "back in 20 minutes" is possible. */
  closed_message: string;
  /** Local wall clock at the store, `HH:MM:SS`. Equal values mean always open. */
  opens_at: string;
  closes_at: string;
  delivery_radius_km: number;
  store_latitude: number;
  store_longitude: number;
  updated_at: string;
}

/** A list response plus the total from the `X-Total-Count` header. The body
 *  itself is always a bare array — the API has no pagination envelope, and
 *  three clients depend on that. */
export interface Page<T> {
  rows: T[];
  total: number;
}

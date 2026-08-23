/**
 * Shapes returned by the Django API.
 *
 * These are hand-written rather than generated, so the rule is: if you change a
 * serializer in `backend/api/serializers.py`, change the matching type here in
 * the same commit. The `StoreProduct` / `Product` split is the one that matters
 * most — it mirrors two different serializers on purpose, and the storefront
 * must never be handed the admin shape.
 */

/** The admin view of a product: includes margin and supplier data. */
export interface Product {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string | null;
  price: number;
  cost_price: number;
  mrp: number;
  stock: number;
  reorder_level: number;
  status: string;
  location: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  description: string | null;
  image_url: string | null;
  discount_percent: number;
  created_at: string;
}

/**
 * The public view of a product. Deliberately narrower: no cost price, no
 * supplier, no shelf location, and stock reduced to two booleans so the exact
 * inventory level is not published to competitors.
 */
export interface StoreProduct {
  id: number;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string | null;
  price: number;
  mrp: number;
  description: string | null;
  image_url: string | null;
  in_stock: boolean;
  low_stock: boolean;
  discount_percent: number;
}

export interface StoreCategory {
  name: string;
  image_url: string | null;
  product_count: number;
}

/** Which delivery speed an order is on. Matches `Order.DELIVERY_TYPE_CHOICES`. */
export type DeliveryType = 'instant' | 'slow';

/**
 * One delivery speed, priced by the server.
 *
 * `fee` is here so the picker can show what each option costs without doing
 * arithmetic — the same reason `/api/store/quote` exists.
 */
export interface DeliveryTier {
  key: DeliveryType;
  label: string;
  fee: number;
  promise_minutes: number;
}

/** The store's own rules, so no fee or promise is hardcoded in the UI. */
export interface StoreConfig {
  store_name: string;
  store_city: string;
  /** Fastest first. */
  delivery_tiers: DeliveryTier[];
  free_delivery_above: number;
  handling_fee: number;
  min_order_value: number;
  /** The default tier's window — what the store promises when nobody has chosen. */
  promise_minutes: number;
  /** The default tier's fee. Prefer reading `delivery_tiers`. */
  delivery_fee: number;

  /**
   * Whether the shop will take an order right now — opening hours *and* the
   * manager's pause switch, resolved server-side into one boolean.
   *
   * Read this before the address form, not after it. The alternative is
   * collecting a basket and a delivery address and only then refusing, which is
   * the worst moment to tell someone you are closed.
   */
  is_open: boolean;
  /**
   * Why not, in a sentence written for a customer. Empty when open.
   *
   * The same string `POST /api/store/orders` would refuse with, produced by the
   * same server method — so the message on the cart and the message at checkout
   * cannot disagree.
   */
  closed_reason: string;
  /** Local wall clock at the store, `HH:MM:SS`. */
  opens_at: string;
  closes_at: string;

  /** How far the store delivers, and from where. */
  delivery_radius_km: number;
  store_latitude: number;
  store_longitude: number;
}

/** One priced row of a quoted basket, as the server computed it. */
export interface BasketQuoteLine {
  product_id: number;
  name: string;
  quantity: number;
  price: number;
  /**
   * `price × quantity`, quantised server-side.
   *
   * The reason this field exists: without it the cart had nowhere to get a row
   * total from and multiplied in TypeScript, which is the second pricing engine
   * the whole design forbids. Render this; never compute it.
   */
  line_total: number;
}

export interface UnavailableItem {
  product_id: number;
  name: string;
  reason: string;
  available: number;
}

/** What a basket would cost. Always computed by the server. */
export interface BasketQuote {
  items_total: number;
  delivery_fee: number;
  handling_fee: number;
  grand_total: number;
  free_delivery_shortfall: number;
  meets_minimum: boolean;
  unavailable: UnavailableItem[];
  /** Per-row totals, so no client multiplies a price by a quantity. */
  lines: BasketQuoteLine[];
  /**
   * The tier this bill was actually priced at, echoed back.
   *
   * Read this rather than the UI's own selection when showing the customer
   * what they are about to pay for: if a request is dropped or lands out of
   * order, this is what makes the mismatch visible instead of showing one
   * tier's ETA above another tier's total.
   */
  delivery_type: DeliveryType;
  promised_minutes: number;
}

/**
 * Mirrors `Order.STATUS_CHOICES` on the server, `Failed` included.
 *
 * `Failed` is what a rider reports when the bag never reached the customer —
 * nobody at the address, a refused delivery, a stolen bike. It is terminal and
 * it restocks nothing on its own. Leaving it out of this union does not stop
 * the server sending it; it only stops the storefront recognising it, which
 * shows the customer an order still cheerfully on its way.
 */
export type OrderStatus =
  | 'Placed'
  | 'Packing'
  | 'Ready'
  | 'Dispatched'
  | 'Delivered'
  | 'Cancelled'
  | 'Failed';

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
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

/** What the customer sees on the tracking page. */
export interface TrackedOrder {
  id: number;
  tracking_token: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_landmark: string | null;
  delivery_notes: string | null;
  status: OrderStatus;
  status_label: string;
  cancellation_reason: string | null;
  can_cancel: boolean;
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
  created_at: string;
  packed_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  rider: RiderSummary | null;
  items: OrderItem[];
}

/** The full internal view, for the admin console. */
export interface Order extends Omit<TrackedOrder, 'rider' | 'can_cancel'> {
  /** Null when the customer did not share a position. Never the store's own. */
  customer_latitude: number | null;
  customer_longitude: number | null;
  delivery_boy_id: number | null;
  offered_distance_km: number | null;
  fulfilment_minutes: number | null;
  rider: RiderSummary | null;
}

export type Role = 'manager' | 'delivery';

export interface User {
  id: number;
  name: string;
  role: Role;
  phone: string;
  is_active: boolean;
  is_available: boolean;
  base_latitude?: number;
  base_longitude?: number;
  service_radius_km?: number;
  created_at?: string;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  image_url: string | null;
  sort_order: number;
  status: string;
  created_at?: string;
}

export interface AdminSession {
  username: string;
  accessToken: string;
}

/** One line in the basket: the product, plus how many of it. */
export interface CartLine {
  product: StoreProduct;
  quantity: number;
}

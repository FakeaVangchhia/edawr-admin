/**
 * Shapes returned by the Django API, mirroring `backend/api/serializers.py`.
 *
 * Change a serializer there, change this in the same commit — there is no code
 * generation keeping them in step.
 */

export interface User {
  id: number;
  name: string;
  role: 'manager' | 'delivery';
  phone: string;
  is_active: boolean;
  is_available: boolean;
  base_latitude: number;
  base_longitude: number;
  service_radius_km: number;
}

/** What POST /api/auth/rider/login and GET /api/auth/rider/me return. */
export interface RiderSession {
  access_token: string;
  token_type: string;
  rider: User;
}

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

/**
 * The six order states. A rider only ever sees three of them:
 *   Ready      — packed and waiting for someone to take it (the feed)
 *   Dispatched — in this rider's hands (the active job)
 *   Delivered  — done (history)
 * `Placed`, `Packing` and `Cancelled` appear in the type because the API can
 * return them, not because the app has a screen for them.
 */
export type OrderStatus =
  | 'Placed'
  | 'Packing'
  | 'Ready'
  | 'Dispatched'
  | 'Delivered'
  | 'Cancelled'
  /** Attempted and did not happen. Terminal, and it returns no stock by itself
   *  — the bag is with the rider until they bring it back to the shop. */
  | 'Failed';

/**
 * The three moves a rider may make on an order they are carrying.
 *
 * Mirrors `RIDER_TARGETS` in backend/api/views/orders.py, and the backend
 * re-checks it — this narrows what the app can express, not what is allowed.
 *
 *   Delivered  it arrived
 *   Ready      hand it back to the pool for someone else
 *   Failed     it was attempted and did not happen
 */
export type RiderStatus = Extract<OrderStatus, 'Delivered' | 'Ready' | 'Failed'>;

export interface RiderSummary {
  id: number;
  name: string;
  phone: string;
}

export interface Order {
  id: number;
  tracking_token: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_landmark: string | null;
  delivery_notes: string | null;
  /**
   * Null when the customer declined geolocation at checkout, which is a
   * supported outcome rather than an error — `Order.customer_latitude` is
   * `null=True` with no default precisely so that an order with no position is
   * not recorded as standing at the store counter.
   *
   * Typed as non-null, this invited arithmetic on a null: `toFixed` on a
   * missing coordinate, or a distance computed from one, with the compiler
   * agreeing it was safe.
   */
  customer_latitude: number | null;
  customer_longitude: number | null;
  status: OrderStatus;
  status_label: string;
  cancellation_reason: string | null;

  items_total: number;
  delivery_fee: number;
  handling_fee: number;
  /** What the rider collects at the door — this is a cash-on-delivery store. */
  grand_total: number;
  payment_method: string;

  promised_minutes: number;
  promised_at: string;
  /** Counts down to the delivery promise; 0 once it has run out. */
  minutes_remaining: number;
  is_late: boolean;
  fulfilment_minutes: number | null;

  delivery_boy_id: number | null;
  offered_to_delivery_boy_id: number | null;
  rider: RiderSummary | null;
  offered_distance_km: number | null;

  created_at: string;
  packed_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;

  items: OrderItem[];
}

export interface DeliveryDashboard {
  incoming_orders: Order[];
  active_order: Order | null;
  recent_orders: Order[];
  /** The rider's own on/off switch, echoed back so the toggle reflects truth. */
  is_available: boolean;
}

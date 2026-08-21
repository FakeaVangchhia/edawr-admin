/**
 * Capturing the customer's position at checkout, and never insisting on it.
 *
 * The order rows have carried `customer_latitude`/`longitude` since the first
 * schema and the storefront never sent them, so the server applied its defaults
 * — which were the *store's own coordinates*. Every order was therefore recorded
 * as 0.00 km from every rider: the service-radius filter matched everyone,
 * "nearest first" degenerated to ordering by id, and the rider app displayed a
 * confident, false `0.0 km` on the offer card.
 *
 * Two rules shape everything here:
 *
 * **It is opt-in and it never blocks.** Reading a position shows a browser
 * permission prompt. Someone who dismisses it, or whose device cannot get a fix
 * indoors, still typed an address a rider can read — turning them away would
 * cost a real order to improve a routing hint. Every failure path here resolves
 * to `null` rather than rejecting.
 *
 * **The distance check here is advice, not enforcement.** `api/checkout.py`
 * refuses an out-of-area address regardless of what this file concluded; this
 * exists so the customer finds out on the address form instead of after filling
 * in the whole thing. Same reasoning as the quote endpoint, and the opposite of
 * the money rule: a *warning* computed on the client is a convenience, whereas a
 * *price* computed on the client is a second pricing engine.
 */

/** Earth's mean radius. The same constant `api/dispatch.py` uses. */
const EARTH_RADIUS_KM = 6371.0;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Why a position could not be read, phrased for a customer rather than a log. */
export type GeolocationFailure =
  | 'unsupported'
  | 'denied'
  | 'unavailable'
  | 'timeout';

export interface GeolocationResult {
  coords: Coordinates | null;
  failure: GeolocationFailure | null;
}

export const GEOLOCATION_MESSAGES: Record<GeolocationFailure, string> = {
  unsupported: 'This browser cannot share a location. Your address is enough.',
  denied: 'Location is off for this site. Your typed address is enough.',
  unavailable: 'We could not get a fix just now. Your typed address is enough.',
  timeout: 'That took too long. Your typed address is enough.',
};

/**
 * Ask the browser where the customer is.
 *
 * Resolves rather than rejects on every failure, because none of them is an
 * error the customer has to act on — the address field is the real input and
 * this is a hint layered on top of it.
 *
 * `timeout` is 10s and `maximumAge` allows a 60s-old fix: a fresh GPS lock can
 * take a long while indoors, and a position from a minute ago is easily precise
 * enough to decide which side of an 8 km radius someone is on.
 */
export function requestPosition(timeoutMs = 10_000): Promise<GeolocationResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ coords: null, failure: 'unsupported' });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          failure: null,
        }),
      (error) => resolve({ coords: null, failure: describe(error) }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

function describe(error: GeolocationPositionError): GeolocationFailure {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'denied';
    case error.TIMEOUT:
      return 'timeout';
    default:
      return 'unavailable';
  }
}

/**
 * Great-circle distance in kilometres.
 *
 * Straight-line, not travel distance. Aizawl is built on ridges, so the road
 * between two points can be several times this — which is why it decides only
 * whether an address is *plausibly* inside the delivery area, and is never shown
 * to anyone as a journey length.
 */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface DeliveryArea {
  store_latitude: number;
  store_longitude: number;
  delivery_radius_km: number;
}

/**
 * Whether a captured position is inside the store's delivery area.
 *
 * `null` means "no opinion" — either nothing was captured, or the store config
 * has not arrived yet. The caller must treat that as *allowed*, never as
 * refused: an unknown position is a supported way to order, and a config
 * request that is still in flight must not block a checkout.
 */
export function isDeliverable(
  coords: Coordinates | null,
  area: DeliveryArea | null | undefined,
): boolean | null {
  if (!coords || !area) return null;

  const distance = haversineKm(
    { latitude: area.store_latitude, longitude: area.store_longitude },
    coords,
  );
  return distance <= area.delivery_radius_km;
}

/** How far a position is from the store, rounded for display. `null` if unknown. */
export function distanceFromStore(
  coords: Coordinates | null,
  area: DeliveryArea | null | undefined,
): number | null {
  if (!coords || !area) return null;

  return (
    Math.round(
      haversineKm(
        { latitude: area.store_latitude, longitude: area.store_longitude },
        coords,
      ) * 10,
    ) / 10
  );
}

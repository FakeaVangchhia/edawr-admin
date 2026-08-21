import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  distanceFromStore,
  haversineKm,
  isDeliverable,
  requestPosition,
  type Coordinates,
} from './geolocation';

/**
 * The delivery-area check the customer sees before they fill in a form.
 *
 * The server refuses an out-of-area address regardless of what this concludes,
 * so none of it is a security boundary. What it has to get right is the
 * *third* state: an unknown position must read as "no opinion", never as
 * "refused" — geolocation is opt-in, and a customer who declines the browser
 * prompt still typed an address a rider can read.
 */

const STORE: Coordinates = { latitude: 23.7272, longitude: 92.7178 };
const AREA = { store_latitude: 23.7272, store_longitude: 92.7178, delivery_radius_km: 8 };

describe('haversineKm', () => {
  it('is zero for a point measured against itself', () => {
    expect(haversineKm(STORE, STORE)).toBe(0);
  });

  it('is symmetric', () => {
    const elsewhere = { latitude: 23.75, longitude: 92.73 };
    expect(haversineKm(STORE, elsewhere)).toBeCloseTo(haversineKm(elsewhere, STORE), 10);
  });

  it('matches a known separation', () => {
    // Aizawl to Mumbai, roughly 2,000 km. Loose tolerance on purpose: this
    // asserts the formula is not out by a factor, not that it is a survey.
    const mumbai = { latitude: 19.076, longitude: 72.8777 };
    expect(haversineKm(STORE, mumbai)).toBeGreaterThan(1900);
    expect(haversineKm(STORE, mumbai)).toBeLessThan(2200);
  });

  it('measures a degree of latitude at about 111 km', () => {
    expect(haversineKm(STORE, { ...STORE, latitude: STORE.latitude + 1 })).toBeCloseTo(
      111.2,
      0,
    );
  });
});

describe('isDeliverable', () => {
  it('accepts a point inside the radius', () => {
    expect(isDeliverable({ latitude: 23.73, longitude: 92.72 }, AREA)).toBe(true);
  });

  it('refuses a point outside it', () => {
    expect(isDeliverable({ latitude: 19.076, longitude: 72.8777 }, AREA)).toBe(false);
  });

  it('treats the boundary itself as inside', () => {
    // One degree of latitude is ~111 km, so 8/111 degrees is the edge.
    const edge = { latitude: STORE.latitude + 8 / 111.2, longitude: STORE.longitude };
    expect(isDeliverable(edge, AREA)).toBe(true);
  });

  it('has no opinion when nothing was captured', () => {
    // Not `false`. An unshared position is a supported way to order, and a
    // caller that read this as a refusal would block every customer who
    // dismissed the browser prompt.
    expect(isDeliverable(null, AREA)).toBeNull();
  });

  it('has no opinion while the store config is still loading', () => {
    expect(isDeliverable({ latitude: 23.73, longitude: 92.72 }, null)).toBeNull();
    expect(isDeliverable({ latitude: 23.73, longitude: 92.72 }, undefined)).toBeNull();
  });

  it('follows the radius rather than a hardcoded one', () => {
    const far = { latitude: 23.8, longitude: 92.8 };
    expect(isDeliverable(far, AREA)).toBe(false);
    expect(isDeliverable(far, { ...AREA, delivery_radius_km: 50 })).toBe(true);
  });
});

describe('distanceFromStore', () => {
  it('rounds to one decimal for display', () => {
    const distance = distanceFromStore({ latitude: 23.8, longitude: 92.8 }, AREA);
    expect(distance).not.toBeNull();
    expect(distance).toBe(Math.round(distance! * 10) / 10);
  });

  it('is null when there is nothing to measure', () => {
    expect(distanceFromStore(null, AREA)).toBeNull();
    expect(distanceFromStore({ latitude: 23.73, longitude: 92.72 }, null)).toBeNull();
  });
});

describe('requestPosition', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported rather than throwing when there is no geolocation', async () => {
    vi.stubGlobal('navigator', {});

    await expect(requestPosition()).resolves.toEqual({
      coords: null,
      failure: 'unsupported',
    });
  });

  it('returns the coordinates on success', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (onSuccess: PositionCallback) =>
          onSuccess({
            coords: { latitude: 23.73, longitude: 92.72 },
          } as GeolocationPosition),
      },
    });

    await expect(requestPosition()).resolves.toEqual({
      coords: { latitude: 23.73, longitude: 92.72 },
      failure: null,
    });
  });

  it('resolves, never rejects, when permission is denied', async () => {
    // The whole contract of this function. A rejection here would have to be
    // caught at every call site, and the one that forgot would surface a
    // browser permission prompt as a failed checkout.
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: PositionCallback, onError: PositionErrorCallback) =>
          onError({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError),
      },
    });

    await expect(requestPosition()).resolves.toEqual({
      coords: null,
      failure: 'denied',
    });
  });

  it('distinguishes a timeout from a refusal', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: PositionCallback, onError: PositionErrorCallback) =>
          onError({ code: 3, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError),
      },
    });

    await expect(requestPosition()).resolves.toEqual({
      coords: null,
      failure: 'timeout',
    });
  });

  it('falls back to unavailable for an unrecognised error code', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: PositionCallback, onError: PositionErrorCallback) =>
          onError({ code: 2, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError),
      },
    });

    await expect(requestPosition()).resolves.toEqual({
      coords: null,
      failure: 'unavailable',
    });
  });
});

/**
 * The customer account's own endpoints, typed.
 *
 * Mirrors `store-api.ts`, which does the same for the public storefront. Every
 * call here goes through `authRequest` and therefore carries the bearer token —
 * with two exceptions at the top, sign-up and sign-in, which are how you get
 * one in the first place and so use plain `request`.
 *
 * The server's response shape is `{access_token, token_type, customer}` for
 * anything that mints a session. `toSession` is the one place that turns it
 * into the shape `session.ts` stores, so a field added on the server is renamed
 * here rather than in four components.
 */

import { authRequest, request } from './api';
import type { CustomerSession } from './session';
import type { TrackedOrder } from '@/types';

interface CustomerPayload {
  id: number;
  phone: string;
  name: string;
  phone_verified: boolean;
  created_at: string;
}

interface TokenPayload {
  access_token: string;
  token_type: string;
  customer: CustomerPayload;
}

function toSession(payload: TokenPayload): CustomerSession {
  return {
    accessToken: payload.access_token,
    id: payload.customer.id,
    phone: payload.customer.phone,
    name: payload.customer.name || '',
    phoneVerified: payload.customer.phone_verified,
  };
}

export interface SignUpDetails {
  phone: string;
  password: string;
  name?: string;
  /**
   * The tracking token of an order the customer is holding — set when signing
   * up straight after checkout, so the account does not open on an empty list.
   * The server links exactly that one order, and possession of the token is
   * what authorises it.
   */
  claimToken?: string;
}

export async function signUp(details: SignUpDetails): Promise<CustomerSession> {
  const payload = await request<TokenPayload>('/api/auth/customer/signup', {
    method: 'POST',
    body: {
      phone: details.phone,
      password: details.password,
      name: details.name ?? '',
      claim_token: details.claimToken ?? '',
    },
  });
  return toSession(payload);
}

export async function signIn(phone: string, password: string): Promise<CustomerSession> {
  const payload = await request<TokenPayload>('/api/auth/customer/login', {
    method: 'POST',
    body: { phone, password },
  });
  return toSession(payload);
}

/**
 * Validate a stored token and take a fresh one.
 *
 * The server mints a new token on every call, which is how a session that is
 * used stays alive — and how one that has been retired is discovered. A 401
 * here is handled by the interceptor in `api.ts`, which clears the session.
 */
export async function refreshSession(): Promise<CustomerSession> {
  const payload = await authRequest<TokenPayload>('/api/auth/customer/me');
  return toSession(payload);
}

export async function updateName(name: string): Promise<CustomerPayload> {
  return authRequest<CustomerPayload>('/api/auth/customer/me', {
    method: 'PATCH',
    body: { name },
  });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<CustomerSession> {
  const payload = await authRequest<TokenPayload>('/api/auth/customer/password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  });
  // A password change retires every existing token, including the one that
  // just made this request. The replacement keeps *this* device signed in.
  return toSession(payload);
}

/**
 * Sign out on the server, retiring the token on every device.
 *
 * Deliberately swallows its failure. The caller clears the local session
 * whatever happens: someone tapping sign-out on a phone with no signal must
 * still end up signed out of that phone.
 */
export async function signOut(): Promise<void> {
  try {
    await authRequest<void>('/api/auth/customer/logout', { method: 'POST' });
  } catch {
    // Nothing to do and nothing worth saying.
  }
}

export function fetchMyOrders(signal?: AbortSignal): Promise<TrackedOrder[]> {
  return authRequest<TrackedOrder[]>('/api/customer/orders', { signal });
}

/**
 * Attach an order this browser is holding a token for to the account.
 *
 * The token is the evidence — it is already the whole credential for the public
 * tracking page — so this works without a verified phone number.
 */
export function claimOrder(trackingToken: string): Promise<TrackedOrder> {
  return authRequest<TrackedOrder>('/api/customer/orders/claim', {
    method: 'POST',
    body: { tracking_token: trackingToken },
  });
}

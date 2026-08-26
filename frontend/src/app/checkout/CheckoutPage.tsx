'use client';

/* eslint-disable @next/next/no-img-element -- Product and category images are
   served by the Django backend, and its hostname is only known at runtime from
   NEXT_PUBLIC_API_URL. next/image needs `remotePatterns` configured at build
   time, which would mean baking the API host into the bundle — the one thing
   `lib/api.ts` exists to avoid. Plain <img> it is. */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Banknote, Check, Crosshair, Loader2, MapPin, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, assetUrl } from '@/lib/api';
import { addAddress, selectAddress, selectedAddress, toDeliveryAddress } from '@/lib/addresses';
import { clearCart } from '@/lib/cart-store';
import { DEFAULT_DELIVERY_TYPE } from '@/lib/delivery';
import { formatMoney } from '@/lib/format';
import {
  GEOLOCATION_MESSAGES,
  distanceFromStore,
  isDeliverable,
  requestPosition,
  type Coordinates,
} from '@/lib/geolocation';
import { clearCheckoutAttempt } from '@/lib/checkout-attempt';
import { saveProfile } from '@/lib/profile';
import { recentOrdersArePersisted, rememberOrder } from '@/lib/recent-orders';
import { placeOrder } from '@/lib/store-api';
import { isValidAddress, isValidIndianMobile, isValidName } from '@/lib/validation';
import {
  BillLines,
  DeliveryTierPicker,
  MinimumOrderNotice,
} from '@/components/BasketSummary';
import { ImageFallback } from '@/components/ProductCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useAddressBook, useCart, useProfile, useSession, useStoreConfig } from '@/hooks/useStoreData';
import { signUp } from '@/lib/customer-api';
import { PASSWORD_HINT, passwordProblem } from '@/lib/password';
import { saveSession } from '@/lib/session';
import { useDraft } from '@/hooks/useDraft';
import { useQuote } from '@/hooks/useQuote';
import { cn } from '@/lib/utils';
import type { DeliveryType, UnavailableItem } from '@/types';

/**
 * Confirm and place the order.
 *
 * Two things this page deliberately does not do:
 *
 * **It sends no money.** The request body carries product ids, quantities, the
 * customer's details and a tier key — no price, no fee, no total. The server
 * computes every figure from its own catalogue. A checkout that posted a total
 * would be a checkout where the customer names their own price.
 *
 * **It offers no payment methods it cannot honour.** `Order.PAYMENT_CHOICES` is
 * cash on delivery and nothing else, so that is the only option shown. The
 * prototype's UPI and card tiles were buttons wired to nothing.
 */

interface FieldErrors {
  name?: string;
  phone?: string;
  address?: string;
  signupPassword?: string;
}

/**
 * `+919812345678` as `9812345678`, for a field a customer types by hand.
 *
 * The account stores the normalised form; the server normalises whatever comes
 * back, so showing the local ten digits costs nothing and reads like a phone
 * number rather than like a database row.
 */
function localPhone(stored: string | undefined): string {
  if (!stored) return '';
  const digits = stored.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function CheckoutPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { lines, hydrated } = useCart();
  const config = useStoreConfig();
  const book = useAddressBook();
  const profile = useProfile();
  const session = useSession();

  // The tier is carried from the cart so the customer is not silently moved to
  // a different speed — and re-validated, because a URL is user input.
  const requested = params.get('tier');
  const initialTier: DeliveryType =
    requested === 'instant' || requested === 'slow' ? requested : DEFAULT_DELIVERY_TYPE;

  // The address book and the profile are both localStorage-backed, so both are
  // empty on the first render and real one tick later. Every field seeded from
  // them is therefore *derived* from them — `useState(profile.name)` captured
  // the empty value and never let go of it, which is why the remembered name
  // and number never appeared here.
  const saved = selectedAddress(book);
  const savedAddress = saved ? toDeliveryAddress(saved) : '';
  const savedLandmark = saved?.landmark ?? '';

  const [deliveryType, setDeliveryType] = useState<DeliveryType>(initialTier);
  // The account first, the device-local profile second. `useDraft` is built
  // for exactly this — a source that arrives a tick after the first render —
  // so a signed-in customer sees their own details rather than two blank
  // boxes followed by a flash of them.
  const [name, setName] = useDraft(session?.name || profile.name);
  const [phone, setPhone] = useDraft(localPhone(session?.phone) || profile.phone);

  // The optional account offer, shown only to a guest. Unchecked by default:
  // an untouched box is a guest order with zero extra keystrokes, which is
  // the whole point of leaving checkout open to people without accounts.
  const [wantsAccount, setWantsAccount] = useState(false);
  const [signupPassword, setSignupPassword] = useState('');
  const [address, setAddress, resetAddress] = useDraft(savedAddress);
  const [landmark, setLandmark, resetLandmark] = useDraft(savedLandmark);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isPlacing, setIsPlacing] = useState(false);
  const [failure, setFailure] = useState('');
  const [unavailable, setUnavailable] = useState<UnavailableItem[]>([]);

  // The customer's position, if they chose to share it. `null` is a supported
  // final state, not a pending one — see lib/geolocation.ts.
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationNote, setLocationNote] = useState('');

  // Guards the state writes after `await placeOrder`. The 409 path calls
  // `setUnavailable` and `setFailure` after a round trip the customer may have
  // navigated away from, and React drops those writes on an unmounted tree —
  // taking the backend's actual sentence ("Some items are no longer available:
  // Amul Taaza Milk.") with them.
  const mounted = useRef(true);

  // Flips on unmount, and every state write after an `await` below is guarded by
  // it. Declared above the early returns because hooks cannot be conditional.
  //
  // `mounted` starts true rather than being set in the effect: React 19 in
  // StrictMode mounts, unmounts and remounts, and an effect that only ever sets
  // `true` on mount would leave the ref false through the second render.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { quote, isLoading, error } = useQuote(lines, deliveryType);

  const outsideArea = isDeliverable(coords, config) === false;
  const distanceKm = distanceFromStore(coords, config);
  // `is_open` is false while the shop is shut or a manager has paused orders.
  // Checked here as well as on the cart because a customer can sit on this page
  // through a closing time, and because the server will refuse anyway — this is
  // what stops them finding that out after filling in the whole form.
  const storeClosed = config ? !config.is_open : false;

  if (!hydrated) return <CheckoutSkeleton />;

  if (lines.length === 0) {
    return (
      <div className="container-page py-20 text-center lg:py-28">
        <h1 className="text-2xl font-semibold">Nothing to check out</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your basket is empty, so there is no order to place yet.
        </p>
        <Link
          href="/products"
          className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
        >
          Start shopping
        </Link>
      </div>
    );
  }

  // True once the customer has taken the field over, which is tracked rather
  // than inferred from emptiness. Falling back whenever the box was empty meant
  // a saved address could not be cleared: deleting the last character refilled
  // it, so anyone delivering somewhere else had to leave a stray character in.
  const addressOverridden = address !== savedAddress;

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (!isValidName(name)) {
      next.name = 'Enter the name the rider should ask for.';
    }
    if (!isValidIndianMobile(phone)) {
      next.phone = 'Enter a 10-digit mobile number, like 98123 45678.';
    }
    if (!isValidAddress(address)) {
      next.address = 'Enter a full address a rider could actually find.';
    }
    // Only when the box is ticked. An untouched offer must never be able to
    // block an order — that is the difference between an option and a wall.
    if (wantsAccount && !session) {
      const problem = passwordProblem(signupPassword, phone);
      if (problem) next.signupPassword = problem;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const locate = async () => {
    if (isLocating) return;
    setIsLocating(true);
    setLocationNote('');

    const { coords: found, failure: why } = await requestPosition();
    if (!mounted.current) return;

    if (found) {
      setCoords(found);
      setLocationNote('');
    } else if (why) {
      // Never an error state. The address field is the real input and this is a
      // hint layered on it, so the copy says so rather than demanding a retry.
      setLocationNote(GEOLOCATION_MESSAGES[why]);
    }
    setIsLocating(false);
  };

  const submit = async () => {
    if (isPlacing) return;
    setFailure('');
    setUnavailable([]);
    if (!validate()) return;

    setIsPlacing(true);
    try {
      const order = await placeOrder(
        lines,
        {
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          customer_address: address.trim(),
          customer_landmark: landmark.trim(),
          delivery_notes: notes.trim(),
          // Sent as a pair or not at all: the server rejects half a position,
          // because latitude without longitude is a client bug rather than a
          // partial answer.
          ...(coords
            ? {
                customer_latitude: coords.latitude,
                customer_longitude: coords.longitude,
              }
            : {}),
        },
        deliveryType,
      );

      // Remember the token before anything else: it is handed over exactly once
      // and there is no account to find the order behind if it is lost.
      rememberOrder({
        token: order.tracking_token,
        orderId: order.id,
        placedAt: order.created_at,
        total: order.grand_total,
        itemCount: order.items.length,
      });
      saveProfile({ name: name.trim(), phone: phone.trim() });

      // **The account is created after the order, and cannot fail it.** By this
      // point the order is committed, the token is remembered and the customer
      // has bought their groceries. A sign-up that threw here — a number
      // already taken, a password the server refuses, a dropped connection —
      // must produce a message and nothing else.
      //
      // `claimToken` is what stops the new account opening on an empty list:
      // the order predates it, and the phone number alone is not evidence of
      // anything until it is verified. Possession of the tracking token is.
      if (wantsAccount && !session) {
        try {
          saveSession(
            await signUp({
              phone: phone.trim(),
              password: signupPassword,
              name: name.trim(),
              claimToken: order.tracking_token,
            }),
          );
          toast.success('Account created');
        } catch (signupError) {
          toast.error('Your order is placed', {
            description:
              signupError instanceof ApiError && signupError.isConflict
                ? 'That number already has an account — sign in to see this order in it.'
                : 'We could not create your account. Try again from the Account page.',
          });
        }
      }
      // The idempotency key has been redeemed. Leaving it in storage means the
      // next checkout's first act is reading a spent one, and a used key
      // lingering in a customer's browser is exactly what confuses whoever is
      // later debugging a duplicate order.
      clearCheckoutAttempt();

      // Private browsing and a full quota both make the write throw, and the
      // order then looks remembered until the next reload loses it. The
      // customer's only other copy of the token is the URL they are about to be
      // sent to, so this is the one moment they can be told to keep it.
      toast.success('Order placed', {
        description: recentOrdersArePersisted()
          ? `Arriving in about ${order.promised_minutes} minutes`
          : 'Save this page — this browser cannot remember your order.',
      });
      // Navigate first, empty the basket second. The other order re-renders this
      // page through the `lines.length === 0` branch above, so the customer sees
      // "Nothing to check out" flash over a successful order while the router
      // is still working.
      router.push(`/order/${order.tracking_token}`);
      clearCart();
    } catch (caught: unknown) {
      if (!mounted.current) return;

      // A 409 means the catalogue moved under a basket that was valid when it
      // was built. Naming the exact rows is the difference between a customer
      // fixing it in one tap and a customer giving up.
      if (caught instanceof ApiError && caught.isConflict) {
        const rows = caught.payload.unavailable;
        if (Array.isArray(rows)) setUnavailable(rows as UnavailableItem[]);
        setFailure(caught.message);
      } else {
        setFailure(
          caught instanceof Error ? caught.message : 'We could not place your order just now.',
        );
      }
      setIsPlacing(false);
    }
  };


  const blocked =
    unavailable.length > 0 ||
    quote?.meets_minimum === false ||
    storeClosed ||
    outsideArea;

  return (
    <div className="container-page py-8 pb-32 lg:py-12 lg:pb-12">
      <h1 className="text-3xl font-semibold lg:text-5xl">Checkout</h1>
      <p className="mt-2 text-muted-foreground">
        One screen. Your order leaves the store the moment you confirm.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
        <div className="space-y-6">
          <section className="rounded-4xl border border-border/70 p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Where to deliver</h2>
              <Link
                href="/addresses"
                className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
              >
                <Plus className="size-3.5" aria-hidden />
                Manage
              </Link>
            </div>

            {book.entries.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {book.entries.map((entry) => {
                  const active = entry.id === saved?.id && !addressOverridden;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        selectAddress(entry.id);
                        resetAddress();
                        resetLandmark();
                        setErrors((current) => ({ ...current, address: undefined }));
                      }}
                      aria-pressed={active}
                      className={cn(
                        'rounded-3xl border p-4 text-left transition-all duration-300 ease-[var(--ease-apple)]',
                        active
                          ? 'border-primary bg-secondary'
                          : 'border-border/70 hover:border-primary/25 hover:bg-surface',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{entry.label}</span>
                        {active && (
                          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary">
                            <Check className="size-3 text-primary-foreground" aria-hidden />
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {toDeliveryAddress(entry)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Your name"
                value={name}
                onChange={(value) => {
                  setName(value);
                  setErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder="Who should the rider ask for?"
                error={errors.name}
                autoComplete="name"
              />
              <Field
                label="Mobile number"
                value={phone}
                onChange={(value) => {
                  setPhone(value);
                  setErrors((current) => ({ ...current, phone: undefined }));
                }}
                placeholder="98123 45678"
                error={errors.phone}
                inputMode="tel"
                autoComplete="tel"
              />
            </div>

            <div className="mt-4">
              <Field
                label="Delivery address"
                value={address}
                onChange={(value) => {
                  setAddress(value);
                  setErrors((current) => ({ ...current, address: undefined }));
                }}
                placeholder="House, street, locality"
                error={errors.address}
                autoComplete="street-address"
              />
            </div>

            <div className="mt-4 rounded-3xl bg-surface p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={locate}
                  disabled={isLocating || isPlacing}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold transition-colors hover:bg-background disabled:pointer-events-none disabled:opacity-60"
                >
                  {isLocating ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Crosshair className="size-4" aria-hidden />
                  )}
                  {coords ? 'Update my location' : 'Share my location'}
                </button>
                <p className="text-xs text-muted-foreground">
                  Optional. It helps the rider find you and lets us check we
                  deliver to your area.
                </p>
              </div>

              {/* Always mounted, text swapped. A conditionally rendered
                  aria-live region is inserted at the same moment its content
                  first changes, and most screen readers announce nothing at
                  all — the region has to already exist to be watched. */}
              <p
                role="status"
                aria-live="polite"
                className={cn(
                  'mt-2 min-h-4 text-xs',
                  outsideArea ? 'font-medium text-destructive' : 'text-muted-foreground',
                )}
              >
                {outsideArea
                  ? `That is about ${distanceKm} km from the store, outside the ${config?.delivery_radius_km} km delivery area.`
                  : coords
                    ? `Location shared${distanceKm !== null ? ` · ${distanceKm} km from the store` : ''}.`
                    : locationNote}
              </p>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Landmark (optional)"
                value={landmark}
                onChange={setLandmark}
                placeholder="Near the church, opposite the bank"
              />
              <Field
                label="Note for the rider (optional)"
                value={notes}
                onChange={setNotes}
                placeholder="Gate code, or where to leave it"
              />
            </div>

            {!session && (
              <div className="mt-6 rounded-3xl bg-surface p-5">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={wantsAccount}
                    onChange={(event) => setWantsAccount(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--color-primary)]"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Save my details for next time</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      Create an account with this number, and your orders follow you to any device.
                    </span>
                  </span>
                </label>

                {wantsAccount && (
                  <div className="mt-4">
                    <Field
                      label="Choose a password"
                      value={signupPassword}
                      onChange={setSignupPassword}
                      type="password"
                      autoComplete="new-password"
                      error={errors.signupPassword}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">{PASSWORD_HINT}</p>
                  </div>
                )}
              </div>
            )}

            {book.entries.length === 0 && isValidAddress(address) && (
              <button
                type="button"
                onClick={() => {
                  addAddress({
                    label: 'Home',
                    line: address.trim(),
                    city: config?.store_city ?? '',
                    landmark: landmark.trim(),
                  });
                  toast.success('Address saved on this device');
                }}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
              >
                <MapPin className="size-3.5" aria-hidden />
                Save this address for next time
              </button>
            )}
          </section>

          <section className="rounded-4xl border border-border/70 p-6">
            <h2 className="text-lg font-semibold">Delivery speed</h2>
            <div className="mt-4">
              <DeliveryTierPicker
                config={config}
                quote={quote}
                selected={deliveryType}
                onSelect={setDeliveryType}
                disabled={isPlacing}
              />
            </div>
          </section>

          <section className="rounded-4xl border border-border/70 p-6">
            <h2 className="text-lg font-semibold">Payment</h2>
            <div className="mt-4 flex items-center gap-3 rounded-3xl bg-surface p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-soft">
                <Banknote className="size-5 text-amber" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-semibold">Cash on delivery</span>
                <span className="block text-xs text-muted-foreground">
                  Pay the rider at your door. It is the only method this store takes today.
                </span>
              </span>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-6 rounded-4xl border border-border/70 p-6">
            <div>
              <h2 className="text-lg font-semibold">Your order</h2>
              <ul className="mt-4 space-y-3">
                {lines.map((line) => {
                  const image = assetUrl(line.product.image_url);
                  const problem = unavailable.find((item) => item.product_id === line.product.id);
                  return (
                    <li
                      key={line.product.id}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl',
                        problem && 'bg-destructive-soft p-2',
                      )}
                    >
                      {image ? (
                        <img
                          src={image}
                          alt=""
                          loading="lazy"
                          width={100}
                          height={100}
                          className="size-11 shrink-0 rounded-xl bg-surface object-cover"
                        />
                      ) : (
                        <ImageFallback
                          name={line.product.name}
                          className="size-11 shrink-0 rounded-xl"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {line.product.name}
                        </span>
                        <span className="num block text-xs text-muted-foreground">
                          Qty {line.quantity} · {formatMoney(line.product.price)}
                        </span>
                        {problem && (
                          <span className="block text-xs font-medium text-destructive">
                            {problem.reason}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="border-t pt-6">
              <BillLines quote={quote} />
              {isLoading && (
                <p className="animate-pulse-soft mt-3 text-xs text-muted-foreground">
                  Pricing your basket…
                </p>
              )}
              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            </div>

            <MinimumOrderNotice quote={quote} config={config} />

            {storeClosed && (
              <div
                role="status"
                className="rounded-2xl bg-amber-soft px-4 py-3 text-sm text-amber"
              >
                <p className="font-semibold">The store is closed</p>
                {/* The server's own sentence, so what is shown here and what
                    checkout would refuse with cannot drift apart. */}
                <p className="mt-1">{config?.closed_reason}</p>
                <p className="mt-1 text-xs">
                  Your basket is saved. Come back when we open and it will still
                  be here.
                </p>
              </div>
            )}

            {failure && (
              <div className="rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive">
                <p>{failure}</p>
                {unavailable.length > 0 && (
                  <Link href="/cart" className="mt-2 inline-block font-semibold underline">
                    Fix your basket
                  </Link>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={isPlacing || isLoading || blocked}
              className="hidden h-13 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60 lg:flex"
            >
              {isPlacing && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {isPlacing ? 'Placing order…' : storeClosed ? 'Store closed' : 'Place order'}
              {!isPlacing && !storeClosed && quote && (
                <span className="num">· {formatMoney(quote.grand_total)}</span>
              )}
            </button>
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-[68px] z-30 border-t border-border/70 bg-background/92 px-5 py-3 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={submit}
          disabled={isPlacing || isLoading || blocked}
          className="flex h-13 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground transition-transform duration-300 ease-[var(--ease-apple)] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
        >
          {isPlacing && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isPlacing ? 'Placing order…' : storeClosed ? 'Store closed' : 'Place order'}
          {!isPlacing && !storeClosed && quote && (
            <span className="num">· {formatMoney(quote.grand_total)}</span>
          )}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
  inputMode,
  autoComplete,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  inputMode?: 'tel' | 'text';
  autoComplete?: string;
  type?: 'text' | 'password';
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        className={cn(
          'mt-2 h-12 w-full rounded-2xl border bg-surface px-4 text-sm outline-none transition-colors',
          error ? 'border-destructive' : 'border-border focus:border-primary/25',
        )}
      />
      {error && <span className="mt-1.5 block text-xs text-destructive">{error}</span>}
    </label>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="container-page py-8 lg:py-12">
      <Skeleton className="h-12 w-52 rounded-2xl" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
        <div className="space-y-6">
          <Skeleton className="h-80 rounded-4xl" />
          <Skeleton className="h-40 rounded-4xl" />
          <Skeleton className="h-32 rounded-4xl" />
        </div>
        <Skeleton className="h-96 rounded-4xl" />
      </div>
    </div>
  );
}

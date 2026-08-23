'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Info, MapPin, Package, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { selectedAddress, toDeliveryAddress } from '@/lib/addresses';
import { clearProfile, hasProfile, saveProfile } from '@/lib/profile';
import { formatMoneyExact } from '@/lib/format';
import { isValidIndianMobile, isValidName } from '@/lib/validation';
import { useAddressBook, useProfile, useRecentOrders } from '@/hooks/useStoreData';
import { useDraft } from '@/hooks/useDraft';
import { cn } from '@/lib/utils';

/**
 * The customer's details, on this device.
 *
 * Emphatically **not** a sign-in. This store has no customer accounts — the API
 * has no customer auth at all — and the prototype's OTP screen was a form that
 * authenticated nobody. What is genuinely useful is remembering a name and a
 * number so checkout does not ask twice, and that is all this does. Saying so
 * on the page is the honest version.
 */
export function AccountPage() {
  const profile = useProfile();
  const book = useAddressBook();
  const orders = useRecentOrders();
  const address = selectedAddress(book);

  // Derived from the store rather than seeded from it once: the profile is
  // empty on the first render and arrives a tick later, so `useState(...)`
  // showed two blank boxes to a customer who had saved their details — and
  // `save()` then wrote those blanks back over what was stored.
  const [name, setName] = useDraft(profile.name);
  const [phone, setPhone] = useDraft(profile.phone);
  const [touched, setTouched] = useState(false);

  const nameError = touched && name.trim() !== '' && !isValidName(name);
  const phoneError = touched && phone.trim() !== '' && !isValidIndianMobile(phone);

  const save = () => {
    setTouched(true);
    if (nameError || phoneError) return;
    saveProfile({ name, phone });
    toast.success('Saved on this device');
  };

  const liveOrders = orders.length;
  const spent = orders.reduce((total, order) => total + order.total, 0);

  return (
    <div className="container-page py-10 lg:py-16">
      <h1 className="text-3xl font-semibold lg:text-5xl">Your details</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Everything on this page lives in this browser. It is what makes checkout quick — not an
        account, and not a login.
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-10">
        <div className="space-y-6">
          <section className="rounded-4xl border border-border/70 p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <User className="size-4 text-amber" aria-hidden />
              Contact
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The name a rider should ask for and a number they can call.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Name
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  aria-invalid={nameError || undefined}
                  className={cn(
                    'mt-2 h-12 w-full rounded-2xl border bg-surface px-4 text-sm outline-none transition-colors',
                    nameError ? 'border-destructive' : 'border-border focus:border-primary/25',
                  )}
                />
                {nameError && (
                  <span className="mt-1.5 block text-xs text-destructive">
                    Enter at least two characters.
                  </span>
                )}
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Mobile number
                </span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="98123 45678"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-invalid={phoneError || undefined}
                  className={cn(
                    'mt-2 h-12 w-full rounded-2xl border bg-surface px-4 text-sm outline-none transition-colors',
                    phoneError ? 'border-destructive' : 'border-border focus:border-primary/25',
                  )}
                />
                {phoneError && (
                  <span className="mt-1.5 block text-xs text-destructive">
                    Enter a 10-digit mobile number.
                  </span>
                )}
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                className="inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
              >
                Save
              </button>

              {hasProfile(profile) && (
                <button
                  type="button"
                  onClick={() => {
                    clearProfile();
                    setName('');
                    setPhone('');
                    setTouched(false);
                    toast.success('Details cleared from this device');
                  }}
                  className="inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden />
                  Clear
                </button>
              )}
            </div>
          </section>

          <LinkRow
            href="/addresses"
            icon={<MapPin className="size-4 text-amber" aria-hidden />}
            title="Addresses"
            body={
              address
                ? `${address.label} · ${toDeliveryAddress(address)}`
                : 'No saved addresses yet'
            }
          />

          <LinkRow
            href="/orders"
            icon={<Package className="size-4 text-amber" aria-hidden />}
            title="Your orders"
            body={
              liveOrders > 0
                ? `${liveOrders} remembered on this device`
                : 'Orders you place will appear here'
            }
          />
        </div>

        <aside className="space-y-6">
          {liveOrders > 0 && (
            <div className="rounded-4xl border border-border/70 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                On this device
              </h2>
              <dl className="mt-4 space-y-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Orders remembered</dt>
                  <dd className="num mt-0.5 text-2xl font-semibold">{liveOrders}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Their total</dt>
                  <dd className="num mt-0.5 text-2xl font-semibold">{formatMoneyExact(spent)}</dd>
                </div>
              </dl>
            </div>
          )}

          <div className="flex gap-3 rounded-4xl bg-surface p-6">
            <Info className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
            <p className="text-sm leading-relaxed text-muted-foreground">
              eDawr has no customer sign-in. Your orders are tracked by a private link saved here,
              so clearing your browser data loses access to them. Keep the link if an order matters.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function LinkRow({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-4xl border border-border/70 p-6 transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-card"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-soft">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">{body}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

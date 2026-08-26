'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Info, LogOut, MapPin, Package, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { selectedAddress, toDeliveryAddress } from '@/lib/addresses';
import { clearProfile, hasProfile, saveProfile } from '@/lib/profile';
import { formatMoneyExact } from '@/lib/format';
import { isValidIndianMobile, isValidName } from '@/lib/validation';
import { useAddressBook, useProfile, useRecentOrders, useSession } from '@/hooks/useStoreData';
import { changePassword, signOut, updateName } from '@/lib/customer-api';
import { PASSWORD_HINT, passwordProblem } from '@/lib/password';
import { clearSession, saveSession } from '@/lib/session';
import { useDraft } from '@/hooks/useDraft';
import { cn } from '@/lib/utils';

/**
 * The customer's account, and their details on this device.
 *
 * Both, because both are real. Signing in is optional — guest checkout is the
 * main path and stays that way — so this page has to make sense for someone who
 * has never created an account and for someone who has.
 *
 * It used to say, in a docstring and on the page, that eDawr has no customer
 * sign-in. That was true and carefully written, and it is now false; the honest
 * version today is the paragraph about **verification**, which is genuinely
 * awkward and belongs on the screen rather than in a support article. A customer
 * who signs in and finds their earlier orders missing will otherwise assume the
 * shop lost them, when what has actually happened is that a password proves you
 * know a number and not that you hold the SIM — and nothing can prove the second
 * until there is an SMS provider.
 */
/**
 * The account card: an invitation when signed out, the account when signed in.
 *
 * Kept in this file rather than extracted because it is the only thing that
 * reads the session here, and splitting it out would mean a component whose
 * whole job is to be imported once.
 */
function AccountPanel() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [accountName, setAccountName] = useDraft(session?.name ?? '');

  if (!session) {
    return (
      <section className="rounded-4xl border border-border/70 p-6">
        <h2 className="text-lg font-semibold">Save your details for next time</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Create an account with the number you already order with, and the orders you place stay
          with you instead of with this browser.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/signup?next=/account"
            className="inline-flex h-12 items-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
          >
            Create an account
          </Link>
          <Link
            href="/signin?next=/account"
            className="inline-flex h-12 items-center rounded-full border border-border px-7 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  const saveName = async () => {
    setBusy(true);
    try {
      const updated = await updateName(accountName.trim());
      // Mirrored into the device-local profile so checkout prefills the same
      // whichever of the two it reads.
      saveSession({ ...session, name: updated.name });
      saveProfile({ name: updated.name, phone: session.phone });
      toast.success('Name updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update your name.');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    const problem = passwordProblem(newPassword);
    if (problem) {
      setPasswordError(problem);
      return;
    }
    setPasswordError('');
    setBusy(true);
    try {
      // The server retires every token, including this one, and hands back a
      // replacement — so this device stays signed in and every other is out.
      saveSession(await changePassword(currentPassword, newPassword));
      setCurrentPassword('');
      setNewPassword('');
      setChanging(false);
      toast.success('Password changed', {
        description: 'Any other device you were signed in on has been signed out.',
      });
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : 'Could not change your password.',
      );
    } finally {
      setBusy(false);
    }
  };

  const endSession = async () => {
    setBusy(true);
    // Cleared locally whatever the server says. Someone tapping sign-out on a
    // phone with no signal must still end up signed out of that phone — the
    // same precedent the console and the rider app set.
    await signOut();
    clearSession();
    toast.success('Signed out');
    setBusy(false);
  };

  return (
    <section className="rounded-4xl border border-border/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Your account</h2>
          <p className="num mt-0.5 text-sm text-muted-foreground">{session.phone}</p>
        </div>
        <button
          type="button"
          onClick={endSession}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Name on the account
          </span>
          <div className="mt-2 flex gap-2">
            <input
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              autoComplete="name"
              className="h-12 w-full rounded-2xl border border-border bg-surface px-4 text-sm outline-none transition-colors focus:border-primary/25"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={busy || accountName.trim() === session.name}
              className="inline-flex h-12 shrink-0 items-center rounded-2xl bg-secondary px-5 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </label>

        {/*
          The honest surfacing of the verification rule. It is a disabled
          control rather than a hidden one: a customer who signs in and sees no
          earlier orders needs to know why, and "we cannot send codes yet" is a
          better answer than a page that silently omits them.
        */}
        {!session.phoneVerified && (
          <div className="rounded-2xl bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Number not verified</span>
              <button
                type="button"
                disabled
                title="We cannot send verification codes yet."
                className="inline-flex h-9 cursor-not-allowed items-center rounded-full border border-border px-4 text-xs font-medium opacity-50"
              >
                Verify
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              We cannot send verification codes yet. Orders you place while signed in are saved to
              your account either way — but orders placed as a guest, before this account existed,
              stay on the device that placed them.
            </p>
          </div>
        )}

        {changing ? (
          <div className="space-y-3 rounded-2xl bg-surface p-4">
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:border-primary/25"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:border-primary/25"
            />
            <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
            {passwordError && (
              <p role="alert" className="text-xs text-destructive">
                {passwordError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitPassword}
                disabled={busy}
                className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Change password
              </button>
              <button
                type="button"
                onClick={() => {
                  setChanging(false);
                  setPasswordError('');
                }}
                className="inline-flex h-11 items-center rounded-full px-4 text-sm text-muted-foreground hover:bg-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Change password
          </button>
        )}
      </div>
    </section>
  );
}

export function AccountPage() {
  const profile = useProfile();
  const book = useAddressBook();
  const orders = useRecentOrders();
  const session = useSession();
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
        Your account, and the details this browser remembers to make checkout quick.
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-10">
        <div className="space-y-6">
          <AccountPanel />
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
              {session ? (
                <>
                  Orders you place while signed in are saved to your account and follow you to any
                  device. Orders on this page from before you signed in are still tracked by a
                  private link saved in this browser only.
                </>
              ) : (
                <>
                  Your orders are tracked by a private link saved in this browser, so clearing your
                  data loses access to them. Keep the link if an order matters — or{' '}
                  <Link href="/signup" className="underline underline-offset-4">
                    create an account
                  </Link>{' '}
                  and new orders are kept on the server instead.
                </>
              )}
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

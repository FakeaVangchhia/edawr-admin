'use client';

/**
 * Create an account with the number you already give at checkout.
 *
 * Two things this page has to be honest about, because a customer who finds
 * them out later will assume the store lost their data:
 *
 *   1. **Older orders do not appear.** Orders placed as a guest stay on the
 *      device that placed them until the number is verified, and nothing can
 *      verify a number yet. Saying so here is cheaper than a support call.
 *   2. **There is no password reset.** No SMS, no email on the record, no
 *      second channel to send a code down.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError, NetworkError } from '@/lib/api';
import { signUp } from '@/lib/customer-api';
import { PASSWORD_HINT, passwordProblem } from '@/lib/password';
import { saveProfile } from '@/lib/profile';
import { safeNext } from '@/lib/redirect';
import { saveSession } from '@/lib/session';
import { isValidIndianMobile, isValidName } from '@/lib/validation';
import { AuthError, AuthField, AuthShell, AuthSwitchLink } from '@/components/auth/AuthShell';

export function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; password?: string }>({});
  const [failure, setFailure] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure('');

    const found: typeof errors = {};
    if (!isValidName(name)) found.name = 'Tell us what to call you.';
    if (!isValidIndianMobile(phone)) found.phone = 'Enter a 10-digit mobile number.';
    const passwordIssue = passwordProblem(password, phone);
    if (passwordIssue) found.password = passwordIssue;

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const session = await signUp({ phone: phone.trim(), password, name: name.trim() });
      saveSession(session);
      saveProfile({ name: session.name, phone: session.phone });
      toast.success('Account created');
      router.push(next);
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) {
        // The server tells us the number is taken, which is the one thing it
        // is willing to reveal here — and the only answer that lets someone do
        // the right thing next.
        setErrors({ phone: 'This number already has an account. Sign in instead.' });
      } else if (error instanceof NetworkError || error instanceof ApiError) {
        setFailure(error.message);
      } else {
        setFailure('Could not create your account. Try again in a moment.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Create an account"
      subtitle="So your orders are not tied to one browser."
      footer={
        <AuthSwitchLink
          href={`/signin?next=${encodeURIComponent(next)}`}
          prompt="Already have one?"
          action="Sign in"
        />
      }
    >
      <form onSubmit={submit} noValidate>
        <div className="space-y-4">
          <AuthField
            label="Your name"
            value={name}
            onChange={setName}
            autoComplete="name"
            placeholder="Lalringa"
            error={errors.name}
            disabled={submitting}
          />
          <AuthField
            label="Mobile number"
            value={phone}
            onChange={setPhone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98123 45678"
            hint="The number a rider would call."
            error={errors.phone}
            disabled={submitting}
          />
          <AuthField
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            error={errors.password}
            disabled={submitting}
          />
        </div>

        <AuthError message={failure} />

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 h-12 w-full rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create account'}
        </button>

        <div className="mt-5 space-y-2 text-xs text-muted-foreground">
          <p>
            Orders you place while signed in are saved to your account. Orders placed
            before this stay on the device that placed them — we cannot yet send a code
            to confirm the number is yours.
          </p>
          <p>
            Keep the password somewhere safe: we have no way to reset it by SMS, so a
            forgotten one means asking at the shop.
          </p>
        </div>
      </form>
    </AuthShell>
  );
}

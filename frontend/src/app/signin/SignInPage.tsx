'use client';

/**
 * Sign in with the phone number you order with.
 *
 * There is no password reset, and the page says so rather than offering a
 * "forgot password?" link that goes nowhere. Recovering an account needs a
 * second channel to send a code down, and this store has none yet — see
 * PRODUCTION.md Part 4. Someone locked out has to ask at the counter.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError, NetworkError } from '@/lib/api';
import { signIn } from '@/lib/customer-api';
import { saveProfile } from '@/lib/profile';
import { safeNext } from '@/lib/redirect';
import { saveSession } from '@/lib/session';
import { isValidIndianMobile } from '@/lib/validation';
import { AuthError, AuthField, AuthShell, AuthSwitchLink } from '@/components/auth/AuthShell';

export function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [failure, setFailure] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure('');

    if (!isValidIndianMobile(phone)) {
      setPhoneError('Enter a 10-digit mobile number.');
      return;
    }
    setPhoneError('');

    setSubmitting(true);
    try {
      const session = await signIn(phone.trim(), password);
      saveSession(session);
      // Mirrored into the device-local profile so checkout prefills the same
      // way whether or not this session survives.
      saveProfile({ name: session.name, phone: session.phone });
      toast.success('Signed in');
      router.push(next);
    } catch (error) {
      if (error instanceof NetworkError) {
        setFailure(error.message);
      } else if (error instanceof ApiError) {
        setFailure(error.message);
      } else {
        setFailure('Could not sign you in. Try again in a moment.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your orders follow your account, on any phone or laptop."
      footer={
        <AuthSwitchLink
          href={`/signup?next=${encodeURIComponent(next)}`}
          prompt="No account yet?"
          action="Create one"
        />
      }
    >
      <form onSubmit={submit} noValidate>
        <div className="space-y-4">
          <AuthField
            label="Mobile number"
            value={phone}
            onChange={setPhone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98123 45678"
            error={phoneError}
            disabled={submitting}
          />
          <AuthField
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="current-password"
            disabled={submitting}
          />
        </div>

        <AuthError message={failure} />

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 h-12 w-full rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-4 text-xs text-muted-foreground">
          Forgotten your password? We cannot reset it by SMS yet — ask at the shop and
          we will sort it out.
        </p>
      </form>
    </AuthShell>
  );
}

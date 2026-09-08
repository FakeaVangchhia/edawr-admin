'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { errorMessage } from '@/lib/api';
import { login } from '@/lib/queries';
import { safeNext } from '@/lib/redirect';
import { writeSession } from '@/lib/session';
import { useSession } from '@/lib/use-session';

/**
 * Sign in to the console.
 *
 * Deliberately plain: one card, two fields, no marketing panel. The storefront's
 * admin login borrows the shop's visual language and puts a promotional column
 * beside the form; this is a staff tool, and the person opening it at 6am wants
 * the password box, not a value proposition.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The reason we are here, if the API interceptor sent us. Read once into
  // state so it survives the URL being cleaned up below.
  const [notice] = useState(() => {
    const reason = params.get('reason');
    if (reason === 'expired') return 'Your session expired. Please sign in again.';
    return '';
  });

  // Where to land afterwards, read once into state for the same reason as
  // `notice` above — and it has to be, not merely tidily. `ConsoleShell` sends
  // an expired session here as `?reason=expired&next=%2Forders`, and the effect
  // below rewrites the URL to `/login`. Next patches `history.replaceState` to
  // keep the router in step, so `useSearchParams()` re-renders empty: anything
  // reading `next` after that point gets nothing and lands on the dashboard,
  // silently dropping the deep link this parameter exists to preserve.
  const [next] = useState(() => safeNext(params.get('next')));

  // Strip the query parameters so a refresh does not re-show the notice, and so
  // the URL is not littered when the operator bookmarks the page. Both values
  // are already in state by now.
  useEffect(() => {
    if (params.get('reason') || params.get('next')) {
      window.history.replaceState(null, '', '/login');
    }
  }, [params]);

  // Already signed in — nothing to do here. `next` is honoured so an operator
  // who was deep-linked to /orders and bounced through login lands back there
  // rather than at the dashboard.
  useEffect(() => {
    if (session) router.replace(next);
  }, [session, router, next]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      writeSession(await login(trimmedEmail, password));
      router.replace(next);
    } catch (caught) {
      // The backend returns one message whether the email is unknown or the
      // password is wrong, so this cannot be used to enumerate accounts. It is
      // shown as-is rather than reworded.
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 48px local
              asset; next/image would add a round trip and nothing else. */}
          <img
            src="/edawr-mark-512.png"
            alt=""
            width={48}
            height={48}
            className="mx-auto mb-3 size-12 rounded-xl"
            aria-hidden="true"
          />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            eDawr
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Console</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Store operations for managers and admins.
          </p>
        </div>

        <form onSubmit={onSubmit} className="panel p-5" noValidate>
          {notice ? (
            <p className="mb-4 rounded-[0.4rem] border border-warn bg-warn-quiet px-3 py-2 text-xs text-warn">
              {notice}
            </p>
          ) : null}

          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="field"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="field"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Always mounted, only its text changes, so screen readers actually
              announce a failed sign-in. A conditionally rendered live region is
              not announced by most of them. */}
          <p role="alert" aria-live="polite" className="mt-3 min-h-4 text-xs text-danger">
            {error}
          </p>

          <button type="submit" className="btn btn-primary mt-2 w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-faint">
          Access is granted by an Admin. There is no self-service sign-up.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // `useSearchParams` requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

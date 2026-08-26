'use client';

/**
 * The furniture both auth pages share: a card, a field and an error region.
 *
 * Kept here rather than in either page because the two forms have to look and
 * behave identically — a sign-up that styles its inputs differently from
 * sign-in reads as a different site, which is exactly the moment someone is
 * deciding whether to trust it with a password.
 *
 * The inputs are the storefront's own idiom (`CheckoutPage`'s `Field`) rather
 * than anything imported from `admin/`: the two packages deploy separately and
 * share no modules, and their CSS conventions differ.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="container-page flex justify-center py-10 lg:py-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

        <div className="mt-6 rounded-3xl border border-border bg-surface p-6">
          {children}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}

export function AuthField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  error,
  inputMode,
  autoComplete,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'tel' | 'password';
  placeholder?: string;
  hint?: string;
  error?: string;
  inputMode?: 'tel' | 'text';
  autoComplete?: string;
  disabled?: boolean;
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
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={cn(
          'mt-2 h-12 w-full rounded-2xl border bg-background px-4 text-sm outline-none transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-destructive' : 'border-border focus:border-primary/25',
        )}
      />
      {error ? (
        <span className="mt-1.5 block text-xs text-destructive">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * The form-level failure.
 *
 * **Always mounted when there is a message**, with `role="alert"` and
 * `aria-live`, so a screen reader announces a rejected password instead of
 * leaving someone staring at a form that did nothing.
 */
export function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      aria-live="polite"
      className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

export function AuthSwitchLink({ href, prompt, action }: { href: string; prompt: string; action: string }) {
  return (
    <>
      {prompt}{' '}
      <Link href={href} className="font-medium text-foreground underline underline-offset-4">
        {action}
      </Link>
    </>
  );
}

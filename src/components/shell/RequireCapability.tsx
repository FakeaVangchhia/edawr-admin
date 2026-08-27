'use client';

import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { can, DENIED_MESSAGE, ROLE_LABEL, type Capability } from '@/lib/guard';
import { useSession } from '@/lib/use-session';

/**
 * The route half of the three-layer gate.
 *
 * Layer one hides the link, this is layer two, and layer three is the API
 * returning 403 no matter what either of the first two did. Only the third is a
 * security control — this exists so that a Manager who types `/accounts` into
 * the address bar gets an explanation instead of a screen that renders, fires
 * requests, and fills with error banners.
 *
 * **It shows a message rather than redirecting.** A silent bounce to the
 * dashboard reads as a broken link, and the operator tries again. Saying "this
 * is Admin-only" once, with who to ask, ends it — and it never says "your
 * session expired", because it has not.
 */
export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const session = useSession();

  // The shell is still resolving the session; it renders its own placeholder.
  if (!session) return null;

  if (!can(session.role, capability)) {
    return (
      <div className="panel mx-auto mt-10 max-w-md p-6 text-center">
        <ShieldAlert size={22} className="mx-auto text-warn" aria-hidden="true" />
        <h1 className="mt-3 text-base font-semibold">Admin access required</h1>
        <p className="mt-1.5 text-sm text-ink-soft">{DENIED_MESSAGE}</p>
        <p className="mt-3 text-xs text-ink-faint">
          You are signed in as {session.email} ({ROLE_LABEL[session.role]}).
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

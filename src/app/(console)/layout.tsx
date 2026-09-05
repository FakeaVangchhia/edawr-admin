import type { ReactNode } from 'react';

import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ToastProvider } from '@/components/ui';

/**
 * Everything behind a session lives in this route group.
 *
 * `(console)` is a route *group* — the parentheses mean it does not appear in
 * the URL, so `(console)/orders/page.tsx` serves `/orders`. The point is that
 * `/login` sits outside it and therefore does not get the shell wrapped around
 * it or the session check applied to it, which is what stops the login page
 * redirecting to itself.
 *
 * `ToastProvider` sits *outside* the shell rather than inside a page, so a
 * confirmation raised from a drawer survives the drawer closing — which is the
 * common case, since almost every write here closes the thing that made it.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ToastProvider>
  );
}

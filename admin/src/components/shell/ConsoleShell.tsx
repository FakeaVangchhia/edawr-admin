'use client';

import {
  Banknote,
  BarChart3,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
  Tags,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { clsx } from 'clsx';

import { setSessionExpiredHandler } from '@/lib/api';
import { can, ROLE_LABEL, type Capability } from '@/lib/guard';
import { endSession, verifySession } from '@/lib/queries';
import { clearSession, writeSession } from '@/lib/session';
import { useSession } from '@/lib/use-session';
import { useTheme } from '@/lib/use-theme';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  capability: Capability | null;
}

/**
 * The navigation, in the order an operator's day runs: what is happening now,
 * then what they sell, then who sells it, then the numbers, then settings.
 * Admin-only entries sit at the bottom, visually separated, because they are
 * about the console rather than about the store.
 */
const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, capability: null },
  { href: '/orders', label: 'Orders', icon: ClipboardList, capability: 'orders' },
  { href: '/products', label: 'Products', icon: Boxes, capability: 'products' },
  { href: '/categories', label: 'Categories', icon: Tags, capability: 'categories' },
  { href: '/staff', label: 'Staff', icon: Users, capability: 'staff' },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, capability: 'analytics' },
  // Not Admin-only, and no new capability: reconciling the till is how a
  // Manager runs the store, the same reasoning that puts Settings here.
  { href: '/cash', label: 'Cash', icon: Banknote, capability: 'analytics' },
  { href: '/settings', label: 'Settings', icon: Settings, capability: 'settings' },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/accounts', label: 'Accounts', icon: ShieldCheck, capability: 'accounts' },
  { href: '/audit', label: 'Activity log', icon: ScrollText, capability: 'audit' },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const [navOpen, setNavOpen] = useState(false);

  /**
   * Give the API client a way to bounce an expired session to the login page.
   *
   * Registered here, once, rather than passed to every call — the alternative
   * is threading a callback through every screen and the one that forgets is
   * the one that leaves a dead session sitting on a failing poll.
   */
  useEffect(() => {
    setSessionExpiredHandler(() => {
      router.replace(`/login?reason=expired&next=${encodeURIComponent(pathname)}`);
    });
    return () => setSessionExpiredHandler(null);
  }, [router, pathname]);

  /**
   * Validate the stored token once on mount, and refresh the role while we are
   * there — an account promoted since sign-in should get the right navigation
   * without having to sign out.
   *
   * Note there is no `loading` flag being set here. `writeSession` writes to the
   * external session store, not to React state, so this effect never calls
   * `setState` synchronously — which is a hard error in this project, and the
   * fix for it is structural rather than a suppression.
   *
   * The `catch` is deliberately narrow. `verifySession` throws `NetworkError`
   * for a dropped connection and `ApiError(401)` for a dead token, and only the
   * second is a reason to sign anybody out — the client already cleared the
   * session and redirected in that case. Clearing it in a bare catch is how the
   * storefront's console deletes valid tokens on a wifi blip.
   */
  useEffect(() => {
    if (!session) return;
    verifySession()
      .then(writeSession)
      .catch(() => {
        /* 401 already handled by the interceptor; anything else is transient. */
      });
    // Runs once per mount. Depending on `session` would loop, because the
    // success path writes the session this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Not signed in — go to login, remembering where they were headed.
   *
   * Safe to run without a "have we checked yet" flag: `useSession` reads
   * localStorage synchronously, and effects run after hydration, so by the time
   * this fires `session` already holds the real value rather than the
   * server-render placeholder.
   */
  useEffect(() => {
    if (!session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [session, router, pathname]);

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-ink-faint">
        Checking your session…
      </div>
    );
  }

  const visible = NAV.filter((item) => !item.capability || can(session.role, item.capability));
  const adminVisible = ADMIN_NAV.filter((item) =>
    can(session.role, item.capability as Capability),
  );

  function signOut() {
    // Fire the server-side revocation, then leave immediately without waiting
    // for it. Clearing our own copy is the part that must always happen — a
    // manager on a dropped connection still has to be able to sign out of the
    // browser in front of them — and `endSession` swallows its own failures
    // precisely so this ordering is safe.
    void endSession();
    clearSession();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Backdrop for the mobile drawer. */}
      {navOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <Sidebar
        open={navOpen}
        items={visible}
        adminItems={adminVisible}
        pathname={pathname}
        onClose={() => setNavOpen(false)}
        onNavigate={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          name={session.name || session.email}
          email={session.email}
          role={session.role}
          onMenu={() => setNavOpen(true)}
          onSignOut={signOut}
        />
        <main id="main" className="flex-1 px-4 py-5 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  open,
  items,
  adminItems,
  pathname,
  onClose,
  onNavigate,
}: {
  open: boolean;
  items: NavItem[];
  adminItems: NavItem[];
  pathname: string;
  onClose: () => void;
  /** Closes the mobile drawer. Called from the link itself rather than from an
   *  effect watching the pathname: navigating is an event, and driving it from
   *  an event handler is both simpler and the rule this codebase follows. */
  onNavigate: () => void;
}) {
  return (
    <nav
      aria-label="Console sections"
      className={clsx(
        'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-accent">
            eDawr
          </p>
          <p className="text-sm font-semibold">Console</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm lg:hidden"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </ul>

        {adminItems.length ? (
          <>
            <p className="mt-5 mb-1.5 px-2 text-2xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              Admin only
            </p>
            <ul className="space-y-0.5">
              {adminItems.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className="border-t border-line p-2">
        <ThemeToggle />
      </div>
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  // Exact match for the dashboard, prefix match for the rest — otherwise "/"
  // is highlighted on every page, and /orders stays highlighted correctly when
  // a detail route is added under it later.
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={clsx(
          'flex items-center gap-2.5 rounded-[0.4rem] px-2.5 py-1.5 text-sm transition-colors',
          active
            ? 'bg-accent-quiet font-semibold text-accent'
            : 'text-ink-soft hover:bg-hover hover:text-ink',
        )}
      >
        <Icon size={16} aria-hidden="true" />
        {item.label}
      </Link>
    </li>
  );
}

function TopBar({
  name,
  email,
  role,
  onMenu,
  onSignOut,
}: {
  name: string;
  email: string;
  role: 'admin' | 'manager';
  onMenu: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:px-6">
      <button
        type="button"
        className="btn btn-ghost btn-sm lg:hidden"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Menu size={18} aria-hidden="true" />
      </button>

      <div className="ml-auto flex items-center gap-2.5">
        <div className="hidden text-right sm:block">
          <p className="text-xs font-semibold leading-tight">{name}</p>
          <p className="text-2xs leading-tight text-ink-faint">{email}</p>
        </div>
        {/* Always visible. Which role you are signed in as changes what the
            buttons on every screen will do, so it should never be a thing you
            have to go and check. */}
        <span className={clsx('badge', role === 'admin' ? 'badge-accent' : 'badge-neutral')}>
          {ROLE_LABEL[role]}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();

  const options = [
    { value: 'light' as const, label: 'Light', icon: Sun },
    { value: 'system' as const, label: 'System', icon: Monitor },
    { value: 'dark' as const, label: 'Dark', icon: Moon },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex gap-0.5 rounded-[0.4rem] bg-raised p-0.5"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className={clsx(
              'flex flex-1 items-center justify-center rounded-[0.3rem] py-1 transition-colors',
              active ? 'bg-surface text-accent shadow-sm' : 'text-ink-faint hover:text-ink',
            )}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

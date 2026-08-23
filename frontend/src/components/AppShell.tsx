'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDown,
  Grid2X2,
  Home,
  MapPin,
  Package,
  Search,
  ShoppingBag,
  User,
  Zap,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SearchOverlay } from '@/components/SearchOverlay';
import { selectAddress, selectedAddress } from '@/lib/addresses';
import { cn } from '@/lib/utils';
import { useAddressBook, useCart, useIsOnline, useStoreConfig } from '@/hooks/useStoreData';

/**
 * The chrome around every page: header, location picker, search, footer and the
 * mobile tab bar.
 *
 * It is a client component because all of it is stateful — the cart badge, the
 * ⌘K listener, the active tab. The pages it wraps are free to be server
 * components where they have nothing interactive to do.
 */

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="eDawr home">
      <span className="grid size-8 place-items-center rounded-xl bg-primary">
        <Zap className="size-4 text-amber" aria-hidden />
      </span>
      <span className="text-[17px] font-semibold tracking-tight">eDawr</span>
    </Link>
  );
}

/**
 * "Deliver to …".
 *
 * The address book is local to this device — there are no customer accounts —
 * so before anything is saved this reads as an invitation to add one rather
 * than as a fake default. Inventing "Home · Aizawl" for someone who has never
 * typed an address is the kind of placeholder that survives into production and
 * gets an order sent to a street nobody named.
 */
function LocationPicker({ compact }: { compact?: boolean }) {
  const book = useAddressBook();
  const config = useStoreConfig();
  const current = selectedAddress(book);
  const city = current?.city || config?.store_city || '';

  if (!current) {
    return (
      <Link
        href="/addresses"
        className="flex items-center gap-2 rounded-full px-3 py-2 text-left transition-colors hover:bg-secondary"
      >
        <MapPin className="size-4 text-amber" aria-hidden />
        <span className="leading-tight">
          <span className="block text-[11px] text-muted-foreground">Deliver to</span>
          <span className="block text-[13px] font-medium">Add an address</span>
        </span>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex items-center gap-2 rounded-full px-3 py-2 text-left transition-colors hover:bg-secondary">
        <MapPin className="size-4 text-amber" aria-hidden />
        <span className="leading-tight">
          <span className="block text-[11px] text-muted-foreground">Deliver to</span>
          <span className="block text-[13px] font-medium">
            {current.label}
            {city ? ` · ${city}` : ''}
          </span>
        </span>
        {!compact && <ChevronDown className="size-4 text-muted-foreground" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 rounded-2xl p-2">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Saved on this device
        </DropdownMenuLabel>
        {book.entries.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            onSelect={() => selectAddress(entry.id)}
            className={cn(
              'cursor-pointer rounded-xl px-3 py-2.5',
              entry.id === current.id && 'bg-secondary',
            )}
          >
            <span>
              <span className="block text-sm font-medium">{entry.label}</span>
              <span className="block text-xs text-muted-foreground">
                {[entry.line, entry.city].filter(Boolean).join(', ')}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem asChild className="cursor-pointer rounded-xl px-3 py-2.5">
          <Link href="/addresses" className="text-sm font-medium">
            Manage addresses
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useCartCount(): number {
  const { lines } = useCart();
  return lines.reduce((total, line) => total + line.quantity, 0);
}

function CartButton() {
  const count = useCartCount();
  return (
    <Link
      href="/cart"
      aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
      className="relative flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:-translate-y-0.5 hover:shadow-lift"
    >
      <ShoppingBag className="size-4" aria-hidden />
      <span className="hidden sm:inline">Cart</span>
      {count > 0 && (
        <span
          key={count}
          className="num animate-pop grid min-w-5 place-items-center rounded-full bg-amber px-1.5 text-[11px] font-semibold text-amber-foreground"
        >
          {count}
        </span>
      )}
    </Link>
  );
}

const NAV_LINKS: Array<[label: string, href: string]> = [
  ['Shop', '/products'],
  ['Orders', '/orders'],
  ['Offers', '/offers'],
  ['Account', '/account'],
];

export function AppShell({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
  const config = useStoreConfig();
  const online = useIsOnline();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/*
        Above the header and outside the sticky element, so it pushes the page
        down rather than covering the nav. `role="status"` with a polite live
        region announces it once to a screen reader without stealing focus —
        losing signal is worth knowing about, not worth interrupting for.
      */}
      {!online && (
        <div
          role="status"
          aria-live="polite"
          className="bg-destructive-soft px-4 py-2 text-center text-sm font-medium text-destructive"
        >
          You are offline. Browsing still works, but orders cannot be placed until
          your connection is back.
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="container-page flex h-16 items-center gap-3 lg:h-20 lg:gap-6">
          <Logo />
          <div className="hidden lg:block">
            <LocationPicker />
          </div>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full border border-border bg-surface px-4 text-left text-sm text-muted-foreground transition-all duration-300 ease-[var(--ease-apple)] hover:border-primary/20 hover:bg-secondary lg:ml-0 lg:max-w-xl"
          >
            <Search className="size-4" aria-hidden />
            <span className="truncate">Search for groceries, snacks, household…</span>
            <kbd className="ml-auto hidden rounded-md border bg-card px-1.5 py-0.5 text-[10px] lg:block">
              ⌘K
            </kbd>
          </button>

          <nav className="ml-auto hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary hover:text-foreground',
                  pathname === href ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </Link>
            ))}
            <div className="ml-2">
              <CartButton />
            </div>
          </nav>

          <div className="lg:hidden">
            <CartButton />
          </div>
        </div>

        <div className="container-page flex items-center pb-2 lg:hidden">
          <LocationPicker compact />
        </div>
      </header>

      <main className="flex-1 pb-24 lg:pb-0">{children}</main>

      <footer className="hidden border-t border-border/70 bg-surface lg:block">
        <div className="container-page grid gap-10 py-14 md:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Everyday essentials, delivered across {config?.store_city ?? 'Aizawl'} in minutes.
            </p>
          </div>
          <FooterCol
            title="Shop"
            links={[
              ['All products', '/products'],
              ['Categories', '/categories'],
              ['Offers', '/offers'],
            ]}
          />
          <FooterCol
            title="Your orders"
            links={[
              ['Track an order', '/orders'],
              ['Addresses', '/addresses'],
              ['Account', '/account'],
            ]}
          />
          <div>
            <p className="text-sm font-semibold">Delivering now</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {config?.store_city ?? 'Aizawl'}
              {config ? (
                <>
                  <br />
                  Arriving in about {config.promise_minutes} minutes
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="container-page border-t py-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} {config?.store_name ?? 'eDawr'}. All rights reserved.
        </div>
      </footer>

      <MobileNav pathname={pathname} onSearch={() => setSearchOpen(true)} />
      <SearchOverlay open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link
              href={href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MobileNav({ pathname, onSearch }: { pathname: string; onSearch: () => void }) {
  const count = useCartCount();
  const items = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/categories', label: 'Aisles', icon: Grid2X2 },
    { href: '/orders', label: 'Orders', icon: Package },
    { href: '/account', label: 'Account', icon: User },
  ] as const;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/92 backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 pb-[max(env(safe-area-inset-bottom),0.4rem)] pt-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('size-5', active && 'text-amber')} aria-hidden />
              {label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onSearch}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-1.5 text-[11px] text-muted-foreground"
        >
          <Search className="size-5" aria-hidden />
          Search
        </button>

        <Link
          href="/cart"
          className="relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-1.5 text-[11px] text-muted-foreground"
        >
          <ShoppingBag className="size-5" aria-hidden />
          Cart
          {count > 0 && (
            <span className="num absolute right-2 top-0 grid min-w-4 place-items-center rounded-full bg-amber px-1 text-[10px] font-semibold text-amber-foreground">
              {count}
            </span>
          )}
        </Link>
      </div>
    </nav>
  );
}

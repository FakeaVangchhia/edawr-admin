'use client';

import { AlertTriangle, ArrowRight, LayoutGrid, RefreshCw, Rows3, Search, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { clsx } from 'clsx';

import { OrderDrawer } from '@/components/orders/OrderDrawer';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  Panel,
  StatusBadge,
  TableSkeleton,
  useToast,
} from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime, money, phone as formatPhone, relativeTime } from '@/lib/format';
import { advanceOrder, listOrders, listRiders } from '@/lib/queries';
import { useDebounced, usePolling, useResource } from '@/lib/use-resource';
import type { Order, OrderStatus } from '@/types';

const PAGE_SIZE = 25;

/**
 * The four live columns.
 *
 * Terminal states are reached through the filters.
 *
 * `next` is the one move that is *unambiguous* from that column, offered on the
 * card itself so the ordinary path — pick it, pack it, mark it ready — is one
 * click rather than open-drawer, click, close-drawer. Two columns deliberately
 * have none. Nothing forward happens by hand from **Ready**: dispatch picks the
 * rider. And **On the way** ends in Delivered, which records the cash against
 * the order; that one keeps the drawer, where the amount is in front of you and
 * the failure exit sits beside it.
 */
const BOARD_COLUMNS: {
  status: OrderStatus;
  label: string;
  hint: string;
  next?: { status: OrderStatus; label: string; done: (order: Order) => string };
}[] = [
  {
    status: 'Placed',
    label: 'New',
    hint: 'Waiting to be picked',
    next: {
      status: 'Packing',
      label: 'Start packing',
      done: (order) => `Order #${order.id} is being packed.`,
    },
  },
  {
    status: 'Packing',
    label: 'Packing',
    hint: 'Being assembled',
    next: {
      status: 'Ready',
      label: 'Mark ready',
      done: (order) => `Order #${order.id} is ready — a rider is being found for it.`,
    },
  },
  // A rider is picked automatically at Ready, so an order that stays in this
  // column is one dispatch could find nobody for — not one simply waiting its
  // turn. The hint says so, because the difference decides whether a manager
  // needs to do anything.
  { status: 'Ready', label: 'Ready', hint: 'No rider found yet' },
  { status: 'Dispatched', label: 'On the way', hint: 'With a rider' },
];

const STATUS_OPTIONS: (OrderStatus | '')[] = [
  '',
  'Placed',
  'Packing',
  'Ready',
  'Dispatched',
  'Delivered',
  'Cancelled',
  'Failed',
];

type View = 'board' | 'table';

export default function OrdersPage() {
  const [view, setView] = useState<View>('board');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [stalledOnly, setStalledOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);
  const [actionError, setActionError] = useState('');

  const toast = useToast();
  const debouncedSearch = useDebounced(search);

  // The board wants every open order; the table wants a page of whatever the
  // filters describe. One endpoint serves both — the difference is the query.
  const isBoard = view === 'board';
  const filters = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      status: isBoard ? undefined : status || undefined,
      open: isBoard ? true : undefined,
      stalled: stalledOnly || undefined,
      from: isBoard ? undefined : from || undefined,
      to: isBoard ? undefined : to || undefined,
      limit: isBoard ? 200 : PAGE_SIZE,
      offset: isBoard ? 0 : offset,
    }),
    [debouncedSearch, isBoard, status, stalledOnly, from, to, offset],
  );

  const key = JSON.stringify(filters);
  const orders = useResource(key, (signal) => listOrders(filters, signal));
  const riders = useResource('riders', (signal) => listRiders(signal));

  // Poll the board, not the table. A live fulfilment board has to be current;
  // a filtered history from last Tuesday does not change while you read it.
  // `orders.refresh` is already stable — a useCallback with no dependencies,
  // inside useResource. Wrapping it in another useCallback keyed on `orders`,
  // which is a new object every render, was what made it unstable, and an
  // unstable callback used to restart the interval on every keystroke.
  const refresh = orders.refresh;
  usePolling(refresh, 15_000, isBoard);

  const rows = orders.data?.rows ?? [];
  const total = orders.data?.total ?? 0;

  // Which filters are actually narrowing what is on screen. The board ignores
  // the status and date boxes — they are not even rendered there — so counting
  // them would offer to clear something invisible.
  const activeFilters = isBoard
    ? [search, stalledOnly ? 'stalled' : ''].filter(Boolean).length
    : [search, status, from, to, stalledOnly ? 'stalled' : ''].filter(Boolean).length;

  function clearFilters() {
    setSearch('');
    setStatus('');
    setFrom('');
    setTo('');
    setStalledOnly(false);
    setOffset(0);
  }

  function changeView(next: View) {
    setView(next);
    setOffset(0);
  }

  /**
   * The one obvious move, taken from the card.
   *
   * Errors surface in the page's banner rather than on the card: a card can
   * vanish on the next poll, and an error that disappears before it is read is
   * worse than one shown a little further away. A 409 here is the ordinary
   * case — somebody else moved this order first — so the server's own sentence
   * is what gets shown.
   */
  const advance = useCallback(
    async (order: Order, status: OrderStatus, done: string) => {
      setActionError('');
      try {
        await advanceOrder(order.id, status);
        toast.success(done);
        refresh();
      } catch (caught) {
        setActionError(errorMessage(caught));
      }
    },
    [refresh, toast],
  );

  function onFilterChange<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      // Any filter change invalidates the page you were on. Staying on page 3
      // of a result set that now has one page shows an empty screen.
      setOffset(0);
    };
  }

  return (
    <>
      <PageHeader
        title="Orders"
        description={
          isBoard
            ? 'Live fulfilment board, refreshing every 15 seconds.'
            : 'Every order, including completed and cancelled.'
        }
        actions={
          <>
            <div className="flex rounded-[0.4rem] bg-raised p-0.5" role="tablist">
              <ViewTab
                active={isBoard}
                onClick={() => changeView('board')}
                icon={<LayoutGrid size={14} aria-hidden="true" />}
                label="Board"
              />
              <ViewTab
                active={!isBoard}
                onClick={() => changeView('table')}
                icon={<Rows3 size={14} aria-hidden="true" />}
                label="History"
              />
            </div>
            <button type="button" className="btn btn-secondary" onClick={refresh}>
              <RefreshCw size={14} aria-hidden="true" />
              Refresh
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            className="field pl-8"
            placeholder="Search name, phone, address or #id"
            aria-label="Search orders"
            value={search}
            onChange={(event) => onFilterChange(setSearch)(event.target.value)}
          />
        </div>

        {!isBoard ? (
          <>
            <div>
              <label className="label" htmlFor="status-filter">
                Status
              </label>
              <select
                id="status-filter"
                className="field w-36"
                value={status}
                onChange={(event) =>
                  onFilterChange(setStatus)(event.target.value as OrderStatus | '')
                }
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option || 'all'} value={option}>
                    {option || 'All statuses'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="from-date">
                From
              </label>
              <input
                id="from-date"
                type="date"
                className="field w-36"
                value={from}
                onChange={(event) => onFilterChange(setFrom)(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="to-date">
                To
              </label>
              <input
                id="to-date"
                type="date"
                className="field w-36"
                value={to}
                onChange={(event) => onFilterChange(setTo)(event.target.value)}
              />
            </div>
          </>
        ) : null}

        <label className="flex h-[2.125rem] items-center gap-1.5 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={stalledOnly}
            onChange={(event) => onFilterChange(setStalledOnly)(event.target.checked)}
          />
          Stalled only
        </label>

        {/* Only when there is something to clear. A permanently visible reset
            button is one more control to read past on every visit, and the
            screen it rescues you from — an empty table you cannot explain — is
            the only moment anybody looks for it. */}
        {activeFilters > 0 ? (
          <button
            type="button"
            className="btn btn-ghost h-[2.125rem]"
            onClick={clearFilters}
          >
            <X size={13} aria-hidden="true" />
            Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      ) : null}
      {orders.error ? (
        <div className="mb-4">
          <ErrorBanner message={orders.error} onRetry={refresh} />
        </div>
      ) : null}

      {orders.loading && !orders.data ? (
        <Panel flush>
          <TableSkeleton />
        </Panel>
      ) : isBoard ? (
        <Board orders={rows} onSelect={setSelected} onAdvance={advance} />
      ) : (
        <Panel flush>
          {rows.length === 0 ? (
            <EmptyState
              title="No orders match those filters"
              description="Try widening the date range, or clear the filters and start again."
              action={
                activeFilters > 0 ? (
                  <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Rider</th>
                      <th>Placed</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((order) => (
                      <tr
                        key={order.id}
                        className="cursor-pointer"
                        onClick={() => setSelected(order)}
                      >
                        <td className="mono">#{order.id}</td>
                        <td>
                          {order.customer_name}
                          <span className="block text-2xs text-ink-faint">
                            {formatPhone(order.customer_phone)}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={order.status} label={order.status_label} />
                        </td>
                        <td className="text-ink-soft">{order.rider?.name ?? '—'}</td>
                        <td className="text-ink-soft">{dateTime(order.created_at)}</td>
                        <td className="num font-medium">{money(order.grand_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                total={total}
                limit={PAGE_SIZE}
                offset={offset}
                onOffset={setOffset}
                noun="orders"
              />
            </>
          )}
        </Panel>
      )}

      <OrderDrawer
        order={selected}
        riders={riders.data ?? []}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setSelected(null);
          refresh();
        }}
      />
    </>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 rounded-[0.3rem] px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-surface text-accent' : 'text-ink-faint hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Board({
  orders,
  onSelect,
  onAdvance,
}: {
  orders: Order[];
  onSelect: (order: Order) => void;
  onAdvance: (order: Order, status: OrderStatus, done: string) => Promise<void>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {BOARD_COLUMNS.map((column) => {
        const items = orders.filter((order) => order.status === column.status);
        return (
          <section key={column.status} className="panel flex flex-col">
            <header className="flex items-baseline justify-between border-b border-line px-3 py-2">
              <div>
                <h2 className="text-sm font-semibold">{column.label}</h2>
                <p className="text-2xs text-ink-faint">{column.hint}</p>
              </div>
              <span className="badge badge-neutral numeric">{items.length}</span>
            </header>

            <div className="flex-1 space-y-2 p-2">
              {items.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-ink-faint">Nothing here</p>
              ) : (
                items.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    next={column.next}
                    onSelect={onSelect}
                    onAdvance={onAdvance}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * One order on the board.
 *
 * Two controls, side by side rather than nested: the card itself opens the
 * drawer, and the strip under it takes the one obvious next step. A button
 * cannot contain a button, and the alternatives — a click handler on a div, or
 * a transparent button stretched over the whole card — cost either keyboard
 * access or every native affordance inside it, including the tooltip on the
 * elapsed time. So the card keeps being exactly what it was, and the new
 * control sits below it.
 */
function OrderCard({
  order,
  next,
  onSelect,
  onAdvance,
}: {
  order: Order;
  next?: { status: OrderStatus; label: string; done: (order: Order) => string };
  onSelect: (order: Order) => void;
  onAdvance: (order: Order, status: OrderStatus, done: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function advance() {
    if (!next) return;
    setBusy(true);
    try {
      await onAdvance(order, next.status, next.done(order));
    } finally {
      // The card is usually gone by now — the refresh moves it to the next
      // column — so this only matters on the path where it is not: an error,
      // where the button has to become clickable again.
      setBusy(false);
    }
  }

  return (
    <div
      className={clsx(
        'rounded-[0.4rem] border bg-surface transition-colors hover:bg-hover',
        // A late order is outlined, not just badged. On a board of thirty cards
        // the one that has blown its promise has to be findable without reading.
        order.is_late ? 'border-danger' : 'border-line',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(order)}
        className="block w-full rounded-[0.4rem] p-2.5 text-left"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="mono text-xs text-ink-faint">#{order.id}</span>
          <span className="numeric text-sm font-semibold">{money(order.grand_total)}</span>
        </div>

        <p className="mt-1 truncate text-sm font-medium">{order.customer_name}</p>
        <p className="truncate text-xs text-ink-faint">{order.customer_address}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {order.is_late ? (
            <span className="badge badge-danger">
              <AlertTriangle size={10} aria-hidden="true" />
              Late
            </span>
          ) : (
            <span className="badge badge-neutral numeric">{order.minutes_remaining} min left</span>
          )}
          {order.rider ? <span className="badge badge-accent">{order.rider.name}</span> : null}
          <span className="ml-auto text-2xs text-ink-faint" title={dateTime(order.created_at)}>
            {relativeTime(order.created_at)}
          </span>
        </div>
      </button>

      {next ? (
        <div className="px-2.5 pb-2.5">
          <button
            type="button"
            className="btn btn-primary btn-sm w-full"
            disabled={busy}
            // Named in full for a screen reader. On a board of thirty cards,
            // thirty buttons all reading "Start packing" say nothing about
            // which order is about to move.
            aria-label={`${next.label} — order #${order.id} for ${order.customer_name}`}
            onClick={advance}
          >
            {busy ? 'Working…' : next.label}
            <ArrowRight size={12} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

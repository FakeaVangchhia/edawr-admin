'use client';

import { AlertTriangle, LayoutGrid, RefreshCw, Rows3, Search } from 'lucide-react';
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
} from '@/components/ui';
import { dateTime, money, phone as formatPhone, relativeTime } from '@/lib/format';
import { listOrders, listRiders } from '@/lib/queries';
import { useDebounced, usePolling, useResource } from '@/lib/use-resource';
import type { Order, OrderStatus } from '@/types';

const PAGE_SIZE = 25;

/** The four live columns. Terminal states are reached through the filters. */
const BOARD_COLUMNS: { status: OrderStatus; label: string; hint: string }[] = [
  { status: 'Placed', label: 'New', hint: 'Waiting to be picked' },
  { status: 'Packing', label: 'Packing', hint: 'Being assembled' },
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
  const refresh = useCallback(() => orders.refresh(), [orders]);
  usePolling(refresh, 15_000, isBoard);

  const rows = orders.data?.rows ?? [];
  const total = orders.data?.total ?? 0;

  function changeView(next: View) {
    setView(next);
    setOffset(0);
  }

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
      </div>

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
        <Board orders={rows} onSelect={setSelected} />
      ) : (
        <Panel flush>
          {rows.length === 0 ? (
            <EmptyState
              title="No orders match those filters"
              description="Try widening the date range or clearing the search."
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
}: {
  orders: Order[];
  onSelect: (order: Order) => void;
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
                  <OrderCard key={order.id} order={order} onSelect={onSelect} />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function OrderCard({
  order,
  onSelect,
}: {
  order: Order;
  onSelect: (order: Order) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(order)}
      className={clsx(
        'w-full rounded-[0.4rem] border bg-surface p-2.5 text-left transition-colors hover:bg-hover',
        // A late order is outlined, not just badged. On a board of thirty cards
        // the one that has blown its promise has to be findable without reading.
        order.is_late ? 'border-danger' : 'border-line',
      )}
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
        {order.rider ? (
          <span className="badge badge-accent">{order.rider.name}</span>
        ) : null}
        <span className="ml-auto text-2xs text-ink-faint" title={dateTime(order.created_at)}>
          {relativeTime(order.created_at)}
        </span>
      </div>
    </button>
  );
}

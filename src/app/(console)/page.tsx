'use client';

import { AlertTriangle, ArrowRight, PackageX } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { LineChart, StatTile } from '@/components/charts';
import { RiderLocationPanel } from '@/components/riders/RiderLocationPanel';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  Panel,
  StatusBadge,
  TableSkeleton,
} from '@/components/ui';
import { count, dateOnly, daysAgo, delta, money, moneyRounded, percent, relativeTime, today } from '@/lib/format';
import { analyticsInventory, analyticsRevenue, analyticsSummary, listOrders } from '@/lib/queries';
import { usePolling, useResource } from '@/lib/use-resource';
import { useSession } from '@/lib/use-session';

/**
 * What is happening right now, and whether it is going well.
 *
 * The ordering is the argument: live orders first, because that is the thing
 * someone can still act on; then the week's shape; then the shelves that need
 * walking. A dashboard that leads with a revenue chart is a dashboard for a
 * meeting, not for a shift.
 */
export default function OverviewPage() {
  const session = useSession();

  const range = useMemo(() => ({ from: daysAgo(29), to: today() }), []);

  const summary = useResource('summary', (signal) => analyticsSummary(range, signal));
  const revenue = useResource('revenue', (signal) => analyticsRevenue(range, signal));
  const inventory = useResource('inventory', (signal) => analyticsInventory(signal));
  const open = useResource('open-orders', (signal) =>
    listOrders({ open: true, limit: 100 }, signal),
  );

  usePolling(open.refresh, 15_000);

  const openOrders = open.data?.rows ?? [];
  const late = openOrders.filter((order) => order.is_late);
  const unassigned = openOrders.filter((order) => !order.rider && order.status === 'Ready');

  const inventoryData = inventory.data;
  const summaryData = summary.data;

  const points = (revenue.data ?? []).map((point) => ({
    label: dateOnly(point.date),
    value: point.revenue,
  }));

  const firstName = (session?.name || session?.email || '').split(/[\s@]/)[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Good to see you, ${firstName}` : 'Overview'}
        description="The last 30 days, and everything currently in flight."
      />

      {/* --- alerts, and only when there is something to say ---------------
          An alert bar that is always present is furniture, and furniture is
          ignored. These appear only when they are true. */}
      {(late.length > 0 || unassigned.length > 0 || (inventoryData?.out_of_stock ?? 0) > 0) && (
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          {late.length > 0 ? (
            <Alert
              tone="danger"
              icon={<AlertTriangle size={14} aria-hidden="true" />}
              title={`${late.length} order${late.length === 1 ? '' : 's'} past the promise`}
              href="/orders"
            />
          ) : null}
          {unassigned.length > 0 ? (
            <Alert
              tone="warn"
              icon={<AlertTriangle size={14} aria-hidden="true" />}
              title={`${unassigned.length} ready, no rider yet`}
              href="/orders"
            />
          ) : null}
          {(inventoryData?.out_of_stock ?? 0) > 0 ? (
            <Alert
              tone="warn"
              icon={<PackageX size={14} aria-hidden="true" />}
              title={`${inventoryData!.out_of_stock} product${
                inventoryData!.out_of_stock === 1 ? '' : 's'
              } out of stock`}
              href="/products?stock=out"
            />
          ) : null}
        </div>
      )}

      {summary.error ? (
        <div className="mb-4">
          <ErrorBanner message={summary.error} onRetry={summary.refresh} />
        </div>
      ) : null}

      {/* --- headline figures --- */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryData ? (
          <>
            <StatTile
              label="Revenue · 30 days"
              value={moneyRounded(summaryData.revenue.value)}
              delta={delta(summaryData.revenue.value, summaryData.revenue.previous)}
            />
            <StatTile
              label="Orders"
              value={count(summaryData.orders.value)}
              delta={delta(summaryData.orders.value, summaryData.orders.previous)}
            />
            <StatTile
              label="Average basket"
              value={money(summaryData.average_order_value.value)}
              delta={delta(
                summaryData.average_order_value.value,
                summaryData.average_order_value.previous,
              )}
            />
            <StatTile
              label="Delivered on time"
              value={percent(summaryData.on_time_rate.value)}
              delta={delta(summaryData.on_time_rate.value, summaryData.on_time_rate.previous)}
              tone={
                summaryData.on_time_rate.value >= 90
                  ? 'good'
                  : summaryData.on_time_rate.value >= 75
                    ? 'warn'
                    : 'danger'
              }
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="panel p-3.5">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-2 h-7 w-28" />
              <div className="skeleton mt-2 h-3 w-24" />
            </div>
          ))
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* --- revenue --- */}
        <Panel title="Revenue, last 30 days" className="lg:col-span-2">
          {revenue.loading && !revenue.data ? (
            <div className="skeleton h-48" />
          ) : (
            <LineChart
              points={points}
              formatValue={moneyRounded}
              ariaLabel="Daily revenue over the last 30 days"
            />
          )}
        </Panel>

        {/* --- shelves --- */}
        <Panel
          title="Stock needing attention"
          actions={
            <Link href="/products?stock=low" className="text-xs text-accent hover:underline">
              All products
            </Link>
          }
        >
          {inventory.loading && !inventoryData ? (
            <div className="skeleton h-40" />
          ) : !inventoryData || inventoryData.items.length === 0 ? (
            <EmptyState title="Every shelf is above its reorder level" />
          ) : (
            <ul className="divide-y divide-line text-sm">
              {inventoryData.items.slice(0, 7).map((item) => (
                <li key={item.product_id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate">{item.name}</span>
                  <span
                    className={`badge ${item.units <= 0 ? 'badge-danger' : 'badge-warn'} numeric`}
                  >
                    {item.units <= 0 ? 'Out' : `${item.units} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* --- live orders --- */}
      <Panel
        flush
        className="mt-3"
        title={`In flight (${openOrders.length})`}
        actions={
          <Link href="/orders" className="flex items-center gap-1 text-xs text-accent hover:underline">
            Open the board
            <ArrowRight size={12} aria-hidden="true" />
          </Link>
        }
      >
        {open.loading && !open.data ? (
          <TableSkeleton rows={4} columns={5} />
        ) : openOrders.length === 0 ? (
          <EmptyState
            title="Nothing in flight"
            description="Every order placed so far has been delivered or cancelled."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Rider</th>
                  <th>Waiting</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.slice(0, 8).map((order) => (
                  <tr key={order.id}>
                    <td className="mono">#{order.id}</td>
                    <td>{order.customer_name}</td>
                    <td>
                      <StatusBadge status={order.status} label={order.status_label} />
                    </td>
                    <td className="text-ink-soft">{order.rider?.name ?? '—'}</td>
                    <td className={order.is_late ? 'text-danger' : 'text-ink-soft'}>
                      {relativeTime(order.created_at)}
                    </td>
                    <td className="num font-medium">{money(order.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* --- who is out there ------------------------------------------------
          Directly under the orders in flight, because the two are one question:
          a manager looking at "3 ready, no rider yet" needs to know whether
          anybody is actually moving before they decide it is a problem. */}
      <RiderLocationPanel className="mt-3" />
    </>
  );
}

function Alert({
  tone,
  icon,
  title,
  href,
}: {
  tone: 'danger' | 'warn';
  icon: React.ReactNode;
  title: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-[0.4rem] border px-3 py-2 text-sm transition-colors ${
        tone === 'danger'
          ? 'border-danger bg-danger-quiet text-danger hover:bg-danger-quiet/70'
          : 'border-warn bg-warn-quiet text-warn hover:bg-warn-quiet/70'
      }`}
    >
      {icon}
      <span className="font-medium">{title}</span>
      <ArrowRight size={13} className="ml-auto" aria-hidden="true" />
    </Link>
  );
}

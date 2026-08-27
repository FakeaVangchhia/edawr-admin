'use client';

import { useMemo, useState } from 'react';

import { BarChart, LineChart, OnTimeBar, StatTile } from '@/components/charts';
import { EmptyState, ErrorBanner, PageHeader, Panel } from '@/components/ui';
import {
  count,
  dateOnly,
  daysAgo,
  delta,
  minutes,
  money,
  moneyRounded,
  percent,
  today,
} from '@/lib/format';
import {
  analyticsCategories,
  analyticsDelivery,
  analyticsInventory,
  analyticsProducts,
  analyticsRevenue,
  analyticsSummary,
} from '@/lib/queries';
import { useResource } from '@/lib/use-resource';

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

export default function AnalyticsPage() {
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => today());

  const range = useMemo(() => ({ from, to }), [from, to]);
  const key = `${from}:${to}`;

  const summary = useResource(`summary:${key}`, (signal) => analyticsSummary(range, signal));
  const revenue = useResource(`revenue:${key}`, (signal) => analyticsRevenue(range, signal));
  const top = useResource(`top:${key}`, (signal) =>
    analyticsProducts({ ...range, limit: 8 }, signal),
  );
  const slow = useResource(`slow:${key}`, (signal) =>
    analyticsProducts({ ...range, limit: 8, direction: 'bottom' }, signal),
  );
  const categories = useResource(`cat:${key}`, (signal) => analyticsCategories(range, signal));
  const delivery = useResource(`del:${key}`, (signal) => analyticsDelivery(range, signal));
  const inventory = useResource('inventory', (signal) => analyticsInventory(signal));

  function applyPreset(days: number) {
    setFrom(daysAgo(days - 1));
    setTo(today());
  }

  const summaryData = summary.data;
  const deliveryData = delivery.data;
  const inventoryData = inventory.data;

  const revenuePoints = (revenue.data ?? []).map((point) => ({
    label: dateOnly(point.date),
    value: point.revenue,
  }));

  const orderPoints = (revenue.data ?? []).map((point) => ({
    label: dateOnly(point.date),
    value: point.orders,
  }));

  const anyError =
    summary.error || revenue.error || top.error || categories.error || delivery.error;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Revenue is booked when an order is placed, not when the cash arrives at the door."
        actions={
          <div className="flex items-end gap-2">
            {/* One row of filters above the charts, as a set. */}
            <div className="flex rounded-[0.4rem] bg-raised p-0.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  className="rounded-[0.3rem] px-2.5 py-1 text-xs font-medium text-ink-faint transition-colors hover:text-ink"
                  onClick={() => applyPreset(preset.days)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="field w-36"
              aria-label="From date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
            <input
              type="date"
              className="field w-36"
              aria-label="To date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        }
      />

      {anyError ? (
        <div className="mb-4">
          <ErrorBanner message={anyError} onRetry={() => summary.refresh()} />
        </div>
      ) : null}

      {/* --- headline ------------------------------------------------------ */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryData ? (
          <>
            <StatTile
              label="Revenue"
              value={money(summaryData.revenue.value)}
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
              label="Cancelled"
              value={percent(summaryData.cancellation_rate.value)}
              delta={delta(
                summaryData.cancellation_rate.value,
                summaryData.cancellation_rate.previous,
              )}
              tone={summaryData.cancellation_rate.value > 10 ? 'danger' : 'neutral'}
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="panel p-3.5">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-2 h-7 w-28" />
            </div>
          ))
        )}
      </div>

      {/* --- revenue and volume, as two charts ----------------------------
          Deliberately not one chart with two y-axes. Rupees and order counts
          have unrelated scales, and a dual axis lets the author choose where
          the two lines appear to cross — which is a conclusion drawn by the
          chart rather than by the data. Two panels, one scale each. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Revenue per day">
          {revenue.loading && !revenue.data ? (
            <div className="skeleton h-48" />
          ) : (
            <LineChart
              points={revenuePoints}
              formatValue={moneyRounded}
              ariaLabel="Revenue per day over the selected range"
            />
          )}
        </Panel>

        <Panel title="Orders per day">
          {revenue.loading && !revenue.data ? (
            <div className="skeleton h-48" />
          ) : (
            <LineChart
              points={orderPoints}
              formatValue={(value) => count(Math.round(value))}
              ariaLabel="Orders per day over the selected range"
            />
          )}
        </Panel>
      </div>

      {/* --- products ------------------------------------------------------ */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Best sellers">
          {top.data ? (
            <BarChart
              rows={top.data.map((row) => ({
                label: row.name,
                value: row.revenue,
                detail: `${count(row.units)} sold`,
              }))}
              formatValue={money}
              ariaLabel="Products ranked by revenue"
            />
          ) : (
            <div className="skeleton h-40" />
          )}
        </Panel>

        <Panel title="Slowest movers">
          {slow.data ? (
            slow.data.length === 0 ? (
              <EmptyState title="Nothing sold in this range" />
            ) : (
              <BarChart
                rows={slow.data.map((row) => ({
                  label: row.name,
                  value: row.revenue,
                  detail: `${count(row.units)} sold`,
                }))}
                formatValue={money}
                ariaLabel="Products with the fewest units sold"
              />
            )
          ) : (
            <div className="skeleton h-40" />
          )}
        </Panel>
      </div>

      {/* --- categories and delivery --------------------------------------- */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Revenue by category">
          {categories.data ? (
            <BarChart
              rows={categories.data.map((row) => ({
                label: row.category,
                value: row.revenue,
                detail: `${count(row.units)} units`,
              }))}
              formatValue={money}
              ariaLabel="Revenue by category"
            />
          ) : (
            <div className="skeleton h-40" />
          )}
        </Panel>

        <Panel title="The 15-minute promise">
          {deliveryData ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-ink-faint">On-time rate</p>
                  <p className="numeric text-2xl font-semibold">
                    {percent(deliveryData.on_time_rate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-faint">Average time to door</p>
                  <p className="numeric text-2xl font-semibold">
                    {minutes(deliveryData.average_minutes)}
                  </p>
                </div>
              </div>

              <OnTimeBar
                onTime={deliveryData.delivered - deliveryData.late}
                late={deliveryData.late}
              />

              {deliveryData.riders.length > 0 ? (
                <table className="table mt-4">
                  <thead>
                    <tr>
                      <th>Rider</th>
                      <th className="num">Delivered</th>
                      <th className="num">Late</th>
                      <th className="num">Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryData.riders.map((rider) => (
                      <tr key={rider.rider_id}>
                        <td>{rider.name}</td>
                        <td className="num">{count(rider.delivered)}</td>
                        <td className={`num ${rider.late > 0 ? 'text-danger' : ''}`}>
                          {count(rider.late)}
                        </td>
                        <td className="num">{minutes(rider.average_minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : (
            <div className="skeleton h-40" />
          )}
        </Panel>
      </div>

      {/* --- inventory ------------------------------------------------------ */}
      <Panel
        title="Stock on hand"
        className="mt-3"
        actions={
          <span className="text-xs text-ink-faint">
            A snapshot of right now — the date range does not apply.
          </span>
        }
      >
        {inventoryData ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Products"
                value={count(inventoryData.total_products)}
                delta={null}
                hint={`${count(inventoryData.active_products)} on sale`}
              />
              <StatTile
                label="Out of stock"
                value={count(inventoryData.out_of_stock)}
                delta={null}
                hint="Losing sales now"
                tone={inventoryData.out_of_stock > 0 ? 'danger' : 'neutral'}
              />
              <StatTile
                label="Low stock"
                value={count(inventoryData.low_stock)}
                delta={null}
                hint="Below reorder level"
                tone={inventoryData.low_stock > 0 ? 'warn' : 'neutral'}
              />
              <StatTile
                label="Stock value"
                value={moneyRounded(inventoryData.stock_value)}
                delta={null}
                hint="At cost, not retail"
              />
            </div>

            {inventoryData.items.length > 0 ? (
              <table className="table mt-4">
                <thead>
                  <tr>
                    <th>Needs reordering</th>
                    <th className="num">Units left</th>
                    <th className="num">Value at cost</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryData.items.map((item) => (
                    <tr key={item.product_id}>
                      <td>{item.name}</td>
                      <td className={`num ${item.units <= 0 ? 'text-danger font-medium' : ''}`}>
                        {count(item.units)}
                      </td>
                      <td className="num">{money(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : (
          <div className="skeleton h-40" />
        )}
      </Panel>
    </>
  );
}

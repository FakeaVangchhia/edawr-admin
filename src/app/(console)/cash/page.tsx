'use client';

import { useMemo, useState } from 'react';

import { StatTile } from '@/components/charts';
import { EmptyState, ErrorBanner, PageHeader, Panel, TableSkeleton } from '@/components/ui';
import { count, dateOnly, daysAgo, money, today } from '@/lib/format';
import { analyticsCash } from '@/lib/queries';
import { useResource } from '@/lib/use-resource';

/**
 * The till.
 *
 * Cash on delivery is the whole payment model, and until `paid_at` and
 * `amount_collected` existed the only way to answer "how much does this rider
 * owe?" was to sum what the orders were worth and trust it — the expected
 * figure standing in for the actual one, which is exactly the substitution a
 * cash business cannot make. Every number on this screen therefore comes in a
 * pair, and the only one worth looking at twice is the difference.
 *
 * **Not Admin-only.** Reconciling the till is how a Manager runs the store, so
 * this route carries no `RequireCapability` — the same reasoning that puts
 * Settings and Analytics in front of both roles.
 *
 * **Dated by when the money arrived, not when the order was placed.** The one
 * screen in the console where those differ: an order taken at 23:50 and
 * delivered at 00:05 is cash that reaches the shop the next day, and filing it
 * under the first would leave both days wrong and a rider arguing with a
 * report.
 */

const PRESETS = [
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
];

export default function CashPage() {
  const [from, setFrom] = useState(() => daysAgo(6));
  const [to, setTo] = useState(() => today());

  const range = useMemo(() => ({ from, to }), [from, to]);
  const cash = useResource(`cash:${from}:${to}`, (signal) => analyticsCash(range, signal));

  const data = cash.data;
  const short = (data?.shortfall ?? 0) > 0;

  function applyPreset(days: number) {
    setFrom(daysAgo(days - 1));
    setTo(today());
  }

  return (
    <>
      <PageHeader
        title="Cash"
        description="Counted by when the money reached the shop, not when the order was placed."
        actions={
          <div className="flex items-end gap-2">
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

      {cash.error ? (
        <div className="mb-4">
          <ErrorBanner message={cash.error} onRetry={() => cash.refresh()} />
        </div>
      ) : null}

      {/* Expected and collected side by side, never one without the other. A
          single "revenue" tile here is the exact mistake this screen exists to
          undo. */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Deliveries" value={count(data?.orders ?? 0)} />
        <StatTile
          label="Expected"
          value={money(data?.expected ?? 0)}
          hint="What the orders were worth"
        />
        <StatTile
          label="Collected"
          value={money(data?.collected ?? 0)}
          hint="What the riders recorded taking"
        />
        <StatTile
          label="Shortfall"
          value={money(data?.shortfall ?? 0)}
          tone={short ? 'danger' : 'good'}
          hint={
            short
              ? `${count(data?.short_orders ?? 0)} order${
                  (data?.short_orders ?? 0) === 1 ? '' : 's'
                } paid short`
              : 'Every delivery paid in full'
          }
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="By rider" flush>
          {cash.loading && !data ? (
            <TableSkeleton rows={4} columns={5} />
          ) : (data?.riders.length ?? 0) === 0 ? (
            <EmptyState
              title="Nothing collected yet"
              description="Deliveries in this window will appear here with what each rider took."
            />
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Cash by rider table">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Collected</th>
                    <th className="text-right">Shortfall</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.riders.map((rider) => (
                    <tr key={rider.rider_id ?? 'unattributed'}>
                      <td>
                        {/* A null rider is an order a manager closed from the
                            console. It still holds cash the store is owed, so
                            it gets a row rather than being dropped. */}
                        {rider.name ?? (
                          <span className="text-ink-faint">Closed from console</span>
                        )}
                      </td>
                      <td className="num text-right">{count(rider.orders)}</td>
                      <td className="num text-right">{money(rider.expected)}</td>
                      <td className="num text-right">{money(rider.collected)}</td>
                      <td
                        className={
                          rider.shortfall > 0
                            ? 'num text-right font-semibold text-danger'
                            : 'num text-right text-ink-faint'
                        }
                      >
                        {money(rider.shortfall)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="By day" flush>
          {cash.loading && !data ? (
            <TableSkeleton rows={4} columns={4} />
          ) : (data?.days.length ?? 0) === 0 ? (
            <EmptyState title="No deliveries in this window" />
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Cash by day table">
              <table className="table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.days.map((day) => (
                    <tr key={day.day}>
                      <td className="num">{dateOnly(day.day)}</td>
                      <td className="num text-right">{count(day.orders)}</td>
                      <td className="num text-right">{money(day.expected)}</td>
                      <td
                        className={
                          day.shortfall > 0
                            ? 'num text-right font-semibold text-danger'
                            : 'num text-right'
                        }
                      >
                        {money(day.collected)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

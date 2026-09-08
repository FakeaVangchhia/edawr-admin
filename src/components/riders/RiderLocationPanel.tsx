'use client';

import { MapPin } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, ErrorBanner, Panel, TableSkeleton } from '@/components/ui';
import { ageFromSeconds } from '@/lib/format';
import { listRiderLocations } from '@/lib/queries';
import { usePolling, useResource } from '@/lib/use-resource';
import type { RiderLocation } from '@/types';

/** How often the board asks. Matches the orders board, and roughly the rate the
 *  handsets report at — polling faster would only redraw the same fix. */
const REFRESH_MS = 10_000;

/**
 * Where everyone is, right now.
 *
 * **A stale position is shown, not hidden.** This is the opposite of what the
 * customer's tracking page does, and the asymmetry is deliberate. To a customer
 * a marker that has stopped moving reads as a rider who is nearly there, so the
 * API refuses to send one. To a manager, "last seen 4m ago" is the most useful
 * sentence on the screen — it is the difference between a rider whose phone is
 * in a pocket and a rider who is not working, and hiding the row would collapse
 * those two into an identical blank.
 *
 * So every active rider appears, always, in one of four states: moving, idle,
 * stale, or never reported. The row is never absent.
 *
 * There is no map here yet. That is not an oversight — the distances and ages
 * are the part a manager acts on, and they are legible now, on a laptop, with
 * no Google Cloud billing account and no change to the CSP in `src/proxy.ts`.
 * The map slots into this panel when the key exists.
 */
export function RiderLocationPanel({ className }: { className?: string }) {
  const locations = useResource('rider-locations', (signal) => listRiderLocations(signal));
  usePolling(locations.refresh, REFRESH_MS);

  const riders = locations.data ?? [];
  const live = riders.filter((rider) => !rider.is_stale);

  return (
    <Panel
      flush
      className={className}
      title={`Riders (${live.length}/${riders.length} reporting)`}
      actions={
        <Link href="/staff" className="text-xs text-accent hover:underline">
          Manage riders
        </Link>
      }
    >
      {locations.error ? (
        <div className="p-4">
          <ErrorBanner message={locations.error} onRetry={locations.refresh} />
        </div>
      ) : locations.loading && !locations.data ? (
        <TableSkeleton rows={3} columns={4} />
      ) : riders.length === 0 ? (
        <EmptyState
          title="No active riders"
          description="Nobody is on the roster yet, so there is nothing to track."
        />
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Active riders table">
          <table className="table">
            <thead>
              <tr>
                <th>Rider</th>
                <th>Carrying</th>
                <th>Position</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {riders.map((rider) => (
                <RiderRow key={rider.id} rider={rider} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function RiderRow({ rider }: { rider: RiderLocation }) {
  const positioned = rider.latitude !== null && rider.longitude !== null;

  return (
    <tr>
      <td>
        <span className="font-medium">{rider.name}</span>
        {!rider.is_available ? (
          <span className="ml-2 badge badge-neutral">Off duty</span>
        ) : null}
      </td>
      <td className="text-ink-soft">
        {rider.order_id ? (
          <Link href={`/orders?q=${rider.order_id}`} className="mono text-accent hover:underline">
            #{rider.order_id}
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td>
        {positioned ? (
          <span className="mono text-xs text-ink-soft">
            {rider.latitude!.toFixed(4)}, {rider.longitude!.toFixed(4)}
            {rider.accuracy_m !== null ? (
              /* Accuracy is here because a fix good to 2 km is not a position,
                 and without this a manager cannot tell one from a fix good to
                 5 m. It is the number that says whether to trust the other two. */
              <span className="ml-1.5 text-ink-faint">±{Math.round(rider.accuracy_m)}m</span>
            ) : null}
          </span>
        ) : (
          <span className="text-ink-faint">No signal yet</span>
        )}
      </td>
      <td>
        <SignalBadge rider={rider} />
      </td>
    </tr>
  );
}

/**
 * The four states, kept in one place so they cannot drift apart.
 *
 * "Never reported" is its own state rather than an extreme of stale: it means
 * the app has not been opened or has no location permission, which is a
 * different thing to fix from a rider riding through a dead spot.
 */
function SignalBadge({ rider }: { rider: RiderLocation }) {
  if (rider.age_seconds === null) {
    return <span className="badge badge-neutral">Never reported</span>;
  }
  if (rider.is_stale) {
    return (
      <span className="badge badge-warn numeric" title={rider.received_at ?? undefined}>
        {ageFromSeconds(rider.age_seconds)} ago
      </span>
    );
  }
  return (
    <span className="badge badge-ok numeric" title={rider.received_at ?? undefined}>
      <MapPin size={11} aria-hidden="true" className="mr-1 inline" />
      {ageFromSeconds(rider.age_seconds)} ago
    </span>
  );
}

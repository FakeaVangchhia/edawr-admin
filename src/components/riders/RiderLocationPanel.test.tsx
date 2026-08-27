import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RiderLocationPanel } from '@/components/riders/RiderLocationPanel';
import * as queries from '@/lib/queries';
import type { RiderLocation } from '@/types';

/**
 * What the console shows about where riders are.
 *
 * The rule under test is an asymmetry that is easy to "fix" by mistake: **the
 * console shows stale positions and the customer's tracking page hides them.**
 * The API enforces the customer half. Nothing but this file enforces the
 * console half, and the tempting simplification — filter out `is_stale` so the
 * board only shows live markers — is exactly the bug. A rider whose phone is in
 * a pocket would vanish from the roster and read as a rider who is not working,
 * which is the one conclusion a manager must not draw from this screen.
 *
 * So these assert that rows are *present*, in all four states, rather than that
 * the right ones were removed.
 */

function rider(overrides: Partial<RiderLocation> = {}): RiderLocation {
  return {
    id: 1,
    name: 'Ramthar',
    phone: '+919000000002',
    is_available: true,
    latitude: 23.764,
    longitude: 92.7178,
    accuracy_m: 12,
    speed_kmh: 18,
    heading: 95,
    received_at: '2026-08-28T10:00:00Z',
    age_seconds: 12,
    is_stale: false,
    order_id: 1043,
    ...overrides,
  };
}

function show(riders: RiderLocation[]) {
  vi.spyOn(queries, 'listRiderLocations').mockResolvedValue(riders);
  render(<RiderLocationPanel />);
}

describe('RiderLocationPanel', () => {
  it('shows a moving rider with their position, order and age', async () => {
    show([rider()]);

    expect(await screen.findByText('Ramthar')).toBeInTheDocument();
    expect(screen.getByText('#1043')).toBeInTheDocument();
    expect(screen.getByText(/23\.7640, 92\.7178/)).toBeInTheDocument();
    expect(screen.getByText('12s ago')).toBeInTheDocument();
  });

  it('keeps a stale rider on the board instead of hiding them', async () => {
    // The whole point. "Last seen 4m ago near Chanmari" is actionable; an
    // absent row is indistinguishable from a rider who is not on shift.
    show([rider({ is_stale: true, age_seconds: 254 })]);

    expect(await screen.findByText('Ramthar')).toBeInTheDocument();
    expect(screen.getByText('4m ago')).toBeInTheDocument();
    // Position is still rendered — it is the last place they were known to be.
    expect(screen.getByText(/23\.7640/)).toBeInTheDocument();
  });

  it('distinguishes a rider who has never reported from a stale one', async () => {
    // Different faults, different fixes: never-reported is a permission or an
    // app that was never opened; stale is a dead spot on the Durtlang road.
    show([
      rider({ id: 2, name: 'Zoram', latitude: null, longitude: null, accuracy_m: null,
              received_at: null, age_seconds: null, is_stale: true, order_id: null }),
    ]);

    expect(await screen.findByText('Never reported')).toBeInTheDocument();
    expect(screen.getByText('No signal yet')).toBeInTheDocument();
  });

  it('counts only the riders actually reporting in the heading', async () => {
    show([
      rider({ id: 1, name: 'Ramthar' }),
      rider({ id: 2, name: 'Zoram', is_stale: true, age_seconds: 600 }),
      rider({ id: 3, name: 'Vanlalruata', age_seconds: null, is_stale: true }),
    ]);

    // 3 riders on the roster, 1 whose fix is fresh.
    expect(await screen.findByText('Riders (1/3 reporting)')).toBeInTheDocument();
  });

  it('marks an off-duty rider without dropping their last position', async () => {
    show([rider({ is_available: false, order_id: null })]);

    expect(await screen.findByText('Off duty')).toBeInTheDocument();
    expect(screen.getByText(/23\.7640/)).toBeInTheDocument();
  });

  it('shows accuracy, so a two-kilometre guess is not read as a position', async () => {
    show([rider({ accuracy_m: 1840 })]);

    expect(await screen.findByText('±1840m')).toBeInTheDocument();
  });

  it('never renders a rider home base', async () => {
    // `base_latitude` is where a member of staff lives. The API does not send
    // it on this route; this asserts the console would not show it if it did.
    show([rider()]);
    await screen.findByText('Ramthar');

    expect(document.body.textContent).not.toContain('base_latitude');
    // The store's own coordinates, which is what a home base defaults to.
    expect(document.body.textContent).not.toContain('23.7272');
  });

  it('says so when there are no riders at all', async () => {
    show([]);
    expect(await screen.findByText('No active riders')).toBeInTheDocument();
  });

  it('surfaces a failure with a retry rather than an empty table', async () => {
    vi.spyOn(queries, 'listRiderLocations').mockRejectedValue(new Error('offline'));
    render(<RiderLocationPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
  });

  it('links a carrying rider to the order they hold', async () => {
    show([rider({ order_id: 1043 })]);

    const link = await screen.findByRole('link', { name: '#1043' });
    expect(link).toHaveAttribute('href', '/orders?q=1043');
  });

  it('shows an em dash rather than a zero for a rider carrying nothing', async () => {
    show([rider({ order_id: null })]);

    const row = (await screen.findByText('Ramthar')).closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('#0')).not.toBeInTheDocument();
  });
});

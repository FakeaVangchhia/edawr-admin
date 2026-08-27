'use client';

import { useState } from 'react';
import { ExternalLink, Info, Loader2 } from 'lucide-react';

import { ErrorBanner, PageHeader, Panel } from '@/components/ui';
import { API_BASE_URL, errorMessage } from '@/lib/api';
import { minutes, money } from '@/lib/format';
import { storeConfig, storeSettings, updateStoreSettings } from '@/lib/queries';
import { useResource } from '@/lib/use-resource';
import type { StoreSettings } from '@/types';

/**
 * Store settings — half of this page is editable and half deliberately is not,
 * and the split is the interesting part.
 *
 * **Read-only: the economics.** Fees, the free-delivery threshold, the minimum
 * order, the two delivery tiers. These come from environment variables on the
 * API server. They are pricing decisions, they change rarely, and changing one
 * should require the same care as a deploy — so there is nothing for a form
 * here to write to, and rendering editable-looking inputs wired to nothing
 * would be worse than showing none.
 *
 * **Editable: the operations.** Opening hours, the pause switch, the delivery
 * radius, the store's own position. These live in a `store_settings` table and
 * are written through `PATCH /api/settings`. They change *within* a shift and
 * the person changing them is behind the counter at the time. Requiring a
 * redeploy to pause checkout during a power cut means the shop carries on
 * promising 15-minute delivery it cannot make.
 *
 * That table is what closed three of the four gaps this page used to list at
 * the bottom.
 */
export default function SettingsPage() {
  const config = useResource('store-config', (signal) => storeConfig(signal));
  const settings = useResource('store-settings', (signal) => storeSettings(signal));
  const data = config.data;

  return (
    <>
      <PageHeader
        title="Settings"
        description="What the store promises, and whether it is open."
      />

      {config.error ? (
        <div className="mb-4">
          <ErrorBanner message={config.error} onRetry={config.refresh} />
        </div>
      ) : null}
      {settings.error ? (
        <div className="mb-4">
          <ErrorBanner message={settings.error} onRetry={settings.refresh} />
        </div>
      ) : null}

      {settings.data ? (
        <OperationsForm settings={settings.data} onSaved={settings.refresh} />
      ) : (
        <div className="skeleton mb-3 h-64" />
      )}

      <div className="mb-4 mt-3 flex items-start gap-2 rounded-[0.4rem] border border-line bg-raised px-3 py-2.5 text-xs text-ink-soft">
        <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <p>
          Everything below is read from the API server&apos;s environment, so it is shown here
          rather than edited here — changing one means changing the server&apos;s configuration
          and redeploying. Prices are deliberately not a thing this screen can change on a
          Tuesday afternoon.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Store">
          {data ? (
            <dl className="space-y-2 text-sm">
              <Row label="Name" value={data.store_name} />
              <Row label="City" value={data.store_city} />
              <Row label="Minimum order" value={money(data.min_order_value)} />
              <Row label="Free delivery above" value={money(data.free_delivery_above)} />
              <Row label="Handling fee" value={money(data.handling_fee)} />
            </dl>
          ) : (
            <div className="skeleton h-32" />
          )}
        </Panel>

        <Panel title="Delivery tiers">
          {data ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th className="num">Fee</th>
                  <th className="num">Promise</th>
                </tr>
              </thead>
              <tbody>
                {data.delivery_tiers.map((tier) => (
                  <tr key={tier.type}>
                    <td>
                      {tier.label}
                      {tier.type === data.default_delivery_type ? (
                        <span className="badge badge-accent ml-1.5">Default</span>
                      ) : null}
                    </td>
                    <td className="num">{money(tier.fee)}</td>
                    <td className="num">{minutes(tier.promise_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="skeleton h-32" />
          )}
        </Panel>
      </div>

      <Panel title="This console" className="mt-3">
        <dl className="space-y-2 text-sm">
          <Row label="API server" value={API_BASE_URL || 'Not configured'} mono />
        </dl>
        <p className="mt-3 text-xs text-ink-faint">
          If screens load but stay empty, this is the first thing to check — the browser blocks
          any request to an origin the console was not built to talk to.
        </p>
      </Panel>

      <Panel title="Known gaps" className="mt-3">
        {/* Stated rather than hidden. An operator who knows the system cannot
            do something will work around it; one who assumes it can will find
            out at the worst moment.

            Three entries were removed from this list because the thing they
            described was built, not because the list got tidied: opening hours
            and a pause switch, a delivery-zone check, and an exit for a
            dispatched order that cannot be delivered. */}
        <ul className="space-y-2 text-sm text-ink-soft">
          <Gap title="Cash is recorded as intent, not collection">
            The rider is told what to collect, and nothing records what they actually took. End of
            shift reconciliation means summing order totals and trusting them, which for a cash
            business is the main way money goes missing quietly.
          </Gap>
          <Gap title="No customer notification outside the browser tab">
            The tracking page is the only channel. Close the tab and the customer has no idea when
            the rider is coming — no SMS, no WhatsApp, no push.
          </Gap>
          <Gap title="No receipt and no tax fields">
            No printable invoice, no HSN codes, no GSTIN. A compliant tax invoice cannot be issued
            from this system if turnover crosses the registration threshold.
          </Gap>
          <Gap title="Straight-line distance">
            The delivery radius and rider ranking use direct distance. Aizawl is built on ridges,
            so the road can be several times it — a genuinely 6 km address may be a 20-minute ride.
          </Gap>
        </ul>
        <p className="mt-3 flex items-center gap-1 text-xs text-ink-faint">
          <ExternalLink size={12} aria-hidden="true" />
          These are tracked in the project&apos;s backlog, not discovered here.
        </p>
      </Panel>
    </>
  );
}

/**
 * The editable half.
 *
 * Local state seeded from the server row, and PATCHed back — only the fields
 * that were touched, because the endpoint is partial by design. A full replace
 * would mean the pause switch had to be resent with every edit to the hours,
 * and a screen that forgot would silently reopen a store somebody had shut.
 */
function OperationsForm({
  settings,
  onSaved,
}: {
  settings: StoreSettings;
  onSaved: () => void;
}) {
  /**
   * The draft, tagged with the server row it was seeded from.
   *
   * The obvious shape — `useState(settings)` plus an effect that re-seeds when
   * `settings` changes — is an error in this codebase
   * (`react-hooks/set-state-in-effect`), and the rule is right: that effect
   * fires a second render after every refetch, and the window between them is a
   * render showing stale edits over fresh data.
   *
   * Tagging instead means there is nothing to synchronise. `edits.from` is the
   * row this draft was built on; when the resource refetches, `settings` is a
   * new object, the tag no longer matches, and `draft` below falls back to the
   * server's values on the very same render. Same technique as `useResource`
   * itself and as the storefront's `useQuote`.
   */
  const [edits, setEdits] = useState<{ from: StoreSettings; value: StoreSettings } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const draft = edits?.from === settings ? edits.value : settings;

  const patch = <K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) => {
    setEdits({ from: settings, value: { ...draft, [key]: value } });
    setSaved('');
  };

  /** Everything the form owns, as the API wants it. */
  function wholeForm(): Partial<StoreSettings> {
    return {
      is_accepting_orders: draft.is_accepting_orders,
      closed_message: draft.closed_message,
      // The API takes `HH:MM` or `HH:MM:SS`; an <input type="time"> gives the
      // former, and the row comes back as the latter.
      opens_at: draft.opens_at,
      closes_at: draft.closes_at,
      delivery_radius_km: Number(draft.delivery_radius_km),
      store_latitude: Number(draft.store_latitude),
      store_longitude: Number(draft.store_longitude),
    };
  }

  /**
   * `body` is exactly what gets sent — no merging with the rest of the form.
   *
   * That distinction is the point. The pause switch saves on the click, because
   * it is the control someone reaches for during a power cut and making them
   * find a Save button afterwards is how orders keep arriving for another thirty
   * seconds. But if it sent the whole form, a manager who had half-typed a new
   * radius ("1" on the way to "12", or an emptied box, which `Number('')` makes
   * `0`) would silently ship that too — and a zero radius or a zero latitude
   * changes what checkout accepts. The switch now sends one field.
   */
  async function save(body: Partial<StoreSettings>) {
    setBusy(true);
    setError('');
    try {
      await updateStoreSettings(body);
      setSaved('Saved.');
      onSaved();
    } catch (caught) {
      // The server's own sentence. A slipped decimal point in the radius comes
      // back as "A radius over 100 km is almost certainly a mistake", which is
      // more useful than anything this screen could invent.
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const alwaysOpen = draft.opens_at.slice(0, 5) === draft.closes_at.slice(0, 5);

  return (
    <Panel title="Operations">
      {error ? (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      {/* Always mounted, text swapped — a region inserted at the moment its
          content first changes is not announced by most screen readers. */}
      <p role="status" aria-live="polite" className="mb-2 min-h-4 text-xs text-ok">
        {saved}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Taking orders
          </h3>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.is_accepting_orders}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.checked;
                patch('is_accepting_orders', next);
                // Saved immediately rather than on a button, because this is the
                // control someone reaches for during a power cut. Making them
                // find "Save" afterwards is how orders keep arriving for another
                // thirty seconds.
                void save({ is_accepting_orders: next });
              }}
            />
            <span>
              <span className="block font-medium text-ink">Accept new orders</span>
              <span className="block text-xs text-ink-faint">
                Unticking this stops checkout immediately, whatever the opening hours say. Use it
                for a stock-take, a power cut, or a shift with nobody to ride.
              </span>
            </span>
          </label>

          <div className="mt-3">
            <label className="label" htmlFor="closed-message">
              Message shown when closed
            </label>
            <input
              id="closed-message"
              className="field"
              placeholder="Back in 20 minutes"
              value={draft.closed_message}
              disabled={busy}
              onChange={(event) => patch('closed_message', event.target.value)}
            />
            <p className="mt-1 text-xs text-ink-faint">
              Shown to the customer word for word on the cart and at checkout. Leave it blank for a
              generic one.
            </p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Opening hours
          </h3>

          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label" htmlFor="opens-at">
                Opens
              </label>
              <input
                id="opens-at"
                type="time"
                className="field"
                value={draft.opens_at.slice(0, 5)}
                disabled={busy}
                onChange={(event) => patch('opens_at', event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="closes-at">
                Closes
              </label>
              <input
                id="closes-at"
                type="time"
                className="field"
                value={draft.closes_at.slice(0, 5)}
                disabled={busy}
                onChange={(event) => patch('closes_at', event.target.value)}
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            Local time in Aizawl. A window that crosses midnight works — 22:00 to 02:00 is a late
            shift, not an empty range.{' '}
            {alwaysOpen ? <strong className="text-ink">Equal times mean open 24 hours.</strong> : null}
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Delivery area
          </h3>

          <div>
            <label className="label" htmlFor="radius">
              Radius (km)
            </label>
            <input
              id="radius"
              type="number"
              step="0.5"
              min="0.5"
              className="field"
              value={draft.delivery_radius_km}
              disabled={busy}
              onChange={(event) => patch('delivery_radius_km', Number(event.target.value))}
            />
            <p className="mt-1 text-xs text-ink-faint">
              Checkout refuses an address further than this from the store. Straight-line distance,
              so allow for the ridges.
            </p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Where the store is
          </h3>

          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label" htmlFor="latitude">
                Latitude
              </label>
              <input
                id="latitude"
                type="number"
                step="0.0001"
                className="field"
                value={draft.store_latitude}
                disabled={busy}
                onChange={(event) => patch('store_latitude', Number(event.target.value))}
              />
            </div>
            <div>
              <label className="label" htmlFor="longitude">
                Longitude
              </label>
              <input
                id="longitude"
                type="number"
                step="0.0001"
                className="field"
                value={draft.store_longitude}
                disabled={busy}
                onChange={(event) => patch('store_longitude', Number(event.target.value))}
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            The centre the delivery radius is measured from. Change it if the shop moves.
          </p>
        </section>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => save(wholeForm())}
        >
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
          Save settings
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setEdits(null);
            setError('');
            setSaved('');
          }}
        >
          Discard changes
        </button>
      </div>
    </Panel>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
      <dt className="text-ink-faint">{label}</dt>
      <dd className={mono ? 'mono text-right' : 'numeric text-right font-medium'}>{value}</dd>
    </div>
  );
}

function Gap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li>
      <p className="font-medium text-ink">{title}</p>
      <p className="text-xs">{children}</p>
    </li>
  );
}

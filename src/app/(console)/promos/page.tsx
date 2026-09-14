'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { RequireCapability } from '@/components/shell/RequireCapability';
import {
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  Panel,
  TableSkeleton,
  useToast,
} from '@/components/ui';
import { PromoDrawer } from '@/components/promos/PromoDrawer';
import { assetUrl, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { describeLink } from '@/lib/promo-link';
import { deletePromo, listPromos } from '@/lib/queries';
import { useResource } from '@/lib/use-resource';
import type { Promo } from '@/types';

const PAGE_SIZE = 25;

export default function PromosPage() {
  return (
    <RequireCapability capability="promos">
      <Promos />
    </RequireCapability>
  );
}

/**
 * Is this banner showing on the storefront right now?
 *
 * The same rule as the API's `Promo.live()`, repeated here so the table can
 * say "Live" / "Scheduled" / "Ended" without a round trip. Only the label is
 * decided here; what a customer sees is decided by the server.
 */
function liveState(promo: Promo, now = Date.now()): 'live' | 'scheduled' | 'ended' | 'hidden' {
  if (promo.status !== 'active') return 'hidden';
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now) return 'scheduled';
  if (promo.ends_at && new Date(promo.ends_at).getTime() <= now) return 'ended';
  return 'live';
}

const STATE_LABEL = {
  live: ['Live', 'badge-ok'],
  scheduled: ['Scheduled', 'badge-info'],
  ended: ['Ended', 'badge-neutral'],
  hidden: ['Hidden', 'badge-neutral'],
} as const;

function Promos() {
  const [offset, setOffset] = useState(0);
  const promos = useResource(`promos:${offset}`, (signal) =>
    listPromos({ limit: PAGE_SIZE, offset }, signal),
  );
  const refresh = useCallback(() => promos.refresh(), [promos]);

  const [editing, setEditing] = useState<Promo | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Promo | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const toast = useToast();

  const rows = promos.data?.rows ?? [];
  const total = promos.data?.total ?? 0;

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setActionError('');
    try {
      await deletePromo(deleting.id);
      toast.success(`${deleting.title} taken down.`);
      setDeleting(null);
      // Deleting the only row on a later page would refetch an offset past
      // the end and show "No promotions yet" over a table that has twenty
      // five. Step back a page instead; the offset is the resource key, so
      // changing it is the refetch.
      if (rows.length === 1 && offset > 0) {
        setOffset(Math.max(0, offset - PAGE_SIZE));
      } else {
        refresh();
      }
    } catch (caught) {
      setActionError(errorMessage(caught));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  const newButton = (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus size={14} aria-hidden="true" />
      New promotion
    </button>
  );

  return (
    <>
      <PageHeader
        title="Promotions"
        description="The banners at the top of the storefront home. Order here is the order customers swipe through."
        actions={newButton}
      />

      {actionError ? (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      ) : null}
      {promos.error ? (
        <div className="mb-4">
          <ErrorBanner message={promos.error} onRetry={refresh} />
        </div>
      ) : null}

      <Panel flush>
        {promos.loading && !promos.data ? (
          <TableSkeleton columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No promotions yet"
            description="The storefront shows nothing in this slot until you add one — the page simply closes up. A banner needs a title; an image makes it worth looking at."
            action={newButton}
          />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Promotions table">
            <table className="table">
              <thead>
                <tr>
                  <th>Banner</th>
                  <th>Goes to</th>
                  <th className="num">Order</th>
                  <th>Window</th>
                  <th>Showing</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((promo) => {
                  const [label, tone] = STATE_LABEL[liveState(promo)];
                  return (
                    <tr key={promo.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          {promo.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={assetUrl(promo.image_url)}
                              alt=""
                              className="h-9 w-16 rounded-[0.3rem] border border-line object-cover"
                            />
                          ) : (
                            <div className="h-9 w-16 rounded-[0.3rem] border border-dashed border-line" />
                          )}
                          <div>
                            <p className="font-medium">{promo.title}</p>
                            {promo.subtitle ? (
                              <p className="text-2xs text-ink-faint">{promo.subtitle}</p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="text-ink-soft">{describeLink(promo.link)}</td>
                      <td className="num text-ink-soft">{promo.sort_order}</td>
                      <td className="text-2xs text-ink-soft">
                        {promo.starts_at || promo.ends_at ? (
                          <>
                            {promo.starts_at ? dateTime(promo.starts_at) : 'Now'}
                            {' → '}
                            {promo.ends_at ? dateTime(promo.ends_at) : 'until hidden'}
                          </>
                        ) : (
                          'Always'
                        )}
                      </td>
                      <td>
                        <span className={`badge ${tone}`}>{label}</span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setEditing(promo)}
                            aria-label={`Edit ${promo.title}`}
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-danger"
                            onClick={() => setDeleting(promo)}
                            aria-label={`Delete ${promo.title}`}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              total={total}
              limit={PAGE_SIZE}
              offset={offset}
              onOffset={setOffset}
              noun="promotions"
            />
          </div>
        )}
      </Panel>

      {creating || editing ? (
        <PromoDrawer
          promo={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(title) => {
            toast.success(editing ? `${title} saved.` : `${title} is up.`);
            setCreating(false);
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        destructive
        busy={busy}
        title={`Delete ${deleting?.title}?`}
        confirmLabel="Delete"
        message="It comes off the storefront immediately and its image is removed. To pause it instead, set it to Hidden."
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

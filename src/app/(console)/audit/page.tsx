'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { RequireCapability } from '@/components/shell/RequireCapability';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  Pagination,
  Panel,
  TableSkeleton,
} from '@/components/ui';
import { dateTime } from '@/lib/format';
import { listAudit } from '@/lib/queries';
import { useDebounced, useResource } from '@/lib/use-resource';
import type { AuditEntry } from '@/types';

const PAGE_SIZE = 40;

const ENTITIES = ['', 'product', 'category', 'order', 'staff', 'admin'];
const ACTIONS = ['', 'create', 'update', 'delete', 'status', 'assign', 'cancel'];

const ACTION_TONE: Record<string, string> = {
  create: 'badge-ok',
  update: 'badge-info',
  delete: 'badge-danger',
  cancel: 'badge-danger',
  status: 'badge-accent',
  assign: 'badge-accent',
};

export default function AuditPage() {
  return (
    <RequireCapability capability="audit">
      <Audit />
    </RequireCapability>
  );
}

/**
 * What everyone did, newest first.
 *
 * Admin-only, because a record that its subjects can curate is worth less than
 * one they cannot. Read-only in the strongest sense: there is no delete button
 * here and no endpoint behind one — trimming this table, if it ever needs
 * trimming, is a retention policy and a scheduled job, not a control beside the
 * entries.
 */
function Audit() {
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const debouncedSearch = useDebounced(search);

  const filters = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      entity: entity || undefined,
      action: action || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [debouncedSearch, entity, action, from, to, offset],
  );

  const key = JSON.stringify(filters);
  const entries = useResource(key, (signal) => listAudit(filters, signal));

  const rows = entries.data?.rows ?? [];
  const total = entries.data?.total ?? 0;

  function filtered<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setOffset(0);
    };
  }

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Every change made through the console or the rider app, and who made it."
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            className="field pl-8"
            placeholder="Search the log or a person's name"
            aria-label="Search the activity log"
            value={search}
            onChange={(event) => filtered(setSearch)(event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="entity-filter">
            What
          </label>
          <select
            id="entity-filter"
            className="field w-32"
            value={entity}
            onChange={(event) => filtered(setEntity)(event.target.value)}
          >
            {ENTITIES.map((option) => (
              <option key={option || 'all'} value={option}>
                {option ? option[0].toUpperCase() + option.slice(1) : 'Everything'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="action-filter">
            Action
          </label>
          <select
            id="action-filter"
            className="field w-32"
            value={action}
            onChange={(event) => filtered(setAction)(event.target.value)}
          >
            {ACTIONS.map((option) => (
              <option key={option || 'all'} value={option}>
                {option ? option[0].toUpperCase() + option.slice(1) : 'Any action'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="audit-from">
            From
          </label>
          <input
            id="audit-from"
            type="date"
            className="field w-36"
            value={from}
            onChange={(event) => filtered(setFrom)(event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="audit-to">
            To
          </label>
          <input
            id="audit-to"
            type="date"
            className="field w-36"
            value={to}
            onChange={(event) => filtered(setTo)(event.target.value)}
          />
        </div>
      </div>

      {entries.error ? (
        <div className="mb-4">
          <ErrorBanner message={entries.error} onRetry={entries.refresh} />
        </div>
      ) : null}

      <Panel flush>
        {entries.loading && !entries.data ? (
          <TableSkeleton columns={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Entries appear as soon as someone changes a product, moves an order or edits an account."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap text-ink-soft">
                        {dateTime(entry.created_at)}
                      </td>
                      <td>
                        <p className="font-medium">{entry.actor_label || 'System'}</p>
                        <p className="text-2xs text-ink-faint">
                          {entry.actor_kind === 'rider'
                            ? 'Rider'
                            : entry.actor_role
                              ? entry.actor_role[0].toUpperCase() + entry.actor_role.slice(1)
                              : 'System'}
                        </p>
                      </td>
                      <td>
                        <span className={`badge ${ACTION_TONE[entry.action] ?? 'badge-neutral'}`}>
                          {entry.action_label}
                        </span>
                        <span className="ml-1.5 text-2xs text-ink-faint">
                          {entry.entity}
                          {entry.entity_id ? ` #${entry.entity_id}` : ''}
                        </span>
                      </td>
                      <td>
                        <p>{entry.summary}</p>
                        {entry.changes ? <Changes changes={entry.changes} /> : null}
                      </td>
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
              noun="entries"
            />
          </>
        )}
      </Panel>
    </>
  );
}

/**
 * The field-level diff.
 *
 * Passwords and PINs never reach this: the recorder strips anything named like
 * a credential, and a reset is recorded as `pin_reset: no → yes` instead. So
 * this renders whatever it is given without needing to know what is sensitive.
 */
function Changes({ changes }: { changes: NonNullable<AuditEntry['changes']> }) {
  const fields = Object.entries(changes);
  if (fields.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5">
      {fields.map(([field, [before, after]]) => (
        <li key={field} className="text-2xs text-ink-faint">
          <span className="mono">{field}</span>{' '}
          <span className="line-through">{before ?? '—'}</span>{' '}
          <span aria-hidden="true">→</span>{' '}
          <span className="text-ink">{after ?? '—'}</span>
        </li>
      ))}
    </ul>
  );
}

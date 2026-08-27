'use client';

import { KeyRound, Pencil, Plus, UserMinus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Pagination,
  Panel,
  TableSkeleton,
} from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { dateOnly, phone as formatPhone } from '@/lib/format';
import { createStaff, deleteStaff, listRiders, listStaff, updateStaff } from '@/lib/queries';
import { useResource } from '@/lib/use-resource';
import type { StaffUser } from '@/types';

/**
 * Riders and store managers.
 *
 * **This screen has never existed before.** `POST /api/users` has been in the
 * API the whole time and no client called it, so the only way to create a rider
 * was `manage.py seed` — which deletes every row in the database first and
 * therefore cannot be run twice on a live store. A shop that lost a rider's PIN
 * had no way to reset it without shell access.
 *
 * Note what this is *not*: console logins. Those are `/accounts`, they live in a
 * different table, and only an Admin may touch them. Riders are operational
 * records — a Manager hires and stands down riders, because otherwise a store
 * cannot take on help at the weekend without ringing the owner.
 */
const PAGE_SIZE = 25;

export default function StaffPage() {
  const [roleFilter, setRoleFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const staff = useResource(`staff:${roleFilter}:${offset}`, (signal) =>
    listStaff({ role: roleFilter || undefined, limit: PAGE_SIZE, offset }, signal),
  );
  const refresh = useCallback(() => staff.refresh(), [staff]);

  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<StaffUser | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  // Memoised for the same reason as in accounts/page.tsx: `?? []` is a new
  // array each render, so an unmemoised `rows` makes the memo below pointless.
  const rows = useMemo(() => staff.data?.rows ?? [], [staff.data]);
  const total = staff.data?.total ?? 0;

  /**
   * The on-duty count comes from the whole roster, not from the visible page.
   *
   * `rows` is 25 rows since this table was paginated, so deriving the count
   * from it under-reports the moment a store has more than 25 staff — and with
   * the Role filter on "Managers" it reads "0 of 0 riders on duty", which is a
   * number a manager will act on during a rush. `/api/delivery/riders` returns
   * the full roster and is unpaged by design.
   */
  const roster = useResource('rider-roster', (signal) => listRiders(signal));
  const riders = useMemo(() => roster.data ?? [], [roster.data]);

  const changeRoleFilter = (next: string) => {
    setRoleFilter(next);
    // Back to page one. Without this, a manager on page 3 who narrows the
    // filter asks for offset 50 of a three-row result, sees an empty table, and
    // is told "51-3 of 3 staff" underneath it.
    setOffset(0);
  };

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setActionError('');
    try {
      const result = await deleteStaff(removing.id);
      // The backend deactivates rather than deletes anyone with delivery
      // history, and says so. Passing that sentence through matters: "deleted"
      // and "deactivated, because they have delivered orders" are different
      // outcomes and the operator should know which one happened.
      setNotice(result.detail ?? `${removing.name} was removed.`);
      setRemoving(null);
      refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Staff"
        description="Riders and managers. Console logins are managed separately, under Accounts."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            Add staff
          </button>
        }
      />

      <div className="mb-4 flex items-end gap-2">
        <div>
          <label className="label" htmlFor="role-filter">
            Role
          </label>
          <select
            id="role-filter"
            className="field w-40"
            value={roleFilter}
            onChange={(event) => changeRoleFilter(event.target.value)}
          >
            <option value="">Everyone</option>
            <option value="delivery">Riders</option>
            <option value="manager">Managers</option>
          </select>
        </div>
        <p className="pb-2 text-xs text-ink-faint numeric">
          {riders.filter((rider) => rider.is_active && rider.is_available).length} of{' '}
          {riders.filter((rider) => rider.is_active).length} riders on duty
        </p>
      </div>

      {notice ? (
        <div className="mb-4 rounded-[0.4rem] border border-info bg-info-quiet px-3 py-2 text-sm text-info">
          {notice}
        </div>
      ) : null}
      {actionError ? (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      ) : null}
      {staff.error ? (
        <div className="mb-4">
          <ErrorBanner message={staff.error} onRetry={refresh} />
        </div>
      ) : null}

      <Panel flush>
        {staff.loading && !staff.data ? (
          <TableSkeleton columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No staff yet"
            description="Add a rider so orders have somewhere to go. They sign in to the rider app with their phone number and a PIN."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden="true" />
                Add staff
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th className="num">Radius</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((person) => (
                  <tr key={person.id}>
                    <td className="font-medium">{person.name}</td>
                    <td>
                      <span className="badge badge-neutral">
                        {person.role === 'delivery' ? 'Rider' : 'Manager'}
                      </span>
                    </td>
                    <td className="mono text-ink-soft">{formatPhone(person.phone)}</td>
                    <td>
                      {!person.is_active ? (
                        <span className="badge badge-danger">Deactivated</span>
                      ) : person.role === 'delivery' && person.is_available ? (
                        <span className="badge badge-ok">On duty</span>
                      ) : person.role === 'delivery' ? (
                        <span className="badge badge-warn">Off duty</span>
                      ) : (
                        <span className="badge badge-neutral">Active</span>
                      )}
                    </td>
                    <td className="num text-ink-soft">
                      {person.role === 'delivery' ? `${person.service_radius_km ?? 0} km` : '—'}
                    </td>
                    <td className="text-ink-soft">{dateOnly(person.created_at)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditing(person)}
                          aria-label={`Edit ${person.name}`}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                        {person.is_active ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-danger"
                            onClick={() => setRemoving(person)}
                            aria-label={`Deactivate ${person.name}`}
                          >
                            <UserMinus size={13} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              total={total}
              limit={PAGE_SIZE}
              offset={offset}
              onOffset={setOffset}
              noun="staff"
            />
          </div>
        )}
      </Panel>

      {creating || editing ? (
        <StaffDrawer
          person={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            setNotice('');
            refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        destructive
        busy={busy}
        title={`Deactivate ${removing?.name}?`}
        confirmLabel="Deactivate"
        message="They stop being offered orders and can no longer sign in — immediately, not when their token expires. If they have delivered anything their record is kept so past orders still show who delivered them."
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </>
  );
}

function StaffDrawer({
  person,
  onClose,
  onSaved,
}: {
  person: StaffUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(person?.name ?? '');
  const [role, setRole] = useState<StaffUser['role']>(person?.role ?? 'delivery');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [pin, setPin] = useState('');
  const [radius, setRadius] = useState(String(person?.service_radius_km ?? 10));
  const [isActive, setIsActive] = useState(person?.is_active ?? true);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setFieldErrors({});

    if (!name.trim()) {
      setFieldErrors({ name: 'A name is required.' });
      return;
    }
    if (!person && role === 'delivery' && !pin) {
      setFieldErrors({ pin: 'A rider needs a PIN to sign in.' });
      return;
    }

    setSaving(true);
    try {
      const body: Partial<StaffUser> & { pin?: string } = {
        name: name.trim(),
        role,
        phone: phone.trim(),
        is_active: isActive,
        service_radius_km: Number(radius) || 10,
      };
      // Omitted rather than sent empty. The staff PUT is partial precisely so
      // an unchanged PIN survives a save — sending "" would fail validation,
      // and sending null would clear their ability to sign in.
      if (pin) body.pin = pin;

      if (person) {
        await updateStaff(person.id, body);
      } else {
        await createStaff(body);
      }
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = caught.fieldErrors;
        if (fields) {
          setFieldErrors(
            Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.join(' ')])),
          );
        }
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={person ? `Edit ${person.name}` : 'Add staff'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="staff-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="staff-form" onSubmit={onSubmit} className="space-y-3" noValidate>
        {error ? <ErrorBanner message={error} /> : null}

        <Field label="Name" required error={fieldErrors.name}>
          {(props) => (
            <input
              {...props}
              className={`field ${fieldErrors.name ? 'field-invalid' : ''}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field label="Role">
          {(props) => (
            <select
              {...props}
              className="field"
              value={role}
              onChange={(event) => setRole(event.target.value as StaffUser['role'])}
            >
              <option value="delivery">Rider — delivers orders</option>
              <option value="manager">Manager — a staff record only</option>
            </select>
          )}
        </Field>

        {role === 'manager' ? (
          <p className="rounded-[0.4rem] border border-line bg-raised px-3 py-2 text-xs text-ink-soft">
            A manager record here is operational data — a name and a number on the
            staff list. It grants no access to anything. To let someone sign in to
            this console, an Admin creates an account under <strong>Accounts</strong>.
          </p>
        ) : null}

        <Field
          label="Phone"
          required
          hint="Indian mobile number. Stored as +91XXXXXXXXXX however it is typed."
          error={fieldErrors.phone}
        >
          {(props) => (
            <input
              {...props}
              className={`field ${fieldErrors.phone ? 'field-invalid' : ''}`}
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </Field>

        {role === 'delivery' ? (
          <>
            <Field
              label={person ? 'Reset PIN' : 'PIN'}
              required={!person}
              hint={
                person
                  ? 'Leave blank to keep the current PIN.'
                  : '4 to 12 digits. Not 1234, and not all the same digit.'
              }
              error={fieldErrors.pin}
            >
              {(props) => (
                <input
                  {...props}
                  className={`field mono ${fieldErrors.pin ? 'field-invalid' : ''}`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                />
              )}
            </Field>

            {pin && person ? (
              <p className="flex items-start gap-1.5 text-xs text-warn">
                <KeyRound size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                This replaces their PIN. It cannot be read back afterwards — tell them
                before saving.
              </p>
            ) : null}

            <Field label="Service radius (km)" hint="How far from the store they are offered orders.">
              {(props) => (
                <input
                  {...props}
                  className="field"
                  type="number"
                  min={1}
                  step="0.5"
                  value={radius}
                  onChange={(event) => setRadius(event.target.value)}
                />
              )}
            </Field>
          </>
        ) : null}

        {person ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active — can sign in and be offered orders
          </label>
        ) : null}
      </form>
    </Drawer>
  );
}

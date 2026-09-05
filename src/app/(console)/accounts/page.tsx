'use client';

import { Info, Pencil, Plus, ShieldOff } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { RequireCapability } from '@/components/shell/RequireCapability';
import {
  ConfirmDialog,
  Drawer,
  ErrorBanner,
  Field,
  PageHeader,
  Pagination,
  Panel,
  TableSkeleton,
  useToast,
} from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/guard';
import { dateOnly, dateTime } from '@/lib/format';
import { createAccount, deactivateAccount, listAccounts, updateAccount } from '@/lib/queries';
import { useResource } from '@/lib/use-resource';
import { useSession } from '@/lib/use-session';
import type { AdminAccount, Role } from '@/types';

export default function AccountsPage() {
  return (
    <RequireCapability capability="accounts">
      <Accounts />
    </RequireCapability>
  );
}

/**
 * Who may sign in to this console, and as what.
 *
 * The screen an Admin has and a Manager does not. Everything else in the
 * console is about the store; this is about the console itself, which is why it
 * is the one capability the roles differ by (along with the activity log).
 *
 * **The lockout guards are shown, not just enforced.** The API refuses to demote
 * or deactivate the last active Admin with a 409, and it would be perfectly
 * correct to let the operator find that out by clicking. It is nicer, and
 * cheaper in support calls, to disable the control and say why beside it —
 * so the rule is visible before it is hit rather than only after.
 */
const PAGE_SIZE = 25;

function Accounts() {
  const session = useSession();
  const [offset, setOffset] = useState(0);
  const accounts = useResource(`accounts:${offset}`, (signal) =>
    listAccounts({ limit: PAGE_SIZE, offset }, signal),
  );
  const refresh = useCallback(() => accounts.refresh(), [accounts]);

  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState<AdminAccount | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const toast = useToast();

  // Memoised because `?? []` produces a new array on every render, which would
  // make the memo below recompute every time and defeat its purpose.
  const rows = useMemo(() => accounts.data?.rows ?? [], [accounts.data]);
  const total = accounts.data?.total ?? 0;

  /**
   * Mirrors the backend's guard so the UI can explain it in advance — and to
   * mirror it, this has to see **every** Admin, not the page in front of you.
   *
   * Derived from `rows` it counted a page. With 30 accounts and the second
   * active Admin on page 2, page 1 saw one, locked the controls with "This is
   * the last active Admin", and refused an operation `admins.py` would have
   * allowed. A guard that is stricter than the rule it mirrors is its own bug:
   * it teaches the operator that the console is wrong, which is worse than not
   * warning them at all.
   *
   * A separate query, filtered server-side to the Admin role, so it stays small
   * whatever the roster does.
   */
  const adminRoster = useResource('admin-roster', (signal) =>
    listAccounts({ role: 'admin', limit: 200 }, signal),
  );
  const activeAdmins = useMemo(
    () => (adminRoster.data?.rows ?? []).filter((row) => row.is_active),
    [adminRoster.data],
  );

  function lockReason(account: AdminAccount): string | null {
    if (session && account.email === session.email) {
      return 'You cannot change your own role or deactivate yourself. Ask another Admin.';
    }
    if (account.role === 'admin' && account.is_active && activeAdmins.length === 1) {
      return 'This is the last active Admin. Promote another account first, or nobody could administer the console.';
    }
    return null;
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    setBusy(true);
    setActionError('');
    try {
      const result = await deactivateAccount(deactivating.id);
      // The server's sentence when it has one — it is the only thing that can
      // report an outcome other than the one that was asked for.
      if (result.detail) {
        toast.info(result.detail);
      } else {
        toast.success(`${deactivating.email} can no longer sign in.`);
      }
      setDeactivating(null);
      refresh();
      // The lock guard reads its own query, so it has to be told too — else
      // deactivating the second-to-last Admin leaves the last one unlocked
      // until a reload.
      adminRoster.refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
      setDeactivating(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Console accounts"
        description="Who can sign in here. Riders and store staff are managed under Staff."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            New account
          </button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-[0.4rem] border border-line bg-raised px-3 py-2.5 text-xs text-ink-soft">
        <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <p>
          <strong className="text-ink">Managers</strong> run the store — products, categories,
          orders, riders, prices, settings and every figure in Analytics.{' '}
          <strong className="text-ink">Admins</strong> can additionally create accounts, change
          roles, and read the activity log. A role change takes effect on that person&apos;s very
          next action; they do not need to sign out.
        </p>
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      ) : null}
      {accounts.error ? (
        <div className="mb-4">
          <ErrorBanner message={accounts.error} onRetry={refresh} />
        </div>
      ) : null}

      <Panel flush>
        {accounts.loading && !accounts.data ? (
          <TableSkeleton columns={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last signed in</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => {
                  const locked = lockReason(account);
                  const isSelf = session?.email === account.email;

                  return (
                    <tr key={account.id}>
                      <td>
                        <p className="font-medium">
                          {account.name || account.email}
                          {isSelf ? (
                            <span className="badge badge-neutral ml-1.5">You</span>
                          ) : null}
                        </p>
                        {account.name ? (
                          <p className="text-2xs text-ink-faint">{account.email}</p>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            account.role === 'admin' ? 'badge-accent' : 'badge-neutral'
                          }`}
                        >
                          {ROLE_LABEL[account.role]}
                        </span>
                      </td>
                      <td>
                        {account.is_active ? (
                          <span className="badge badge-ok">Active</span>
                        ) : (
                          <span className="badge badge-danger">Deactivated</span>
                        )}
                      </td>
                      <td className="text-ink-soft">
                        {account.last_login_at ? dateTime(account.last_login_at) : 'Never'}
                      </td>
                      <td className="text-ink-soft">{dateOnly(account.created_at)}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setEditing(account)}
                            aria-label={`Edit ${account.email}`}
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-danger"
                            disabled={!account.is_active || locked !== null}
                            title={locked ?? 'Deactivate this account'}
                            onClick={() => setDeactivating(account)}
                            aria-label={`Deactivate ${account.email}`}
                          >
                            <ShieldOff size={13} aria-hidden="true" />
                          </button>
                        </div>
                        {locked && account.is_active ? (
                          <p className="mt-0.5 max-w-56 text-right text-2xs text-ink-faint">
                            {locked}
                          </p>
                        ) : null}
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
              noun="accounts"
            />
          </div>
        )}
      </Panel>

      {creating || editing ? (
        <AccountDrawer
          account={editing}
          isSelf={editing !== null && session?.email === editing.email}
          lockReason={editing ? lockReason(editing) : null}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(saved) => {
            toast.success(
              editing
                ? `${saved.email} saved.`
                : `${saved.email} can sign in now, as a ${ROLE_LABEL[saved.role]}.`,
            );
            setCreating(false);
            setEditing(null);
            refresh();
            // Creating an Admin, or changing someone's role, changes the answer
            // to "is this the last one?".
            adminRoster.refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deactivating !== null}
        destructive
        busy={busy}
        title={`Deactivate ${deactivating?.email}?`}
        confirmLabel="Deactivate"
        message="They lose access immediately — the check runs on every request, not when their token expires. The account is kept rather than deleted, so the activity log still shows what they did."
        onCancel={() => setDeactivating(null)}
        onConfirm={confirmDeactivate}
      />
    </>
  );
}

function AccountDrawer({
  account,
  isSelf,
  lockReason,
  onClose,
  onSaved,
}: {
  account: AdminAccount | null;
  isSelf: boolean;
  lockReason: string | null;
  onClose: () => void;
  /** Reports the account as saved, so the caller can name it in a confirmation. */
  onSaved: (saved: { email: string; role: Role }) => void;
}) {
  const [email, setEmail] = useState(account?.email ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [role, setRole] = useState<Role>(account?.role ?? 'manager');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const roleLocked = lockReason !== null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setFieldErrors({});

    if (!email.trim()) {
      setFieldErrors({ email: 'An email is required.' });
      return;
    }
    if (!account && password.length < 8) {
      setFieldErrors({ password: 'Use at least 8 characters.' });
      return;
    }

    setSaving(true);
    try {
      if (account) {
        const body: Parameters<typeof updateAccount>[1] = {
          email: email.trim(),
          name: name.trim(),
        };
        // Only sent when it is allowed to change, so a locked select cannot
        // round-trip a value the server would refuse anyway.
        if (!roleLocked) body.role = role;
        // Omitted rather than sent empty — an empty password would be a
        // validation error, and the API leaves the hash alone when it is absent.
        if (password) body.password = password;
        await updateAccount(account.id, body);
      } else {
        await createAccount({
          email: email.trim(),
          name: name.trim(),
          role,
          password,
        });
      }
      onSaved({ email: email.trim(), role: account && roleLocked ? account.role : role });
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
      title={account ? `Edit ${account.email}` : 'New console account'}
      description={
        account ? undefined : 'They can sign in as soon as you save. There is no invitation email.'
      }
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="account-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="account-form" onSubmit={onSubmit} className="space-y-3" noValidate>
        {error ? <ErrorBanner message={error} /> : null}

        <Field label="Email" required error={fieldErrors.email} hint="Stored in lower case.">
          {(props) => (
            <input
              {...props}
              className={`field ${fieldErrors.email ? 'field-invalid' : ''}`}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>

        <Field label="Name" hint="Shown in the console header and the activity log.">
          {(props) => (
            <input
              {...props}
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Role"
          error={fieldErrors.role}
          hint={
            roleLocked
              ? undefined
              : 'Managers run the store. Admins additionally manage accounts and read the activity log.'
          }
        >
          {(props) => (
            <select
              {...props}
              className="field"
              value={role}
              disabled={roleLocked}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          )}
        </Field>

        {roleLocked ? (
          <p className="rounded-[0.4rem] border border-warn bg-warn-quiet px-3 py-2 text-xs text-warn">
            {lockReason}
          </p>
        ) : null}

        <Field
          label={account ? 'Set a new password' : 'Password'}
          required={!account}
          error={fieldErrors.password}
          hint={
            account
              ? 'Leave blank to keep the current password.'
              : 'At least 8 characters. It cannot be read back afterwards.'
          }
        >
          {(props) => (
            <input
              {...props}
              className={`field ${fieldErrors.password ? 'field-invalid' : ''}`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        {isSelf && password ? (
          <p className="rounded-[0.4rem] border border-info bg-info-quiet px-3 py-2 text-xs text-info">
            You are changing your own password. Your current session keeps working — sign in with
            the new one next time.
          </p>
        ) : null}
      </form>
    </Drawer>
  );
}

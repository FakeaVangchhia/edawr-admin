'use client';

/**
 * The console's UI primitives.
 *
 * Hand-built on the `@layer components` classes in `globals.css`, matching the
 * storefront's approach — this project has no component library, and adding one
 * for a dozen primitives would be a larger dependency than the code it saves.
 *
 * They are collected in one file because each is small and they are always
 * imported together; splitting twelve twenty-line components across twelve
 * files makes them harder to read, not easier.
 */

import { X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';

import { clsx } from 'clsx';

/* Re-exported so every screen still imports its UI from one place. The toast
   lives in its own file because it is a provider that owns a queue, and
   everything else here is presentational and stateless. */
export { ToastProvider, useToast, type Toaster } from './toast';

/* --- layout -------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-sm text-ink-faint">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  flush,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Drop the body padding — for a panel whose only child is a table. */
  flush?: boolean;
}) {
  return (
    <section className={clsx(flush ? 'panel-flush' : 'panel', className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

/* --- feedback ------------------------------------------------------------ */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-ink-faint">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * An error banner.
 *
 * `role="alert"` so it is announced. Always rendered when there is a message
 * rather than mounted conditionally inside a live region — a conditionally
 * mounted `aria-live` element is not announced by most screen readers, which is
 * the bug the storefront's order tracker has.
 */
export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-[0.4rem] border border-danger bg-danger-quiet px-3 py-2 text-sm text-danger"
    >
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="p-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="mb-2 flex gap-3">
          {Array.from({ length: columns }).map((__, column) => (
            <div
              key={column}
              className="skeleton h-5"
              style={{ width: column === 0 ? '32%' : '14%' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* --- drawer -------------------------------------------------------------- */

/**
 * A right-hand drawer for editing one record.
 *
 * Three behaviours that are easy to leave out and each of which makes the thing
 * unusable for somebody:
 *
 * - **Body scroll lock.** Without it the table scrolls behind the open form on
 *   a phone, which is exactly the bug in the storefront's checkout sheet.
 * - **Focus trap.** Tab must not walk out of an open dialog into the page
 *   behind it, or a keyboard user is silently editing a form they cannot see.
 * - **Focus restore.** On close, focus returns to whatever opened the drawer,
 *   so a keyboard user is not dumped back at the top of the document.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'relative flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl',
          wide ? 'max-w-2xl' : 'max-w-md',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs text-ink-faint">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* --- confirm ------------------------------------------------------------- */

/**
 * A confirmation dialog for destructive actions.
 *
 * Not `window.confirm`: that is unstyleable, blocks the whole tab, and cannot
 * explain *why* an action is irreversible — and the difference between
 * "deactivate, which you can undo" and "delete, which you cannot" is exactly
 * what the operator needs to be told before they click.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  busy,
  /** Blocks Confirm while the dialog's own input is incomplete. */
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55" onClick={onCancel} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel relative w-full max-w-sm p-4"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <div className="mt-1.5 text-sm text-ink-soft">{message}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={clsx('btn', destructive ? 'btn-danger' : 'btn-primary')}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            autoFocus
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --- fields -------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* --- paging -------------------------------------------------------------- */

export function Pagination({
  total,
  limit,
  offset,
  onOffset,
  noun = 'rows',
}: {
  total: number;
  limit: number;
  offset: number;
  onOffset: (next: number) => void;
  noun?: string;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const canPrevious = offset > 0;
  const canNext = to < total;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-ink-faint">
      {/* The exact range, not just a page number: "showing 51-100 of 337"
          answers "did my filter work" in a way "page 2" does not. */}
      <span className="numeric">
        {from}–{to} of {total} {noun}
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          disabled={!canPrevious}
          onClick={() => onOffset(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          disabled={!canNext}
          onClick={() => onOffset(offset + limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* --- badges -------------------------------------------------------------- */

const STATUS_TONE: Record<string, string> = {
  Placed: 'badge-info',
  Packing: 'badge-accent',
  Ready: 'badge-warn',
  Dispatched: 'badge-accent',
  Delivered: 'badge-ok',
  Cancelled: 'badge-danger',
  Failed: 'badge-danger',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={clsx('badge', STATUS_TONE[status] ?? 'badge-neutral')}>
      {label ?? status}
    </span>
  );
}

export function StockBadge({ stock, reorderLevel }: { stock: number; reorderLevel: number }) {
  if (stock <= 0) return <span className="badge badge-danger">Out of stock</span>;
  if (stock <= reorderLevel) return <span className="badge badge-warn">Low</span>;
  return <span className="badge badge-neutral">In stock</span>;
}

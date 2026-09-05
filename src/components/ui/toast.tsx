'use client';

/**
 * Transient confirmations.
 *
 * The console could write to the API in a dozen places and tell you nothing
 * about any of them: a product saved, a stock count corrected, an order moved
 * to Packing, a rider reassigned — the drawer shut, the table refreshed, and
 * that was the whole answer. On a slow connection the two are indistinguishable
 * from a click that did not register, which is how an order gets advanced
 * twice and how a stock count gets typed in again.
 *
 * **This carries successes only. Failures stay inline, in `ErrorBanner`,
 * where they were.** The two are not symmetric: a confirmation is something you
 * glance at and let go, and an error is something you have to read and act on,
 * so putting an error in something that vanishes after four seconds is how a
 * 409 gets missed. The one nuance is `info`, which is for a server sentence
 * that reports a *different* outcome than the one asked for — "deactivated
 * rather than deleted, because they have delivered orders" — and which
 * therefore stays up long enough to be read.
 *
 * Kept out of `index.tsx` deliberately: everything in there is presentational
 * and stateless, and this is a provider that owns a queue.
 */

import { CheckCircle2, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { clsx } from 'clsx';

type Tone = 'success' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: Tone;
  duration: number;
}

/** How long each tone stays up. Info is longer because it is read, not glanced at. */
const DURATION: Record<Tone, number> = {
  success: 4000,
  info: 9000,
};

export interface Toaster {
  /** "Saved", "Order #12 is packing" — the happy path, in the past tense. */
  success: (message: string) => void;
  /** An outcome worth reading, usually a sentence the server chose. */
  info: (message: string) => void;
}

/**
 * Defaults to a no-op rather than throwing on a missing provider.
 *
 * A drawer rendered in a test, or any screen mounted outside the console
 * layout, should not crash for want of a confirmation message — the toast is
 * the least important thing on screen at the moment it fires.
 */
const ToastContext = createContext<Toaster>({
  success: () => {},
  info: () => {},
});

export function useToast(): Toaster {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Ids come from a ref, not from the array's length: two toasts raised and one
  // dismissed would otherwise reuse an id and React would reconcile the wrong
  // one away.
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message: string, tone: Tone) => {
    const id = nextId.current++;
    setToasts((current) => {
      const next = [...current, { id, message, tone, duration: DURATION[tone] }];
      // Three at once is already more than anyone reads. Beyond that the oldest
      // goes, so a burst of saves cannot walk the stack off the top of the screen.
      return next.slice(-3);
    });
  }, []);

  const toaster = useMemo<Toaster>(
    () => ({
      success: (message: string) => push(message, 'success'),
      info: (message: string) => push(message, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      {/* Always mounted, even with nothing in it. A live region inserted at the
          moment its first message arrives is not announced by most screen
          readers — the same reason `ErrorBanner` is rendered rather than
          conditionally created. */}
      <div
        role="status"
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { id, duration } = toast;

  // Self-dismissing. The timer lives with the row rather than in the provider
  // so it is torn down by unmounting — a toast dismissed by hand cannot leave a
  // timer behind that removes whatever has taken its place.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]);

  const Icon = toast.tone === 'success' ? CheckCircle2 : Info;

  return (
    <div
      className={clsx(
        'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-[0.4rem] border px-3 py-2 text-sm shadow-lg motion-safe:animate-[toast-in_140ms_var(--ease-out-quick)]',
        toast.tone === 'success'
          ? 'border-ok bg-ok-quiet text-ok'
          : 'border-info bg-info-quiet text-info',
      )}
    >
      <Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{toast.message}</p>
      <button
        type="button"
        className="-mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

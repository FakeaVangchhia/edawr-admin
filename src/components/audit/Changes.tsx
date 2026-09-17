'use client';

import type { AuditEntry } from '@/types';

/**
 * The field-level diff.
 *
 * Passwords and PINs never reach this: the recorder strips anything named like
 * a credential, and a reset is recorded as `pin_reset: no → yes` instead. So
 * this renders whatever it is given without needing to know what is sensitive.
 */
export function Changes({ changes }: { changes: NonNullable<AuditEntry['changes']> }) {
  const fields = Object.entries(changes);
  if (fields.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5">
      {fields.map(([field, change]) => (
        <li key={field} className="text-2xs text-ink-faint">
          <span className="mono">{field}</span>{' '}
          {isPair(change) ? (
            <>
              <span className="line-through">{show(change[0])}</span>{' '}
              <span aria-hidden="true">→</span>{' '}
              <span className="text-ink">{show(change[1])}</span>
            </>
          ) : (
            // Not every entry is a before/after pair: the API's auto-assign
            // row carries `auto: true` as a flag beside the real change, and
            // a renderer that destructured every value as a pair took the
            // whole screen down on the first order dispatch found a rider for.
            <span className="text-ink">{show(change)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function isPair(change: unknown): change is [unknown, unknown] {
  return Array.isArray(change) && change.length === 2;
}

/** A value from the log as a word: `null` is a dash, a flag is yes/no. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

'use client';

import { useState } from 'react';

/**
 * An editable field whose initial value arrives *after* the first render.
 *
 * Every localStorage-backed store in this app returns its empty value until
 * `subscribe` runs, which React does in an effect after mount — that is what
 * keeps the server-rendered HTML and the first client render in agreement (see
 * `lib/local-store.ts`). So `useState(profile.name)` captures `''`, always, and
 * then throws the real value away when it lands a tick later: the remembered
 * name never reaches the input, and saving the form writes the blank back over
 * the stored one.
 *
 * The fix is the same tag-and-derive shape used for fetched data elsewhere in
 * this codebase. The edit is stored *with the value it was made against*, and
 * the displayed value is derived rather than stored:
 *
 * - no edit yet, or the source has changed underneath it → show the source
 * - the source is unchanged since the edit → show the edit
 *
 * Which means hydration replaces an untouched field, and a write from another
 * tab replaces it too, while anything the customer actually typed survives.
 * Nothing is set inside an effect, so `react-hooks/set-state-in-effect` — an
 * error in this project, not a warning — has nothing to complain about.
 */
export function useDraft(
  source: string,
): [value: string, setValue: (next: string) => void, reset: () => void] {
  const [draft, setDraft] = useState<{ from: string; value: string } | null>(null);
  const value = draft !== null && draft.from === source ? draft.value : source;
  return [
    value,
    (next: string) => setDraft({ from: source, value: next }),
    // Explicit, because writing `''` is a legitimate edit here — a customer
    // clearing the address field means the field is empty, not that it should
    // spring back to the saved one. Only `reset` hands control back.
    () => setDraft(null),
  ];
}

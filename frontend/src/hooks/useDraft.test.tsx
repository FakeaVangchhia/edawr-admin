import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { useDraft } from '@/hooks/useDraft';

/**
 * The hook that lets a localStorage-backed value reach an input.
 *
 * Worth testing carefully despite being ten lines, because every failure mode
 * it has is silent. The one it was written for: a customer's saved name and
 * address never appearing in the checkout form, and the blank being written
 * back over the stored value on save. The one it introduced and then fixed:
 * deleting the last character of a saved address refilling it from the store,
 * so the field could not be emptied.
 *
 * Mounted with `react-dom/client` and React's own `act` rather than Testing
 * Library, which the storefront does not install (see `ImageFallback.test.tsx`
 * for the same constraint). A hook holding state cannot be exercised with
 * `renderToStaticMarkup`, so this is the smallest harness that will do: render
 * a probe component, capture what the hook returned, drive it, re-render.
 */

// React refuses to batch `act` updates unless it is told it is in a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Draft = ReturnType<typeof useDraft>;

let latest: Draft;
let root: Root | null = null;

function Probe({ source }: { source: string }) {
  latest = useDraft(source);
  return <input readOnly value={latest[0]} />;
}

/** Mount (or re-render) the probe with a new source value. */
function render(source: string) {
  const ui: ReactElement = <Probe source={source} />;
  if (root === null) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(ui);
  });
}

/** What the customer would be looking at. */
const shown = () => latest[0];
const type = (next: string) => act(() => latest[1](next));
const reset = () => act(() => latest[2]());

afterEach(() => {
  const current = root;
  root = null;
  if (current) act(() => current.unmount());
  document.body.innerHTML = '';
});

describe('useDraft', () => {
  it('shows the source until something is typed', () => {
    render('Ada');
    expect(shown()).toBe('Ada');
  });

  it('shows what was typed', () => {
    render('Ada');
    type('Ada Lovelace');
    expect(shown()).toBe('Ada Lovelace');
  });

  it('takes the hydrated value when the field is untouched', () => {
    // The bug this hook exists for. localStorage-backed stores return their
    // empty value until `subscribe` runs in an effect after mount, so the first
    // render always sees ''. `useState('')` would capture that and never let go.
    render('');
    expect(shown()).toBe('');

    render('Ada');
    expect(shown()).toBe('Ada');
  });

  it('keeps an edit across a re-render that does not change the source', () => {
    render('Ada');
    type('Grace');

    render('Ada');
    expect(shown()).toBe('Grace');
  });

  it('yields to the source when it changes underneath an edit', () => {
    // Another tab wrote the profile. The stored value is newer than this
    // half-finished edit, and two tabs disagreeing about the saved name is a
    // worse outcome than losing a few keystrokes.
    render('Ada');
    type('Grace');

    render('Grace Hopper');
    expect(shown()).toBe('Grace Hopper');
  });

  it('treats clearing the field as a real edit', () => {
    // The regression that came with the first version of this: deleting the
    // last character of a saved address refilled it from the store, so the
    // field could not be emptied. An empty edit is still an edit.
    render('Bara Bazar');
    type('');

    expect(shown()).toBe('');

    // And it survives a re-render, rather than springing back on the next one.
    render('Bara Bazar');
    expect(shown()).toBe('');
  });

  it('hands control back to the source on reset', () => {
    // What checkout calls after a successful save: the edit is now the stored
    // value, so the field should start tracking the store again.
    render('Bara Bazar');
    type('');
    expect(shown()).toBe('');

    reset();
    expect(shown()).toBe('Bara Bazar');

    render('Chanmari');
    expect(shown()).toBe('Chanmari');
  });
});

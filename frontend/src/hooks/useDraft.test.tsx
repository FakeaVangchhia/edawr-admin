import { act } from 'react';
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
 * Library, which the storefront does not install — see `ImageFallback.test.tsx`
 * for the same constraint. The hook is driven through the DOM rather than by
 * capturing what it returned: the React compiler's lint rules forbid a
 * component writing to anything outside itself during render, which rules out
 * the usual `renderHook` trick, and typing into the input is closer to what
 * checkout actually does anyway.
 */

// React refuses to batch `act` updates unless it is told it is in a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ source }: { source: string }) {
  const [value, setValue, reset] = useDraft(source);
  return (
    <form>
      <input data-testid="field" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" data-testid="reset" onClick={reset}>
        reset
      </button>
    </form>
  );
}

let root: Root | null = null;
let container: HTMLElement | null = null;

/** Mount, or re-render with a new source value. */
function render(source: string) {
  if (root === null) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(<Probe source={source} />);
  });
}

const find = <T extends HTMLElement>(id: string): T => {
  const node = container?.querySelector<T>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`No ${id} rendered`);
  return node;
};

/** What the customer would be looking at. */
const shown = () => find<HTMLInputElement>('field').value;

/**
 * Type into the field the way a person does.
 *
 * The native value setter plus a bubbling `input` event is what makes React
 * notice a programmatic change to a controlled input: assigning `.value`
 * directly updates the DOM node while React's own value tracker still holds the
 * old string, so the synthetic onChange never fires.
 */
const type = (next: string) => {
  const field = find<HTMLInputElement>('field');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(field, next);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const reset = () => {
  const button = find<HTMLButtonElement>('reset');
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

afterEach(() => {
  const current = root;
  root = null;
  container = null;
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

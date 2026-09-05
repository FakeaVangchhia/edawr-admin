import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider, useToast } from '@/components/ui';

/**
 * The console's confirmations.
 *
 * Worth testing for one reason above the others: **the live region has to exist
 * before the first message does.** A region inserted at the moment its content
 * arrives is not announced by most screen readers, so a confirmation that is
 * only ever mounted alongside a toast is invisible to exactly the people who
 * cannot see the toast. That is the assertion in `renders its live region
 * before anything is in it` — it looks like a test of an empty div, and it is
 * the one that would catch the mistake.
 */

function Harness({ onReady }: { onReady?: (toast: ReturnType<typeof useToast>) => void }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => (onReady ? onReady(toast) : toast.success('Saved.'))}>
      Do it
    </button>
  );
}

describe('ToastProvider', () => {
  it('renders its live region before anything is in it', () => {
    render(
      <ToastProvider>
        <p>Console</p>
      </ToastProvider>,
    );

    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('shows what happened, in the words the caller chose', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness onReady={(toast) => toast.success('Order #12 is being packed.')} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Do it' }));
    expect(screen.getByText('Order #12 is being packed.')).toBeInTheDocument();
  });

  it('can be dismissed by hand', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Do it' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });

  it('keeps only the three most recent, so a burst cannot fill the screen', async () => {
    const user = userEvent.setup();
    let count = 0;
    render(
      <ToastProvider>
        <Harness onReady={(toast) => toast.success(`Message ${++count}`)} />
      </ToastProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Do it' });
    for (let index = 0; index < 4; index += 1) await user.click(trigger);

    expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
    expect(screen.getByText('Message 4')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(3);
  });

  it('does nothing, rather than throwing, with no provider above it', () => {
    // A screen rendered outside the console layout must not crash for want of a
    // confirmation message — the toast is the least important thing on screen
    // at the moment it fires.
    render(<Harness />);
    expect(() => screen.getByRole('button', { name: 'Do it' }).click()).not.toThrow();
  });
});

describe('a toast left alone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('clears itself, and an info message outlasts a success', () => {
    render(
      <ToastProvider>
        <Harness
          onReady={(toast) => {
            toast.success('Saved.');
            toast.info('Deactivated rather than deleted.');
          }}
        />
      </ToastProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Do it' }).click());
    expect(screen.getByText('Saved.')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(4500));
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
    // The one carrying a sentence somebody has to read is still up.
    expect(screen.getByText('Deactivated rather than deleted.')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByText('Deactivated rather than deleted.')).not.toBeInTheDocument();
  });
});

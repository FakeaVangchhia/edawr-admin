import { describe, expect, it } from 'vitest';

import { mapWithLimit } from '@/lib/concurrency';

/**
 * The fan-out limiter behind the orders page.
 *
 * Two properties matter and both are easy to get subtly wrong: results must
 * come back in *input* order however the jobs interleave, and no more than
 * `limit` jobs may be in flight at once. A limiter that quietly runs everything
 * at once passes every functional test and puts the burst back.
 */

/** A job that resolves when told to, so interleaving is deterministic. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('mapWithLimit', () => {
  it('returns results in input order, not completion order', async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];

    const running = mapWithLimit([0, 1, 2], 3, (index) => gates[index].promise);

    // Finish them backwards.
    gates[2].resolve('c');
    gates[1].resolve('b');
    gates[0].resolve('a');

    await expect(running).resolves.toEqual(['a', 'b', 'c']);
  });

  it('never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithLimit(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('runs every item even when there are more than the limit', async () => {
    const seen: number[] = [];

    await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 2, async (item) => {
      seen.push(item);
      return item;
    });

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('does not hang on an empty list', async () => {
    // The orders page calls this with no tokens on a first visit, and an
    // implementation that waits for a worker that never starts leaves the page
    // on its skeleton forever.
    await expect(mapWithLimit([], 3, async () => 'x')).resolves.toEqual([]);
  });

  it('handles a limit larger than the list', async () => {
    await expect(mapWithLimit([1, 2], 10, async (n) => n * 2)).resolves.toEqual([2, 4]);
  });

  it('treats a limit below one as one', async () => {
    await expect(mapWithLimit([1, 2], 0, async (n) => n)).resolves.toEqual([1, 2]);
  });

  it('passes the index through', async () => {
    await expect(
      mapWithLimit(['a', 'b', 'c'], 2, async (item, index) => `${index}${item}`),
    ).resolves.toEqual(['0a', '1b', '2c']);
  });

  it('rejects if a job rejects', async () => {
    // The orders page catches per-token, so nothing here should swallow an
    // error on its behalf — a limiter that silently absorbed failures would
    // turn a bug into missing rows.
    await expect(
      mapWithLimit([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('nope');
        return n;
      }),
    ).rejects.toThrow('nope');
  });
});

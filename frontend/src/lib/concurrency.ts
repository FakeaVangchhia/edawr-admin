/**
 * Run an async job over a list, a few at a time.
 *
 * Written for the orders page, which fans out one tracking request per
 * remembered order. `Promise.all` over that list opens up to ten simultaneous
 * connections to the API on every mount — against a Cloud Run service scaled to
 * zero, the first of those pays the cold start and the other nine queue behind
 * it anyway, so the parallelism buys nothing and the burst is what a rate limit
 * is for. Three at a time finishes at very nearly the same moment and looks like
 * a browser rather than like a script.
 *
 * Results come back in input order regardless of completion order, because the
 * caller is zipping them against the list it passed in.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  // One shared cursor rather than fixed slices: a slice per worker makes the
  // whole batch wait on whichever slice happened to contain the slow request.
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await job(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );

  return results;
}

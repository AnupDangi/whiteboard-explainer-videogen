/** `Promise.all(items.map(fn))` with at most `limit` calls in flight; results keep input order and the first failure wins. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('mapLimit needs an integer limit of at least 1');
  const results = new Array<R>(items.length);
  let next = 0; let failure: { error: unknown } | undefined;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && next < items.length) {
      const index = next++;
      try { results[index] = await fn(items[index]!, index); } catch (error) { failure ??= { error }; }
    }
  }));
  if (failure) throw failure.error;
  return results;
}

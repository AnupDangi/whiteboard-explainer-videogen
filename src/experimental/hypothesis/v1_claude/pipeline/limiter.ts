/**
 * In-process concurrency limit: at most `max` calls of the returned function
 * run at once, the rest wait in FIFO order. Cross-process limits (provider,
 * TTS, raster) use shared/hostResourcePool.ts instead.
 */
export function createLimiter(max: number): <T>(work: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(max) || max < 1) throw new Error('limiter size must be a positive integer');
  let active = 0;
  const waiters: Array<() => void> = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiters.push(resolve));
    else active += 1;
    try { return await work(); }
    finally {
      // Hand the slot straight to the next waiter so `active` never under-counts.
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/** A positive-integer concurrency from the environment, clamped to `maximum`. */
export function configuredConcurrency(name: string, fallback: number, maximum = 32): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
}

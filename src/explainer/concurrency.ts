/** Bounded-concurrency gate. No external dependency; safe under Node's single-threaded event loop. */
export function semaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = () => new Promise<void>(resolve => {
    const attempt = () => { if (active < limit) { active++; resolve(); } else queue.push(attempt); };
    attempt();
  });
  const release = () => { active--; const next = queue.shift(); if (next) next(); };
  return { acquire, release };
}

import type { ResolutionRecord } from '../shared/types.js';

export const CANONICAL_RESOLUTION_RUNGS = [
  'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11',
] as const;

/** Canonical strategy-based counts alongside legacy confidence buckets. */
export function canonicalResolutionCounts(resolutions: Array<ResolutionRecord | undefined>): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(CANONICAL_RESOLUTION_RUNGS.map((rung) => [`resolver.${rung}`, 0]));
  for (const resolution of resolutions) {
    const rung = resolution?.strategy?.match(/^(R(?:1[01]|[0-9]))-/)?.[1];
    if (rung && Object.hasOwn(counts, `resolver.${rung}`)) counts[`resolver.${rung}`] += 1;
  }
  return counts;
}

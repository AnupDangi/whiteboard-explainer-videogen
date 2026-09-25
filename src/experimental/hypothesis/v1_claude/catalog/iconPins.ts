import type { ResolvedScene } from '../types.js';

/** Lesson-level icon consistency: the first confident icon for a concept is reused in later scenes. */
export interface IconPin {
  assetId: string;
  rung: 2 | 3;
  score: number;
}

export function iconPinKey(element: { concept: string; conceptIds?: string[] }): string {
  if (element.conceptIds?.length) return `concepts:${[...element.conceptIds].sort().join(',')}`;
  return `concept:${element.concept.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')}`;
}

export function collectPins(resolved: ResolvedScene, into: ReadonlyMap<string, IconPin>): Map<string, IconPin> {
  const next = new Map(into);
  for (const resolvedElement of resolved.elements) {
    const { element, resolution } = resolvedElement;
    if (element.prim !== 'object' || !resolution?.assetId || (resolution.rung !== 2 && resolution.rung !== 3)) continue;
    const key = iconPinKey(element);
    if (!next.has(key)) next.set(key, { assetId: resolution.assetId, rung: resolution.rung, score: resolution.score });
  }
  return next;
}

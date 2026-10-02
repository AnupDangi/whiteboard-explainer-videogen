import type { ResolvedScene } from '../shared/types.js';

/** Lesson-level icon consistency: reuse an icon for the same depicted referent. */
export interface IconPin {
  assetId: string;
  rung: 2 | 3;
  score: number;
  selectionBasis?: 'exact' | 'curated' | 'similarity' | 'procedural';
  requestedStrategy?: 'diagram' | 'semantic-core' | 'literal' | 'metaphor' | 'retrieval' | 'topology' | 'labelled' | 'text';
}

export function iconPinKey(element: { concept: string; conceptIds?: string[] }): string {
  const referent = element.concept.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  // One teaching concept can contain several depicted objects. Source concept IDs
  // alone would pin all of them to the first object's icon.
  if (element.conceptIds?.length) return `concepts:${[...element.conceptIds].sort().join(',')}|referent:${referent}`;
  return `concept:${referent}`;
}

export function collectPins(resolved: ResolvedScene, into: ReadonlyMap<string, IconPin>, semanticValidationPassed: boolean): Map<string, IconPin> {
  const next = new Map(into);
  if (!semanticValidationPassed) return next;
  for (const resolvedElement of resolved.elements) {
    const { element, resolution } = resolvedElement;
    if (element.prim !== 'object' || !resolution?.assetId || (resolution.rung !== 2 && resolution.rung !== 3)) continue;
    const key = iconPinKey(element);
    if (!next.has(key)) next.set(key, { assetId: resolution.assetId, rung: resolution.rung, score: resolution.score, ...(resolution.selectionBasis ? { selectionBasis: resolution.selectionBasis } : {}), ...(element.visualStrategy ? { requestedStrategy: element.visualStrategy } : {}) });
  }
  return next;
}

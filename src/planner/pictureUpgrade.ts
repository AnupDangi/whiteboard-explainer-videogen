import type { Element, SceneSpec } from '../shared/types.js';

/**
 * A node the planner left as a labelled box may still have a recognisable picture (the planner chooses a form before any
 * library lookup). These two pure helpers let the pipeline offer such boxes to the Depiction Director and, only for the
 * pictures it and the judge approve, turn the box into an object element. Ids, anchors, evidence and concept links are
 * untouched, so every claim, relation and timing rule keeps pointing at the same element.
 */
export interface PictureCandidate { elementId: string; referent: string; label: string }

const plainReferent = (text: string): string => text.toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);

/** Labelled boxes that name a concept (not glyph boxes, not unlinked decoration). */
export function pictureCandidates(spec: Pick<SceneSpec, 'elements'>): PictureCandidate[] {
  return spec.elements.flatMap((element) => {
    if (element.prim !== 'box' || !element.text || element.glyph || !element.conceptIds?.length) return [];
    const referent = plainReferent(element.text);
    return referent ? [{ elementId: element.id, referent, label: element.text }] : [];
  });
}

/** Turn each candidate whose referent has an approved picture into an object element (same id, anchor, evidence, concept links). */
export function applyPictureUpgrades(spec: SceneSpec, approved: ReadonlyMap<string, string>): SceneSpec {
  const upgrades = new Map(pictureCandidates(spec).filter((candidate) => approved.has(candidate.referent)).map((candidate) => [candidate.elementId, candidate] as const));
  if (!upgrades.size) return spec;
  const elements = spec.elements.map((element): Element => {
    const upgrade = upgrades.get(element.id);
    if (!upgrade || element.prim !== 'box') return element;
    const { text: _text, glyph: _glyph, fill: _fill, ...base } = element;
    return { ...base, prim: 'object', concept: upgrade.referent, label: upgrade.label, visualStrategy: 'literal' } as Element;
  });
  return { ...spec, elements };
}

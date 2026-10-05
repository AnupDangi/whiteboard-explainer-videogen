import type { BoardOp, ElementSpec } from '../board-ops/types.js';
import { contentProblems } from '../board-ops/validate.js';
import type { SceneBoardDraft } from './types.js';
import { validateSceneBoard, type BoardContext } from './validate.js';

/**
 * Deterministic fallback board for a scene whose model-written board could not be validated even after salvage and repair.
 * It is built only from the scene's own validated data (its concepts, claims and beats): one entity per concept the beats
 * name, labelled with the concept's own label, drawn the first time a beat names it and highlighted whenever a beat returns to
 * it, so every visual beat still changes the board. It carries no relations, numbers or claims of its own. A lesson that
 * uses it is a draft, never a pass: the caller records a soft failure for every scene that took this path.
 *
 * Returns undefined when even this board does not lay out; the lesson then fails visibly as before.
 */
export function fallbackSceneBoard(ctx: BoardContext): SceneBoardDraft | undefined {
  const named: string[] = [];
  for (const beat of ctx.beats) for (const entity of beat.entities) if (ctx.concepts.some((c) => c.id === entity.conceptId) && !named.includes(entity.conceptId)) named.push(entity.conceptId);
  for (let keep = Math.min(named.length, 8); keep >= 1; keep--) {
    const draft = build(ctx, named.slice(0, keep));
    if (draft && validateSceneBoard(draft, ctx).length === 0) return draft;
  }
  return undefined;
}

function build(ctx: BoardContext, shown: readonly string[]): SceneBoardDraft | undefined {
  const ops: BoardOp[] = [];
  // Ids are never reused in a lesson, including by removed elements: the scene's own id keeps each fallback id fresh.
  const taken = new Set([...Object.keys(ctx.initial.elements), ...Object.keys(ctx.initial.edges)]);
  const ids = new Map<string, string>();
  const idFor = (conceptId: string): string => {
    const known = ids.get(conceptId);
    if (known) return known;
    const stem = `${ctx.sceneId}_${conceptId}`.replace(/[^A-Za-z0-9_.-]/g, '_').slice(-34);
    let slug = stem;
    for (let n = 2; taken.has(`fb_${slug}`); n++) slug = `${stem}_${n}`;
    taken.add(`fb_${slug}`);
    ids.set(conceptId, slug);
    return slug;
  };
  const drawn = new Set<string>();
  const regionFor = (index: number): 'left' | 'center' | 'right' => (shown.length <= 1 ? 'center' : (['left', 'center', 'right'] as const)[index % 3]!);
  for (const beat of ctx.beats) {
    if (beat.narrationOnly) continue;
    const here = beat.entities.map((e) => e.conceptId).filter((id) => shown.includes(id));
    const wanted = here.length > 0 ? here : shown.slice(0, 1);
    let cue = 0;
    for (const conceptId of [...new Set(wanted)]) {
      const concept = ctx.concepts.find((c) => c.id === conceptId);
      if (!concept) continue;
      const slug = idFor(conceptId);
      if (!drawn.has(conceptId)) {
        drawn.add(conceptId);
        // A fallback may not shorten factual/semantic text; an overlong label fails visibly for repair.
        const label = concept.label;
        const bindings = { conceptIds: [conceptId], claimIds: [...new Set(ctx.beats.filter((b) => b.entities.some((e) => e.conceptId === conceptId)).flatMap((b) => b.claimIds))].slice(0, 12) };
        const base = { type: 'entity' as const, conceptId, label, bindings };
        const cited = ctx.grounding ? (concept.evidence ?? []).find((e) => contentProblems({ ...base, provenance: 'source', evidence: e } as ElementSpec, '', ctx.grounding).length === 0) : undefined;
        const element: ElementSpec = cited ? { ...base, provenance: 'source', evidence: { spanId: cited.spanId, quote: cited.quote } } : { ...base, provenance: 'illustrative' };
        ops.push({ op: 'add', opId: `fallback.${beat.beatId}.${slug}`, beatId: beat.beatId, cue: Math.min(cue, 3), id: `fb_${slug}`, element, at: { region: regionFor(shown.indexOf(conceptId)) } } as BoardOp);
      } else {
        ops.push({ op: 'highlight', opId: `fallback.${beat.beatId}.${slug}.hl`, beatId: beat.beatId, cue: Math.min(cue, 3), target: `fb_${slug}` } as BoardOp);
      }
      cue++;
    }
  }
  return ops.length > 0 ? { transition: { mode: 'clean' }, ops } : undefined;
}

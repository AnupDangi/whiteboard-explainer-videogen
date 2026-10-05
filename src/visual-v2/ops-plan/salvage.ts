import type { CoercionEntry } from '../../structured/coercionLedger.js';
import type { TeachingBeat } from '../../teaching/beat-plan/types.js';
import type { BoardOp, ElementSpec } from '../board-ops/types.js';
import { dependenciesOf } from '../board-ops/deps.js';
import { contentProblems } from '../board-ops/validate.js';
import { sourceEdgeProblem, type SourceCitation } from '../provenance/ground.js';
import type { SceneBoardDraft } from './types.js';
import { applyOpAfter, startScene } from '../board-state/reducer.js';
import type { BoardState } from '../board-state/types.js';
import { opSpecs, validateSceneBoard, type BoardContext } from './validate.js';

/**
 * Deterministic salvage of a BoardOps draft (S6). Models are good at what to draw and unreliable at copying quotes exactly,
 * counting label words and echoing ids. Each fix here can only REMOVE or DOWNGRADE a claim, or re-point it at evidence the
 * unchanged validator accepts: re-cite from another quote that really states it, drop a factual arrow no quote supports, and
 * rebuild bindings from the element's own concept and its beat's claims. Semantic text is never rewritten: a label or token
 * that fails length or layout validation remains for a scoped model repair. Nothing is ever invented, and the result is
 * accepted only when the whole board validates (layout included); otherwise the model repair path runs as before.
 * Every change is returned as a ledger entry so it is never silent.
 */

const normalize = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const nameOf = (spec: ElementSpec | undefined): string | undefined => {
  if (!spec) return undefined;
  switch (spec.type) {
    case 'entity': case 'value': return spec.label;
    case 'text': case 'token': return spec.text;
    case 'kit': return spec.label;
    case 'equation': return undefined;
  }
};
const isEquation = (spec: ElementSpec): boolean => spec.type === 'equation' || (spec.type === 'kit' && spec.kit === 'equation');
type Bindings = { conceptIds: string[]; claimIds: string[] };
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, i) => value === b[i]);
const unique = (values: readonly string[]): string[] => [...new Set(values)];

interface Created { id: string; spec: ElementSpec; path: string }
function createdSpecs(op: BoardOp, at: string): Created[] {
  const specs = opSpecs(op, at);
  switch (op.op) {
    case 'add': case 'replace': return [{ id: op.id, spec: op.element, path: specs[0]!.path }];
    case 'split': return op.into.map((part, j) => ({ id: part.id, spec: part.element, path: specs[j]!.path }));
    case 'merge': return [{ id: op.into.id, spec: op.into.element, path: specs[0]!.path }];
    default: return [];
  }
}

export function salvageSceneBoard(draft: SceneBoardDraft, ctx: BoardContext): { value: SceneBoardDraft; entries: CoercionEntry[] } | undefined {
  const attempt = salvageAttempt(draft, ctx);
  return attempt && attempt.remaining.length === 0 ? { value: attempt.value, entries: attempt.entries } : undefined;
}

/** The corrected draft and the validator problems that remain after it (empty = accepted). Exposed so a harness can say why a draft was not salvageable. */
export function salvageAttempt(draft: SceneBoardDraft, ctx: BoardContext): { value: SceneBoardDraft; entries: CoercionEntry[]; remaining: ReturnType<typeof validateSceneBoard> } | undefined {
  const value: SceneBoardDraft = structuredClone(draft);
  const entries: CoercionEntry[] = [];
  const note = (path: string, reason: string, oldValue: unknown, newValue: unknown): void => { entries.push({ path, oldValue, newValue, reason, semanticRisk: 'semantic' }); };

  const beats = new Map<string, TeachingBeat>(ctx.beats.map((beat) => [beat.beatId, beat]));
  const knownConcepts = new Set(ctx.concepts.map((concept) => concept.id));
  const knownClaims = new Set(ctx.beats.flatMap((beat) => beat.claimIds));
  const seen = new Set<string>();
  const quotes: Array<SourceCitation & { concepts: string[] }> = [];
  for (const concept of ctx.concepts) for (const evidence of concept.evidence ?? []) {
    if (evidence.quote.length < 6 || evidence.quote.length > 240) continue;
    const key = `${evidence.spanId}\u0000${evidence.quote}`;
    if (seen.has(key)) { quotes.find((q) => q.spanId === evidence.spanId && q.quote === evidence.quote)?.concepts.push(concept.id); continue; }
    seen.add(key);
    quotes.push({ spanId: evidence.spanId, quote: evidence.quote, concepts: [concept.id] });
  }

  // Sentences of the cited spans that state a formula can be offered as evidence too (the model often cites the sentence next to it).
  if (ctx.grounding?.spanText) {
    for (const spanId of [...new Set(quotes.map((q) => q.spanId))]) {
      const text = ctx.grounding.spanText(spanId) ?? '';
      const owners = quotes.filter((q) => q.spanId === spanId).flatMap((q) => q.concepts);
      for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
        const sentence = raw.replace(/^#+\s*/, '').trim();
        if (!sentence.includes('=') || sentence.length < 6 || sentence.length > 240) continue;
        const key = `${spanId}\u0000${sentence}`;
        if (seen.has(key)) continue;
        seen.add(key);
        quotes.push({ spanId, quote: sentence, concepts: [...new Set(owners)] });
      }
    }
  }

  const names = new Map<string, string | undefined>();
  const bound = new Map<string, Bindings>();
  for (const [id, element] of Object.entries(ctx.initial.elements)) {
    names.set(id, nameOf(element.spec));
    if (element.spec.bindings) bound.set(id, element.spec.bindings);
  }

  const inferConcept = (spec: ElementSpec, beat: TeachingBeat | undefined): string | undefined => {
    const name = nameOf(spec);
    if (name) {
      const target = normalize(name);
      const hit = ctx.concepts.find((concept) => { const label = normalize(concept.label); return target.length > 0 && (label === target || label.includes(target) || target.includes(label)); });
      if (hit) return hit.id;
    }
    const entities = unique((beat?.entities ?? []).map((entity) => entity.conceptId).filter((id) => knownConcepts.has(id)));
    return entities.length === 1 ? entities[0] : undefined;
  };
  const rebuildBindings = (current: Bindings | undefined, beat: TeachingBeat | undefined, seed: string[], fallbackConcept: () => string | undefined, endpointBindings?: Bindings): Bindings => {
    let conceptIds = unique([...(current?.conceptIds ?? []).filter((id) => knownConcepts.has(id)), ...seed.filter((id) => knownConcepts.has(id))]);
    if (conceptIds.length === 0 && endpointBindings) conceptIds = unique(endpointBindings.conceptIds.filter((id) => knownConcepts.has(id)));
    if (conceptIds.length === 0) { const inferred = fallbackConcept(); if (inferred) conceptIds = [inferred]; }
    let claimIds = unique((current?.claimIds ?? []).filter((id) => knownClaims.has(id)));
    if (claimIds.length === 0 && endpointBindings) claimIds = unique(endpointBindings.claimIds.filter((id) => knownClaims.has(id)));
    if (claimIds.length === 0) claimIds = unique((beat?.claimIds ?? []).filter((id) => knownClaims.has(id)));
    return { conceptIds, claimIds };
  };

  const grounded = (spec: ElementSpec): boolean => contentProblems(spec, '', ctx.grounding).length === 0;
  const tryRecite = (spec: ElementSpec, boundConcepts: readonly string[]): SourceCitation | undefined => {
    const ordered = [...quotes.filter((q) => q.concepts.some((id) => boundConcepts.includes(id))), ...quotes.filter((q) => !q.concepts.some((id) => boundConcepts.includes(id)))];
    return ordered.find((quote) => grounded({ ...spec, evidence: { spanId: quote.spanId, quote: quote.quote } } as ElementSpec));
  };

  const dropped = new Set<number>();
  const gone = new Set<string>();
  const drop = (index: number, op: BoardOp, reason: string): void => {
    dropped.add(index);
    for (const id of createdOf(op)) gone.add(id);
    note(`/ops/${index}`, `dropped: ${reason}`, { op: op.op, opId: op.opId }, undefined);
  };
  const createdOf = (op: BoardOp): string[] => (op.op === 'connect' ? [op.id] : createdSpecs(op, '').map((part) => part.id));

  value.ops.forEach((op, index) => {
    const at = `/ops/${index}`;
    const beat = beats.get(op.beatId);
    const blocked = dependenciesOf(op).filter((id) => gone.has(id));
    if (blocked.length > 0) { drop(index, op, `it depends on a dropped operation (${blocked.join(', ')})`); return; }

    let unprovable: string | undefined;
    for (const { id, spec, path } of createdSpecs(op, at)) {
      // 1. Bindings: drop unknown ids, then fill from the element's own concept and its beat.
      const seed = spec.type === 'entity' ? [spec.conceptId] : [];
      const inferred = (): string | undefined => inferConcept(spec, beat);
      if (spec.type === 'entity' && !knownConcepts.has(spec.conceptId)) {
        const replacement = inferred();
        if (replacement) { note(`${path}/conceptId`, 'unknown concept id replaced by the scene concept this label names', spec.conceptId, replacement); spec.conceptId = replacement; }
      }
      const current = spec.bindings;
      const rebuilt = rebuildBindings(current, beat, spec.type === 'entity' ? [spec.conceptId, ...seed] : [], inferred);
      const sufficient = current && sameList(current.conceptIds, rebuilt.conceptIds) && sameList(current.claimIds, rebuilt.claimIds);
      if (!sufficient && rebuilt.conceptIds.length > 0 && rebuilt.claimIds.length > 0) {
        note(`${path}/bindings`, 'bindings limited to known ids and completed from the element concept and its beat claims', current, rebuilt);
        spec.bindings = rebuilt;
      }
      // 3. Source grounding: re-cite only. An unsupported source claim cannot be downgraded into an illustrative visual.
      if (ctx.grounding && spec.provenance === 'source' && !grounded(spec)) {
        const citation = tryRecite(spec, spec.bindings?.conceptIds ?? []);
        if (citation) {
          note(`${path}/evidence`, 'citation replaced by a quote the validator accepts for this element', spec.evidence, citation);
          spec.evidence = { spanId: citation.spanId, quote: citation.quote };
        } else if (!isEquation(spec)) {
          return undefined;
        }
      }
      // An equation the checker cannot verify is re-cited as a source formula when a quote states it, otherwise not shown at all.
      if (ctx.grounding && isEquation(spec) && spec.provenance !== 'source' && !grounded(spec)) {
        const citation = tryRecite({ ...spec, provenance: 'source' } as ElementSpec, spec.bindings?.conceptIds ?? []);
        if (citation) {
          note(`${path}/provenance`, 'unverified equation re-cited as a source formula by a quote that states it', { provenance: spec.provenance }, { provenance: 'source', evidence: citation });
          spec.provenance = 'source';
          spec.evidence = { spanId: citation.spanId, quote: citation.quote };
        } else unprovable = `${id} is an equation that cannot be verified or cited`;
      }
      names.set(id, nameOf(spec));
      if (spec.bindings) bound.set(id, spec.bindings);
    }
    if (unprovable) { drop(index, op, `${unprovable}, so it is not shown`); return; }

    if (op.op === 'connect') {
      if (ctx.grounding) {
        const problem = (evidence: SourceCitation | undefined): string | undefined => sourceEdgeProblem(names.get(op.from), op.relation, names.get(op.to), evidence, ctx.grounding);
        if (problem(op.evidence)) {
          const citation = quotes.find((quote) => !problem({ spanId: quote.spanId, quote: quote.quote }));
          if (citation) {
            note(`${at}/evidence`, 'citation replaced by a quote that states this directed relation', op.evidence, citation);
            op.evidence = { spanId: citation.spanId, quote: citation.quote };
          } else { drop(index, op, 'no quote states this directed relation, so it is not shown as a source fact'); return; }
        }
      }
      const ends = [bound.get(op.from), bound.get(op.to)].filter((b): b is Bindings => b !== undefined);
      const endpoint: Bindings = { conceptIds: unique(ends.flatMap((b) => b.conceptIds)), claimIds: unique(ends.flatMap((b) => b.claimIds)) };
      const rebuilt = rebuildBindings(op.bindings, beat, [], () => undefined, endpoint);
      const sufficient = op.bindings && sameList(op.bindings.conceptIds, rebuilt.conceptIds) && sameList(op.bindings.claimIds, rebuilt.claimIds);
      if (!sufficient && rebuilt.conceptIds.length > 0 && rebuilt.claimIds.length > 0) {
        note(`${at}/bindings`, 'edge bindings limited to known ids and completed from its endpoints', op.bindings, rebuilt);
        op.bindings = rebuilt;
      }
    }
  });

  value.ops = value.ops.filter((_, index) => !dropped.has(index));
  if (value.ops.length === 0) return undefined;
  let remaining = validateSceneBoard(value, ctx);
  if (remaining.length > 0 && clearInheritedBoard(value, ctx, entries, remaining.length)) remaining = validateSceneBoard(value, ctx);
  if (entries.length === 0) return undefined;
  return { value, entries, remaining };
}

function boardStates(draft: SceneBoardDraft, ctx: BoardContext): BoardState[] | undefined {
  const order = ctx.beats.map((beat) => beat.beatId);
  const states: BoardState[] = [startScene(ctx.initial, draft.transition, ctx.sceneId)];
  try {
    draft.ops.forEach((op, i) => { states.push(applyOpAfter(states[states.length - 1]!, op, draft.ops[i - 1]?.beatId, order).state); });
  } catch { return undefined; }
  return states;
}

/** Concepts a beat names that no live element shows at the end of that beat, with the index of that beat's last op. */
function uncoveredConcepts(draft: SceneBoardDraft, ctx: BoardContext): Array<{ beatId: string; conceptId: string; afterOp: number }> {
  const states = boardStates(draft, ctx);
  if (!states) return [];
  const lastOp = new Map<string, number>();
  draft.ops.forEach((op, i) => lastOp.set(op.beatId, i));
  const out: Array<{ beatId: string; conceptId: string; afterOp: number }> = [];
  for (const beat of ctx.beats) {
    const at = lastOp.get(beat.beatId);
    if (at === undefined) continue;
    const live = Object.values(states[at + 1]!.elements).filter((el) => el.lifecycle.removedAtBeat === undefined);
    for (const entity of beat.entities) {
      if (!ctx.concepts.some((concept) => concept.id === entity.conceptId)) continue;
      const shown = live.some((el) => (el.spec.type === 'entity' && el.spec.conceptId === entity.conceptId) || (el.spec.bindings?.conceptIds.includes(entity.conceptId) ?? false));
      if (!shown) out.push({ beatId: beat.beatId, conceptId: entity.conceptId, afterOp: at });
    }
  }
  return out;
}

/**
 * A scene that keeps the whole previous board can run out of room for what it adds. When none of its operations touches an
 * inherited element, starting from a clean board is a safe way to make room. Concepts that only the dropped board was showing
 * are shown again by an illustrative entity carrying the concept's own label and the beat's claims. Kept only if the whole
 * board then validates better than before.
 */
function clearInheritedBoard(value: SceneBoardDraft, ctx: BoardContext, entries: CoercionEntry[], problemsNow: number): boolean {
  const inherited = new Set(Object.keys(ctx.initial.elements));
  if (value.transition.mode === 'clean' || inherited.size === 0) return false;
  if (value.ops.some((op) => dependenciesOf(op).some((id) => inherited.has(id)))) return false;
  const before = value.transition;
  const trial: SceneBoardDraft = structuredClone(value);
  trial.transition = { mode: 'clean' };
  const added: Array<{ index: number; op: BoardOp }> = [];
  const usedIds = new Set([...inherited, ...Object.keys(ctx.initial.edges), ...value.ops.flatMap((op) => (op.op === 'connect' ? [op.id] : createdSpecs(op, '').map((part) => part.id)))]);
  for (const miss of uncoveredConcepts(trial, ctx)) {
    const concept = ctx.concepts.find((c) => c.id === miss.conceptId)!;
    const beat = ctx.beats.find((b) => b.beatId === miss.beatId)!;
    let id = `cover_${miss.conceptId.replace(/[^A-Za-z0-9_.-]/g, '_')}`.slice(0, 40);
    for (let n = 2; usedIds.has(id); n++) id = `${id.slice(0, 36)}_${n}`;
    usedIds.add(id);
    added.push({ index: miss.afterOp, op: { op: 'add', opId: `salvage.${id}`, beatId: miss.beatId, id, element: { type: 'entity', conceptId: miss.conceptId, label: concept.label, provenance: 'illustrative', bindings: { conceptIds: [miss.conceptId], claimIds: beat.claimIds.filter((claim) => ctx.beats.some((b) => b.claimIds.includes(claim))) } }, at: { region: 'top' } } as BoardOp });
  }
  // Insert after each beat's last op, highest index first so earlier indexes stay valid.
  for (const { index, op } of [...added].sort((a, b) => b.index - a.index)) trial.ops.splice(index + 1, 0, op);
  if (validateSceneBoard(trial, ctx).length >= problemsNow) return false;
  entries.push({ path: '/transition', oldValue: before, newValue: trial.transition, reason: 'no operation uses the inherited board, so the scene starts clean to make room', semanticRisk: 'semantic' });
  for (const { op } of added) entries.push({ path: `/ops/+${op.opId}`, oldValue: undefined, newValue: { op: op.op, id: (op as { id: string }).id }, reason: 'concept the dropped board was showing is shown again by an illustrative entity with its own label', semanticRisk: 'semantic' });
  value.transition = trial.transition;
  value.ops = trial.ops;
  return true;
}

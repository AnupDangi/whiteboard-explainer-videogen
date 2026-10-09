import type { BoardContext } from './validate.js';
import type { SceneBoardDraft } from './types.js';
import type { BoardOp, ElementSpec } from '../board-ops/types.js';

const norm = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const PROCESS_RELATIONS = new Set(['causes', 'feeds', 'produces']);
/** True when `quote` contains every `part` as a whole word, in order (the order `sourceTextProblem`/`sourceEdgeProblem` check). */
function inOrder(quote: string, parts: readonly string[]): boolean {
  const haystack = ` ${norm(quote)} `;
  let cursor = 0;
  for (const part of parts) {
    const value = norm(part);
    if (!value) continue;
    const at = haystack.indexOf(` ${value} `, cursor);
    if (at < 0) return false;
    cursor = at + value.length + 1;
  }
  return true;
}
/** First source quote that states the directed parts in order, if any. */
function firstQuote(parts: readonly string[], quotes: ReadonlyArray<{ spanId: string; quote: string }>): { spanId: string; quote: string } | undefined {
  return quotes.find((citation) => inOrder(citation.quote, parts));
}
const edgeParts = (from: string, relation: string, to: string): string[] => (PROCESS_RELATIONS.has(relation) ? [from, to] : [from, ...norm(relation).split(' ').filter(Boolean), to]);
const specLabelOf = (spec: ElementSpec): string | undefined => (spec.type === 'entity' || spec.type === 'value' ? spec.label : spec.type === 'token' || spec.type === 'text' ? spec.text : undefined);

/**
 * Deterministic bindings completion (S6 compiler aid, not a validator).
 * The model routinely omits `bindings` the schema leaves optional while the
 * validator requires. Where the beat scope makes the answer unambiguous, code
 * fills it so repair rounds are spent on real defects:
 * - claimIds: the op's beat carries exactly one claim.
 * - conceptIds: entity specs name their conceptId and it exists in the scene.
 * - connect evidence: when the model leaves a factual edge without a valid quote,
 *   snap it to a source quote that already states the directed subject->object
 *   sequence, using the source's own words (deterministic; the validator still
 *   checks the snapped quote, so an unfindable edge still fails).
 * - source element evidence: when a source element's label is absent from its own
 *   cited quote, snap the evidence to a source quote that contains the label.
 * Everything else stays missing and still fails validation for model repair.
 * Never overwrites a valid answer. Raw model output is retained separately by the
 * call recorder, so the completion is always auditable.
 */
export function completeBindings(draft: SceneBoardDraft, ctx: BoardContext): SceneBoardDraft {
  const beatClaims = new Map(ctx.beats.map((beat) => [beat.beatId, beat.claimIds]));
  const knownConcepts = new Set(ctx.concepts.map((concept) => concept.id));
  const elementConcepts = new Map<string, string[]>();
  const elementLabels = new Map<string, string>();
  for (const op of draft.ops) {
    if (op.op === 'add' || op.op === 'replace') {
      const id = op.op === 'add' ? op.id : op.target;
      if (op.element.bindings?.conceptIds?.length) elementConcepts.set(id, [...op.element.bindings.conceptIds]);
      const label = specLabelOf(op.element);
      if (label) elementLabels.set(id, label);
    }
  }
  const sourceQuotes = ctx.concepts.flatMap((concept) => concept.evidence ?? []);
  const completeSpec = (spec: ElementSpec, claimIds: string[]): ElementSpec => {
    const bindings = spec.bindings ?? { conceptIds: [], claimIds: [] };
    const nextConceptIds = bindings.conceptIds.length
      ? bindings.conceptIds
      : (spec.type === 'entity' && knownConcepts.has(spec.conceptId) ? [spec.conceptId] : []);
    const nextClaimIds = bindings.claimIds.length ? bindings.claimIds : claimIds;
    // A source element's label must occur in its own cited quote; when the model cites a
    // quote that does not contain the label, snap the evidence to a source quote that does
    // (using the source's own words). An unfindable label still fails validation.
    const label = specLabelOf(spec);
    const evidence = spec.provenance === 'source' && label
      ? (spec.evidence && inOrder(spec.evidence.quote, [label]) ? spec.evidence : firstQuote([label], sourceQuotes) ?? spec.evidence)
      : spec.evidence;
    const bindingsChanged = nextConceptIds.length !== bindings.conceptIds.length || nextClaimIds.length !== bindings.claimIds.length;
    const evidenceChanged = evidence !== spec.evidence;
    if (!bindingsChanged && !evidenceChanged) return spec;
    return { ...spec, ...(evidence ? { evidence } : {}), bindings: { conceptIds: nextConceptIds, claimIds: nextClaimIds } } as ElementSpec;
  };
  const ops = draft.ops.map((op): BoardOp => {
    const claims = beatClaims.get(op.beatId) ?? [];
    const singleClaim = claims.length === 1 ? [claims[0]!] : [];
    switch (op.op) {
      case 'add':
      case 'replace':
        return { ...op, element: completeSpec(op.element, singleClaim) };
      case 'split':
        return { ...op, into: op.into.map((part) => ({ ...part, element: completeSpec(part.element, singleClaim) })) };
      case 'merge':
        return { ...op, into: { ...op.into, element: completeSpec(op.into.element, singleClaim) } };
      case 'connect': {
        const fromConcepts = elementConcepts.get(op.from) ?? [];
        const toConcepts = elementConcepts.get(op.to) ?? [];
        const conceptIds = [...new Set([...fromConcepts, ...toConcepts])].filter((id) => knownConcepts.has(id));
        const binding = op.bindings ?? { conceptIds: [], claimIds: [] };
        const fromLabel = elementLabels.get(op.from);
        const toLabel = elementLabels.get(op.to);
        const parts = fromLabel && toLabel ? edgeParts(fromLabel, op.relation, toLabel) : undefined;
        const snapped = parts ? (op.evidence && inOrder(op.evidence.quote, parts) ? op.evidence : firstQuote(parts, sourceQuotes) ?? op.evidence) : op.evidence;
        return {
          ...op,
          ...(snapped ? { evidence: snapped } : {}),
          bindings: {
            conceptIds: binding.conceptIds.length ? binding.conceptIds : conceptIds,
            claimIds: binding.claimIds.length ? binding.claimIds : singleClaim,
          },
        };
      }
      default:
        return op;
    }
  });
  return { ...draft, ops };
}

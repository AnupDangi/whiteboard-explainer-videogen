import type { BoardContext } from './validate.js';
import type { SceneBoardDraft } from './types.js';
import type { BoardOp, ElementSpec } from '../board-ops/types.js';

/**
 * Deterministic bindings completion (S6 compiler aid, not a validator).
 * The model routinely omits `bindings` the schema leaves optional while the
 * validator requires. Where the beat scope makes the answer unambiguous, code
 * fills it so repair rounds are spent on real defects:
 * - claimIds: the op's beat carries exactly one claim.
 * - conceptIds: entity specs name their conceptId and it exists in the scene.
 * Everything else stays missing and still fails validation for model repair.
 * Never overwrites bindings the model wrote. Raw model output is retained
 * separately by the call recorder, so the completion is always auditable.
 */
export function completeBindings(draft: SceneBoardDraft, ctx: BoardContext): SceneBoardDraft {
  const beatClaims = new Map(ctx.beats.map((beat) => [beat.beatId, beat.claimIds]));
  const knownConcepts = new Set(ctx.concepts.map((concept) => concept.id));
  const elementConcepts = new Map<string, string[]>();
  for (const op of draft.ops) {
    if ((op.op === 'add' || op.op === 'replace') && op.element.bindings?.conceptIds?.length) {
      elementConcepts.set(op.op === 'add' ? op.id : op.target, [...op.element.bindings.conceptIds]);
    }
  }
  const completeSpec = (spec: ElementSpec, claimIds: string[]): ElementSpec => {
    const bindings = spec.bindings ?? { conceptIds: [], claimIds: [] };
    const nextConceptIds = bindings.conceptIds.length
      ? bindings.conceptIds
      : (spec.type === 'entity' && knownConcepts.has(spec.conceptId) ? [spec.conceptId] : []);
    const nextClaimIds = bindings.claimIds.length ? bindings.claimIds : claimIds;
    if (nextConceptIds.length === bindings.conceptIds.length && nextClaimIds.length === bindings.claimIds.length) return spec;
    return { ...spec, bindings: { conceptIds: nextConceptIds, claimIds: nextClaimIds } } as ElementSpec;
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
        if (binding.conceptIds.length && binding.claimIds.length) return op;
        return {
          ...op,
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

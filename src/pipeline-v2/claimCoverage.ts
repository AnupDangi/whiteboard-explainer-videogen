import { z } from 'zod';
import { semanticEventId, type TeachingBeat } from '../teaching/beat-plan/types.js';
import type { SemanticOp } from '../teaching/semantic-ir/types.js';
import type { MechanismRequirement } from '../teaching/representation/providerRegistry.js';
import type { BoardOp } from '../visual-v2/board-ops/types.js';
import type { BoardState } from '../visual-v2/board-state/types.js';
import type { RenderedEntityAssetEvidence } from './renderedEntityAssets.js';

export const CLAIM_COVERAGE_SCORER_VERSION = 'v2-claim-coverage/v1' as const;
export type ClaimCoverageLevel = 'none' | 'label_only' | 'partial' | 'mechanism_visible';
export type ClaimCoverageWeight = 1 | 2 | 3;

/** Only canonical graph and code-owned beat structure determine weight; prose is never parsed for it. */
export interface CanonicalCoverageClaim {
  id: string;
  epistemicType?: string;
  verificationStatus?: string;
  conceptIds: readonly string[];
  relations: readonly { from: string; to: string; type: string }[];
}

export interface ClaimCoverageInput {
  claims: readonly CanonicalCoverageClaim[];
  beats: readonly TeachingBeat[];
  semanticOperations: readonly SemanticOp[];
  /** Provider obligations; each is checked against the pinned beat change before it can support coverage. */
  mechanismRequirements?: readonly MechanismRequirement[];
  boardOps: readonly BoardOp[];
  /** One initial state, then one state after each BoardOp in boardOps order. */
  states: readonly BoardState[];
  renderedEntityAssets: readonly RenderedEntityAssetEvidence[];
}

export interface ClaimCoverageRow {
  claimId: string;
  weight: ClaimCoverageWeight;
  weightBasis: string;
  level: ClaimCoverageLevel;
  dynamicMechanismRequired: boolean;
  beatIds: string[];
  semanticEventIds: string[];
  boardOpIds: string[];
  elementIds: string[];
  edgeIds: string[];
  rationale: string;
}

export interface ClaimCoverageReport {
  scorerVersion: typeof CLAIM_COVERAGE_SCORER_VERSION;
  rows: ClaimCoverageRow[];
  weightedEarned: number;
  weightedPossible: number;
  weightedCoverage: number;
  dynamicMechanismMissingClaimIds: string[];
}

export const ClaimCoverageRowSchema = z.object({
  claimId: z.string().min(1),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  weightBasis: z.string().min(1),
  level: z.enum(['none', 'label_only', 'partial', 'mechanism_visible']),
  dynamicMechanismRequired: z.boolean(),
  beatIds: z.array(z.string().min(1)),
  semanticEventIds: z.array(z.string().min(1)),
  boardOpIds: z.array(z.string().min(1)),
  elementIds: z.array(z.string().min(1)),
  edgeIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
}).strict();

/** Strict wire contract for lock parsing; semantic consistency is recomputed from pinned inputs. */
export const ClaimCoverageReportSchema = z.object({
  scorerVersion: z.literal(CLAIM_COVERAGE_SCORER_VERSION),
  rows: z.array(ClaimCoverageRowSchema),
  weightedEarned: z.number().finite().nonnegative(),
  weightedPossible: z.number().finite().nonnegative(),
  weightedCoverage: z.number().finite().min(0).max(1),
  dynamicMechanismMissingClaimIds: z.array(z.string().min(1)),
}).strict();

const DYNAMIC_CHANGE_KINDS = new Set(['flow', 'transform', 'move', 'separate', 'merge', 'quantity_update', 'plot', 'cause', 'feedback']);
const DYNAMIC_RELATION_TYPES = new Set(['causes', 'feeds', 'transforms', 'produces', 'branches', 'precedes', 'requires']);
const SEPARATION_RELATION_TYPES = new Set(['produces', 'branches', 'causes', 'transforms']);
const LEVEL_FRACTION: Record<ClaimCoverageLevel, number> = { none: 0, label_only: 1 / 3, partial: 2 / 3, mechanism_visible: 1 };
const sorted = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();
const live = (removedAtBeat?: string): boolean => removedAtBeat === undefined;
const bound = (claimIds: readonly string[] | undefined, claimId: string): boolean => claimIds?.includes(claimId) ?? false;
const drawable = (asset: RenderedEntityAssetEvidence | undefined): boolean => !!asset && asset.depictionFamily === 'pictorial'
  && asset.meaningful && asset.pathCount + asset.fillCount + asset.embedCount > 0;

/** A split earns mechanism coverage only when the exact semantic event produces visible, claim-bound results. */
function visibleSeparation(
  claim: CanonicalCoverageClaim,
  operation: Extract<SemanticOp, { type: 'separate' }>,
  input: ClaimCoverageInput,
  assetByElement: ReadonlyMap<string, RenderedEntityAssetEvidence>,
): { boardOpIds: string[]; elementIds: string[]; sourceConceptId: string; resultConceptIds: string[] } | undefined {
  if (!bound(operation.claimIds, claim.id) || operation.results.some((result) => !bound(result.claimIds, claim.id))) return undefined;
  if (input.states.length !== input.boardOps.length + 1) return undefined;
  const splitIndex = input.boardOps.findIndex((boardOp) => boardOp.opId === `${operation.eventId}.split`);
  const split = input.boardOps[splitIndex];
  if (split?.op !== 'split' || split.beatId !== operation.beatId || split.target !== operation.sourceEntityId) return undefined;
  const expectedIds = operation.results.map((result) => result.id);
  if (split.into.length !== expectedIds.length || split.into.some((part, index) => part.id !== expectedIds[index]
    || part.element.type !== 'entity' || part.element.conceptId !== operation.results[index]?.conceptId
    || !bound(part.element.bindings?.claimIds, claim.id))) return undefined;
  const before = input.states[splitIndex];
  const after = input.states[splitIndex + 1];
  const sourceBefore = before?.elements[operation.sourceEntityId];
  const sourceAfter = after?.elements[operation.sourceEntityId];
  if (!sourceBefore || sourceBefore.spec.type !== 'entity' || !live(sourceBefore.lifecycle.removedAtBeat)
    || !sourceAfter || live(sourceAfter.lifecycle.removedAtBeat)
    || !claim.conceptIds.includes(sourceBefore.spec.conceptId)
    || !drawable(assetByElement.get(operation.sourceEntityId))) return undefined;
  const sourceConceptId = sourceBefore.spec.conceptId;
  if (!operation.results.every((result) => {
    const element = after.elements[result.id];
    return element?.spec.type === 'entity' && live(element.lifecycle.removedAtBeat)
      && element.spec.conceptId === result.conceptId && bound(element.spec.bindings?.claimIds, claim.id)
      && drawable(assetByElement.get(result.id));
  })) return undefined;
  const stateRemoveIndex = input.boardOps.findIndex((boardOp) => boardOp.opId === `${operation.eventId}.state-remove`);
  const stateRemove = input.boardOps[stateRemoveIndex];
  if (stateRemove?.op !== 'remove' || stateRemove.beatId !== operation.beatId
    || stateRemove.target !== `${operation.sourceEntityId}.state` || stateRemoveIndex >= splitIndex) return undefined;
  const sourceStateBefore = input.states[stateRemoveIndex]?.elements[stateRemove.target];
  const sourceStateAfter = input.states[stateRemoveIndex + 1]?.elements[stateRemove.target];
  if (!sourceStateBefore || !live(sourceStateBefore.lifecycle.removedAtBeat)
    || !sourceStateAfter || live(sourceStateAfter.lifecycle.removedAtBeat)
    || sourceStateBefore.value !== operation.fromState
    || !sourceStateBefore.spec.bindings?.conceptIds.includes(sourceConceptId)) return undefined;
  return { boardOpIds: [stateRemove.opId, split.opId], elementIds: [operation.sourceEntityId, ...expectedIds],
    sourceConceptId, resultConceptIds: operation.results.map((result) => result.conceptId) };
}

function capturedRelationVisible(
  claimId: string,
  relation: CanonicalCoverageClaim['relations'][number],
  state: BoardState,
  assetByElement: ReadonlyMap<string, RenderedEntityAssetEvidence>,
): boolean {
  return Object.values(state.edges).some((edge) => {
    const from = state.elements[edge.from];
    const to = state.elements[edge.to];
    return live(edge.lifecycle.removedAtBeat) && bound(edge.bindings?.claimIds, claimId)
      && edge.relation === relation.type && from?.spec.type === 'entity' && to?.spec.type === 'entity'
      && live(from.lifecycle.removedAtBeat) && live(to.lifecycle.removedAtBeat)
      && from.spec.conceptId === relation.from && to.spec.conceptId === relation.to
      && drawable(assetByElement.get(edge.from)) && drawable(assetByElement.get(edge.to));
  });
}

/** Record a label/value change as partial evidence only when its captured effect matches the typed event. */
function partialDynamicBoardOpIds(operations: readonly SemanticOp[], input: ClaimCoverageInput): string[] {
  if (input.states.length !== input.boardOps.length + 1) return [];
  return sorted(operations.flatMap((operation) => {
    if (operation.type !== 'transform') return [];
    const index = input.boardOps.findIndex((boardOp) => boardOp.opId === `${operation.eventId}.board`);
    const boardOp = input.boardOps[index];
    if (boardOp?.op !== 'updateValue' || boardOp.beatId !== operation.beatId
      || boardOp.target !== `${operation.entityId}.state` || boardOp.value !== operation.toState) return [];
    const before = input.states[index]?.elements[boardOp.target];
    const after = input.states[index + 1]?.elements[boardOp.target];
    return before?.value === operation.fromState && after?.value === operation.toState ? [boardOp.opId] : [];
  }));
}

/** Pure projection over already captured, replay-verified board states. It does not trust planner visual intents. */
export function scoreClaimCoverage(input: ClaimCoverageInput): ClaimCoverageReport {
  const assetByElement = new Map(input.renderedEntityAssets.map((asset) => [asset.elementId, asset]));
  const rows = [...input.claims].sort((a, b) => a.id.localeCompare(b.id)).map((claim): ClaimCoverageRow => {
    const beats = input.beats.filter((beat) => beat.claimIds.includes(claim.id));
    const beatIds = sorted(beats.map((beat) => beat.beatId));
    const dynamicChanges = beats.flatMap((beat) => beat.requiredSemanticChanges.flatMap((change, index) => {
      if (!DYNAMIC_CHANGE_KINDS.has(change.kind)) return [];
      const explicitClaimIds = (change as typeof change & { claimIds?: readonly string[] }).claimIds;
      if (explicitClaimIds && !explicitClaimIds.includes(claim.id)) return [];
      if (!explicitClaimIds && !beat.claimIds.includes(claim.id)) return [];
      return [{ beat, change, index, ambiguous: !explicitClaimIds && beat.claimIds.length !== 1 }];
    }));
    // A process/causal relation remains dynamic even if the planner only adds
    // its endpoints and an edge. Planner-selected changes cannot downgrade the
    // canonical claim into a static illustration.
    const dynamicRelation = claim.relations.some((relation) => DYNAMIC_RELATION_TYPES.has(relation.type));
    const dynamic = dynamicChanges.length > 0 || dynamicRelation;
    const misconception = beats.some((beat) => beat.misconceptionIds.length > 0 && beat.claimIds.length === 1);
    const weight: ClaimCoverageWeight = dynamic || misconception ? 3 : claim.epistemicType === 'illustrative_example'
      || claim.epistemicType === 'analogy' ? 1 : claim.relations.length > 0 ? 2 : 1;
    const weightBasis = dynamicChanges.length > 0 ? 'dynamic semantic change in a claim-bound beat' : dynamicRelation
      ? 'canonical dynamic relation requires a visible mechanism' : misconception
      ? 'sole claim of a misconception-correction beat' : claim.epistemicType === 'illustrative_example'
        || claim.epistemicType === 'analogy' ? 'illustrative example or analogy' : claim.relations.length > 0
          ? 'canonical relation claim' : 'definition or supporting detail';
    const semantic = input.semanticOperations.filter((operation) => bound(operation.claimIds, claim.id)
      && beatIds.includes(operation.beatId));
    const semanticEventIds = sorted(semantic.map((operation) => operation.eventId));
    const visibleElements = new Map<string, BoardState['elements'][string]>();
    const visibleEdges = new Map<string, BoardState['edges'][string]>();
    for (const state of input.states) {
      for (const [id, element] of Object.entries(state.elements)) if (live(element.lifecycle.removedAtBeat)
        && bound(element.spec.bindings?.claimIds, claim.id)) visibleElements.set(id, element);
      for (const [id, edge] of Object.entries(state.edges)) if (live(edge.lifecycle.removedAtBeat)
        && bound(edge.bindings?.claimIds, claim.id)
        && state.elements[edge.from] && live(state.elements[edge.from]!.lifecycle.removedAtBeat)
        && state.elements[edge.to] && live(state.elements[edge.to]!.lifecycle.removedAtBeat)) visibleEdges.set(id, edge);
    }
    const elementIds = sorted(visibleElements.keys());
    const edgeIds = sorted(visibleEdges.keys());
    const picturedConcepts = new Set([...visibleElements].flatMap(([id, element]) => element.spec.type === 'entity'
      && drawable(assetByElement.get(id)) ? [element.spec.conceptId] : []));
    const staticClaimCompleteInOneState = input.states.some((state) => {
      const pictured = new Set(Object.entries(state.elements).flatMap(([id, element]) =>
        live(element.lifecycle.removedAtBeat) && bound(element.spec.bindings?.claimIds, claim.id)
        && element.spec.type === 'entity' && drawable(assetByElement.get(id)) ? [element.spec.conceptId] : []));
      return claim.conceptIds.length > 0 && claim.conceptIds.every((id) => pictured.has(id))
        && claim.relations.every((relation) => capturedRelationVisible(claim.id, relation, state, assetByElement));
    });
    const requiredDynamicEvents = dynamicChanges.map(({ beat, change, index, ambiguous }) => ({
      eventId: semanticEventId(beat.beatId, index), beatId: beat.beatId,
      kind: change.kind, entityId: change.entityId, ambiguous,
    }));
    const visibleSeparations = requiredDynamicEvents.map((required) => {
      if (required.ambiguous) return undefined;
      const operation = semantic.find((candidate) => candidate.eventId === required.eventId
        && candidate.beatId === required.beatId && candidate.type === required.kind
        && candidate.type === 'separate' && candidate.sourceEntityId === required.entityId);
      const matchingRequirements = input.mechanismRequirements?.filter((requirement) => requirement.eventId === required.eventId) ?? [];
      if (operation?.type !== 'separate' || matchingRequirements.length !== 1) return undefined;
      const requirement = matchingRequirements[0]!;
      if (requirement.kind !== required.kind || !bound(requirement.claimIds, claim.id)
        || requirement.entityIds.length !== operation.results.length + 1
        || requirement.entityIds[0] !== required.entityId
        || operation.results.some((result, index) => requirement.entityIds[index + 1] !== result.id)) return undefined;
      return visibleSeparation(claim, operation, input, assetByElement);
    });
    const dynamicMechanismProved = dynamic && requiredDynamicEvents.length > 0
      && visibleSeparations.every((proof) => proof !== undefined);
    const separationEvidence = visibleSeparations.flatMap((proof) => proof ? [proof] : []);
    const mechanismPicturedConcepts = new Set([...picturedConcepts, ...separationEvidence.map((proof) => proof.sourceConceptId)]);
    const allMechanismConceptsPictured = claim.conceptIds.every((id) => mechanismPicturedConcepts.has(id));
    const relationCovered = claim.relations.every((relation) => input.states.some((state) =>
      capturedRelationVisible(claim.id, relation, state, assetByElement))
      || (SEPARATION_RELATION_TYPES.has(relation.type) && separationEvidence.some((proof) =>
        proof.sourceConceptId === relation.from && proof.resultConceptIds.includes(relation.to))));
    let level: ClaimCoverageLevel;
    let rationale: string;
    if (elementIds.length === 0 && edgeIds.length === 0) {
      level = 'none'; rationale = 'No captured live element or edge has an explicit binding to this claim.';
    } else if (dynamicMechanismProved && allMechanismConceptsPictured && relationCovered) {
      level = 'mechanism_visible'; rationale = 'Claim-bound semantic separation matches source-state removal, a captured split, and drawable live result entities.';
    } else if (dynamic) {
      level = picturedConcepts.size > 0 || edgeIds.length > 0 ? 'partial' : 'label_only';
      rationale = semanticEventIds.length === 0
        ? 'A claim-bound board mark exists, but no matching typed semantic event proves the required dynamic change.'
        : requiredDynamicEvents.some((event) => event.ambiguous)
          ? 'A multi-claim beat does not attribute its dynamic change to a claim, so mechanism coverage is ambiguous.'
          : 'The captured board does not prove the complete claim-bound dynamic mechanism; labels, value changes, and selected icons alone are insufficient.';
    } else if (staticClaimCompleteInOneState) {
      level = 'mechanism_visible'; rationale = 'Every canonical concept has a drawable claim-bound entity, and every canonical relation has a matching live claim-bound edge.';
    } else if (picturedConcepts.size > 0 || edgeIds.length > 0) {
      level = 'partial'; rationale = 'Some claim-bound structure is visible, but canonical concept or relation coverage is incomplete or ambiguous.';
    } else {
      level = 'label_only'; rationale = 'Only claim-bound text, values, or non-drawable entity marks are visible.';
    }
    const partialBoardOpIds = partialDynamicBoardOpIds(semantic, input);
    const boardOpIds = sorted(input.boardOps.filter((operation) => {
      if (operation.op === 'add') return elementIds.includes(operation.id);
      if (operation.op === 'connect') return edgeIds.includes(operation.id);
      if (partialBoardOpIds.includes(operation.opId)) return true;
      return separationEvidence.some((proof) => proof.boardOpIds.includes(operation.opId));
    }).map((operation) => operation.opId));
    return { claimId: claim.id, weight, weightBasis, level, dynamicMechanismRequired: dynamic,
      beatIds, semanticEventIds, boardOpIds, elementIds: sorted([...elementIds, ...separationEvidence.flatMap((proof) => proof.elementIds)]), edgeIds, rationale };
  });
  const weightedPossible = rows.reduce((sum, row) => sum + row.weight, 0);
  const weightedEarned = rows.reduce((sum, row) => sum + row.weight * LEVEL_FRACTION[row.level], 0);
  return { scorerVersion: CLAIM_COVERAGE_SCORER_VERSION, rows, weightedEarned, weightedPossible,
    weightedCoverage: weightedPossible === 0 ? 0 : weightedEarned / weightedPossible,
    dynamicMechanismMissingClaimIds: rows.filter((row) => row.dynamicMechanismRequired && row.level !== 'mechanism_visible').map((row) => row.claimId) };
}

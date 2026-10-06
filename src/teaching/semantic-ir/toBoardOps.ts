import { BoardOpSchema, type BoardOp, type ElementSpec, type RegionId } from '../../visual-v2/board-ops/types.js';
import type { VisualVocabulary } from '../../planner/visualDiscovery.js';
import type { SemanticProgramContext } from './program.js';
import { applySemanticProgram } from './program.js';
import { SemanticOpSchema, type SemanticOp, type SemanticSceneState, type SemanticIrProblem } from './types.js';

export interface SemanticBoardLoweringContext extends SemanticProgramContext {
  concepts: ReadonlyArray<{ id: string; label: string; kind?: string }>;
  visualVocabulary?: VisualVocabulary;
  /** Existing renderer-element ids are checked only for identity collisions and required update targets. */
  existingElementIds?: ReadonlySet<string>;
  /** Current visible state values, keyed by the deterministic `${semanticEntityId}.state` element id. */
  existingStateValues?: Readonly<Record<string, string | number>>;
  /** Optional already-resolved sentence cue for each semantic event. */
  cueByEventId?: Readonly<Record<string, number>>;
}

export type SemanticBoardLoweringResult =
  | { ok: true; operations: BoardOp[]; resultingSemanticState: SemanticSceneState; selectedAssetIds: Record<string, string> }
  | { ok: false; problems: SemanticIrProblem[] };

const problem = (path: string, message: string): SemanticIrProblem => ({ path, message });
const stateValueId = (entityId: string): string => `${entityId}.state`;

function separationRegions(count: number): RegionId[] {
  const regions: Record<number, RegionId[]> = {
    2: ['left', 'right'],
    3: ['left', 'center', 'right'],
    4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    5: ['top', 'left', 'right', 'bottom-left', 'bottom-right'],
    6: ['top-left', 'top-right', 'left', 'right', 'bottom-left', 'bottom-right'],
  };
  return regions[count] ?? [];
}

/**
 * Deterministic first-stage lowering from semantic operations to existing BoardOps.
 * It intentionally supports only mechanisms whose current renderer mapping is explicit.
 * Unsupported operations fail closed instead of being translated to a generic board.
 */
export function compileSemanticOpsToBoardOps(
  initialState: SemanticSceneState,
  candidateOperations: readonly unknown[],
  context: SemanticBoardLoweringContext,
): SemanticBoardLoweringResult {
  const parsedOps: SemanticOp[] = [];
  for (const [index, candidate] of candidateOperations.entries()) {
    const parsed = SemanticOpSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((issue) => ({ path: `/operations/${index}/${issue.path.map(String).join('/')}`, message: issue.message })) };
    parsedOps.push(parsed.data);
  }
  const replay = applySemanticProgram(initialState, parsedOps, context);
  if (!replay.ok) return replay;

  const concepts = new Map(context.concepts.map((concept) => [concept.id, concept]));
  const selectedAssetIds: Record<string, string> = {};
  const seenVocabularyConcepts = new Set<string>();
  if (context.visualVocabulary && context.visualVocabulary.sceneId !== initialState.sceneId) {
    return { ok: false, problems: [problem('/visualVocabulary/sceneId', `icon vocabulary belongs to ${context.visualVocabulary.sceneId}, not semantic scene ${initialState.sceneId}`)] };
  }
  for (const [index, item] of (context.visualVocabulary?.concepts ?? []).entries()) {
    const concept = concepts.get(item.conceptId);
    if (!concept) return { ok: false, problems: [problem(`/visualVocabulary/concepts/${index}/conceptId`, `unknown concept ${item.conceptId}`)] };
    if (seenVocabularyConcepts.has(item.conceptId)) return { ok: false, problems: [problem(`/visualVocabulary/concepts/${index}/conceptId`, `duplicate visual vocabulary entry for ${item.conceptId}`)] };
    seenVocabularyConcepts.add(item.conceptId);
    if (concept.label !== item.label) return { ok: false, problems: [problem(`/visualVocabulary/concepts/${index}/label`, `icon vocabulary label does not match canonical concept ${item.conceptId}`)] };
    if (concept.kind !== undefined && concept.kind !== item.conceptKind) return { ok: false, problems: [problem(`/visualVocabulary/concepts/${index}/conceptKind`, `visual vocabulary kind does not match canonical concept ${item.conceptId}`)] };
    if (item.depiction.kind === 'icon') {
      if (concept.kind !== 'entity' || item.conceptKind !== 'entity') return { ok: false, problems: [problem(`/visualVocabulary/concepts/${index}/depiction`, 'library icons are allowed only for canonical entity concepts')] };
      if (!item.depiction.entryId.trim()) return { ok: false, problems: [problem(`/visualVocabulary/concepts/${index}/depiction/entryId`, 'selected icon needs its exact catalog asset id')] };
      selectedAssetIds[item.conceptId] = item.depiction.entryId;
    }
  }

  const operations: BoardOp[] = [];
  const usedElementIds = new Set(context.existingElementIds ?? []);
  const stateValues = new Map(Object.entries(context.existingStateValues ?? {}));
  const introduced = new Set(initialState.entities.map((entity) => entity.id));
  const add = (op: unknown, path: string): SemanticIrProblem[] => {
    const parsed = BoardOpSchema.safeParse(op);
    if (!parsed.success) return parsed.error.issues.map((issue) => ({ path: `${path}/${issue.path.map(String).join('/')}`, message: issue.message }));
    operations.push(parsed.data);
    return [];
  };
  const reserveId = (id: string, path: string): SemanticIrProblem[] => {
    if (usedElementIds.has(id)) return [problem(path, `renderer element id ${id} is already in use` )];
    usedElementIds.add(id);
    return [];
  };
  const bindings = (conceptId: string, claimIds: string[]) => ({ conceptIds: [conceptId], claimIds: [...new Set(claimIds)] });

  for (const [index, op] of parsedOps.entries()) {
    const path = `/operations/${index}`;
    const cue = context.cueByEventId?.[op.eventId];
    if (cue !== undefined && (!Number.isInteger(cue) || cue < 0 || cue > 3)) return { ok: false, problems: [problem(`/cueByEventId/${op.eventId}`, 'sentence cue must be an integer from 0 through 3')] };
    const base = { opId: `${op.eventId}.board`, beatId: op.beatId, ...(cue !== undefined ? { cue } : {}) };

    if (op.type === 'introduce') {
      const concept = concepts.get(op.entity.conceptId);
      if (!concept) return { ok: false, problems: [problem(`${path}/entity/conceptId`, `unknown canonical concept ${op.entity.conceptId}`)] };
      if (introduced.has(op.entity.id)) return { ok: false, problems: [problem(`${path}/entity/id`, `semantic entity ${op.entity.id} was already introduced`)] };
      if (op.entity.state !== undefined && op.entity.state.length > 60) return { ok: false, problems: [problem(`${path}/entity/state`, 'state exceeds the visible value limit; preserve it verbatim and repair the semantic representation instead of shortening it')] };
      const entityId = op.entity.id;
      const entityIdProblems = reserveId(entityId, `${path}/entity/id`);
      if (entityIdProblems.length) return { ok: false, problems: entityIdProblems };
      const entity: ElementSpec = {
        type: 'entity', conceptId: concept.id, label: concept.label, provenance: 'derived',
        bindings: bindings(concept.id, op.claimIds),
      };
      const addEntityProblems = add({ op: 'add', ...base, id: entityId, element: entity, at: { region: 'center' }, persistence: 'scene' }, `${path}/boardOps/entity`);
      if (addEntityProblems.length) return { ok: false, problems: addEntityProblems };
      introduced.add(entityId);
      if (op.entity.state !== undefined) {
        const valueId = stateValueId(entityId);
        const stateIdProblems = reserveId(valueId, `${path}/entity/state`);
        if (stateIdProblems.length) return { ok: false, problems: stateIdProblems };
        const value: ElementSpec = {
          type: 'value', label: 'State', value: op.entity.state, provenance: 'derived',
          bindings: bindings(concept.id, op.claimIds),
        };
        const addStateProblems = add({ op: 'add', ...base, opId: `${op.eventId}.state`, id: valueId, element: value, at: { region: 'center' }, persistence: 'scene' }, `${path}/boardOps/state`);
        if (addStateProblems.length) return { ok: false, problems: addStateProblems };
        stateValues.set(valueId, op.entity.state);
      }
      continue;
    }

    if (op.type === 'transform') {
      if (!introduced.has(op.entityId) && !context.existingElementIds?.has(op.entityId)) return { ok: false, problems: [problem(`${path}/entityId`, `no board entity exists for semantic entity ${op.entityId}`)] };
      if (op.toState.length > 60) return { ok: false, problems: [problem(`${path}/toState`, 'state exceeds the visible value limit; preserve it verbatim and repair the semantic representation instead of shortening it')] };
      const target = stateValueId(op.entityId);
      if (!usedElementIds.has(target)) return { ok: false, problems: [problem(`${path}/entityId`, `no visible state value exists for semantic entity ${op.entityId}`)] };
      if (stateValues.get(target) !== op.fromState) return { ok: false, problems: [problem(`${path}/fromState`, `visible state value does not match required prior state ${JSON.stringify(op.fromState)}`)] };
      const updateProblems = add({ op: 'updateValue', ...base, target, value: op.toState }, `${path}/boardOps/state`);
      if (updateProblems.length) return { ok: false, problems: updateProblems };
      stateValues.set(target, op.toState);
      continue;
    }

    if (op.type === 'separate') {
      if (!introduced.has(op.sourceEntityId) && !context.existingElementIds?.has(op.sourceEntityId)) {
        return { ok: false, problems: [problem(`${path}/sourceEntityId`, `no board entity exists for semantic source ${op.sourceEntityId}`)] };
      }
      const sourceStateId = stateValueId(op.sourceEntityId);
      if (!usedElementIds.has(sourceStateId)) return { ok: false, problems: [problem(`${path}/fromState`, `no visible state value exists for semantic source ${op.sourceEntityId}`)] };
      if (stateValues.get(sourceStateId) !== op.fromState) return { ok: false, problems: [problem(`${path}/fromState`, `visible state value does not match required prior state ${JSON.stringify(op.fromState)}`)] };
      if (op.results.length < 2 || op.results.length > 6) return { ok: false, problems: [problem(`${path}/results`, 'a visible separation needs two through six result entities')] };
      const regions = separationRegions(op.results.length);
      const parts: Array<{ id: string; element: ElementSpec; at: { region: RegionId } }> = [];
      for (const [resultIndex, result] of op.results.entries()) {
        const concept = concepts.get(result.conceptId);
        if (!concept) return { ok: false, problems: [problem(`${path}/results/${resultIndex}/conceptId`, `unknown canonical concept ${result.conceptId}`)] };
        if (result.state !== undefined && result.state.length > 60) return { ok: false, problems: [problem(`${path}/results/${resultIndex}/state`, 'state exceeds the visible value limit; preserve it verbatim and repair the semantic representation instead of shortening it')] };
        const idProblems = reserveId(result.id, `${path}/results/${resultIndex}/id`);
        if (idProblems.length) return { ok: false, problems: idProblems };
        parts.push({
          id: result.id,
          element: { type: 'entity', conceptId: concept.id, label: concept.label, provenance: 'derived', bindings: bindings(concept.id, result.claimIds) },
          at: { region: regions[resultIndex]! },
        });
      }
      const removeStateProblems = add({ op: 'remove', ...base, opId: `${op.eventId}.state-remove`, target: sourceStateId }, `${path}/boardOps/source-state`);
      if (removeStateProblems.length) return { ok: false, problems: removeStateProblems };
      stateValues.delete(sourceStateId);
      const splitProblems = add({ op: 'split', ...base, opId: `${op.eventId}.split`, target: op.sourceEntityId, into: parts }, `${path}/boardOps/split`);
      if (splitProblems.length) return { ok: false, problems: splitProblems };
      for (const [resultIndex, result] of op.results.entries()) {
        introduced.add(result.id);
        if (result.state === undefined) continue;
        const valueId = stateValueId(result.id);
        const valueIdProblems = reserveId(valueId, `${path}/results/${resultIndex}/state`);
        if (valueIdProblems.length) return { ok: false, problems: valueIdProblems };
        const concept = concepts.get(result.conceptId)!;
        const stateElement: ElementSpec = { type: 'value', label: 'State', value: result.state, provenance: 'derived', bindings: bindings(concept.id, result.claimIds) };
        const stateProblems = add({ op: 'add', ...base, opId: `${op.eventId}.result-${resultIndex + 1}-state`, id: valueId, element: stateElement, at: parts[resultIndex]!.at, persistence: 'scene' }, `${path}/boardOps/results/${resultIndex}/state`);
        if (stateProblems.length) return { ok: false, problems: stateProblems };
        stateValues.set(valueId, result.state);
      }
      continue;
    }

    if (op.type === 'focus' || op.type === 'select') {
      const entityIds = op.type === 'focus' ? op.entityIds : [op.entityId];
      for (const [entityIndex, entityId] of entityIds.entries()) {
        if (!usedElementIds.has(entityId)) return { ok: false, problems: [problem(`${path}/entityIds/${entityIndex}`, `no board entity exists for semantic entity ${entityId}`)] };
        const focusProblems = add({ op: 'highlight', ...base, opId: `${op.eventId}.focus.${entityIndex + 1}`, target: entityId }, `${path}/boardOps/focus/${entityIndex}`);
        if (focusProblems.length) return { ok: false, problems: focusProblems };
      }
      continue;
    }

    if (op.type === 'finalize') {
      if (!introduced.has(op.entityId) && !context.existingElementIds?.has(op.entityId)) return { ok: false, problems: [problem(`${path}/entityId`, `no board entity exists for semantic entity ${op.entityId}`)] };
      const finishProblems = add({ op: 'deemphasize', ...base, target: op.entityId }, `${path}/boardOps/finalize`);
      if (finishProblems.length) return { ok: false, problems: finishProblems };
      continue;
    }

    return { ok: false, problems: [problem(`${path}/type`, `semantic operation ${op.type} has no verified BoardOps compiler yet; no generic visual substitute is allowed`)] };
  }

  return { ok: true, operations, resultingSemanticState: replay.state, selectedAssetIds };
}

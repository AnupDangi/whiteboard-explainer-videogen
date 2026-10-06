import { SemanticOpSchema, SemanticSceneStateSchema, type SemanticEntity, type SemanticOp, type SemanticSceneState } from './types.js';
import type { SemanticIrProblem } from './types.js';

export interface SemanticProgramContext {
  knownBeatIds?: ReadonlySet<string>;
  knownClaimIds?: ReadonlySet<string>;
}

export type SemanticProgramResult =
  | { ok: true; state: SemanticSceneState; operations: SemanticOp[] }
  | { ok: false; problems: SemanticIrProblem[] };

const equalScalar = (left: string | number | undefined, right: string | number | undefined): boolean => Object.is(left, right);
const parseProblems = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }, base: string): SemanticIrProblem[] => error.issues.map((issue) => ({ path: `${base}/${issue.path.map(String).join('/')}`, message: issue.message }));

function fail(path: string, message: string): SemanticIrProblem[] { return [{ path, message }]; }

function initialStateProblems(state: SemanticSceneState): SemanticIrProblem[] {
  const problems: SemanticIrProblem[] = [];
  const entities = new Map<string, SemanticEntity>();
  for (const [index, entity] of state.entities.entries()) {
    if (entities.has(entity.id)) problems.push({ path: `/initialState/entities/${index}/id`, message: `duplicate semantic entity id ${entity.id}` });
    entities.set(entity.id, entity);
  }
  const relationIds = new Set<string>();
  for (const [index, relation] of state.relations.entries()) {
    if (relationIds.has(relation.id)) problems.push({ path: `/initialState/relations/${index}/id`, message: `duplicate semantic relation id ${relation.id}` });
    relationIds.add(relation.id);
    if (!entities.has(relation.fromEntityId)) problems.push({ path: `/initialState/relations/${index}/fromEntityId`, message: `unknown semantic entity ${relation.fromEntityId}` });
    if (!entities.has(relation.toEntityId)) problems.push({ path: `/initialState/relations/${index}/toEntityId`, message: `unknown semantic entity ${relation.toEntityId}` });
  }
  const selected = new Set<string>();
  for (const [index, id] of state.selectedEntityIds.entries()) {
    if (selected.has(id)) problems.push({ path: `/initialState/selectedEntityIds/${index}`, message: `duplicate selected entity ${id}` });
    selected.add(id);
    const entity = entities.get(id);
    if (!entity) problems.push({ path: `/initialState/selectedEntityIds/${index}`, message: `unknown semantic entity ${id}` });
    else if (entity.lifecycle !== 'active') problems.push({ path: `/initialState/selectedEntityIds/${index}`, message: `selected entity ${id} is ${entity.lifecycle}, not active` });
  }
  const plotIds = new Set<string>();
  for (const [index, plot] of state.plots.entries()) {
    if (plotIds.has(plot.id)) problems.push({ path: `/initialState/plots/${index}/id`, message: `duplicate semantic plot id ${plot.id}` });
    plotIds.add(plot.id);
    if (new Set(plot.thresholds.map((threshold) => threshold.id)).size !== plot.thresholds.length) problems.push({ path: `/initialState/plots/${index}/thresholds`, message: 'threshold ids must be unique within a plot' });
  }
  const loopIds = new Set<string>();
  for (const [index, loop] of state.feedbackLoops.entries()) {
    if (loopIds.has(loop.id)) problems.push({ path: `/initialState/feedbackLoops/${index}/id`, message: `duplicate feedback loop id ${loop.id}` });
    loopIds.add(loop.id);
    if (!entities.has(loop.sourceEntityId)) problems.push({ path: `/initialState/feedbackLoops/${index}/sourceEntityId`, message: `unknown semantic entity ${loop.sourceEntityId}` });
    if (!entities.has(loop.targetEntityId)) problems.push({ path: `/initialState/feedbackLoops/${index}/targetEntityId`, message: `unknown semantic entity ${loop.targetEntityId}` });
  }
  const annotationIds = new Set<string>();
  for (const [index, annotation] of state.annotations.entries()) {
    if (annotationIds.has(annotation.id)) problems.push({ path: `/initialState/annotations/${index}/id`, message: `duplicate semantic annotation id ${annotation.id}` });
    annotationIds.add(annotation.id);
    if (!entities.has(annotation.entityId)) problems.push({ path: `/initialState/annotations/${index}/entityId`, message: `unknown semantic entity ${annotation.entityId}` });
  }
  return problems;
}

function initialStateClaimIds(state: SemanticSceneState): string[] {
  return [
    ...state.entities.flatMap((entity) => entity.claimIds),
    ...state.relations.flatMap((relation) => relation.claimIds),
    ...state.plots.flatMap((plot) => [...plot.claimIds, ...plot.thresholds.flatMap((threshold) => threshold.claimIds)]),
    ...state.feedbackLoops.flatMap((loop) => loop.claimIds),
    ...state.annotations.flatMap((annotation) => annotation.claimIds),
  ];
}

function entityIndex(state: SemanticSceneState, id: string): number { return state.entities.findIndex((entity) => entity.id === id); }
function activeEntity(state: SemanticSceneState, id: string, path: string): SemanticEntity | SemanticIrProblem[] {
  const entity = state.entities.find((candidate) => candidate.id === id);
  if (!entity) return fail(path, `unknown semantic entity ${id}`);
  if (entity.lifecycle !== 'active') return fail(path, `semantic entity ${id} is ${entity.lifecycle}, not active`);
  return entity;
}
function relationIndex(state: SemanticSceneState, id: string): number { return state.relations.findIndex((relation) => relation.id === id); }
function claimSubset(inner: readonly string[], outer: readonly string[]): boolean { const allowed = new Set(outer); return inner.every((claimId) => allowed.has(claimId)); }
function newEntityProblems(state: SemanticSceneState, entity: SemanticEntity, opClaims: readonly string[], path: string): SemanticIrProblem[] {
  if (entityIndex(state, entity.id) >= 0) return fail(`${path}/id`, `semantic entity id ${entity.id} is already in use; entity identity cannot be recycled`);
  if (entity.lifecycle !== 'active') return fail(`${path}/lifecycle`, 'new semantic entities must enter the state as active');
  if (!claimSubset(entity.claimIds, opClaims)) return fail(`${path}/claimIds`, 'entity claimIds must be included in the introducing operation claimIds');
  return [];
}

function applyOperation(state: SemanticSceneState, op: SemanticOp, at: string): SemanticIrProblem[] {
  const activate = (ids: string[], path: string): SemanticIrProblem[] => {
    for (const [index, id] of ids.entries()) {
      const entity = activeEntity(state, id, `${path}/${index}`);
      if (Array.isArray(entity)) return entity;
    }
    return [];
  };

  switch (op.type) {
    case 'introduce': {
      const problems = newEntityProblems(state, op.entity, op.claimIds, `${at}/entity`);
      if (problems.length) return problems;
      state.entities.push(op.entity);
      return [];
    }
    case 'focus': {
      const problems = activate(op.entityIds, `${at}/entityIds`);
      if (problems.length) return problems;
      state.selectedEntityIds = [...new Set(op.entityIds)];
      return [];
    }
    case 'compare': return activate(op.entityIds, `${at}/entityIds`);
    case 'flow': case 'move': {
      const entity = activeEntity(state, op.entityId, `${at}/entityId`);
      if (Array.isArray(entity)) return entity;
      if (op.fromLocationId === op.toLocationId) return fail(`${at}/toLocationId`, 'a semantic movement must change location');
      if (entity.locationId !== op.fromLocationId) return fail(`${at}/fromLocationId`, `expected prior location ${String(entity.locationId)}, received ${op.fromLocationId}`);
      state.entities[entityIndex(state, entity.id)] = { ...entity, locationId: op.toLocationId };
      return [];
    }
    case 'transform': {
      const entity = activeEntity(state, op.entityId, `${at}/entityId`);
      if (Array.isArray(entity)) return entity;
      if (op.fromState === op.toState) return fail(`${at}/toState`, 'a semantic transformation must change state');
      if (entity.state !== op.fromState) return fail(`${at}/fromState`, `expected prior state ${JSON.stringify(entity.state)}, received ${JSON.stringify(op.fromState)}`);
      state.entities[entityIndex(state, entity.id)] = { ...entity, state: op.toState };
      return [];
    }
    case 'separate': {
      const source = activeEntity(state, op.sourceEntityId, `${at}/sourceEntityId`);
      if (Array.isArray(source)) return source;
      if (source.state !== op.fromState) return fail(`${at}/fromState`, `expected prior state ${JSON.stringify(source.state)}, received ${JSON.stringify(op.fromState)}`);
      for (const [index, result] of op.results.entries()) {
        const problems = newEntityProblems(state, result, op.claimIds, `${at}/results/${index}`);
        if (problems.length) return problems;
        if (op.results.slice(0, index).some((prior) => prior.id === result.id)) return fail(`${at}/results/${index}/id`, `duplicate result entity id ${result.id}`);
      }
      state.entities[entityIndex(state, source.id)] = { ...source, lifecycle: 'separated' };
      state.entities.push(...op.results);
      state.selectedEntityIds = state.selectedEntityIds.filter((id) => id !== source.id);
      return [];
    }
    case 'merge': {
      const problems = activate(op.entityIds, `${at}/entityIds`);
      if (problems.length) return problems;
      if (new Set(op.entityIds).size !== op.entityIds.length) return fail(`${at}/entityIds`, 'a merge cannot use the same input entity more than once');
      const resultProblems = newEntityProblems(state, op.result, op.claimIds, `${at}/result`);
      if (resultProblems.length) return resultProblems;
      for (const id of op.entityIds) {
        const index = entityIndex(state, id);
        state.entities[index] = { ...state.entities[index]!, lifecycle: 'merged' };
      }
      state.entities.push(op.result);
      state.selectedEntityIds = state.selectedEntityIds.filter((id) => !op.entityIds.includes(id));
      return [];
    }
    case 'update_quantity': {
      const entity = activeEntity(state, op.entityId, `${at}/entityId`);
      if (Array.isArray(entity)) return entity;
      if (!equalScalar(entity.quantity, op.fromValue)) return fail(`${at}/fromValue`, `expected prior quantity ${JSON.stringify(entity.quantity)}, received ${JSON.stringify(op.fromValue)}`);
      if (entity.unit !== op.fromUnit) return fail(`${at}/fromUnit`, `expected prior unit ${JSON.stringify(entity.unit)}, received ${JSON.stringify(op.fromUnit)}`);
      if (equalScalar(op.fromValue, op.toValue)) return fail(`${at}/toValue`, 'a quantity update must change the value; unit-only relabelling is not a quantity change');
      state.entities[entityIndex(state, entity.id)] = { ...entity, quantity: op.toValue, ...(op.unit ? { unit: op.unit } : {}) };
      return [];
    }
    case 'weight': {
      const index = relationIndex(state, op.relationId);
      if (index < 0) return fail(`${at}/relationId`, `unknown semantic relation ${op.relationId}`);
      const relation = state.relations[index]!;
      if (!equalScalar(relation.weight, op.fromValue)) return fail(`${at}/fromValue`, `expected prior relation weight ${JSON.stringify(relation.weight)}, received ${JSON.stringify(op.fromValue)}`);
      if (equalScalar(op.fromValue, op.toValue)) return fail(`${at}/toValue`, 'a relation weight update must change the value');
      state.relations[index] = { ...relation, weight: op.toValue };
      return [];
    }
    case 'select': {
      const entity = activeEntity(state, op.entityId, `${at}/entityId`);
      if (Array.isArray(entity)) return entity;
      state.selectedEntityIds = [entity.id];
      return [];
    }
    case 'finalize': {
      const entity = activeEntity(state, op.entityId, `${at}/entityId`);
      if (Array.isArray(entity)) return entity;
      state.entities[entityIndex(state, entity.id)] = { ...entity, lifecycle: 'finalized' };
      state.selectedEntityIds = state.selectedEntityIds.filter((id) => id !== entity.id);
      return [];
    }
    case 'plot': {
      if (state.plots.some((plot) => plot.id === op.plot.id)) return fail(`${at}/plot/id`, `plot id ${op.plot.id} already exists`);
      if (!claimSubset(op.plot.claimIds, op.claimIds)) return fail(`${at}/plot/claimIds`, 'plot claimIds must be included in the operation claimIds');
      state.plots.push(op.plot);
      return [];
    }
    case 'mark_threshold': {
      const index = state.plots.findIndex((plot) => plot.id === op.plotId);
      if (index < 0) return fail(`${at}/plotId`, `unknown semantic plot ${op.plotId}`);
      const plot = state.plots[index]!;
      if (plot.thresholds.some((threshold) => threshold.id === op.threshold.id)) return fail(`${at}/threshold/id`, `threshold id ${op.threshold.id} already exists`);
      if (!claimSubset(op.threshold.claimIds, op.claimIds)) return fail(`${at}/threshold/claimIds`, 'threshold claimIds must be included in the operation claimIds');
      state.plots[index] = { ...plot, thresholds: [...plot.thresholds, op.threshold] };
      return [];
    }
    case 'cause': {
      for (const [field, id] of [['fromEntityId', op.relation.fromEntityId], ['toEntityId', op.relation.toEntityId]] as const) {
        const entity = activeEntity(state, id, `${at}/relation/${field}`);
        if (Array.isArray(entity)) return entity;
      }
      if (op.relation.fromEntityId === op.relation.toEntityId) return fail(`${at}/relation/toEntityId`, 'a causal relation needs distinct cause and effect entities');
      if (state.relations.some((relation) => relation.id === op.relation.id)) return fail(`${at}/relation/id`, `relation id ${op.relation.id} already exists`);
      if (op.relation.type !== 'causes') return fail(`${at}/relation/type`, 'a cause operation must create a causes relation');
      if (!claimSubset(op.relation.claimIds, op.claimIds)) return fail(`${at}/relation/claimIds`, 'relation claimIds must be included in the operation claimIds');
      state.relations.push(op.relation);
      return [];
    }
    case 'feedback': {
      for (const [field, id] of [['sourceEntityId', op.loop.sourceEntityId], ['targetEntityId', op.loop.targetEntityId]] as const) {
        const entity = activeEntity(state, id, `${at}/loop/${field}`);
        if (Array.isArray(entity)) return entity;
      }
      if (op.loop.sourceEntityId === op.loop.targetEntityId) return fail(`${at}/loop/targetEntityId`, 'a feedback loop needs distinct source and target entities');
      if (state.feedbackLoops.some((loop) => loop.id === op.loop.id)) return fail(`${at}/loop/id`, `feedback loop id ${op.loop.id} already exists`);
      if (!claimSubset(op.loop.claimIds, op.claimIds)) return fail(`${at}/loop/claimIds`, 'feedback claimIds must be included in the operation claimIds');
      state.feedbackLoops.push(op.loop);
      return [];
    }
    case 'annotate': {
      const entity = activeEntity(state, op.annotation.entityId, `${at}/annotation/entityId`);
      if (Array.isArray(entity)) return entity;
      if (state.annotations.some((annotation) => annotation.id === op.annotation.id)) return fail(`${at}/annotation/id`, `annotation id ${op.annotation.id} already exists`);
      if (!claimSubset(op.annotation.claimIds, op.claimIds)) return fail(`${at}/annotation/claimIds`, 'annotation claimIds must be included in the operation claimIds');
      state.annotations.push(op.annotation);
      return [];
    }
  }
}

/** Parse, validate and replay semantic operations into a fresh state. Inputs and source state are never mutated. */
export function applySemanticProgram(
  initial: SemanticSceneState,
  candidateOperations: readonly unknown[],
  context: SemanticProgramContext = {},
): SemanticProgramResult {
  const parsedState = SemanticSceneStateSchema.safeParse(initial);
  if (!parsedState.success) return { ok: false, problems: parseProblems(parsedState.error, '/initialState') };
  const initialProblems = initialStateProblems(parsedState.data);
  if (initialProblems.length) return { ok: false, problems: initialProblems };
  if (context.knownClaimIds) {
    const unknown = initialStateClaimIds(parsedState.data).find((claimId) => !context.knownClaimIds!.has(claimId));
    if (unknown) return { ok: false, problems: fail('/initialState', `unknown claim ${unknown} in pinned semantic state`) };
  }
  const state: SemanticSceneState = {
    ...parsedState.data,
    entities: [...parsedState.data.entities],
    relations: [...parsedState.data.relations],
    selectedEntityIds: [...parsedState.data.selectedEntityIds],
    plots: [...parsedState.data.plots],
    feedbackLoops: [...parsedState.data.feedbackLoops],
    annotations: [...parsedState.data.annotations],
  };
  const operations: SemanticOp[] = [];
  const seenEventIds = new Set<string>();

  for (const [index, candidate] of candidateOperations.entries()) {
    const path = `/operations/${index}`;
    const parsed = SemanticOpSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, problems: parseProblems(parsed.error, path) };
    const op = parsed.data;
    if (seenEventIds.has(op.eventId)) return { ok: false, problems: fail(`${path}/eventId`, `semantic event ${op.eventId} is duplicated`) };
    if (!op.eventId.startsWith(`${op.beatId}.e`)) return { ok: false, problems: fail(`${path}/eventId`, `event ${op.eventId} must belong to beat ${op.beatId}`) };
    if (context.knownBeatIds && !context.knownBeatIds.has(op.beatId)) return { ok: false, problems: fail(`${path}/beatId`, `unknown teaching beat ${op.beatId}`) };
    if (context.knownClaimIds) {
      const unknown = op.claimIds.find((claimId) => !context.knownClaimIds!.has(claimId));
      if (unknown) return { ok: false, problems: fail(`${path}/claimIds`, `unknown claim ${unknown}`) };
    }
    const missingDependency = op.dependsOnEventIds.find((dependencyId) => !seenEventIds.has(dependencyId));
    if (missingDependency) return { ok: false, problems: fail(`${path}/dependsOnEventIds`, `dependency ${missingDependency} must refer to an earlier successful semantic event`) };
    const problems = applyOperation(state, op, path);
    if (problems.length) return { ok: false, problems };
    seenEventIds.add(op.eventId);
    operations.push(op);
  }

  return { ok: true, state, operations };
}

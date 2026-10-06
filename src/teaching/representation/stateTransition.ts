import { semanticEventId, type TeachingBeat } from '../beat-plan/types.js';
import { applySemanticProgram } from '../semantic-ir/program.js';
import { SemanticOpSchema, type SemanticOp, type SemanticSceneState } from '../semantic-ir/types.js';
import { defineRepresentationProvider, type RepresentationProblem } from './providerRegistry.js';
import { z } from 'zod';

const id = () => z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/);
const introduction = z.object({
  kind: z.literal('introduce'), eventId: z.string().min(1).max(100), entityId: id(), conceptId: id(), state: z.string().trim().min(1).max(160),
}).strict();
const transformation = z.object({
  kind: z.literal('transform'), eventId: z.string().min(1).max(100), entityId: id(), fromState: z.string().trim().min(1).max(160), toState: z.string().trim().min(1).max(160),
}).strict();
const separation = z.object({
  kind: z.literal('separate'), eventId: z.string().min(1).max(100), entityId: id(), fromState: z.string().trim().min(1).max(160), toState: z.string().trim().min(1).max(160), resultEntityIds: z.array(id()).min(2).max(6),
}).strict();
const merging = z.object({
  kind: z.literal('merge'), eventId: z.string().min(1).max(100), entityId: id(),
  toState: z.string().trim().min(1).max(160),
  inputs: z.array(z.object({ entityId: id(), state: z.string().trim().min(1).max(80) }).strict()).min(2).max(6)
    .refine((inputs) => new Set(inputs.map((input) => input.entityId)).size === inputs.length, 'merge input entity ids must be unique'),
}).strict();
export const StateTransitionModelSchema = z.object({ events: z.array(z.discriminatedUnion('kind', [introduction, transformation, separation, merging])).min(1).max(8) }).strict();
export type StateTransitionModel = z.infer<typeof StateTransitionModelSchema>;

const supported = (kind: string): kind is 'introduce' | 'transform' | 'separate' | 'merge' => kind === 'introduce' || kind === 'transform' || kind === 'separate' || kind === 'merge';

/** Derive the minimal typed representation from the already locked semantic changes. */
export function deriveStateTransitionModel(beat: TeachingBeat): StateTransitionModel {
  return {
    events: beat.requiredSemanticChanges.map((change, index) => {
      const eventId = semanticEventId(beat.beatId, index);
      if (change.kind === 'introduce') {
        const entity = beat.entities.find((candidate) => candidate.entityId === change.entityId);
        if (!entity) throw new Error(`introduction ${eventId} has no declared beat entity`);
        return { kind: 'introduce', eventId, entityId: change.entityId, conceptId: entity.conceptId, state: change.toState };
      }
      if (change.kind === 'transform' && change.fromState) {
        return { kind: 'transform', eventId, entityId: change.entityId, fromState: change.fromState, toState: change.toState };
      }
      if (change.kind === 'separate' && change.fromState) {
        const resultEntityIds = beat.semanticRevealOrder.filter((entityId) => entityId !== change.entityId);
        if (resultEntityIds.length < 2 || resultEntityIds.length > 6) throw new Error(`separation ${eventId} needs 2 through 6 newly revealed result entities`);
        return { kind: 'separate', eventId, entityId: change.entityId, fromState: change.fromState, toState: change.toState, resultEntityIds };
      }
      if (change.kind === 'merge' && change.mergeInputEntityIds) {
        const inputs = change.mergeInputEntityIds.map((entityId) => {
          const entity = beat.entities.find((candidate) => candidate.entityId === entityId);
          if (!entity?.state) throw new Error(`merge input ${entityId} must declare its exact current state in the beat`);
          return { entityId, state: entity.state };
        });
        return { kind: 'merge', eventId, entityId: change.entityId, toState: change.toState, inputs };
      }
      throw new Error(`state_transition cannot represent required change ${change.kind} at ${eventId}`);
    }),
  };
}

function validateStateTransitionModel(model: StateTransitionModel, beat: TeachingBeat): RepresentationProblem[] {
  const problems: RepresentationProblem[] = [];
  if (beat.representationFamily !== 'state_transition') problems.push({ path: '/representationFamily', message: 'state transition provider requires representationFamily state_transition' });
  if (model.events.length !== beat.requiredSemanticChanges.length) {
    problems.push({ path: '/events', message: 'state transition model must represent every required semantic change exactly once' });
  }
  for (const [index, change] of beat.requiredSemanticChanges.entries()) {
    const event = model.events[index];
    const path = `/events/${index}`;
    if (!supported(change.kind)) {
      problems.push({ path: `${path}/kind`, message: `state transition provider does not yet support semantic change ${change.kind}` });
      continue;
    }
    if (!event) continue;
    const expectedEventId = semanticEventId(beat.beatId, index);
    if (event.eventId !== expectedEventId) problems.push({ path: `${path}/eventId`, message: `event id must be ${expectedEventId}` });
    if (event.kind !== change.kind) problems.push({ path: `${path}/kind`, message: `event kind must preserve required change ${change.kind}` });
    if (event.entityId !== change.entityId) problems.push({ path: `${path}/entityId`, message: `event must preserve required semantic entity ${change.entityId}` });
    if (event.kind === 'introduce' && change.kind === 'introduce') {
      const entity = beat.entities.find((candidate) => candidate.entityId === change.entityId);
      if (!entity || event.conceptId !== entity.conceptId) problems.push({ path: `${path}/conceptId`, message: 'introduced concept must match the beat entity identity' });
      if (event.state !== change.toState) problems.push({ path: `${path}/state`, message: 'introduced state must match the required semantic change' });
    }
    if (event.kind === 'transform' && change.kind === 'transform') {
      if (!change.fromState || event.fromState !== change.fromState) problems.push({ path: `${path}/fromState`, message: 'prior state must match the required semantic change' });
      if (event.toState !== change.toState) problems.push({ path: `${path}/toState`, message: 'resulting state must match the required semantic change' });
    }
    if (event.kind === 'separate' && change.kind === 'separate') {
      if (!change.fromState || event.fromState !== change.fromState) problems.push({ path: `${path}/fromState`, message: 'prior state must match the required semantic change' });
      if (event.toState !== change.toState) problems.push({ path: `${path}/toState`, message: 'resulting state must match the required semantic change' });
      const expectedResults = beat.semanticRevealOrder.filter((entityId) => entityId !== change.entityId);
      if (event.resultEntityIds.length < 2 || event.resultEntityIds.length > 6) problems.push({ path: `${path}/resultEntityIds`, message: 'separation must reveal two through six result entities' });
      if (JSON.stringify(event.resultEntityIds) !== JSON.stringify(expectedResults)) problems.push({ path: `${path}/resultEntityIds`, message: 'separation results must match the beat first-reveal order, excluding the source entity' });
      for (const resultEntityId of event.resultEntityIds) {
        if (!beat.entities.some((entity) => entity.entityId === resultEntityId)) problems.push({ path: `${path}/resultEntityIds`, message: `result ${resultEntityId} is not a declared beat entity` });
      }
    }
    if (event.kind === 'merge' && change.kind === 'merge') {
      if (event.toState !== change.toState) problems.push({ path: `${path}/toState`, message: 'resulting state must match the required semantic change' });
      if (!change.mergeInputEntityIds || JSON.stringify(event.inputs.map((input) => input.entityId)) !== JSON.stringify(change.mergeInputEntityIds)) {
        problems.push({ path: `${path}/inputs`, message: 'merge inputs must match the ordered identities pinned by the beat' });
      }
      for (const input of event.inputs) {
        const entity = beat.entities.find((candidate) => candidate.entityId === input.entityId);
        if (!entity) problems.push({ path: `${path}/inputs`, message: `input ${input.entityId} is not a declared beat entity` });
        else if (entity.state !== input.state) problems.push({ path: `${path}/inputs`, message: `input ${input.entityId} state must match the exact state pinned by the beat` });
      }
      const resultEntity = beat.entities.find((entity) => entity.entityId === event.entityId);
      if (!resultEntity) problems.push({ path: `${path}/entityId`, message: `merge result ${event.entityId} is not a declared beat entity` });
      else if (resultEntity.state && resultEntity.state !== event.toState) problems.push({ path: `${path}/toState`, message: 'result state must match the declared beat entity state' });
    }
  }
  return problems;
}

function mechanismDescription(event: StateTransitionModel['events'][number]): string {
  if (event.kind === 'merge') {
    return `Show the ${event.inputs.length} active input entities combining into one new result entity, preserving every exact input state and the required result state.`;
  }
  const description = event.kind === 'introduce'
    ? `Show ${event.entityId} entering the scene in state: ${event.state}.`
    : event.kind === 'separate'
      ? `Show ${event.entityId} in state ${event.fromState} separating into ${event.resultEntityIds.join(', ')}; the resulting state is ${event.toState}.`
      : `Show ${event.entityId} changing from ${event.fromState} to ${event.toState}.`;
  // Preserve the descriptions in accepted older locks. For longer declarations,
  // keep exact factual states in the typed model/operations and summarize only
  // the mechanism requirement rather than truncating any factual field.
  if (description.length <= 240) return description;
  return event.kind === 'introduce'
    ? 'Reveal the declared entity with its exact initial state.'
    : event.kind === 'separate'
      ? `Show the source separating into ${event.resultEntityIds.length} distinct result entities, preserving their declared identities and states.`
      : 'Show the entity changing from its exact prior state to its required result state.';
}

function mechanismRequirements(model: StateTransitionModel, beat: TeachingBeat) {
  return model.events.map((event, index) => ({
    eventId: event.eventId,
    kind: event.kind,
    entityIds: event.kind === 'separate' ? [event.entityId, ...event.resultEntityIds]
      : event.kind === 'merge' ? [...event.inputs.map((input) => input.entityId), event.entityId] : [event.entityId],
    claimIds: beat.requiredSemanticChanges[index]?.claimIds ?? beat.claimIds,
    description: mechanismDescription(event),
  }));
}

function compileStateTransition(model: StateTransitionModel, state: SemanticSceneState, beat: TeachingBeat): SemanticOp[] {
  let currentState = state;
  const operationFor = (event: StateTransitionModel['events'][number], index: number): SemanticOp => {
    const claimIds = beat.requiredSemanticChanges[index]?.claimIds ?? beat.claimIds;
    const common = {
      eventId: event.eventId,
      beatId: beat.beatId,
      claimIds,
      dependsOnEventIds: model.events.slice(0, index).map((prior) => prior.eventId),
    };
    if (event.kind === 'introduce') return {
      type: 'introduce', ...common,
      entity: { id: event.entityId, conceptId: event.conceptId, claimIds, state: event.state, lifecycle: 'active' },
    };
    if (event.kind === 'transform') return { type: 'transform', ...common, entityId: event.entityId, fromState: event.fromState, toState: event.toState };
    if (event.kind === 'merge') {
      for (const input of event.inputs) {
        const source = currentState.entities.find((entity) => entity.id === input.entityId);
        if (!source || source.lifecycle !== 'active') throw new Error(`merge input ${input.entityId} is not an active semantic entity`);
        if (source.state !== input.state) throw new Error(`merge input ${input.entityId} requires exact prior state ${JSON.stringify(source.state)}, received ${JSON.stringify(input.state)}`);
      }
      const result = beat.entities.find((entity) => entity.entityId === event.entityId);
      if (!result) throw new Error(`merge result ${event.entityId} has no declared beat entity`);
      return {
        type: 'merge', ...common, entityIds: event.inputs.map((input) => input.entityId),
        result: { id: result.entityId, conceptId: result.conceptId, claimIds, state: event.toState, lifecycle: 'active' },
      };
    }
    const results = event.resultEntityIds.map((entityId) => {
      const entity = beat.entities.find((candidate) => candidate.entityId === entityId);
      if (!entity) throw new Error(`separation result ${entityId} has no declared beat entity`);
      return { id: entity.entityId, conceptId: entity.conceptId, claimIds, ...(entity.state ? { state: entity.state } : {}), lifecycle: 'active' as const };
    });
    return { type: 'separate', ...common, sourceEntityId: event.entityId, fromState: event.fromState, results };
  };
  const operations: SemanticOp[] = [];
  for (const [index, event] of model.events.entries()) {
    operations.push(SemanticOpSchema.parse(operationFor(event, index)));
    // Replay each bounded prefix so later events see earlier introductions and
    // transformations while retaining the complete dependency validation.
    const replay = applySemanticProgram(state, operations);
    if (!replay.ok) throw new Error(`state transition does not apply to current semantic state: ${replay.problems.map((problem) => `${problem.path} ${problem.message}`).join('; ')}`);
    currentState = replay.state;
  }
  return operations;
}

export const stateTransitionProvider = defineRepresentationProvider({
  family: 'state_transition',
  version: 'state-transition/v4',
  supportedChangeKinds: ['introduce', 'transform', 'separate', 'merge'],
  modelSchema: StateTransitionModelSchema,
  suitability: (beat) => beat.representationFamily === 'state_transition'
    && beat.requiredSemanticChanges.length > 0
    && beat.requiredSemanticChanges.filter((change) => change.kind === 'separate').length <= 1
    && beat.requiredSemanticChanges.filter((change) => change.kind === 'merge').length <= 1
    && !(beat.requiredSemanticChanges.some((change) => change.kind === 'merge') && beat.requiredSemanticChanges.some((change) => change.kind === 'separate'))
    && beat.requiredSemanticChanges.every((change) => supported(change.kind)
      && (change.kind !== 'transform' && change.kind !== 'separate' || Boolean(change.fromState))
      && (change.kind !== 'merge' || Boolean(change.mergeInputEntityIds && change.mergeInputEntityIds.length >= 2 && change.mergeInputEntityIds.length <= 6
        && change.mergeInputEntityIds.every((entityId) => Boolean(beat.entities.find((entity) => entity.entityId === entityId)?.state))))
      && (change.kind !== 'separate' || beat.semanticRevealOrder.filter((entityId) => entityId !== change.entityId).length >= 2
        && beat.semanticRevealOrder.filter((entityId) => entityId !== change.entityId).length <= 6)) ? 1 : 0,
  validateModel: validateStateTransitionModel,
  mechanismRequirements,
  compile: compileStateTransition,
  fallback: deriveStateTransitionModel,
});

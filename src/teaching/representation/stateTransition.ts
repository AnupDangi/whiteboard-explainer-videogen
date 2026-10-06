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
export const StateTransitionModelSchema = z.object({ events: z.array(z.discriminatedUnion('kind', [introduction, transformation, separation])).min(1).max(8) }).strict();
export type StateTransitionModel = z.infer<typeof StateTransitionModelSchema>;

const supported = (kind: string): kind is 'introduce' | 'transform' | 'separate' => kind === 'introduce' || kind === 'transform' || kind === 'separate';

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
  }
  return problems;
}

function mechanismRequirements(model: StateTransitionModel, _beat: TeachingBeat) {
  return model.events.map((event) => ({
    eventId: event.eventId,
    kind: event.kind,
    entityIds: event.kind === 'separate' ? [event.entityId, ...event.resultEntityIds] : [event.entityId],
    description: event.kind === 'introduce'
      ? `Show ${event.entityId} entering the scene in state: ${event.state}.`
      : event.kind === 'separate'
        ? `Show ${event.entityId} in state ${event.fromState} separating into ${event.resultEntityIds.join(', ')}; the resulting state is ${event.toState}.`
        : `Show ${event.entityId} changing from ${event.fromState} to ${event.toState}.`,
  }));
}

function compileStateTransition(model: StateTransitionModel, state: SemanticSceneState, beat: TeachingBeat): SemanticOp[] {
  const operations: SemanticOp[] = model.events.map((event, index) => {
    const common = {
      eventId: event.eventId,
      beatId: beat.beatId,
      claimIds: beat.claimIds,
      dependsOnEventIds: model.events.slice(0, index).map((prior) => prior.eventId),
    };
    if (event.kind === 'introduce') return {
      type: 'introduce', ...common,
      entity: { id: event.entityId, conceptId: event.conceptId, claimIds: beat.claimIds, state: event.state, lifecycle: 'active' },
    };
    if (event.kind === 'transform') return { type: 'transform', ...common, entityId: event.entityId, fromState: event.fromState, toState: event.toState };
    const results = event.resultEntityIds.map((entityId) => {
      const entity = beat.entities.find((candidate) => candidate.entityId === entityId);
      if (!entity) throw new Error(`separation result ${entityId} has no declared beat entity`);
      return { id: entity.entityId, conceptId: entity.conceptId, claimIds: beat.claimIds, ...(entity.state ? { state: entity.state } : {}), lifecycle: 'active' as const };
    });
    return { type: 'separate', ...common, sourceEntityId: event.entityId, fromState: event.fromState, results };
  }).map((candidate) => SemanticOpSchema.parse(candidate));
  const replay = applySemanticProgram(state, operations);
  if (!replay.ok) throw new Error(`state transition does not apply to current semantic state: ${replay.problems.map((problem) => `${problem.path} ${problem.message}`).join('; ')}`);
  return operations;
}

export const stateTransitionProvider = defineRepresentationProvider({
  family: 'state_transition',
  version: 'state-transition/v2',
  supportedChangeKinds: ['introduce', 'transform', 'separate'],
  modelSchema: StateTransitionModelSchema,
  suitability: (beat) => beat.representationFamily === 'state_transition'
    && beat.requiredSemanticChanges.length > 0
    && beat.requiredSemanticChanges.filter((change) => change.kind === 'separate').length <= 1
    && beat.requiredSemanticChanges.every((change) => supported(change.kind)
      && (change.kind !== 'transform' && change.kind !== 'separate' || Boolean(change.fromState))
      && (change.kind !== 'separate' || beat.semanticRevealOrder.filter((entityId) => entityId !== change.entityId).length >= 2
        && beat.semanticRevealOrder.filter((entityId) => entityId !== change.entityId).length <= 6)) ? 1 : 0,
  validateModel: validateStateTransitionModel,
  mechanismRequirements,
  compile: compileStateTransition,
  fallback: deriveStateTransitionModel,
});

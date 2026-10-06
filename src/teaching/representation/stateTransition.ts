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
export const StateTransitionModelSchema = z.object({ events: z.array(z.discriminatedUnion('kind', [introduction, transformation])).min(1).max(8) }).strict();
export type StateTransitionModel = z.infer<typeof StateTransitionModelSchema>;

const supported = (kind: string): kind is 'introduce' | 'transform' => kind === 'introduce' || kind === 'transform';

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
  }
  return problems;
}

function mechanismRequirements(model: StateTransitionModel, _beat: TeachingBeat) {
  return model.events.map((event) => ({
    eventId: event.eventId,
    kind: event.kind,
    entityIds: [event.entityId],
    description: event.kind === 'introduce'
      ? `Show ${event.entityId} entering the scene in state: ${event.state}.`
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
    return { type: 'transform', ...common, entityId: event.entityId, fromState: event.fromState, toState: event.toState };
  }).map((candidate) => SemanticOpSchema.parse(candidate));
  const replay = applySemanticProgram(state, operations);
  if (!replay.ok) throw new Error(`state transition does not apply to current semantic state: ${replay.problems.map((problem) => `${problem.path} ${problem.message}`).join('; ')}`);
  return operations;
}

export const stateTransitionProvider = defineRepresentationProvider({
  family: 'state_transition',
  version: 'state-transition/v1',
  supportedChangeKinds: ['introduce', 'transform'],
  modelSchema: StateTransitionModelSchema,
  suitability: (beat) => beat.representationFamily === 'state_transition'
    && beat.requiredSemanticChanges.length > 0
    && beat.requiredSemanticChanges.every((change) => supported(change.kind) && (change.kind !== 'transform' || Boolean(change.fromState))) ? 1 : 0,
  validateModel: validateStateTransitionModel,
  mechanismRequirements,
  compile: compileStateTransition,
  fallback: deriveStateTransitionModel,
});

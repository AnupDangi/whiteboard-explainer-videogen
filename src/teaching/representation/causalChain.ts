import { createHash } from 'node:crypto';
import { z } from 'zod';
import { semanticEventId, type TeachingBeat } from '../beat-plan/types.js';
import { applySemanticProgram } from '../semantic-ir/program.js';
import { SemanticOpSchema, type SemanticOp, type SemanticSceneState } from '../semantic-ir/types.js';
import { defineRepresentationProvider, type RepresentationProblem } from './providerRegistry.js';

const id = () => z.string().min(1).max(80).regex(/^[a-z0-9_.-]+$/);
const eventFields = {
  eventId: z.string().min(1).max(100).regex(/^[a-z0-9_.-]+\.e[1-8]$/),
  entityId: id(),
  conceptId: id(),
  claimIds: z.array(z.string().min(1).max(40)).min(1).max(3)
    .refine((ids) => new Set(ids).size === ids.length, 'event claim ids must be unique'),
  fromState: z.string().trim().min(1).max(120).optional(),
  toState: z.string().trim().min(1).max(120),
};
const causeRelation = z.object({
  id: id(), fromEntityId: id(), toEntityId: id(), fromConceptId: id(), toConceptId: id(), type: z.literal('causes'),
}).strict();
export const CausalChainModelSchema = z.object({
  events: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('introduce'), ...eventFields }).strict(),
    z.object({ kind: z.literal('focus'), ...eventFields }).strict(),
    z.object({ kind: z.literal('cause'), ...eventFields, relation: causeRelation }).strict(),
  ])).min(1).max(8),
}).strict();
export type CausalChainModel = z.infer<typeof CausalChainModelSchema>;

const supported = (kind: string): kind is 'introduce' | 'focus' | 'cause' => kind === 'introduce' || kind === 'focus' || kind === 'cause';
const relationId = (eventId: string, from: string, to: string): string =>
  `sr_${createHash('sha256').update(`${eventId}\0${from}\0causes\0${to}`, 'utf8').digest('hex').slice(0, 24)}`;

/** Select identities only from the pinned beat. Words in toState never select an edge. */
export function deriveCausalChainModel(beat: TeachingBeat): CausalChainModel {
  if (beat.representationFamily !== 'causal_chain') throw new Error('causal chain provider requires representationFamily causal_chain');
  if (beat.requiredSemanticChanges.length === 0) throw new Error('causal chain needs a required semantic change');
  if (beat.relationships.some((relation) => relation.type !== 'causes')) throw new Error('causal chain only supports exact causes relationships');
  const declaredIds = new Set<string>();
  for (const entity of beat.entities) {
    if (declaredIds.has(entity.entityId)) throw new Error(`declared semantic entity ${entity.entityId} is ambiguous`);
    declaredIds.add(entity.entityId);
  }
  return {
    events: beat.requiredSemanticChanges.map((change, index) => {
      const eventId = semanticEventId(beat.beatId, index);
      if (!supported(change.kind)) throw new Error(`causal chain does not yet support semantic change ${change.kind} at ${eventId}`);
      const entity = beat.entities.find((candidate) => candidate.entityId === change.entityId);
      if (!entity) throw new Error(`change ${eventId} has no declared beat entity ${change.entityId}`);
      if (!change.claimIds && beat.claimIds.length !== 1) throw new Error(`change ${eventId} requires explicit per-event claim ids in a multi-claim beat`);
      const claimIds = change.claimIds ?? beat.claimIds;
      if (claimIds.length === 0 || claimIds.some((claimId) => !beat.claimIds.includes(claimId))) {
        throw new Error(`change ${eventId} claim ids must belong to the pinned beat`);
      }
      const common = {
        eventId, entityId: entity.entityId, conceptId: entity.conceptId, claimIds: [...claimIds],
        ...(change.fromState ? { fromState: change.fromState } : {}), toState: change.toState,
      };
      if (change.kind === 'introduce') {
        if (change.fromState) throw new Error(`introduction ${eventId} cannot declare a prior state`);
        if (entity.state !== undefined && entity.state !== change.toState) throw new Error(`introduction ${eventId} state must match the exact declared entity state`);
        return { kind: 'introduce', ...common };
      }
      if (change.kind === 'focus') return { kind: 'focus', ...common };
      const matches = beat.relationships.filter((relation) => relation.type === 'causes' && relation.from === entity.conceptId);
      if (matches.length !== 1) throw new Error(`cause ${eventId} needs exactly one outgoing causes relation from ${entity.conceptId}; received ${matches.length}`);
      const relation = matches[0]!;
      if (relation.from === relation.to) throw new Error(`cause ${eventId} needs distinct cause and effect concepts`);
      const sources = beat.entities.filter((candidate) => candidate.conceptId === relation.from);
      const targets = beat.entities.filter((candidate) => candidate.conceptId === relation.to);
      if (sources.length !== 1 || targets.length !== 1) throw new Error(`cause ${eventId} needs exactly one declared entity for each canonical endpoint; received ${sources.length} source and ${targets.length} target entities`);
      return {
        kind: 'cause', ...common,
        relation: {
          id: relationId(eventId, relation.from, relation.to),
          fromEntityId: sources[0]!.entityId, toEntityId: targets[0]!.entityId,
          fromConceptId: relation.from, toConceptId: relation.to, type: 'causes',
        },
      };
    }),
  };
}

function validateModel(model: CausalChainModel, beat: TeachingBeat): RepresentationProblem[] {
  let expected: CausalChainModel;
  try { expected = deriveCausalChainModel(beat); }
  catch (error) { return [{ path: '/requiredSemanticChanges', message: String(error) }]; }
  const problems: RepresentationProblem[] = [];
  if (model.events.length !== expected.events.length) problems.push({ path: '/events', message: 'causal chain must preserve every required semantic change exactly once' });
  for (const [index, pinned] of expected.events.entries()) {
    const event = model.events[index];
    if (!event) continue;
    const path = `/events/${index}`;
    for (const field of ['kind', 'eventId', 'entityId', 'conceptId', 'fromState', 'toState'] as const) {
      if (event[field] !== pinned[field]) problems.push({ path: `${path}/${field}`, message: `${field} must preserve the exact pinned semantic change` });
    }
    if (JSON.stringify(event.claimIds) !== JSON.stringify(pinned.claimIds)) problems.push({ path: `${path}/claimIds`, message: 'claim ids must preserve the exact ordered event bindings' });
    if (event.kind === 'cause' && pinned.kind === 'cause') {
      for (const field of ['id', 'fromEntityId', 'toEntityId', 'fromConceptId', 'toConceptId', 'type'] as const) {
        if (event.relation[field] !== pinned.relation[field]) problems.push({ path: `${path}/relation/${field}`, message: 'causal relation must preserve the unique canonical directed edge and declared endpoint identities' });
      }
    }
  }
  return problems;
}

function mechanismDescription(event: CausalChainModel['events'][number]): string {
  const description = event.kind === 'introduce'
    ? `Reveal ${event.entityId} in its exact initial state: ${event.toState}.`
    : event.kind === 'focus'
      ? `Highlight ${event.entityId}; the required meaning is: ${event.toState}.`
      : `Connect ${event.relation.fromEntityId} to ${event.relation.toEntityId} with the pinned causes relation; the required meaning is: ${event.toState}.`;
  // Exact states remain in the model/operations; only the descriptive requirement is bounded.
  if (description.length <= 240) return description;
  return event.kind === 'introduce' ? 'Reveal the declared entity in its exact initial state.'
    : event.kind === 'focus' ? 'Highlight the declared active entity for the pinned event.'
      : 'Show the exact directed causes relation between the declared active cause and effect entities.';
}

function compile(model: CausalChainModel, state: SemanticSceneState, beat: TeachingBeat): SemanticOp[] {
  if (state.sceneId !== beat.sceneId) throw new Error('causal chain state must belong to the beat scene');
  const operations: SemanticOp[] = [];
  let currentState = state;
  const requireEndpoint = (entityId: string, conceptId: string, fromState?: string): void => {
    const current = currentState.entities.find((entity) => entity.id === entityId);
    if (!current || current.lifecycle !== 'active') throw new Error(`causal endpoint ${entityId} must be an active semantic entity`);
    if (current.conceptId !== conceptId) throw new Error(`causal endpoint ${entityId} must preserve its declared concept ${conceptId}`);
    const declared = beat.entities.find((entity) => entity.entityId === entityId);
    if (declared?.state !== undefined && current.state !== declared.state) throw new Error(`causal endpoint ${entityId} must preserve its exact declared state`);
    if (fromState !== undefined && current.state !== fromState) throw new Error(`causal endpoint ${entityId} must preserve its exact prior state`);
  };
  for (const [index, event] of model.events.entries()) {
    const common = {
      eventId: event.eventId, beatId: beat.beatId, claimIds: [...event.claimIds],
      dependsOnEventIds: model.events.slice(0, index).map((prior) => prior.eventId),
    };
    let operation: SemanticOp;
    if (event.kind === 'introduce') {
      operation = { type: 'introduce', ...common, entity: { id: event.entityId, conceptId: event.conceptId, claimIds: [...event.claimIds], state: event.toState, lifecycle: 'active' } };
    } else if (event.kind === 'focus') {
      requireEndpoint(event.entityId, event.conceptId, event.fromState);
      operation = { type: 'focus', ...common, entityIds: [event.entityId] };
    } else {
      requireEndpoint(event.relation.fromEntityId, event.relation.fromConceptId, event.fromState);
      requireEndpoint(event.relation.toEntityId, event.relation.toConceptId);
      operation = {
        type: 'cause', ...common,
        relation: { id: event.relation.id, fromEntityId: event.relation.fromEntityId, toEntityId: event.relation.toEntityId, type: 'causes', claimIds: [...event.claimIds] },
      };
    }
    operations.push(SemanticOpSchema.parse(operation));
    // Earlier beats may have introduced these endpoints under different claims.
    // Their provenance remains intact; validateModel pins this beat's operation claims.
    const replay = applySemanticProgram(state, operations, { knownBeatIds: new Set([beat.beatId]) });
    if (!replay.ok) throw new Error(`causal chain does not apply to current semantic state: ${replay.problems.map((problem) => `${problem.path} ${problem.message}`).join('; ')}`);
    currentState = replay.state;
  }
  return operations;
}

export const causalChainProvider = defineRepresentationProvider({
  family: 'causal_chain',
  version: 'causal-chain/v1',
  supportedChangeKinds: ['introduce', 'focus', 'cause'],
  modelSchema: CausalChainModelSchema,
  suitability: (beat) => beat.representationFamily === 'causal_chain' && beat.requiredSemanticChanges.length > 0
    && beat.requiredSemanticChanges.every((change) => supported(change.kind)) ? 1 : 0,
  validateModel,
  mechanismRequirements: (model) => model.events.map((event) => ({
    eventId: event.eventId, kind: event.kind,
    entityIds: event.kind === 'cause' ? [event.relation.fromEntityId, event.relation.toEntityId] : [event.entityId],
    claimIds: [...event.claimIds], description: mechanismDescription(event),
  })),
  compile,
  fallback: deriveCausalChainModel,
});

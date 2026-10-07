import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import { deriveCausalChainModel, type CausalChainModel } from '../teaching/representation/causalChain.js';
import { REPRESENTATION_PROVIDER_REGISTRY } from '../teaching/representation/registry.js';
import { applySemanticProgram } from '../teaching/semantic-ir/program.js';
import type { SemanticSceneState } from '../teaching/semantic-ir/types.js';

const emptyState = (): SemanticSceneState => ({ sceneId: 'scene', entities: [], relations: [], selectedEntityIds: [], plots: [], feedbackLoops: [], annotations: [] });
const endpoints = (): SemanticSceneState['entities'] => [
  { id: 'se_cause', conceptId: 'cause_concept', claimIds: ['claim_intro'], state: 'cause present', lifecycle: 'active' },
  { id: 'se_effect', conceptId: 'effect_concept', claimIds: ['claim_intro'], state: 'effect present', lifecycle: 'active' },
];
function beatFor(extra: Partial<TeachingBeat> = {}): TeachingBeat {
  return {
    beatId: 'scene.b2', sceneId: 'scene', order: 2, claimIds: ['claim_relation'], learnerDelta: 'The learner identifies the directed cause and effect.',
    learningQuestion: 'Which entity causes the effect?', learnerBefore: 'The entities appear separately.', learnerAfter: 'The cause and effect are connected.',
    dependsOnOrders: [1], dependsOnBeatIds: ['scene.b1'], beatType: 'connect', cognitiveOperation: 'explain_cause', representationFamily: 'causal_chain',
    entities: [
      { identityKey: 'cause', entityId: 'se_cause', conceptId: 'cause_concept', state: 'cause present' },
      { identityKey: 'effect', entityId: 'se_effect', conceptId: 'effect_concept', state: 'effect present' },
    ],
    semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'cause', entityId: 'se_cause', kind: 'cause', toState: 'cause connected to its effect' }],
    relationships: [{ from: 'cause_concept', to: 'effect_concept', type: 'causes' }], misconceptionIds: [], narrationGoal: 'Explain the directed cause.',
    visualInvariant: 'The directed causal relation is visible.', mutedMeaning: 'The first entity causes the second.', narrationOnly: false,
    persistence: 'scene', pauseIntent: 'none', persistentEntityIds: ['se_cause', 'se_effect'], evidenceSpanIds: ['span_relation'],
    ...extra,
  };
}
function causeEvent(model: CausalChainModel) {
  const event = model.events.find((candidate) => candidate.kind === 'cause');
  assert.ok(event && event.kind === 'cause');
  return event;
}
function rejectionMessage(result: ReturnType<typeof REPRESENTATION_PROVIDER_REGISTRY.compile>): string {
  assert.equal(result.ok, false, JSON.stringify(result));
  return result.ok ? '' : result.problems.map((problem) => `${problem.path} ${problem.message}`).join('; ');
}

test('causal provider deterministically preserves the unique directed relation and exact current endpoints across beats', () => {
  const beat = beatFor();
  const model = deriveCausalChainModel(beat);
  const state = { ...emptyState(), entities: endpoints() };
  const snapshot = structuredClone(state);
  const first = REPRESENTATION_PROVIDER_REGISTRY.compile('causal_chain', model, state, beat);
  const second = REPRESENTATION_PROVIDER_REGISTRY.compile('causal_chain', structuredClone(model), structuredClone(state), beat);
  assert.deepEqual(first, second);
  assert.deepEqual(state, snapshot, 'prefix replay must preserve the input state');
  assert.equal(first.ok, true, JSON.stringify(first));
  if (first.ok) {
    assert.equal(first.providerVersion, 'causal-chain/v1');
    assert.equal(first.source, 'model');
    assert.deepEqual(first.operations, [{
      type: 'cause', eventId: 'scene.b2.e1', beatId: 'scene.b2', claimIds: ['claim_relation'], dependsOnEventIds: [],
      relation: { id: causeEvent(model).relation.id, fromEntityId: 'se_cause', toEntityId: 'se_effect', type: 'causes', claimIds: ['claim_relation'] },
    }]);
    assert.deepEqual(first.mechanisms[0]!.entityIds, ['se_cause', 'se_effect']);
    assert.deepEqual(first.mechanisms[0]!.claimIds, ['claim_relation']);
    const replay = applySemanticProgram(state, first.operations);
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.state.relations[0]!.type, 'causes');
      assert.deepEqual(replay.state.entities, snapshot.entities, 'cause creation must preserve endpoint state and earlier claim provenance');
    }
  }
});

test('causal provider replays introductions before cause and focus with exact event-level claims and states', () => {
  const beat = beatFor({
    beatId: 'scene.b1', order: 1, dependsOnOrders: [], dependsOnBeatIds: [], claimIds: ['claim_intro', 'claim_relation'], semanticRevealOrder: ['se_cause', 'se_effect'],
    requiredSemanticChanges: [
      { identityKey: 'cause', entityId: 'se_cause', kind: 'introduce', toState: 'cause present', claimIds: ['claim_intro'] },
      { identityKey: 'effect', entityId: 'se_effect', kind: 'introduce', toState: 'effect present', claimIds: ['claim_intro'] },
      { identityKey: 'cause', entityId: 'se_cause', kind: 'cause', fromState: 'cause present', toState: 'cause connected to its effect', claimIds: ['claim_relation'] },
      { identityKey: 'effect', entityId: 'se_effect', kind: 'focus', fromState: 'effect present', toState: 'effect in focus', claimIds: ['claim_relation'] },
    ],
  });
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', emptyState(), beat);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (compiled.ok) {
    assert.equal(compiled.source, 'fallback');
    assert.deepEqual(compiled.operations.map((operation) => operation.type), ['introduce', 'introduce', 'cause', 'focus']);
    assert.deepEqual(compiled.operations.map((operation) => operation.claimIds), [['claim_intro'], ['claim_intro'], ['claim_relation'], ['claim_relation']]);
    assert.deepEqual(compiled.operations[3]!.dependsOnEventIds, ['scene.b1.e1', 'scene.b1.e2', 'scene.b1.e3']);
    const replay = applySemanticProgram(emptyState(), compiled.operations);
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.deepEqual(replay.state.entities.map((entity) => entity.state), ['cause present', 'effect present']);
      assert.deepEqual(replay.state.selectedEntityIds, ['se_effect']);
    }
  }
});

test('causal provider fails closed for ambiguous, reversed, unsupported and missing canonical endpoints', () => {
  const cases: Array<[string, Partial<TeachingBeat>, RegExp]> = [
    ['ambiguous edges', { relationships: [
      { from: 'cause_concept', to: 'effect_concept', type: 'causes' },
      { from: 'cause_concept', to: 'another_effect', type: 'causes' },
    ] }, /exactly one outgoing causes relation/],
    ['reversed relation', { relationships: [{ from: 'effect_concept', to: 'cause_concept', type: 'causes' }] }, /exactly one outgoing causes relation/],
    ['unsupported predicate', { relationships: [{ from: 'cause_concept', to: 'effect_concept', type: 'produces' }] }, /only supports exact causes/],
    ['missing target', { entities: [beatFor().entities[0]!] }, /exactly one declared entity for each canonical endpoint/],
    ['ambiguous target identity', { entities: [...beatFor().entities, { identityKey: 'effect_copy', entityId: 'se_effect_copy', conceptId: 'effect_concept' }] }, /exactly one declared entity for each canonical endpoint/],
    ['ambiguous source identity', { entities: [...beatFor().entities, { identityKey: 'cause_copy', entityId: 'se_cause_copy', conceptId: 'cause_concept' }] }, /exactly one declared entity for each canonical endpoint/],
    ['self relation', { relationships: [{ from: 'cause_concept', to: 'cause_concept', type: 'causes' }] }, /distinct cause and effect/],
    ['duplicate entity id', { entities: [...beatFor().entities, { identityKey: 'duplicate', entityId: 'se_cause', conceptId: 'cause_concept' }] }, /declared semantic entity .* ambiguous/],
  ];
  for (const [name, extra, pattern] of cases) {
    const result = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', { ...emptyState(), entities: endpoints() }, beatFor(extra));
    assert.match(rejectionMessage(result), pattern, name);
  }
});

test('causal provider does not choose a target or predicate from toState prose', () => {
  const beat = beatFor({ requiredSemanticChanges: [{ identityKey: 'cause', entityId: 'se_cause', kind: 'cause', toState: 'another concept now causes the original cause' }] });
  const event = causeEvent(deriveCausalChainModel(beat));
  assert.equal(event.toState, beat.requiredSemanticChanges[0]!.toState);
  assert.equal(event.relation.fromEntityId, 'se_cause');
  assert.equal(event.relation.toEntityId, 'se_effect');
  assert.equal(event.relation.type, 'causes');
});

test('causal model drift cannot replace event identity, claims, states, endpoints or relation identity', () => {
  const beat = beatFor();
  const event = causeEvent(deriveCausalChainModel(beat));
  const candidates = [
    { ...event, eventId: 'scene.b2.e2' },
    { ...event, entityId: 'se_effect' },
    { ...event, conceptId: 'effect_concept' },
    { ...event, claimIds: ['claim_other'] },
    { ...event, fromState: 'invented prior state' },
    { ...event, toState: 'invented resulting state' },
    { ...event, relation: { ...event.relation, id: 'invented_relation' } },
    { ...event, relation: { ...event.relation, fromEntityId: 'se_effect', toEntityId: 'se_cause' } },
    { ...event, relation: { ...event.relation, toConceptId: 'cause_concept' } },
    { ...event, relation: { ...event.relation, type: 'produces' } },
  ];
  for (const candidate of candidates) {
    const result = REPRESENTATION_PROVIDER_REGISTRY.compile('causal_chain', { events: [candidate] }, { ...emptyState(), entities: endpoints() }, beat);
    rejectionMessage(result);
  }
  assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compile('causal_chain', { events: [event, event] }, { ...emptyState(), entities: endpoints() }, beat)), /every required semantic change exactly once/);
});

test('causal provider rejects unavailable, inactive, stale-state and changed-concept current endpoints', () => {
  const beat = beatFor();
  const model = deriveCausalChainModel(beat);
  const cases: Array<[SemanticSceneState['entities'], RegExp]> = [
    [[endpoints()[0]!], /active semantic entity/],
    [endpoints().map((entity) => entity.id === 'se_effect' ? { ...entity, lifecycle: 'finalized' } : entity), /active semantic entity/],
    [endpoints().map((entity) => entity.id === 'se_cause' ? { ...entity, conceptId: 'changed_concept' } : entity), /preserve its declared concept/],
    [endpoints().map((entity) => entity.id === 'se_effect' ? { ...entity, state: 'stale state' } : entity), /exact declared state/],
  ];
  for (const [entities, pattern] of cases) {
    assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compile('causal_chain', model, { ...emptyState(), entities }, beat)), pattern);
  }
  const priorStateBeat = beatFor({ requiredSemanticChanges: [{ identityKey: 'cause', entityId: 'se_cause', kind: 'cause', fromState: 'wrong prior state', toState: 'cause connected to effect' }] });
  assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', { ...emptyState(), entities: endpoints() }, priorStateBeat)), /exact prior state/);
  assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compile('causal_chain', model, { ...emptyState(), sceneId: 'other_scene', entities: endpoints() }, beat)), /beat scene/);
});

test('causal provider requires explicit event claim ownership for multiple claims and preserves only pinned claims', () => {
  const multiClaim = beatFor({ claimIds: ['claim_relation', 'claim_other'] });
  assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', { ...emptyState(), entities: endpoints() }, multiClaim)), /explicit per-event claim ids/);
  const unknownClaim = beatFor({ requiredSemanticChanges: [{ identityKey: 'cause', entityId: 'se_cause', kind: 'cause', toState: 'cause connected', claimIds: ['claim_unknown'] }] });
  assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', { ...emptyState(), entities: endpoints() }, unknownClaim)), /claim ids must belong to the pinned beat/);
  const bound = { ...multiClaim, requiredSemanticChanges: [{ ...multiClaim.requiredSemanticChanges[0]!, claimIds: ['claim_relation'] }] };
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', { ...emptyState(), entities: endpoints() }, bound);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (compiled.ok) assert.deepEqual(compiled.operations[0]!.claimIds, ['claim_relation']);
});

test('causal provider preserves long introduction states and bounds mechanism descriptions without shortening data', () => {
  const stateText = 's'.repeat(120);
  const beat = beatFor({
    entities: [{ identityKey: 'cause', entityId: 'se_cause', conceptId: 'cause_concept' }], relationships: [], semanticRevealOrder: ['se_cause'],
    requiredSemanticChanges: [{ identityKey: 'cause', entityId: 'se_cause', kind: 'introduce', toState: stateText }],
  });
  const result = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', emptyState(), beat);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.operations[0]!.type, 'introduce');
    if (result.operations[0]!.type === 'introduce') assert.equal(result.operations[0].entity.state, stateText);
    assert.equal(result.mechanisms[0]!.description.length <= 240, true);
  }
  const conflicting = { ...beat, entities: [{ ...beat.entities[0]!, state: 'different state' }] };
  assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', emptyState(), conflicting)), /exact declared entity state/);
});

test('causal provider is registered while unsupported changes and absent families stay unavailable', () => {
  assert.equal(REPRESENTATION_PROVIDER_REGISTRY.statuses.find((status) => status.family === 'causal_chain')?.status, 'implemented');
  assert.equal(REPRESENTATION_PROVIDER_REGISTRY.statuses.find((status) => status.family === 'state_transition')?.status, 'implemented');
  assert.equal(REPRESENTATION_PROVIDER_REGISTRY.statuses.find((status) => status.family === 'material_flow')?.status, 'not_implemented');
  const unsupported = beatFor({ requiredSemanticChanges: [{ identityKey: 'cause', entityId: 'se_cause', kind: 'flow', fromState: 'before', toState: 'after' }] });
  assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', { ...emptyState(), entities: endpoints() }, unsupported)), /does not yet support semantic change flow/);
  const wrongFamily = beatFor({ representationFamily: 'process' });
  assert.match(rejectionMessage(REPRESENTATION_PROVIDER_REGISTRY.compile('causal_chain', deriveCausalChainModel(beatFor()), { ...emptyState(), entities: endpoints() }, wrongFamily)), /requires representationFamily causal_chain/);
});

test('the same causal provider works with different concepts and states without inserting lesson content', () => {
  const beat = beatFor({
    entities: [
      { identityKey: 'left', entityId: 'se_left', conceptId: 'new_input', state: 'input active' },
      { identityKey: 'right', entityId: 'se_right', conceptId: 'new_output', state: 'output present' },
    ],
    requiredSemanticChanges: [{ identityKey: 'left', entityId: 'se_left', kind: 'cause', toState: 'new input linked to new output' }],
    relationships: [{ from: 'new_input', to: 'new_output', type: 'causes' }],
  });
  const state: SemanticSceneState = { ...emptyState(), entities: [
    { id: 'se_left', conceptId: 'new_input', claimIds: ['claim_relation'], state: 'input active', lifecycle: 'active' },
    { id: 'se_right', conceptId: 'new_output', claimIds: ['claim_relation'], state: 'output present', lifecycle: 'active' },
  ] };
  const result = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('causal_chain', state, beat);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    const operation = result.operations[0]!;
    assert.equal(operation.type, 'cause');
    if (operation.type === 'cause') assert.deepEqual([operation.relation.fromEntityId, operation.relation.toEntityId], ['se_left', 'se_right']);
    assert.equal(JSON.stringify(result).includes('cause_concept'), false);
    assert.equal(JSON.stringify(result).includes('effect_concept'), false);
  }
});

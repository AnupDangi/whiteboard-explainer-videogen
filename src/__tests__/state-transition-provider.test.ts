import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticEventId, type TeachingBeat } from '../teaching/beat-plan/types.js';
import { applySemanticProgram } from '../teaching/semantic-ir/program.js';
import type { SemanticSceneState } from '../teaching/semantic-ir/types.js';
import { REPRESENTATION_PROVIDER_REGISTRY } from '../teaching/representation/registry.js';
import { deriveStateTransitionModel } from '../teaching/representation/stateTransition.js';

function beatFor(change: { kind: 'introduce' | 'transform' | 'move' | 'separate' | 'merge'; entityId: string; fromState?: string; toState: string; mergeInputEntityIds?: string[]; claimIds?: string[] }, extra: Partial<TeachingBeat> = {}): TeachingBeat {
  return {
    beatId: 'scene.b1', sceneId: 'scene', order: 1, claimIds: ['claim_a'], learnerDelta: 'The learner sees the state change.',
    learningQuestion: 'How does the state change?', learnerBefore: 'The entity is closed.', learnerAfter: 'The entity is open.', dependsOnOrders: [], dependsOnBeatIds: [],
    beatType: 'transform', cognitiveOperation: 'transform', representationFamily: 'state_transition', entities: [{ identityKey: 'cell_main', entityId: change.entityId, conceptId: 'cell' }],
    semanticRevealOrder: [change.entityId], requiredSemanticChanges: [change], relationships: [], misconceptionIds: [], narrationGoal: 'Explain the transition.',
    visualInvariant: 'The current state is visible.', mutedMeaning: 'The state changed.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none', persistentEntityIds: [change.entityId], evidenceSpanIds: [],
    ...extra,
  } as unknown as TeachingBeat;
}

const emptyState = (): SemanticSceneState => ({ sceneId: 'scene', entities: [], relations: [], selectedEntityIds: [], plots: [], feedbackLoops: [], annotations: [] });
const activeEntity = (id: string, state: string): SemanticSceneState['entities'][number] => ({ id, conceptId: 'cell', claimIds: ['claim_a'], state, lifecycle: 'active' });

test('state-transition provider derives its generic representation from pinned beat semantics', () => {
  const beat = beatFor({ kind: 'introduce', entityId: 'se_cell', toState: 'cell exists before division' });
  const model = deriveStateTransitionModel(beat);
  assert.deepEqual(model.events, [{ kind: 'introduce', eventId: semanticEventId(beat.beatId, 0), entityId: 'se_cell', conceptId: 'cell', state: 'cell exists before division' }]);
  assert.equal(REPRESENTATION_PROVIDER_REGISTRY.statuses.find((status) => status.family === 'state_transition')?.status, 'implemented');
  assert.equal(REPRESENTATION_PROVIDER_REGISTRY.statuses.find((status) => status.family === 'weighted_graph')?.status, 'not_implemented');

  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compile('state_transition', model, emptyState(), beat);
  assert.equal(compiled.ok, true);
  if (compiled.ok) {
    assert.equal(compiled.operations[0]!.type, 'introduce');
    assert.equal(compiled.operations[0]!.eventId, 'scene.b1.e1');
    assert.equal(compiled.source, 'model');
    assert.equal(compiled.mechanisms[0]!.description, 'Show se_cell entering the scene in state: cell exists before division.');
  }
});

test('state-transition provider enforces exact prior and resulting states before producing operations', () => {
  const beat = beatFor({ kind: 'transform', entityId: 'se_cell', fromState: 'one cell', toState: 'two daughter cells' });
  const model = deriveStateTransitionModel(beat);
  const initial = { ...emptyState(), entities: [activeEntity('se_cell', 'one cell')] };
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compile('state_transition', model, initial, beat);
  assert.equal(compiled.ok, true);
  if (compiled.ok) {
    const replay = applySemanticProgram(initial, compiled.operations);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.state.entities[0]!.state, 'two daughter cells');
  }

  const tampered = { ...model, events: [{ ...model.events[0]!, fromState: 'already divided' }] };
  const rejected = REPRESENTATION_PROVIDER_REGISTRY.compile('state_transition', tampered, initial, beat);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.problems[0]!.message, /prior state must match/);
});

test('semantic operations and declared mechanisms preserve exact per-change claim bindings', () => {
  const beat = beatFor({ kind: 'introduce', entityId: 'se_cell', toState: 'cell exists', claimIds: ['claim_a'] }, {
    claimIds: ['claim_a', 'claim_b'],
  });
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('state_transition', emptyState(), beat);
  assert.equal(compiled.ok, true);
  if (compiled.ok) {
    assert.deepEqual(compiled.operations[0]!.claimIds, ['claim_a']);
    assert.deepEqual(compiled.mechanisms[0]!.claimIds, ['claim_a']);
  }
});

test('state-transition fallback is explicit and unsupported semantic changes remain unavailable', () => {
  const introduce = beatFor({ kind: 'introduce', entityId: 'se_cell', toState: 'cell exists' });
  const fallback = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('state_transition', emptyState(), introduce);
  assert.equal(fallback.ok, true);
  if (fallback.ok) assert.equal(fallback.source, 'fallback');

  const unsupportedBeat = beatFor({ kind: 'move', entityId: 'se_cell', fromState: 'outside', toState: 'inside' });
  const unsupportedModel = { events: [{ kind: 'transform', eventId: 'scene.b1.e1', entityId: 'se_cell', fromState: 'outside', toState: 'inside' }] };
  const unsupported = REPRESENTATION_PROVIDER_REGISTRY.compile('state_transition', unsupportedModel, emptyState(), unsupportedBeat);
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.match(unsupported.problems[0]!.message, /does not yet support semantic change move/);
});

test('state-transition provider compiles a declared separation into ordered semantic result entities', () => {
  const beat = beatFor({ kind: 'separate', entityId: 'se_parent', fromState: 'one cell', toState: 'two daughter cells' }, {
    entities: [
      { identityKey: 'parent', entityId: 'se_parent', conceptId: 'cell', state: 'one cell' },
      { identityKey: 'daughter_left', entityId: 'se_left', conceptId: 'cell', state: 'daughter cell' },
      { identityKey: 'daughter_right', entityId: 'se_right', conceptId: 'cell', state: 'daughter cell' },
    ],
    semanticRevealOrder: ['se_left', 'se_right'],
  });
  const model = deriveStateTransitionModel(beat);
  assert.deepEqual(model.events, [{ kind: 'separate', eventId: 'scene.b1.e1', entityId: 'se_parent', fromState: 'one cell', toState: 'two daughter cells', resultEntityIds: ['se_left', 'se_right'] }]);
  const initial = { ...emptyState(), entities: [activeEntity('se_parent', 'one cell')] };
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('state_transition', initial, beat);
  assert.equal(compiled.ok, true);
  if (compiled.ok) {
    assert.equal(compiled.providerVersion, 'state-transition/v4');
    assert.equal(compiled.operations[0]!.type, 'separate');
    const replay = applySemanticProgram(initial, compiled.operations);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.deepEqual(replay.state.entities.map((entity) => [entity.id, entity.lifecycle]), [['se_parent', 'separated'], ['se_left', 'active'], ['se_right', 'active']]);
  }
});

test('state-transition provider compiles explicit ordered merge inputs into a new result entity', () => {
  const beat = beatFor({
    kind: 'merge', entityId: 'se_combined', toState: 'one combined structure',
    mergeInputEntityIds: ['se_left', 'se_right'],
  }, {
    entities: [
      { identityKey: 'left', entityId: 'se_left', conceptId: 'cell', state: 'left part' },
      { identityKey: 'right', entityId: 'se_right', conceptId: 'cell', state: 'right part' },
      { identityKey: 'combined', entityId: 'se_combined', conceptId: 'cell', state: 'one combined structure' },
    ],
    semanticRevealOrder: ['se_combined'],
    requiredSemanticChanges: [{
      identityKey: 'combined', entityId: 'se_combined', kind: 'merge', toState: 'one combined structure',
      mergeInputIdentityKeys: ['left', 'right'], mergeInputEntityIds: ['se_left', 'se_right'],
    }],
  });
  const model = deriveStateTransitionModel(beat);
  assert.deepEqual(model.events, [{
    kind: 'merge', eventId: 'scene.b1.e1', entityId: 'se_combined', toState: 'one combined structure',
    inputs: [{ entityId: 'se_left', state: 'left part' }, { entityId: 'se_right', state: 'right part' }],
  }]);
  const initial = { ...emptyState(), entities: [activeEntity('se_left', 'left part'), activeEntity('se_right', 'right part')] };
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('state_transition', initial, beat);
  assert.equal(compiled.ok, true);
  if (compiled.ok) {
    assert.equal(compiled.providerVersion, 'state-transition/v4');
    assert.equal(compiled.operations[0]!.type, 'merge');
    assert.deepEqual(compiled.mechanisms[0]!.entityIds, ['se_left', 'se_right', 'se_combined']);
    const replay = applySemanticProgram(initial, compiled.operations);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.deepEqual(replay.state.entities.map((entity) => [entity.id, entity.lifecycle, entity.state]), [
      ['se_left', 'merged', 'left part'], ['se_right', 'merged', 'right part'], ['se_combined', 'active', 'one combined structure'],
    ]);
  }

  const tampered = { ...model, events: [{ ...model.events[0]!, inputs: [...model.events[0]!.inputs].reverse() }] };
  const rejected = REPRESENTATION_PROVIDER_REGISTRY.compile('state_transition', tampered, initial, beat);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.problems[0]!.message, /merge inputs must match the ordered identities pinned by the beat/);
});

test('state-transition merge replays same-beat introductions before checking its inputs', () => {
  const beat = beatFor({ kind: 'merge', entityId: 'se_combined', toState: 'combined' }, {
    entities: [
      { identityKey: 'left', entityId: 'se_left', conceptId: 'cell', state: 'left part' },
      { identityKey: 'right', entityId: 'se_right', conceptId: 'cell', state: 'right part' },
      { identityKey: 'combined', entityId: 'se_combined', conceptId: 'cell', state: 'combined' },
    ],
    semanticRevealOrder: ['se_left', 'se_right', 'se_combined'],
    requiredSemanticChanges: [
      { identityKey: 'left', entityId: 'se_left', kind: 'introduce', toState: 'left part' },
      { identityKey: 'right', entityId: 'se_right', kind: 'introduce', toState: 'right part' },
      { identityKey: 'combined', entityId: 'se_combined', kind: 'merge', toState: 'combined', mergeInputIdentityKeys: ['left', 'right'], mergeInputEntityIds: ['se_left', 'se_right'] },
    ],
  });
  const initial = emptyState();
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('state_transition', initial, beat);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.deepEqual(initial, emptyState(), 'provider replay must not mutate its input state');
  if (compiled.ok) {
    assert.deepEqual(compiled.operations.map((operation) => operation.type), ['introduce', 'introduce', 'merge']);
    assert.deepEqual(compiled.operations[2]!.dependsOnEventIds, ['scene.b1.e1', 'scene.b1.e2']);
    const replay = applySemanticProgram(initial, compiled.operations);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.deepEqual(replay.state.entities.map((entity) => [entity.id, entity.lifecycle]), [
      ['se_left', 'merged'], ['se_right', 'merged'], ['se_combined', 'active'],
    ]);
  }
});

test('state-transition merge uses transformed input states and rejects stale same-beat state declarations', () => {
  const beat = beatFor({ kind: 'merge', entityId: 'se_combined', toState: 'combined' }, {
    entities: [
      { identityKey: 'left', entityId: 'se_left', conceptId: 'cell', state: 'ready left' },
      { identityKey: 'right', entityId: 'se_right', conceptId: 'cell', state: 'right part' },
      { identityKey: 'combined', entityId: 'se_combined', conceptId: 'cell', state: 'combined' },
    ],
    semanticRevealOrder: ['se_combined'],
    requiredSemanticChanges: [
      { identityKey: 'left', entityId: 'se_left', kind: 'transform', fromState: 'raw left', toState: 'ready left' },
      { identityKey: 'combined', entityId: 'se_combined', kind: 'merge', toState: 'combined', mergeInputIdentityKeys: ['left', 'right'], mergeInputEntityIds: ['se_left', 'se_right'] },
    ],
  });
  const initial = { ...emptyState(), entities: [activeEntity('se_left', 'raw left'), activeEntity('se_right', 'right part')] };
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('state_transition', initial, beat);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.equal(initial.entities[0]!.state, 'raw left', 'prefix replay must not mutate the initial entity');
  if (compiled.ok) {
    const replay = applySemanticProgram(initial, compiled.operations);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.deepEqual(replay.state.entities.map((entity) => [entity.id, entity.lifecycle, entity.state]), [
      ['se_left', 'merged', 'ready left'], ['se_right', 'merged', 'right part'], ['se_combined', 'active', 'combined'],
    ]);
  }

  const staleBeat = { ...beat, entities: beat.entities.map((entity) => entity.entityId === 'se_left' ? { ...entity, state: 'raw left' } : entity) };
  const stale = REPRESENTATION_PROVIDER_REGISTRY.compile('state_transition', deriveStateTransitionModel(staleBeat), initial, staleBeat);
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.code, 'compile_failed');
    assert.match(stale.problems[0]!.message, /requires exact prior state "ready left", received "raw left"/);
  }
});

test('six-input merge retains maximal beat states with a bounded mechanism description', () => {
  const inputs = Array.from({ length: 6 }, (_, index) => ({
    identityKey: `part_${index}`, entityId: `se_${index}_${'x'.repeat(75)}`, conceptId: 'cell', state: `${index}${'s'.repeat(79)}`,
  }));
  const result = { identityKey: 'combined', entityId: `se_${'z'.repeat(77)}`, conceptId: 'cell', state: 'r'.repeat(80) };
  const beat = beatFor({ kind: 'merge', entityId: result.entityId, toState: result.state }, {
    entities: [...inputs, result],
    semanticRevealOrder: [result.entityId],
    requiredSemanticChanges: [{
      identityKey: result.identityKey, entityId: result.entityId, kind: 'merge', toState: result.state,
      mergeInputIdentityKeys: inputs.map((input) => input.identityKey), mergeInputEntityIds: inputs.map((input) => input.entityId),
    }],
  });
  const model = deriveStateTransitionModel(beat);
  assert.deepEqual(model.events[0]!.kind === 'merge' && model.events[0].inputs, inputs.map(({ entityId, state }) => ({ entityId, state })));
  const initial = { ...emptyState(), entities: inputs.map((input) => activeEntity(input.entityId, input.state)) };
  const compiled = REPRESENTATION_PROVIDER_REGISTRY.compile('state_transition', model, initial, beat);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (compiled.ok) {
    assert.equal(compiled.mechanisms[0]!.description.length <= 240, true);
    assert.deepEqual(compiled.mechanisms[0]!.entityIds, [...inputs.map((input) => input.entityId), result.entityId]);
    const replay = applySemanticProgram(initial, compiled.operations);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.deepEqual(replay.state.entities.map((entity) => entity.state), [...inputs.map((input) => input.state), result.state]);
  }
});

test('long valid transition states do not overflow mechanism descriptions or lose exact state data', () => {
  const entityId = `se_${'x'.repeat(77)}`;
  const fromState = 'f'.repeat(120);
  const toState = 't'.repeat(120);
  const introduction = beatFor({ kind: 'introduce', entityId, toState });
  const transformation = beatFor({ kind: 'transform', entityId, fromState, toState });
  const results = Array.from({ length: 6 }, (_, index) => ({
    identityKey: `result_${index}`, entityId: `se_${index}_${'y'.repeat(75)}`, conceptId: 'cell', state: `${index}${'r'.repeat(79)}`,
  }));
  const separation = beatFor({ kind: 'separate', entityId, fromState, toState }, {
    entities: [{ identityKey: 'source', entityId, conceptId: 'cell' }, ...results],
    semanticRevealOrder: results.map((entity) => entity.entityId),
  });
  const cases: Array<[TeachingBeat, SemanticSceneState]> = [
    [introduction, emptyState()],
    [transformation, { ...emptyState(), entities: [activeEntity(entityId, fromState)] }],
    [separation, { ...emptyState(), entities: [activeEntity(entityId, fromState)] }],
  ];
  for (const [beat, initial] of cases) {
    const compiled = REPRESENTATION_PROVIDER_REGISTRY.compileFallback('state_transition', initial, beat);
    assert.equal(compiled.ok, true, JSON.stringify(compiled));
    if (compiled.ok) {
      assert.equal(compiled.mechanisms[0]!.description.length <= 240, true);
      const operation = compiled.operations[0]!;
      if (operation.type === 'introduce') assert.equal(operation.entity.state, toState);
      if (operation.type === 'transform') {
        assert.equal(operation.fromState, fromState);
        assert.equal(operation.toState, toState);
      }
      if (operation.type === 'separate') {
        assert.equal(operation.fromState, fromState);
        assert.deepEqual(operation.results.map((result) => result.state), results.map((result) => result.state));
      }
    }
  }
});

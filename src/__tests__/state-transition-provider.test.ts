import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticEventId, type TeachingBeat } from '../teaching/beat-plan/types.js';
import { applySemanticProgram } from '../teaching/semantic-ir/program.js';
import type { SemanticSceneState } from '../teaching/semantic-ir/types.js';
import { REPRESENTATION_PROVIDER_REGISTRY } from '../teaching/representation/registry.js';
import { deriveStateTransitionModel } from '../teaching/representation/stateTransition.js';

function beatFor(change: { kind: 'introduce' | 'transform' | 'move'; entityId: string; fromState?: string; toState: string }): TeachingBeat {
  return {
    beatId: 'scene.b1', sceneId: 'scene', order: 1, claimIds: ['claim_a'], learnerDelta: 'The learner sees the state change.',
    learningQuestion: 'How does the state change?', learnerBefore: 'The entity is closed.', learnerAfter: 'The entity is open.', dependsOnOrders: [], dependsOnBeatIds: [],
    beatType: 'transform', cognitiveOperation: 'transform', representationFamily: 'state_transition', entities: [{ identityKey: 'cell_main', entityId: change.entityId, conceptId: 'cell' }],
    semanticRevealOrder: [change.entityId], requiredSemanticChanges: [change], relationships: [], misconceptionIds: [], narrationGoal: 'Explain the transition.',
    visualInvariant: 'The current state is visible.', mutedMeaning: 'The state changed.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none', persistentEntityIds: [change.entityId], evidenceSpanIds: [],
  } as unknown as TeachingBeat;
}

const emptyState = (): SemanticSceneState => ({ sceneId: 'scene', entities: [], relations: [], selectedEntityIds: [], plots: [], feedbackLoops: [], annotations: [] });
const activeEntity = (id: string, state: string): SemanticSceneState['entities'][number] => ({ id, conceptId: 'cell', claimIds: ['claim_a'], state, lifecycle: 'active' });

test('state-transition provider is the only active family and derives a generic representation from beat semantics', () => {
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

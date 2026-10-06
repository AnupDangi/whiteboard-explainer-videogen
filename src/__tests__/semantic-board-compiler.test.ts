import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSemanticOpsToBoardOps } from '../teaching/semantic-ir/toBoardOps.js';
import type { SemanticSceneState } from '../teaching/semantic-ir/types.js';
import type { VisualVocabulary } from '../planner/visualDiscovery.js';

const emptyState = (): SemanticSceneState => ({ sceneId: 'scene', entities: [], relations: [], selectedEntityIds: [], plots: [], feedbackLoops: [], annotations: [] });
const concepts = [{ id: 'cell', label: 'Cell', kind: 'entity' }];
const iconVocabulary: VisualVocabulary = {
  sceneId: 'scene', family: 'outline', concepts: [{
    conceptId: 'cell', label: 'Cell', conceptKind: 'entity',
    depiction: { kind: 'icon', entryId: 'iconify-lucide:cell', rung: 'R3-lucide', houseFamily: 'outline' },
  }],
};
const intro = (state: string) => ({
  type: 'introduce', eventId: 'scene.b1.e1', beatId: 'scene.b1', claimIds: ['claim_a'], dependsOnEventIds: [],
  entity: { id: 'se_cell', conceptId: 'cell', claimIds: ['claim_a'], state, lifecycle: 'active' },
});

test('semantic introduction lowers to a canonically bound entity and preserves the exact selected icon id', () => {
  const result = compileSemanticOpsToBoardOps(emptyState(), [intro('intact')], {
    concepts, visualVocabulary: iconVocabulary,
    knownBeatIds: new Set(['scene.b1']), knownClaimIds: new Set(['claim_a']),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const repeated = compileSemanticOpsToBoardOps(emptyState(), [intro('intact')], {
    concepts, visualVocabulary: iconVocabulary,
    knownBeatIds: new Set(['scene.b1']), knownClaimIds: new Set(['claim_a']),
  });
  assert.equal(repeated.ok, true);
  if (repeated.ok) assert.deepEqual(repeated.operations, result.operations);
  assert.deepEqual(result.selectedAssetIds, { cell: 'iconify-lucide:cell' });
  assert.deepEqual(result.operations.map((op) => op.op), ['add', 'add']);
  const picture = result.operations[0]!;
  assert.equal(picture.op, 'add');
  if (picture.op === 'add') {
    assert.equal(picture.id, 'se_cell');
    assert.equal(picture.element.type, 'entity');
    if (picture.element.type === 'entity') {
      assert.equal(picture.element.label, 'Cell');
      assert.deepEqual(picture.element.bindings, { conceptIds: ['cell'], claimIds: ['claim_a'] });
    }
  }
  const stateValue = result.operations[1]!;
  assert.equal(stateValue.op, 'add');
  if (stateValue.op === 'add') {
    assert.equal(stateValue.id, 'se_cell.state');
    assert.equal(stateValue.element.type, 'value');
    if (stateValue.element.type === 'value') assert.equal(stateValue.element.value, 'intact');
  }
});

test('state transformation lowers only when the locked visible before-value matches', () => {
  const initial = { ...emptyState(), entities: [{ id: 'se_cell', conceptId: 'cell', claimIds: ['claim_a'], state: 'intact', lifecycle: 'active' as const }] };
  const transform = { type: 'transform', eventId: 'scene.b2.e1', beatId: 'scene.b2', claimIds: ['claim_a'], dependsOnEventIds: [], entityId: 'se_cell', fromState: 'intact', toState: 'divided' };
  const context = {
    concepts, visualVocabulary: iconVocabulary,
    knownBeatIds: new Set(['scene.b2']), knownClaimIds: new Set(['claim_a']),
    existingElementIds: new Set(['se_cell', 'se_cell.state']), existingStateValues: { 'se_cell.state': 'intact' },
  };
  const result = compileSemanticOpsToBoardOps(initial, [transform], context);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.operations.length, 1);
    assert.equal(result.operations[0]!.op, 'updateValue');
    if (result.operations[0]!.op === 'updateValue') {
      assert.equal(result.operations[0]!.target, 'se_cell.state');
      assert.equal(result.operations[0]!.value, 'divided');
    }
  }

  const stale = compileSemanticOpsToBoardOps(initial, [transform], { ...context, existingStateValues: { 'se_cell.state': 'already divided' } });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.problems[0]!.message, /visible state value does not match/);
});

test('unsupported mechanisms and overlong visible state fail without text shortening or generic substitution', () => {
  const flow = {
    type: 'flow', eventId: 'scene.b1.e1', beatId: 'scene.b1', claimIds: ['claim_a'], dependsOnEventIds: [],
    entityId: 'se_cell', fromLocationId: 'outside', toLocationId: 'inside', mode: 'net',
  };
  const initial = { ...emptyState(), entities: [{ id: 'se_cell', conceptId: 'cell', claimIds: ['claim_a'], locationId: 'outside', lifecycle: 'active' as const }] };
  const unsupported = compileSemanticOpsToBoardOps(initial, [flow], { concepts, knownBeatIds: new Set(['scene.b1']), knownClaimIds: new Set(['claim_a']) });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.match(unsupported.problems[0]!.message, /no verified BoardOps compiler/);

  const longState = compileSemanticOpsToBoardOps(emptyState(), [intro('state '.repeat(11).trim())], { concepts });
  assert.equal(longState.ok, false);
  if (!longState.ok) assert.match(longState.problems[0]!.message, /preserve it verbatim/);
});

test('icon vocabulary cannot bind a noun icon to a non-entity concept', () => {
  const bad = { ...iconVocabulary, concepts: [{ ...iconVocabulary.concepts[0]!, conceptKind: 'process' }] };
  const result = compileSemanticOpsToBoardOps(emptyState(), [intro('intact')], { concepts: [{ id: 'cell', label: 'Cell', kind: 'process' }], visualVocabulary: bad });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.problems[0]!.message, /only for canonical entity concepts/);
});

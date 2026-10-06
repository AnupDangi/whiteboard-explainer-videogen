import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSemanticOpsToBoardOps } from '../teaching/semantic-ir/toBoardOps.js';
import type { SemanticSceneState } from '../teaching/semantic-ir/types.js';
import type { VisualVocabulary } from '../planner/visualDiscovery.js';
import { loadCatalogLibraries } from '../assets/streamline.js';

const emptyState = (): SemanticSceneState => ({ sceneId: 'scene', entities: [], relations: [], selectedEntityIds: [], plots: [], feedbackLoops: [], annotations: [] });
const concepts = [{ id: 'cell_nuclei', label: 'Cell nuclei', kind: 'entity' }];
const iconVocabulary: VisualVocabulary = {
  sceneId: 'scene', family: 'outline', concepts: [{
    conceptId: 'cell_nuclei', label: 'Cell nuclei', conceptKind: 'entity',
    depiction: { kind: 'icon', entryId: 'iconify-healthicons:cell-nuclei-outline', rung: 'R3-healthicons', houseFamily: 'outline' },
  }],
};
const intro = (state: string) => ({
  type: 'introduce', eventId: 'scene.b1.e1', beatId: 'scene.b1', claimIds: ['claim_a'], dependsOnEventIds: [],
  entity: { id: 'se_cell_nuclei', conceptId: 'cell_nuclei', claimIds: ['claim_a'], state, lifecycle: 'active' },
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
  assert.deepEqual(result.selectedAssetIds, { cell_nuclei: 'iconify-healthicons:cell-nuclei-outline' });
  const libraryAsset = loadCatalogLibraries().entries.find((entry) => entry.id === 'iconify-healthicons:cell-nuclei-outline');
  assert.ok(libraryAsset, 'the selected icon id must exist in the vendored library catalog');
  assert.equal(libraryAsset.license, 'MIT');
  assert.deepEqual(result.operations.map((op) => op.op), ['add', 'add']);
  const picture = result.operations[0]!;
  assert.equal(picture.op, 'add');
  if (picture.op === 'add') {
    assert.equal(picture.id, 'se_cell_nuclei');
    assert.equal(picture.element.type, 'entity');
    if (picture.element.type === 'entity') {
      assert.equal(picture.element.label, 'Cell nuclei');
      assert.deepEqual(picture.element.bindings, { conceptIds: ['cell_nuclei'], claimIds: ['claim_a'] });
    }
  }
  const stateValue = result.operations[1]!;
  assert.equal(stateValue.op, 'add');
  if (stateValue.op === 'add') {
    assert.equal(stateValue.id, 'se_cell_nuclei.state');
    assert.equal(stateValue.element.type, 'value');
    if (stateValue.element.type === 'value') assert.equal(stateValue.element.value, 'intact');
  }
});

test('state transformation lowers only when the locked visible before-value matches', () => {
  const initial = { ...emptyState(), entities: [{ id: 'se_cell_nuclei', conceptId: 'cell_nuclei', claimIds: ['claim_a'], state: 'intact', lifecycle: 'active' as const }] };
  const transform = { type: 'transform', eventId: 'scene.b2.e1', beatId: 'scene.b2', claimIds: ['claim_a'], dependsOnEventIds: [], entityId: 'se_cell_nuclei', fromState: 'intact', toState: 'divided' };
  const context = {
    concepts, visualVocabulary: iconVocabulary,
    knownBeatIds: new Set(['scene.b2']), knownClaimIds: new Set(['claim_a']),
    existingElementIds: new Set(['se_cell_nuclei', 'se_cell_nuclei.state']), existingStateValues: { 'se_cell_nuclei.state': 'intact' },
  };
  const result = compileSemanticOpsToBoardOps(initial, [transform], context);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.operations.length, 1);
    assert.equal(result.operations[0]!.op, 'updateValue');
    if (result.operations[0]!.op === 'updateValue') {
      assert.equal(result.operations[0]!.target, 'se_cell_nuclei.state');
      assert.equal(result.operations[0]!.value, 'divided');
    }
  }

  const stale = compileSemanticOpsToBoardOps(initial, [transform], { ...context, existingStateValues: { 'se_cell_nuclei.state': 'already divided' } });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.problems[0]!.message, /visible state value does not match/);
});

test('separation lowers to a state-checked split and preserves library-icon bindings on every result', () => {
  const initial = { ...emptyState(), entities: [{ id: 'se_cell_nuclei', conceptId: 'cell_nuclei', claimIds: ['claim_a'], state: 'intact', lifecycle: 'active' as const }] };
  const separate = {
    type: 'separate', eventId: 'scene.b2.e1', beatId: 'scene.b2', claimIds: ['claim_a'], dependsOnEventIds: [],
    sourceEntityId: 'se_cell_nuclei', fromState: 'intact',
    results: [
      { id: 'se_left', conceptId: 'cell_nuclei', claimIds: ['claim_a'], state: 'daughter nucleus', lifecycle: 'active' },
      { id: 'se_right', conceptId: 'cell_nuclei', claimIds: ['claim_a'], state: 'daughter nucleus', lifecycle: 'active' },
    ],
  };
  const context = {
    concepts, visualVocabulary: iconVocabulary,
    knownBeatIds: new Set(['scene.b2']), knownClaimIds: new Set(['claim_a']),
    existingElementIds: new Set(['se_cell_nuclei', 'se_cell_nuclei.state']), existingStateValues: { 'se_cell_nuclei.state': 'intact' },
  };
  const result = compileSemanticOpsToBoardOps(initial, [separate], context);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.selectedAssetIds, { cell_nuclei: 'iconify-healthicons:cell-nuclei-outline' });
  assert.deepEqual(result.operations.map((op) => op.op), ['remove', 'split', 'add', 'add']);
  const split = result.operations[1]!;
  assert.equal(split.op, 'split');
  if (split.op === 'split') {
    assert.equal(split.target, 'se_cell_nuclei');
    assert.deepEqual(split.into.map((part) => part.id), ['se_left', 'se_right']);
    for (const part of split.into) {
      assert.equal(part.element.type, 'entity');
      if (part.element.type === 'entity') assert.deepEqual(part.element.bindings, { conceptIds: ['cell_nuclei'], claimIds: ['claim_a'] });
    }
  }
  assert.deepEqual(result.resultingSemanticState.entities.map((entity) => [entity.id, entity.lifecycle]), [['se_cell_nuclei', 'separated'], ['se_left', 'active'], ['se_right', 'active']]);

  const stale = compileSemanticOpsToBoardOps(initial, [separate], { ...context, existingStateValues: { 'se_cell_nuclei.state': 'already divided' } });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.problems[0]!.message, /visible state value does not match/);
});

test('causal semantic relations lower to deterministic directed edges with exact claim and concept bindings', () => {
  const state: SemanticSceneState = {
    ...emptyState(),
    entities: [
      { id: 'se_light', conceptId: 'sunlight', claimIds: ['claim_a'], lifecycle: 'active' },
      { id: 'se_plant', conceptId: 'plant', claimIds: ['claim_a'], lifecycle: 'active' },
    ],
  };
  const cause = {
    type: 'cause', eventId: 'scene.b2.e1', beatId: 'scene.b2', claimIds: ['claim_a'], dependsOnEventIds: [],
    relation: { id: 'rel_light_causes_growth', fromEntityId: 'se_light', toEntityId: 'se_plant', type: 'causes', claimIds: ['claim_a'] },
  };
  const context = {
    concepts: [{ id: 'sunlight', label: 'Sunlight', kind: 'entity' }, { id: 'plant', label: 'Plant', kind: 'entity' }],
    knownBeatIds: new Set(['scene.b2']), knownClaimIds: new Set(['claim_a']),
    existingElementIds: new Set(['se_light', 'se_plant']),
  };
  const result = compileSemanticOpsToBoardOps(state, [cause], context);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const repeated = compileSemanticOpsToBoardOps(state, [cause], context);
  assert.equal(repeated.ok, true);
  assert.deepEqual(repeated.ok ? repeated.operations : [], result.operations);
  assert.equal(result.operations.length, 1);
  const edge = result.operations[0]!;
  assert.equal(edge.op, 'connect');
  if (edge.op === 'connect') {
    assert.match(edge.id, /^edge_[a-f0-9]{20}$/);
    assert.equal(edge.from, 'se_light');
    assert.equal(edge.to, 'se_plant');
    assert.equal(edge.relation, 'causes');
    assert.deepEqual(edge.bindings, { conceptIds: ['sunlight', 'plant'], claimIds: ['claim_a'] });
  }

  const collision = compileSemanticOpsToBoardOps(state, [cause], { ...context, existingEdgeIds: new Set([edge.op === 'connect' ? edge.id : '']) });
  assert.equal(collision.ok, false);
  if (!collision.ok) assert.match(collision.problems[0]!.message, /renderer id .* already in use/);
});

test('unsupported mechanisms and overlong visible state fail without text shortening or generic substitution', () => {
  const flow = {
    type: 'flow', eventId: 'scene.b1.e1', beatId: 'scene.b1', claimIds: ['claim_a'], dependsOnEventIds: [],
    entityId: 'se_cell_nuclei', fromLocationId: 'outside', toLocationId: 'inside', mode: 'net',
  };
  const initial = { ...emptyState(), entities: [{ id: 'se_cell_nuclei', conceptId: 'cell_nuclei', claimIds: ['claim_a'], locationId: 'outside', lifecycle: 'active' as const }] };
  const unsupported = compileSemanticOpsToBoardOps(initial, [flow], { concepts, knownBeatIds: new Set(['scene.b1']), knownClaimIds: new Set(['claim_a']) });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.match(unsupported.problems[0]!.message, /no verified BoardOps compiler/);

  const longState = compileSemanticOpsToBoardOps(emptyState(), [intro('state '.repeat(11).trim())], { concepts });
  assert.equal(longState.ok, false);
  if (!longState.ok) assert.match(longState.problems[0]!.message, /preserve it verbatim/);
});

test('icon vocabulary cannot bind a noun icon to a non-entity concept', () => {
  const bad = { ...iconVocabulary, concepts: [{ ...iconVocabulary.concepts[0]!, conceptKind: 'process' }] };
  const result = compileSemanticOpsToBoardOps(emptyState(), [intro('intact')], { concepts: [{ id: 'cell_nuclei', label: 'Cell nuclei', kind: 'process' }], visualVocabulary: bad });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.problems[0]!.message, /only for canonical entity concepts/);
});

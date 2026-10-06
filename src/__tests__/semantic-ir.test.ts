import assert from 'node:assert/strict';
import test from 'node:test';
import { applySemanticProgram } from '../teaching/semantic-ir/program.js';
import { SemanticOpSchema, type SemanticSceneState } from '../teaching/semantic-ir/types.js';

const emptyState = (): SemanticSceneState => ({ sceneId: 'scene', entities: [], relations: [], selectedEntityIds: [], plots: [], feedbackLoops: [], annotations: [] });
const entity = (id: string, state?: string) => ({ id, conceptId: `concept_${id}`, claimIds: ['claim_a'], lifecycle: 'active' as const, ...(state ? { state } : {}) });
const common = (eventId: string, beatId: string, dependsOnEventIds: string[] = []) => ({ eventId, beatId, claimIds: ['claim_a'], dependsOnEventIds });

test('SemanticOp is a geometry-free, strict meaning-level contract', () => {
  const valid = {
    type: 'transform', ...common('scene.b1.e1', 'scene.b1'), entityId: 'se_a', fromState: 'closed', toState: 'open',
  };
  assert.equal(SemanticOpSchema.safeParse(valid).success, true);
  assert.equal(SemanticOpSchema.safeParse({ ...valid, x: 120, y: 80 }).success, false);
  assert.equal(SemanticOpSchema.safeParse({ ...valid, toState: 'open', geometry: { x: 1 } }).success, false);
  const plot = {
    type: 'plot', ...common('scene.b1.e1', 'scene.b1'),
    plot: { id: 'plot_a', label: 'Quantity over time', claimIds: ['claim_a'], points: [{ independentValue: 0, dependentValue: 4 }], thresholds: [] },
  };
  assert.equal(SemanticOpSchema.safeParse(plot).success, true);
  assert.equal(SemanticOpSchema.safeParse({ ...plot, plot: { ...plot.plot, points: [{ x: 120, y: 80 }] } }).success, false);
});

test('semantic replay applies an exact transform and leaves the input state unchanged', () => {
  const initial = { ...emptyState(), entities: [entity('se_a', 'closed')] };
  const result = applySemanticProgram(initial, [
    { type: 'transform', ...common('scene.b1.e1', 'scene.b1'), entityId: 'se_a', fromState: 'closed', toState: 'open' },
  ], { knownBeatIds: new Set(['scene.b1']), knownClaimIds: new Set(['claim_a']) });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.entities[0]!.state, 'open');
    assert.equal(result.operations.length, 1);
  }
  assert.equal(initial.entities[0]!.state, 'closed');
});

test('semantic replay rejects a stale before-state without partially changing the supplied state', () => {
  const initial = { ...emptyState(), entities: [entity('se_a', 'closed')] };
  const result = applySemanticProgram(initial, [
    { type: 'transform', ...common('scene.b1.e1', 'scene.b1'), entityId: 'se_a', fromState: 'open', toState: 'divided' },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.problems[0]!.message, /expected prior state/);
  assert.equal(initial.entities[0]!.state, 'closed');
});

test('semantic event dependencies must point to earlier successful events and claims must be known', () => {
  const result = applySemanticProgram(emptyState(), [
    { type: 'introduce', ...common('scene.b1.e1', 'scene.b1'), entity: entity('se_a') },
    { type: 'focus', ...common('scene.b1.e2', 'scene.b1', ['scene.b1.e3']), entityIds: ['se_a'] },
  ], { knownBeatIds: new Set(['scene.b1']), knownClaimIds: new Set(['claim_a']) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.problems[0]!.message, /must refer to an earlier/);

  const unknownClaim = applySemanticProgram(emptyState(), [
    { type: 'introduce', ...common('scene.b1.e1', 'scene.b1'), claimIds: ['missing'], entity: { ...entity('se_a'), claimIds: ['missing'] } },
  ], { knownClaimIds: new Set(['claim_a']) });
  assert.equal(unknownClaim.ok, false);
  if (!unknownClaim.ok) assert.match(unknownClaim.problems[0]!.message, /unknown claim/);

  const eventFromWrongBeat = applySemanticProgram(emptyState(), [
    { type: 'introduce', ...common('scene.b1.e1', 'scene.b2'), entity: entity('se_a') },
  ]);
  assert.equal(eventFromWrongBeat.ok, false);
  if (!eventFromWrongBeat.ok) assert.match(eventFromWrongBeat.problems[0]!.message, /must belong to beat/);

  const ungroundedInitial = applySemanticProgram({ ...emptyState(), entities: [{ ...entity('se_old'), claimIds: ['missing'] }] }, [], { knownClaimIds: new Set(['claim_a']) });
  assert.equal(ungroundedInitial.ok, false);
  if (!ungroundedInitial.ok) assert.match(ungroundedInitial.problems[0]!.message, /unknown claim/);
});

test('split and merge preserve old identities as inactive instead of recycling them', () => {
  const split = applySemanticProgram({ ...emptyState(), entities: [entity('se_parent', 'whole')] }, [
    { type: 'separate', ...common('scene.b1.e1', 'scene.b1'), sourceEntityId: 'se_parent', fromState: 'whole', results: [entity('se_left', 'part'), entity('se_right', 'part')] },
  ]);
  assert.equal(split.ok, true);
  if (!split.ok) return;
  assert.equal(split.state.entities.find((candidate) => candidate.id === 'se_parent')!.lifecycle, 'separated');

  const stale = applySemanticProgram({ ...emptyState(), entities: [entity('se_parent', 'whole')] }, [
    { type: 'separate', ...common('scene.b1.e1', 'scene.b1'), sourceEntityId: 'se_parent', fromState: 'already split', results: [entity('se_left'), entity('se_right')] },
  ]);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.problems[0]!.message, /expected prior state/);

  const reuse = applySemanticProgram(split.state, [
    { type: 'introduce', ...common('scene.b2.e1', 'scene.b2'), entity: entity('se_parent') },
  ]);
  assert.equal(reuse.ok, false);
  if (!reuse.ok) assert.match(reuse.problems[0]!.message, /already in use/);

  const merged = applySemanticProgram(split.state, [
    { type: 'merge', ...common('scene.b2.e1', 'scene.b2'), entityIds: ['se_left', 'se_right'], result: entity('se_whole') },
  ]);
  assert.equal(merged.ok, true);
  if (merged.ok) {
    assert.equal(merged.state.entities.find((candidate) => candidate.id === 'se_left')!.lifecycle, 'merged');
    const inactiveUse = applySemanticProgram(merged.state, [
      { type: 'focus', ...common('scene.b3.e1', 'scene.b3'), entityIds: ['se_left'] },
    ]);
    assert.equal(inactiveUse.ok, false);
    if (!inactiveUse.ok) assert.match(inactiveUse.problems[0]!.message, /not active/);
  }
});

test('quantity changes require the exact old value and apply the new value deterministically', () => {
  const initial = { ...emptyState(), entities: [{ ...entity('se_water'), quantity: 10, unit: 'mL' }] };
  const result = applySemanticProgram(initial, [
    { type: 'update_quantity', ...common('scene.b1.e1', 'scene.b1'), entityId: 'se_water', fromValue: 10, toValue: 7, fromUnit: 'mL', unit: 'mL' },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.state.entities[0]!.quantity, 7);

  const stale = applySemanticProgram(initial, [
    { type: 'update_quantity', ...common('scene.b1.e1', 'scene.b1'), entityId: 'se_water', fromValue: 9, toValue: 7, fromUnit: 'mL', unit: 'mL' },
  ]);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.problems[0]!.message, /expected prior quantity/);

  const wrongUnit = applySemanticProgram(initial, [
    { type: 'update_quantity', ...common('scene.b1.e1', 'scene.b1'), entityId: 'se_water', fromValue: 10, toValue: 7, fromUnit: 'L', unit: 'mL' },
  ]);
  assert.equal(wrongUnit.ok, false);
  if (!wrongUnit.ok) assert.match(wrongUnit.problems[0]!.message, /expected prior unit/);
});

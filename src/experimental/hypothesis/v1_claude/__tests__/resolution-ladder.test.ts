import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObject, typeCompatible, APPROVED_METAPHORS } from '../catalog/ladder.js';
import { allCatalogEntries } from '../catalog/semantic.js';
import { loadBridge } from '../catalog/bridge.js';

const SIZE = { w: 150, h: 220 };
const catalog = allCatalogEntries();

test('R3: exact house literal resolves with strategy recorded', () => {
  const first = catalog.find((e) => e.names.includes('abacus')) ?? catalog[0];
  const out = resolveObject(first.names[0], { size: SIZE }, catalog);
  assert.equal(out.resolution.strategy, 'R3-house-literal');
  assert.equal(out.resolution.rung, 2);
  assert.equal(out.resolution.score, 1);
  assert.ok(out.resolution.bridgeVersion === loadBridge().catalogVersion);
  assert.ok(out.visual.paths.length > 0 || out.visual.fills.length > 0);
});

test('R2: explicit semantic role draws the core primitive', () => {
  const out = resolveObject('filtering information', {
    size: SIZE, semanticRole: 'filter', visualStrategy: 'semantic-core', label: 'filtering information',
  }, catalog);
  assert.equal(out.resolution.strategy, 'R2-semantic-core');
  assert.equal(out.resolution.rung, 2);
  assert.equal(out.resolution.assetId, 'core:filter');
  assert.equal(out.resolution.semanticRole, 'filter');
  assert.ok(out.visual.paths.length > 0);
  // Label below aids muted-board comprehension.
  assert.ok(out.visual.texts.some((t) => t.text.includes('FILTERING')));
});

test('R1: mechanism concept with diagram spec resolves diagram-first', () => {
  const out = resolveObject('neural network propagation', { size: SIZE, conceptId: 'neural-network' }, catalog);
  assert.equal(out.resolution.strategy, 'R1-diagram');
  assert.equal(out.resolution.rung, 2);
  assert.ok(out.resolution.assetId?.startsWith('diagram:'));
  assert.ok(out.resolution.diagramRef, 'diagram ref recorded');
});

test('R1: explicit diagram strategy on a diagram-backed concept', () => {
  const out = resolveObject('neural network', {
    size: SIZE, conceptId: 'neural-network', visualStrategy: 'diagram',
  }, catalog);
  assert.equal(out.resolution.strategy, 'R1-diagram');
});

test('R7: explicit topology strategy draws the board grammar', () => {
  const out = resolveObject('something unresolvable xyz', {
    size: SIZE, visualStrategy: 'topology', template: 'fan_out', label: 'xyz',
  }, catalog);
  assert.equal(out.resolution.strategy, 'R7-state-topology');
  assert.equal(out.resolution.rung, 2, 'confident procedural drawing is rung 2, never a weak match');
  assert.equal(out.resolution.assetId, 'topo:fan_out');
  assert.ok(out.visual.paths.length > 0);
});

test('R0: valid pin reuses the validated representation', () => {
  const first = resolveObject('abacus', { size: SIZE }, catalog);
  const pinned = resolveObject('abacus', {
    size: SIZE, pin: { assetId: first.resolution.assetId!, rung: 2, score: 1 },
  }, catalog);
  assert.equal(pinned.resolution.strategy, 'R0-verified-pin');
  assert.equal(pinned.resolution.assetId, first.resolution.assetId);
});

test('R0: synthetic core pins re-render deterministically', () => {
  const out = resolveObject('filtering', {
    size: SIZE, label: 'filtering', pin: { assetId: 'core:filter', rung: 2, score: 0.9 },
  }, catalog);
  assert.equal(out.resolution.strategy, 'R0-verified-pin');
  assert.equal(out.resolution.assetId, 'core:filter');
});

test('R0: stale pins are ignored, never trusted', () => {
  const out = resolveObject('abacus', {
    size: SIZE, pin: { assetId: 'retired:icon:gone', rung: 2, score: 1 },
  }, catalog);
  assert.notEqual(out.resolution.strategy, 'R0-verified-pin', 'stale pin must not pin');
  assert.notEqual(out.resolution.assetId, 'retired:icon:gone');
});

test('R5: embedding candidates resolve with typed-retrieval strategy', () => {
  const target = catalog[3];
  const out = resolveObject('unrelated concept xyz', {
    size: SIZE, candidates: [{ id: target.id, name: target.names[0] ?? target.id, score: 0.75 }],
  }, catalog);
  assert.equal(out.resolution.strategy, 'R5-typed-retrieval');
  assert.equal(out.resolution.assetId, target.id);
});

test('R5: type gate blocks cross-type weak matches', () => {
  const physical = catalog.find((e) => e.names.includes('abacus')) ?? catalog[0];
  // 'abacus' is a physical-object concept: a process-typed request must reject it.
  assert.equal(typeCompatible('process', physical), false);
  // Same-type requests pass.
  assert.equal(typeCompatible('physical-object', physical), true);
  // Untyped requests always pass (gate cannot judge what it cannot see).
  assert.equal(typeCompatible(undefined, physical), true);
});

test('R4: empty metaphor table falls through without effect', () => {
  assert.deepEqual({ ...APPROVED_METAPHORS }, {}, 'V1 ships no curated metaphors');
  const out = resolveObject('filtering information', { size: SIZE, visualStrategy: 'metaphor' }, catalog);
  assert.notEqual(out.resolution.strategy, 'R4-approved-metaphor');
});

test('R8/R9: unresolvable concepts always resolve to labelled boxes', () => {
  const out = resolveObject('zzz unresolvable qqq', { size: SIZE }, catalog);
  assert.ok(out.resolution.strategy === 'R8-labelled-primitive' || out.resolution.strategy === 'R9-minimal-text');
  assert.equal(out.resolution.rung, 4);
  assert.equal(out.resolution.assetId, null);
  assert.ok(out.visual.paths.length > 0 || out.visual.texts.length > 0);
});

test('ladder is deterministic end to end', () => {
  const opts = { size: SIZE, semanticRole: 'bottleneck', label: 'narrowing' } as const;
  const a = JSON.stringify(resolveObject('narrowing flow', { ...opts }));
  const b = JSON.stringify(resolveObject('narrowing flow', { ...opts }));
  assert.equal(a, b);
});

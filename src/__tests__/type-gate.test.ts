import test from 'node:test';
import assert from 'node:assert/strict';
import { depictEntity, depictionFamily, type EntityResolver } from '../visual-v2/resolver/typeGate.js';
import type { PrimitiveVisual } from '../shared/types.js';

const rect = { x: 100, y: 200, w: 240, h: 210 };
const visual: PrimitiveVisual = { paths: [{ d: 'M 0 0 L 10 10', length: 14 }], fills: [], texts: [] };
const exact: EntityResolver = () => ({ visual, resolution: { rung: 3, assetId: 'asset:leaf', score: 1, license: 'MIT', lane: 'simple-symbol', source: 'asset', strategy: 'R3-house-literal', selectionBasis: 'exact' } });
const similar: EntityResolver = () => ({ visual, resolution: { rung: 3, assetId: 'asset:leaf2', score: 0.7, license: 'MIT', lane: 'simple-symbol', source: 'asset', strategy: 'R3-house-literal', selectionBasis: 'similarity' } });
const nothing: EntityResolver = () => ({ visual, resolution: { rung: 4, assetId: null, score: 0, license: 'manual', lane: 'labelled-primitive', source: 'generated', strategy: 'R10-labelled-primitive', selectionBasis: 'procedural' } });

test('concept kind decides what kind of picture may depict a concept, before any similarity ranking', () => {
  assert.equal(depictionFamily('entity'), 'pictorial');
  for (const kind of ['process', 'event', 'rule', 'quantity', 'formula'] as const) assert.equal(depictionFamily(kind), 'labelled', kind);
  assert.equal(depictionFamily('role'), 'role-shape');
  assert.equal(depictionFamily(undefined), 'labelled', 'an unknown kind never gets a noun picture');
});

test('only a concrete entity with an exact asset gets a picture, placed at its rect and counted as meaningful', () => {
  const result = depictEntity({ id: 'leaf', label: 'leaf', kind: 'entity' }, 'leaf', rect, exact);
  assert.equal(result.meaningful, true);
  assert.equal(result.family, 'pictorial');
  assert.equal(result.assetId, 'asset:leaf');
  assert.match(result.visual.paths[0]!.transform ?? '', /translate\(100 200\)/);
});

test('a similarity-selected asset is refused: a wrong picture is worse than a label', () => {
  const result = depictEntity({ id: 'leaf', label: 'leaf', kind: 'entity' }, 'leaf', rect, similar);
  assert.equal(result.family, 'labelled');
  assert.equal(result.meaningful, false);
  assert.match(result.reason, /similarity/);
});

test('a process, quantity or unknown concept is never given a noun picture even if the resolver offers one', () => {
  for (const kind of ['process', 'quantity', 'event'] as const) {
    const result = depictEntity({ id: 'x', label: 'flow', kind }, 'flow', rect, exact);
    assert.equal(result.family, 'labelled', kind);
    assert.equal(result.meaningful, false);
  }
  assert.equal(depictEntity(undefined, 'thing', rect, exact).family, 'labelled');
});

test('a concrete entity with no asset falls back to a labelled box that does not count as meaningful', () => {
  const result = depictEntity({ id: 'k', label: 'quokka', kind: 'entity' }, 'quokka', rect, nothing);
  assert.equal(result.family, 'labelled');
  assert.equal(result.meaningful, false);
});

test('a role concept whose name is a semantic-core role is drawn as that role shape', () => {
  const result = depictEntity({ id: 'g', label: 'gate', kind: 'role' }, 'gate', rect);
  assert.equal(result.family, 'role-shape');
  assert.equal(result.meaningful, true);
  assert.ok(result.visual.paths.length > 0);
  const unknown = depictEntity({ id: 'g', label: 'wibble', kind: 'role' }, 'wibble', rect);
  assert.equal(unknown.family, 'labelled');
});

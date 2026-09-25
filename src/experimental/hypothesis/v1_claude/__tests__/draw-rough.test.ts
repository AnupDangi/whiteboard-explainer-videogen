import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateRoughGeometry, deriveSeed, fnv1aHash} from '../draw/rough-geometry.js';

test('fnv1aHash is a pure, deterministic function of its input string', () => {
  assert.equal(fnv1aHash('hello'), fnv1aHash('hello'));
  assert.notEqual(fnv1aHash('hello'), fnv1aHash('world'));
});

test('deriveSeed is deterministic and varies with elementId', () => {
  const a = deriveSeed('scene-1', 'el-a');
  const b = deriveSeed('scene-1', 'el-a');
  const c = deriveSeed('scene-1', 'el-b');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('same (sceneId, elementId, shape) -> byte-identical RoughGeometry across calls', () => {
  const shape = {kind: 'rectangle' as const, x: 0, y: 0, width: 200, height: 100};
  const g1 = generateRoughGeometry('scene-1', 'box-1', shape);
  const g2 = generateRoughGeometry('scene-1', 'box-1', shape);
  assert.deepEqual(g1, g2);
  assert.ok(g1.paths.length > 0);
  for (const p of g1.paths) {
    assert.equal(typeof p.d, 'string');
    assert.ok(p.d.length > 0);
    assert.equal(typeof p.strokeWidth, 'number');
  }
});

test('different elementId (same scene, same shape) -> different geometry (seed actually varies output)', () => {
  const shape = {kind: 'rectangle' as const, x: 0, y: 0, width: 200, height: 100};
  const g1 = generateRoughGeometry('scene-1', 'box-1', shape);
  const g2 = generateRoughGeometry('scene-1', 'box-2', shape);
  assert.notEqual(g1.seed, g2.seed);
  assert.notDeepEqual(g1.paths, g2.paths);
});

test('different sceneId (same elementId, same shape) -> different geometry', () => {
  const shape = {kind: 'circle' as const, x: 50, y: 50, diameter: 80};
  const g1 = generateRoughGeometry('scene-1', 'el-x', shape);
  const g2 = generateRoughGeometry('scene-2', 'el-x', shape);
  assert.notEqual(g1.seed, g2.seed);
  assert.notDeepEqual(g1.paths, g2.paths);
});

test('circle shape produces geometry', () => {
  const g = generateRoughGeometry('scene-1', 'circ-1', {kind: 'circle', x: 60, y: 60, diameter: 100});
  assert.ok(g.paths.length > 0);
});

test('line shape produces a single-path geometry', () => {
  const g = generateRoughGeometry('scene-1', 'line-1', {kind: 'line', x1: 0, y1: 0, x2: 100, y2: 40});
  assert.ok(g.paths.length > 0);
});

test('arrow shape (two lines + head) produces multiple paths', () => {
  const g = generateRoughGeometry('scene-1', 'arrow-1', {kind: 'arrow', x1: 0, y1: 0, x2: 150, y2: 0});
  // shaft + two head strokes, each roughjs sketch stroke may itself be multiple paths,
  // but there should be at least 3 distinct stroke passes worth of paths.
  assert.ok(g.paths.length >= 3);
});

test('generic path shape (from an SVG path d string) produces geometry', () => {
  const g = generateRoughGeometry('scene-1', 'curve-1', {kind: 'path', d: 'M 0 40 Q 60 0 120 40'});
  assert.ok(g.paths.length > 0);
});

test('repeat generateRoughGeometry calls for the arrow shape are also byte-identical', () => {
  const shape = {kind: 'arrow' as const, x1: 0, y1: 0, x2: 150, y2: 0};
  const g1 = generateRoughGeometry('scene-1', 'arrow-1', shape);
  const g2 = generateRoughGeometry('scene-1', 'arrow-1', shape);
  assert.deepEqual(g1, g2);
});

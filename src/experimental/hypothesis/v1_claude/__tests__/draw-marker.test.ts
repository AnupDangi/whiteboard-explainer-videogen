import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markerAt, pathLength} from '../draw/marker-motion.js';

test('markerAt(d, 0) is (approximately) the path start, for a straight line', () => {
  const d = 'M 0 0 L 100 0';
  const start = markerAt(d, 0);
  assert.ok(Math.abs(start.x - 0) < 1e-6);
  assert.ok(Math.abs(start.y - 0) < 1e-6);
});

test('markerAt(d, 1) is (approximately) the path end, for a straight line', () => {
  const d = 'M 0 0 L 100 0';
  const end = markerAt(d, 1);
  assert.ok(Math.abs(end.x - 100) < 1e-6);
  assert.ok(Math.abs(end.y - 0) < 1e-6);
  // Tangent points along +x for a horizontal line.
  assert.ok(Math.abs(end.angleDeg - 0) < 1e-6);
});

test('markerAt moves monotonically forward along a straight line', () => {
  const d = 'M 0 0 L 200 0';
  const steps = [0, 0.2, 0.4, 0.6, 0.8, 1];
  let lastX = -Infinity;
  for (const t of steps) {
    const p = markerAt(d, t);
    assert.ok(p.x > lastX || t === 0, `expected forward progress at t=${t}`);
    lastX = p.x;
  }
});

test('markerAt is well-behaved at both endpoints for a curved path', () => {
  const d = 'M 0 100 Q 100 0 200 100';
  const start = markerAt(d, 0);
  const end = markerAt(d, 1);
  assert.ok(Math.abs(start.x - 0) < 1e-6);
  assert.ok(Math.abs(start.y - 100) < 1e-6);
  assert.ok(Math.abs(end.x - 200) < 1e-6);
  assert.ok(Math.abs(end.y - 100) < 1e-6);
});

test('markerAt moves monotonically forward (by arc-length progress) along a curved path', () => {
  const d = 'M 0 100 Q 100 0 200 100';
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const points = steps.map((t) => markerAt(d, t));
  // Along this symmetric curve, x should strictly increase with progress.
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].x > points[i - 1].x, `x should increase monotonically at step ${i}`);
  }
});

test('markerAt clamps out-of-range progress to the path endpoints', () => {
  const d = 'M 0 0 L 50 0';
  const below = markerAt(d, -1);
  const above = markerAt(d, 2);
  assert.deepEqual(below, markerAt(d, 0));
  assert.deepEqual(above, markerAt(d, 1));
});

test('markerAt is deterministic across repeat calls', () => {
  const d = 'M 10 10 C 40 -20 80 40 120 10';
  const a = markerAt(d, 0.37);
  const b = markerAt(d, 0.37);
  assert.deepEqual(a, b);
});

test('pathLength matches the geometric length of a simple line', () => {
  const len = pathLength('M 0 0 L 30 40');
  assert.ok(Math.abs(len - 50) < 1e-6); // 3-4-5 triangle scaled
});

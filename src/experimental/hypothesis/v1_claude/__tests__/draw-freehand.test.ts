import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateFreehandGeometry, strokeOutlineToPath} from '../draw/freehand.js';
import type {FreehandGesture} from '../draw/freehand.js';

const BOX = {x: 0, y: 0, w: 200, h: 80};

const GESTURES: FreehandGesture[] = ['underline', 'circle', 'checkmark', 'cross', 'scribble', 'freehand-arrow'];

test('every gesture produces deterministic, repeatable output', () => {
  for (const gesture of GESTURES) {
    const a = generateFreehandGeometry('scene-1', 'el-1', gesture, BOX);
    const b = generateFreehandGeometry('scene-1', 'el-1', gesture, BOX);
    assert.deepEqual(a, b, `gesture ${gesture} should be deterministic`);
  }
});

test('different elementId produces different geometry per gesture (seed actually varies jitter)', () => {
  for (const gesture of GESTURES) {
    const a = generateFreehandGeometry('scene-1', 'el-1', gesture, BOX);
    const b = generateFreehandGeometry('scene-1', 'el-2', gesture, BOX);
    assert.notDeepEqual(a.points, b.points, `gesture ${gesture} should vary with elementId`);
  }
});

test('every gesture produces non-empty raw points with finite coordinates', () => {
  for (const gesture of GESTURES) {
    const geometry = generateFreehandGeometry('scene-1', 'el-1', gesture, BOX);
    assert.ok(geometry.points.length > 0, `gesture ${gesture} should produce points`);
    for (const [x, y, pressure] of geometry.points) {
      assert.ok(Number.isFinite(x));
      assert.ok(Number.isFinite(y));
      if (pressure !== undefined) assert.ok(Number.isFinite(pressure));
    }
  }
});

test('every gesture produces a well-formed outline `d` string with no executable/injection content', () => {
  for (const gesture of GESTURES) {
    const geometry = generateFreehandGeometry('scene-1', 'el-1', gesture, BOX);
    assert.equal(typeof geometry.d, 'string');
    assert.ok(geometry.d.length > 0, `gesture ${gesture} should produce a non-empty d string`);
    assert.match(geometry.d, /^M /, `gesture ${gesture} d string should start with an M command`);
    assert.match(geometry.d, /^[MLCQZ0-9.,\s-]+$/, `gesture ${gesture} d string must be pure path data`);
    assert.doesNotMatch(geometry.d, /<script\b|on\w+\s*=|javascript:/i);
  }
});

test('strokeOutlineToPath handles degenerate outlines without throwing', () => {
  assert.equal(strokeOutlineToPath([]), '');
  const single = strokeOutlineToPath([[1, 2]]);
  assert.match(single, /^M /);
  const two = strokeOutlineToPath([[0, 0], [10, 10]]);
  assert.match(two, /^M /);
});

test('strokeOutlineToPath is deterministic for the same input', () => {
  const outline: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(strokeOutlineToPath(outline), strokeOutlineToPath(outline));
});

test('cross gesture concatenates two diagonal segments into one points array', () => {
  const geometry = generateFreehandGeometry('scene-1', 'el-1', 'cross', BOX);
  // Two segments of 15 points each (steps=14 -> 15 samples) concatenated.
  assert.equal(geometry.points.length, 30);
});

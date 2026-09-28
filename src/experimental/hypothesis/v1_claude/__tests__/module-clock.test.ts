import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModuleSceneClock } from '../pipeline/moduleClock.js';

test('module clock retains narrated time when a middle visual scene is missing', () => {
  const durations = new Map([['first', 1000], ['missing-visual', 2200], ['last', 800]]);
  const result = buildModuleSceneClock(['first', 'missing-visual', 'last'], durations, 200, 200);
  assert.deepEqual(result.intervals, [
    { sceneId: 'first', startMs: 0, endMs: 1000 },
    { sceneId: 'missing-visual', startMs: 1200, endMs: 3400 },
    { sceneId: 'last', startMs: 3600, endMs: 4400 },
  ]);
  assert.equal(result.durationMs, 4600);
});

test('module clock rejects absent narrated audio instead of compressing the lesson', () => {
  assert.throws(() => buildModuleSceneClock(['first', 'missing'], new Map([['first', 1000]]), 200, 0), /Missing narrated audio duration for missing/);
});

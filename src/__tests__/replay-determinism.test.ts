import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash, compareReplayDigests, type ReplayDigest } from '../harness/replayDeterminism.js';

const digest = (over: Partial<ReplayDigest> = {}): ReplayDigest => ({ geometry: 'g', events: 'e', assets: 'a', audio: 'u', frames: 'f', ...over });

test('canonicalHash ignores object key order and distinguishes values', () => {
  assert.equal(canonicalHash({ a: 1, b: { c: [1, 2], d: 'x' } }), canonicalHash({ b: { d: 'x', c: [1, 2] }, a: 1 }));
  assert.notEqual(canonicalHash({ a: 1 }), canonicalHash({ a: 2 }));
  assert.notEqual(canonicalHash([1, 2]), canonicalHash([2, 1]));
});

test('identical replays match on every hash class', () => {
  const result = compareReplayDigests([digest(), digest(), digest()]);
  assert.deepEqual(result, { replays: 3, identical: true, mismatches: [] });
});

test('a drift in any one hash class is named with the replay index', () => {
  const result = compareReplayDigests([digest(), digest({ events: 'e2' }), digest({ frames: 'f2', audio: 'u2' })]);
  assert.equal(result.identical, false);
  assert.deepEqual(result.mismatches, [
    { replay: 1, kind: 'events', expected: 'e', actual: 'e2' },
    { replay: 2, kind: 'audio', expected: 'u', actual: 'u2' },
    { replay: 2, kind: 'frames', expected: 'f', actual: 'f2' },
  ]);
});

test('fewer than two replays cannot prove determinism', () => {
  assert.throws(() => compareReplayDigests([digest()]), /at least two/);
});

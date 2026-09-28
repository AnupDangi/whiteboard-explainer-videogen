import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObject } from '../catalog/ladder.js';
import type { CatalogEntry } from '../catalog/catalog.js';
import { buildNarrationScene } from '../narration/markers.js';
import { alignFixture, alignedWordTimingProblems } from '../narration/align.js';
import { resolveMentions } from '../narration/resolveMentions.js';
import { classifyFailureCode } from '../../shared/failure-taxonomy.js';
import { toNeutralEvents } from '../validation/gates.js';
import { deterministicGates } from '../../shared/evaluation.js';
import { measureBoardScene } from '../harness/boardMetrics.js';
import type { LaidOutScene, Timeline } from '../types.js';

const blankVisual = () => ({ paths: [], fills: [], texts: [] });
const entry = (id: string, names: string[]): CatalogEntry => ({
  id,
  names,
  tags: [],
  meaning: 'test entry',
  source: 'generated',
  license: 'manual',
  lane: 'simple-symbol',
  strokePaths: 1,
  render: blankVisual,
});

test('ladder nextBest mirrors main order: exact-name beats strong embedding after avoid', () => {
  const catalog = [entry('a-test', ['alpha']), entry('b-test', ['beta']), entry('c-test', ['alpha'])];
  const size = { w: 200, h: 200 };
  // Top candidate is weak/missing so best starts as exact 'a-test'; avoiding it
  // must fall through to the other exact ('c-test'), not the strong embedding ('b-test').
  const resolved = resolveObject('alpha', {
    size,
    candidates: [{ id: 'missing', name: 'missing', score: 0.1 }, { id: 'b-test', name: 'beta', score: 0.9 }],
    avoidAssetIds: new Set(['a-test']),
  }, catalog);
  assert.equal(resolved.resolution.assetId, 'c-test');
  assert.equal(resolved.resolution.rung, 2);
});

test('resolveMentions out-of-order fallback never rewinds the cursor', () => {
  const script = {
    schemaVersion: 'claude-narration-script/v1',
    scenes: [buildNarrationScene('s1', 'sec1', '[[b|bravo]] then [[a|alpha]] then [[b2|bravo]]')],
  } as unknown as Parameters<typeof resolveMentions>[0];
  const audio = alignFixture(script, 6000);
  const { mentions, failures } = resolveMentions(script, audio);
  assert.deepEqual(failures, []);
  assert.equal(mentions.length, 3);
  const ranges = mentions.map((m) => m.wordRange);
  // Third mention re-matches "bravo" from the start (out-of-order fallback);
  // cursor must stay at/after the second mention end, so ranges stay ordered.
  assert.ok(ranges[1][1] <= ranges[2][0] || ranges[2][0] >= ranges[0][1]);
  assert.ok(mentions[2].wordRange[0] >= mentions[0].wordRange[1]);
});

test('failure taxonomy routes tiny-element to composition (C)', () => {
  assert.equal(classifyFailureCode('tiny-element'), 'C');
});

test('toNeutralEvents guards a dangling edgeIndex into a dangling-event failure, not a throw', () => {
  const scene = {
    sceneId: 's1',
    elements: [{ id: 'a', element: { id: 'a', prim: 'box', anchor: 'sceneStart' }, bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    edges: [],
  } as unknown as LaidOutScene;
  const timeline = {
    sceneId: 's1',
    sceneStartMs: 0,
    sceneEndMs: 1000,
    events: [{ elementId: 'a->b', track: 'edge', edgeIndex: 7, t0: 0, t1: 100 }],
  } as unknown as Timeline;
  const neutral = toNeutralEvents(scene, timeline);
  assert.equal(neutral.length, 1);
  const failures = deterministicGates({
    elements: [{ id: 's1:a', kind: 'box', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    timeline: neutral,
    durationMs: 1000,
    svg: '<svg></svg>',
  });
  assert.ok(failures.some((f) => f.code === 'dangling-event'), 'expected a dangling-event failure');
});

test('word-clock validation flags overlap even when start order is monotonic', () => {
  const problems = alignedWordTimingProblems([
    { w: 'one', startMs: 0, endMs: 200 },
    { w: 'two', startMs: 150, endMs: 300 },
  ], 500);
  assert.ok(problems.some((p) => p.includes('previous word')));
});

test('board metrics report no outline-then-fill when nothing is revealed', () => {
  const scene = {
    sceneId: 'empty',
    title: 'T',
    template: 'chain',
    elements: [],
    edges: [],
    occupancy: 0,
    carryOver: [],
    focus: [],
  } as unknown as LaidOutScene;
  const timeline: Timeline = { sceneId: 'empty', sceneStartMs: 0, sceneEndMs: 10_000, events: [] };
  assert.equal(measureBoardScene(scene, timeline).outlineThenFill, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  compareBoardMetrics,
  measureBoardScene,
  summarizeBoardMetrics,
} from '../harness/boardMetrics.js';
import type { LaidOutScene, Timeline } from '../types.js';

const el = (id: string, extra: Partial<LaidOutScene['elements'][number]> = {}) => ({
  id,
  element: { id, prim: 'box', slot: 'node', anchor: 'sceneStart' },
  visual: { paths: [], fills: [], texts: [{ x: 0, y: 0, text: 'AB', size: 32, anchor: 'middle' as const }] },
  intrinsicSize: { w: 100, h: 100 },
  strokeLength: 0,
  bbox: { x: 0, y: 0, w: 100, h: 100 },
  ...extra,
});

const timelineFor = (scene: LaidOutScene, tracks: Array<{ id: string; track: Timeline['events'][number]['track']; t0: number; t1: number }>): Timeline => ({
  sceneId: scene.sceneId,
  sceneStartMs: 0,
  sceneEndMs: 18_500,
  events: tracks.map((t) => ({
    elementId: t.id,
    track: t.track,
    t0: t.t0,
    t1: t.t1,
    ...(t.track === 'stroke' ? { phases: { strokeMs: 300, fillMs: 250, textMs: 200 } } : {}),
  })),
});

test('three-node board: nodes, reveals, occupancy, edges, text floor all measured', () => {
  const scene = {
    sceneId: 's1',
    title: 'T',
    template: 'chain',
    elements: [el('a'), el('b'), el('c')],
    edges: [{ from: 'a', to: 'b', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
    occupancy: 0.55,
    carryOver: [],
    focus: [],
  } as unknown as LaidOutScene;
  const timeline = timelineFor(scene, [
    { id: 'a', track: 'stroke', t0: 0, t1: 750 },
    { id: 'b', track: 'stroke', t0: 800, t1: 1550 },
    { id: 'c', track: 'stroke', t0: 1600, t1: 2350 },
  ]);
  const m = measureBoardScene(scene, timeline);
  assert.equal(m.elementCount, 3);
  assert.equal(m.revealCount, 3);
  assert.equal(m.edgeCount, 1);
  assert.equal(m.occupancy, 0.55);
  assert.equal(m.minRenderedTextPx, 32);
  assert.equal(m.minReadableTextViolation, false);
  assert.equal(m.boardTooSparse, false);
  assert.equal(m.outlineThenFill, true);
});

test('empty board reports zeros and the sparse floor, never NaN', () => {
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
  const m = measureBoardScene(scene, timeline);
  assert.equal(m.elementCount, 0);
  assert.equal(m.revealCount, 0);
  assert.equal(m.minRenderedTextPx, null);
  // Donor gate is occupancy < sparse && elements > 0, so an empty board is
  // not "too sparse" (nothing to fix) while the belowSparse floor still fires.
  assert.equal(m.boardTooSparse, false);
  assert.equal(m.belowSparse, true);
  const summary = summarizeBoardMetrics([m]);
  assert.equal(summary.scenes, 1);
  for (const v of [summary.meanElements, summary.meanReveals, summary.meanOccupancy]) assert.ok(Number.isFinite(v));
});

test('fallback, dedup and floor signals are structural only', () => {
  const scene = {
    sceneId: 's2',
    title: 'T',
    template: 'chain',
    elements: [
      el('a', { element: { id: 'a', prim: 'object', slot: 'node', anchor: 'sceneStart', concept: 'alpha' }, resolution: { rung: 4, assetId: null, score: 0, license: 'manual', lane: 'text-fallback', source: 'generated' } }),
      el('b', { element: { id: 'b', prim: 'object', slot: 'node', anchor: 'sceneStart', concept: 'beta' }, resolution: { rung: 2, assetId: 'lib:alpha', score: 0.9, license: 'manual', lane: 'simple-symbol', source: 'catalog' } }),
      el('c', { element: { id: 'c', prim: 'object', slot: 'node', anchor: 'sceneStart', concept: 'gamma' }, resolution: { rung: 2, assetId: 'lib:alpha', score: 0.9, license: 'manual', lane: 'simple-symbol', source: 'catalog' } }),
    ],
    edges: [],
    occupancy: 0.05,
    carryOver: ['a'],
    focus: [],
  } as unknown as LaidOutScene;
  const timeline = timelineFor(scene, [{ id: 'a', track: 'wipe', t0: 0, t1: 200 }]);
  const m = measureBoardScene(scene, timeline);
  assert.equal(m.textFallbackCount, 1);
  assert.ok(Math.abs(m.textFallbackShare - 1 / 3) < 1e-9);
  assert.equal(m.repeatedAssetCount, 1);
  assert.equal(m.carryOverCount, 1);
  assert.equal(m.boardTooSparse, true);
});

test('summary medians and compare deltas read the frozen reference band', async () => {
  const refPath = path.resolve('harness/reference/lamina/metrics.v1.json');
  const ref = JSON.parse(await readFile(refPath, 'utf8'));
  assert.equal(ref.schemaVersion, 'lamina-board-metrics/v1');
  assert.equal(ref.sceneCount, 33);
  assert.equal(ref.sceneDurationSec.median, 18.5);
  assert.deepEqual(ref.boardCoverageBand, { min: 0.5, max: 0.7 });
  const rows = [0.4, 0.55, 0.6].map((occupancy, i) =>
    measureBoardScene(
      { sceneId: `s${i}`, title: 'T', template: 'chain', elements: [el('a'), el('b'), el('c')], edges: [], occupancy, carryOver: [], focus: [] } as unknown as LaidOutScene,
      timelineFor({ sceneId: `s${i}` } as LaidOutScene, [
        { id: 'a', track: 'stroke', t0: 0, t1: 100 },
        { id: 'b', track: 'stroke', t0: 200, t1: 300 },
        { id: 'c', track: 'stroke', t0: 400, t1: 500 },
        { id: 'd', track: 'stroke', t0: 600, t1: 700 },
        { id: 'e', track: 'stroke', t0: 800, t1: 900 },
        { id: 'f', track: 'stroke', t0: 1000, t1: 1100 },
      ]),
    ),
  );
  const summary = summarizeBoardMetrics(rows);
  assert.equal(summary.medianOccupancy, 0.55);
  assert.equal(summary.medianReveals, 6);
  const deltas = compareBoardMetrics(summary, ref);
  assert.equal(deltas.occupancyMedianGapToBand, 0);
  assert.equal(deltas.revealsMedianGapToBand, 0);
});

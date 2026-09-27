import test from 'node:test';
import assert from 'node:assert/strict';
import { allCatalogEntries } from '../catalog/semantic.js';
import { resolveScene, previousSceneIcons } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { runClaudeGates, MIN_ELEMENT_SCALE } from '../validation/gates.js';
import { fitEdgeLabels, edgeLabelAnchor } from '../layout/edges.js';
import { measureTextWidth } from '../layout/measure.js';
import { STYLE } from '../style.js';
import type { RoutedEdge, SceneSpec } from '../types.js';

// Synthetic code-contract inputs only: abstract tokens, never lesson content,
// and the results are never used as visual-quality evidence.

// --- (a) cross-scene dedup -------------------------------------------------

const entries = allCatalogEntries();
const FIRST = entries[0];
const SECOND = entries[1];

const objectSpec = (sceneId: string, concept: string): SceneSpec =>
  ({
    schemaVersion: 'claude-scene-spec/v1',
    sceneId,
    title: 'T',
    template: 'list_icon',
    elements: [
      { id: 'a', prim: 'object', slot: 'item', anchor: 'sceneStart', concept, label: 'A' },
      { id: 'b', prim: 'box', slot: 'item', anchor: 'sceneStart', text: 'B' },
    ],
    edges: [],
  }) as SceneSpec;

// Both concepts share the same ranked candidates, so without dedup they would
// resolve to the same icon — the contact-sheet repetition defect.
const sharedCandidates = () =>
  new Map([
    ['qx alpha', [{ id: FIRST.id, name: FIRST.names[0], score: 0.9 }, { id: SECOND.id, name: SECOND.names[0], score: 0.8 }]],
    ['qx beta', [{ id: FIRST.id, name: FIRST.names[0], score: 0.9 }, { id: SECOND.id, name: SECOND.names[0], score: 0.8 }]],
  ]);

test('consecutive scenes with different concepts do not repeat the same icon, deterministically', () => {
  const first = resolveScene(objectSpec('s1', 'qx alpha'), { candidates: sharedCandidates() });
  assert.equal(first.elements[0].resolution?.assetId, FIRST.id);
  const prev = previousSceneIcons(first);
  const opts = { candidates: sharedCandidates(), previousIcons: prev };
  const second = resolveScene(objectSpec('s2', 'qx beta'), opts);
  assert.notEqual(second.elements[0].resolution?.assetId, first.elements[0].resolution?.assetId);
  assert.equal(second.elements[0].resolution?.assetId, SECOND.id);
  // Deterministic: the same inputs always pick the same alternate.
  const again = resolveScene(objectSpec('s2', 'qx beta'), opts);
  assert.equal(again.elements[0].resolution?.assetId, second.elements[0].resolution?.assetId);
  assert.equal(again.elements[0].resolution?.rung, second.elements[0].resolution?.rung);
});

test('the same concept across scenes keeps its icon (consistency, not deduped away)', () => {
  const first = resolveScene(objectSpec('s1', 'qx alpha'), { candidates: sharedCandidates() });
  const prev = previousSceneIcons(first);
  const repeat = resolveScene(objectSpec('s2', 'qx alpha'), { candidates: sharedCandidates(), previousIcons: prev });
  assert.equal(repeat.elements[0].resolution?.assetId, first.elements[0].resolution?.assetId);
});

// --- (b) small-element floor -------------------------------------------------

const pairSpec = (): SceneSpec =>
  ({
    schemaVersion: 'claude-scene-spec/v1',
    sceneId: 'pair',
    title: 'Pair',
    template: 'compare_2',
    elements: [
      { id: 'left', prim: 'box', slot: 'left', anchor: 'sceneStart', text: 'left box' },
      { id: 'right', prim: 'box', slot: 'right', anchor: 'sceneStart', text: 'right box' },
    ],
    edges: [],
  }) as SceneSpec;

test('a normally laid-out scene passes the element-size floor; an over-shrunk element fails hard', () => {
  const scene = layoutScene(resolveScene(pairSpec()));
  const timeline = compileTimelineFull(scene, [], 0, 12_000);
  assert.deepEqual(
    runClaudeGates(scene, timeline).failures.filter((f) => f.code === 'tiny-element'),
    [],
  );
  const shrunk = {
    ...scene,
    elements: scene.elements.map((el, i) =>
      i === 0
        ? { ...el, bbox: { x: el.bbox.x, y: el.bbox.y, w: el.intrinsicSize.w * 0.3, h: el.intrinsicSize.h * 0.3 } }
        : el,
    ),
  };
  const failures = runClaudeGates(shrunk, timeline).failures;
  assert.ok(failures.some((f) => f.code === 'tiny-element' && f.hard), 'over-shrunk content fails visibly instead of rendering tiny');
});

test('exactly the readable floor still passes', () => {
  const scene = layoutScene(resolveScene(pairSpec()));
  const timeline = compileTimelineFull(scene, [], 0, 12_000);
  const atFloor = {
    ...scene,
    elements: scene.elements.map((el, i) =>
      i === 0
        ? { ...el, bbox: { x: el.bbox.x, y: el.bbox.y, w: el.intrinsicSize.w * MIN_ELEMENT_SCALE, h: el.intrinsicSize.h * MIN_ELEMENT_SCALE } }
        : el,
    ),
  };
  assert.deepEqual(
    runClaudeGates(atFloor, timeline).failures.filter((f) => f.code === 'tiny-element'),
    [],
  );
});

// --- (c) edge-label clipping ---------------------------------------------------

const W = STYLE.canvas.w;
const H = STYLE.canvas.h;
const SAFE = STYLE.canvas.safe;
const NOTE = STYLE.font.sizes.note;

const labelBox = (edge: RoutedEdge): { x: number; y: number; w: number; h: number } => {
  const width = measureTextWidth(edge.label!, NOTE);
  return { x: edge.labelPos!.x - width / 2, y: edge.labelPos!.y - NOTE, w: width, h: NOTE + 8 };
};

const insideSafe = (box: { x: number; y: number; w: number; h: number }): boolean =>
  box.x >= SAFE - 0.5 && box.y >= SAFE - 0.5 && box.x + box.w <= W - SAFE + 0.5 && box.y + box.h <= H - SAFE + 0.5;

test('edge label at the frame edge (observed FEED case) is fitted inside the safe area', () => {
  // Shape of the observed defect: a short label whose default anchor sits at
  // the frame edge, so its ink renders past it.
  const edge: RoutedEdge = { from: 'a', to: 'b', label: 'FEED', points: [{ x: W - SAFE - 10, y: H / 2 }, { x: W - SAFE - 2, y: H / 2 }] };
  const [fitted] = fitEdgeLabels([edge]);
  assert.ok(fitted.labelPos, 'fitted edge carries a label anchor');
  assert.ok(insideSafe(labelBox(fitted)), `label ink stays inside the safe area: ${JSON.stringify(labelBox(fitted))}`);
  assert.deepEqual(fitEdgeLabels([edge])[0], fitted, 'fitting is deterministic');
});

test('an over-wide edge label is shortened to the safe width, never clipped', () => {
  const edge: RoutedEdge = {
    from: 'a',
    to: 'b',
    label: 'A VERY LONG EDGE LABEL THAT CANNOT FIT ON ONE BOARD',
    points: [{ x: W - 300, y: H - 200 }, { x: W - SAFE - 2, y: H - 200 }],
  };
  const [fitted] = fitEdgeLabels([edge]);
  assert.ok(fitted.label, 'a shortened label survives');
  assert.ok(measureTextWidth(fitted.label, NOTE) <= W - 2 * SAFE);
  assert.ok(insideSafe(labelBox(fitted)));
});

test('a centered edge label keeps the default anchor (no gratuitous moves)', () => {
  const edge: RoutedEdge = { from: 'a', to: 'b', label: 'OK', points: [{ x: 400, y: 500 }, { x: 800, y: 500 }] };
  const [fitted] = fitEdgeLabels([edge]);
  assert.deepEqual(fitted.labelPos, edgeLabelAnchor(edge.points));
});

test('laid-out edge labels land inside the safe area end to end', () => {
  const spec: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1',
    sceneId: 'edges',
    title: 'Edges',
    template: 'chain',
    elements: [
      { id: 'n1', prim: 'box', anchor: 'sceneStart', text: 'first node' },
      { id: 'n2', prim: 'box', anchor: 'sceneStart', text: 'second node' },
    ],
    edges: [{ from: 'n1', to: 'n2', label: 'FEED' }],
  } as SceneSpec;
  const scene = layoutScene(resolveScene(spec));
  for (const edge of scene.edges) {
    if (!edge.label) continue;
    assert.ok(edge.labelPos, 'layout assigns every edge label an anchor');
    assert.ok(insideSafe(labelBox(edge)), `${edge.from}->${edge.to} label stays inside the safe area`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { BBox, SceneSpec } from '../types.js';
import { MIN_READABLE_FONT_PX, STYLE } from '../style.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { runClaudeGates } from '../validation/gates.js';

const overlaps = (a: BBox, b: BBox): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function crossesBox(a: { x: number; y: number }, b: { x: number; y: number }, box: BBox): boolean {
  // Clip a segment against a box inset by a small epsilon. Touching a border
  // is allowed; passing through label space is not.
  let start = 0;
  let end = 1;
  for (const axis of ['x', 'y'] as const) {
    const low = box[axis] + 0.01;
    const high = box[axis] + (axis === 'x' ? box.w : box.h) - 0.01;
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) {
      if (a[axis] <= low || a[axis] >= high) return false;
    } else {
      const t0 = (low - a[axis]) / d;
      const t1 = (high - a[axis]) / d;
      start = Math.max(start, Math.min(t0, t1));
      end = Math.min(end, Math.max(t0, t1));
    }
  }
  return start < end && end > 0 && start < 1;
}

test('a source with six box targets keeps labels readable without overlap or overflow', () => {
  const targets = Array.from({ length: 6 }, (_, i) => ({
    id: `target-${i + 1}`, slot: 'target', anchor: 'sceneStart' as const,
    prim: 'box' as const, text: `red cell ${i + 1}`,
  }));
  const spec: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'dense-fan-out', title: 'Cells', template: 'fan_out',
    elements: [{ id: 'source', slot: 'source', anchor: 'sceneStart', prim: 'box', text: 'red cell' }, ...targets],
    edges: targets.map(({ id }) => ({ from: 'source', to: id })),
  };
  const scene = layoutScene(resolveScene(spec));
  const safe = STYLE.canvas.safe;
  for (const element of scene.elements) {
    const { bbox } = element;
    assert.ok(bbox.x >= safe - 0.01 && bbox.y >= safe - 0.01 && bbox.x + bbox.w <= STYLE.canvas.w - safe + 0.01 && bbox.y + bbox.h <= STYLE.canvas.h - safe + 0.01, `${element.id} leaves the safe area`);
    const renderedSize = element.visual.texts[0]?.size * bbox.h / element.intrinsicSize.h;
    assert.ok(renderedSize >= MIN_READABLE_FONT_PX, `${element.id} text shrank to ${renderedSize}px`);
  }
  for (let i = 0; i < scene.elements.length; i++) {
    for (let j = i + 1; j < scene.elements.length; j++) {
      assert.ok(!overlaps(scene.elements[i].bbox, scene.elements[j].bbox), `${scene.elements[i].id} overlaps ${scene.elements[j].id}`);
    }
  }
  assert.equal(scene.edges.length, targets.length);
  for (const edge of scene.edges) {
    for (let i = 0; i < edge.points.length - 1; i++) {
      for (const element of scene.elements) {
        assert.ok(!crossesBox(edge.points[i], edge.points[i + 1], element.bbox), `${edge.from}->${edge.to} cuts through ${element.id}`);
      }
    }
  }
  assert.ok(new Set(scene.elements.filter(({ element }) => element.slot === 'target').map(({ bbox }) => Math.round(bbox.x))).size > 1, 'dense targets should use more than one column');

  const timeline = compileTimelineFull(scene, [], 0, 12000);
  assert.ok(!runClaudeGates(scene, timeline).failures.some(({ code }) => code === 'edge-route-missing' || code === 'edge-through-node'));
  const missing = structuredClone(scene);
  missing.edges[0].points = [];
  assert.ok(runClaudeGates(missing, timeline).failures.some(({ code, hard }) => code === 'edge-route-missing' && hard));
  const crossing = structuredClone(scene);
  const blocked = crossing.elements.find(({ id }) => id === 'target-3')!.bbox;
  crossing.edges[0].points = [
    { x: blocked.x - 10, y: blocked.y + blocked.h / 2 },
    { x: blocked.x + blocked.w + 10, y: blocked.y + blocked.h / 2 },
  ];
  assert.ok(runClaudeGates(crossing, timeline).failures.some(({ code, hard }) => code === 'edge-through-node' && hard));
});

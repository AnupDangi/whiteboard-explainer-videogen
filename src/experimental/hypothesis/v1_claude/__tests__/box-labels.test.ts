import test from 'node:test';
import assert from 'node:assert/strict';
import type { BBox, Element, SceneSpec } from '../types.js';
import { MIN_READABLE_FONT_PX, STYLE } from '../style.js';
import { BOX_MAX_ONE_LINE_W, LINE_H, boxLabelLines, measureElement, measureTextWidth } from '../layout/measure.js';
import { renderPrimitive } from '../render/primitives.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { runClaudeGates } from '../validation/gates.js';

// Synthetic code-contract inputs only: these labels are arbitrary strings, not
// lesson content, and the results are never used as visual-quality evidence.
const box = (id: string, text: string, slot: string): Element & { slot: string } => ({ id, slot, anchor: 'sceneStart', prim: 'box', text });

test('box labels stay on one line unless one line is too wide, and layout and render agree', () => {
  const body = STYLE.font.sizes.body;
  for (const text of ['red cell', 'option a', 'x']) {
    assert.deepEqual(boxLabelLines(text, body), [text], `${text} should not wrap`);
    assert.equal(measureElement(box('a', text, 'item')).h, STYLE.element.boxMinH);
  }
  const long = 'mitochondrial electron transport';
  const lines = boxLabelLines(long, body);
  assert.equal(lines.length, 2);
  assert.equal(lines.join(' '), long, 'wrapping never drops or rewrites words');
  const size = measureElement(box('b', long, 'item'));
  assert.equal(size.h, STYLE.element.boxMinH + LINE_H.body);
  const oneLineW = measureTextWidth(long, body) + 40;
  assert.ok(oneLineW > BOX_MAX_ONE_LINE_W, 'fixture label is wide enough to require wrapping');
  assert.ok(size.w < oneLineW, 'the wrapped box is narrower than the same label on one line');
  const rendered = renderPrimitive(box('b', long, 'item'), size);
  assert.equal(rendered.texts.length, 2, 'renderer draws the same two lines the layout sized for');
  assert.ok(rendered.texts.every((run) => run.size === body), 'wrapping never reduces font size');
});

test('a wrapped label that ends in one round digit remains measurable', () => {
  for (const digit of ['3', '6', '8']) {
    const label = `ELECTROMAGNETISM ${digit}`;
    assert.deepEqual(boxLabelLines(label, STYLE.font.sizes.body), ['ELECTROMAGNETISM', digit]);
    assert.doesNotThrow(() => measureElement(box(`d${digit}`, label, 'item')));
  }
});

function segmentCrossesBox(a: { x: number; y: number }, b: { x: number; y: number }, r: BBox): boolean {
  // Liang-Barsky clip against the box shrunk by 1px: touching a border is allowed.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - (r.x + 1)], [dx, r.x + r.w - 1 - a.x], [-dy, a.y - (r.y + 1)], [dy, r.y + r.h - 1 - a.y]] as const) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function fanOut(source: string, targets: string[]): SceneSpec {
  const nodes = targets.map((text, i) => box(`t${i + 1}`, text, 'target'));
  return {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'dense', title: 'Dense board', template: 'fan_out',
    elements: [box('src', source, 'source'), ...nodes],
    edges: nodes.map(({ id }) => ({ from: 'src', to: id })),
  } as SceneSpec;
}

// Two unrelated vocabularies through the same template: the geometry must not
// depend on which topic supplied the labels.
const TOPICS: Array<{ source: string; target: (i: number) => string }> = [
  { source: 'red cell', target: (i) => `red cell ${i}` },
  { source: 'tax policy', target: (i) => `bracket ${i} revenue` },
];

for (const topic of TOPICS) {
  for (const count of [3, 4, 5, 6, 7, 8]) {
    test(`fan_out with ${count} box targets (${topic.source}) keeps text readable, inside the safe area, without overlap or arrows through nodes`, () => {
      const scene = layoutScene(resolveScene(fanOut(topic.source, Array.from({ length: count }, (_, i) => topic.target(i + 1)))));
      const safe = STYLE.canvas.safe;
      for (const el of scene.elements) {
        const { bbox } = el;
        assert.ok(bbox.x >= safe - 0.5 && bbox.y >= safe - 0.5 && bbox.x + bbox.w <= STYLE.canvas.w - safe + 0.5 && bbox.y + bbox.h <= STYLE.canvas.h - safe + 0.5, `${el.id} leaves the safe area`);
        for (const run of el.visual.texts) {
          const px = run.size * bbox.h / el.intrinsicSize.h;
          assert.ok(px >= MIN_READABLE_FONT_PX, `${el.id} text renders at ${px.toFixed(1)}px`);
        }
      }
      for (let i = 0; i < scene.elements.length; i++) {
        for (let j = i + 1; j < scene.elements.length; j++) {
          const a = scene.elements[i].bbox;
          const b = scene.elements[j].bbox;
          assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), `${scene.elements[i].id} overlaps ${scene.elements[j].id}`);
        }
      }
      assert.equal(scene.edges.length, count);
      for (const edge of scene.edges) {
        assert.ok(edge.points.length >= 2, `${edge.from}->${edge.to} was not routed`);
        for (const el of scene.elements) {
          if (el.id === edge.from || el.id === edge.to) continue;
          for (let k = 1; k < edge.points.length; k++) assert.ok(!segmentCrossesBox(edge.points[k - 1], edge.points[k], el.bbox), `${edge.from}->${edge.to} crosses ${el.id}`);
        }
      }
      const failures = runClaudeGates(scene, compileTimelineFull(scene, [], 0, 12_000)).failures;
      assert.deepEqual(failures.filter((f) => f.code === 'min-readable-text'), []);
    });
  }
}

test('a fan_out that fits at native size keeps the column layout', () => {
  const scene = layoutScene(resolveScene(fanOut('source', ['first', 'second', 'third'])));
  const targetXs = new Set(scene.elements.filter((el) => el.id !== 'src').map((el) => Math.round(el.bbox.x + el.bbox.w / 2)));
  assert.equal(targetXs.size, 1, 'three short targets stay in one column to the right of the source');
  const src = scene.elements.find((el) => el.id === 'src')!.bbox;
  assert.ok(scene.elements.filter((el) => el.id !== 'src').every((el) => el.bbox.x > src.x + src.w));
});

function stack(labels: string[]): SceneSpec {
  const layers = labels.map((text, i) => box(`l${i + 1}`, text, 'layer'));
  return {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'stack', title: 'Stack', template: 'layered_stack',
    elements: layers, edges: layers.slice(1).map(({ id }, i) => ({ from: layers[i].id, to: id })),
  } as SceneSpec;
}

const minRenderedPx = (scene: ReturnType<typeof layoutScene>): number =>
  Math.min(...scene.elements.flatMap((el) => el.visual.texts.map((run) => run.size * el.bbox.h / el.intrinsicSize.h)));

for (const words of [['layer'], ['physical', 'medium']]) {
  for (const count of [3, 4, 5, 6, 7]) {
    test(`layered_stack with ${count} layers (${words.join(' ')}) keeps text at or above the readable floor`, () => {
      const scene = layoutScene(resolveScene(stack(Array.from({ length: count }, (_, i) => `${words.join(' ')} ${i + 1}`))));
      assert.ok(minRenderedPx(scene) >= MIN_READABLE_FONT_PX, `text renders at ${minRenderedPx(scene).toFixed(1)}px`);
      const ys = scene.elements.map((el) => el.bbox.y);
      assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'layers keep their top-to-bottom order');
    });
  }
}

test('a stack too tall to read still reports a hard readability failure instead of passing', () => {
  const scene = layoutScene(resolveScene(stack(Array.from({ length: 9 }, (_, i) => `layer ${i + 1}`))));
  assert.ok(minRenderedPx(scene) < MIN_READABLE_FONT_PX);
  const failures = runClaudeGates(scene, compileTimelineFull(scene, [], 0, 12_000)).failures;
  assert.ok(failures.some((f) => f.code === 'min-readable-text' && f.hard));
});

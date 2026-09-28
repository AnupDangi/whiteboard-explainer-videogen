import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneSpec } from '../types.js';
import { MIN_READABLE_FONT_PX, STYLE } from '../style.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { runClaudeGates } from '../validation/gates.js';

// Dense-object hub_spoke boards from a 10-minute run: 3- and 5-node radial
// boards of icon+label objects shrank to 31.3-31.4px (14 min-readable-text
// hard failures) because hub_spoke had no dense variant — circleLayout's ring
// overshoots the working rect by ~2% and the solver's shrink-to-fit fallback
// scaled everything just below the floor. Tall icon+label objects (not short
// boxes) are the trigger, so these fixtures use object prims with nonsense
// concepts (rung-4 text fallback, object-sized intrinsics). Concept strings
// are arbitrary tokens, never lesson content.

const obj = (id: string, slot: string, concept: string): SceneSpec['elements'][number] =>
  ({ id, slot, anchor: 'sceneStart', prim: 'object', concept, label: concept }) as SceneSpec['elements'][number];

function hubSpoke(concepts: string[], hubIndex: number): SceneSpec {
  return {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'hub-dense', title: 'Dense hub', template: 'hub_spoke',
    elements: concepts.map((concept, i) => obj(`n${i + 1}`, i === hubIndex ? 'hub' : 'spoke', concept)),
    edges: concepts.flatMap((_, i) => (i === hubIndex ? [] : [{ from: `n${hubIndex + 1}`, to: `n${i + 1}` }])),
  } as SceneSpec;
}

const minRenderedPx = (scene: ReturnType<typeof layoutScene>): number =>
  Math.min(...scene.elements.flatMap((el) => el.visual.texts.map((run) => run.size * el.bbox.h / el.intrinsicSize.h)));

function checkFits(scene: ReturnType<typeof layoutScene>, what: string): void {
  const safe = STYLE.canvas.safe;
  for (const el of scene.elements) {
    const { bbox } = el;
    assert.ok(bbox.x >= safe - 0.5 && bbox.y >= safe - 0.5 && bbox.x + bbox.w <= STYLE.canvas.w - safe + 0.5 && bbox.y + bbox.h <= STYLE.canvas.h - safe + 0.5, `${what}: ${el.id} leaves the safe area`);
  }
  for (let i = 0; i < scene.elements.length; i++) {
    for (let j = i + 1; j < scene.elements.length; j++) {
      const a = scene.elements[i]!.bbox;
      const b = scene.elements[j]!.bbox;
      assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), `${what}: ${scene.elements[i]!.id} overlaps ${scene.elements[j]!.id}`);
    }
  }
  assert.ok(minRenderedPx(scene) >= MIN_READABLE_FONT_PX, `${what}: text renders at ${minRenderedPx(scene).toFixed(1)}px`);
  const failures = runClaudeGates(scene, compileTimelineFull(scene, [], 0, 12_000)).failures;
  assert.deepEqual(failures.filter((f) => f.code === 'min-readable-text'), [], `${what}: no min-readable-text failures`);
}

// Two unrelated vocabularies through the same geometry: the fix must not
// depend on which words supplied the labels.
const VOCABS: string[][] = [
  ['qzxw alpha mechanism one', 'qzxw beta mechanism two', 'qzxw gamma mechanism three'],
  ['qzxw delta widget four', 'qzxw epsilon widget five', 'qzxw zeta widget six'],
];

for (const vocab of VOCABS) {
  test(`dense 3-object hub_spoke (${vocab[0]!.split(' ')[1]}) keeps text readable without shrinking below the floor`, () => {
    const scene = layoutScene(resolveScene(hubSpoke(vocab, 2)));
    checkFits(scene, '3-object hub_spoke');
  });
}

test('dense 5-object hub_spoke keeps text readable', () => {
  const spec = hubSpoke(
    ['qzxw alpha mechanism one', 'qzxw beta mechanism two', 'qzxw gamma mechanism three', 'qzxw delta mechanism four', 'qzxw epsilon mechanism five'],
    2,
  );
  const scene = layoutScene(resolveScene(spec));
  checkFits(scene, '5-object hub_spoke');
});

test('a hub_spoke too dense to read still reports a hard readability failure instead of passing', () => {
  const concepts = Array.from({ length: 9 }, (_, i) => `qzxw dense overflow concept number ${i + 1}`);
  const scene = layoutScene(resolveScene(hubSpoke(concepts, 0)));
  assert.ok(minRenderedPx(scene) < MIN_READABLE_FONT_PX, 'genuinely oversized content still shrinks below the floor');
  const failures = runClaudeGates(scene, compileTimelineFull(scene, [], 0, 12_000)).failures;
  assert.ok(failures.some((f) => f.code === 'min-readable-text' && f.hard), 'oversized boards fail loudly instead of rendering tiny');
});

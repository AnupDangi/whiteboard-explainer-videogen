import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { ROUGH_PROFILE_VERSION, roughenPath } from '../render/roughAdapter.js';
import type { SceneSpec } from '../shared/types.js';

const spec: SceneSpec = {
  schemaVersion: 'claude-scene-spec/v1', sceneId: 'rough-scene', title: 'Seeded Path', template: 'chain',
  elements: [
    { id: 'first', anchor: 'mention:first', prim: 'box', text: 'First' },
    { id: 'second', anchor: 'mention:second', prim: 'box', text: 'Second' },
  ],
  edges: [{ from: 'first', to: 'second', label: 'leads to' }],
};

test('Rough.js converts path geometry once with stable, distinct seeds', () => {
  const path = { d: 'M 0 0 H 100 V 60 H 0 Z', length: 320 };
  const a = roughenPath(path, 771)[0]!;
  const b = roughenPath(path, 771)[0]!;
  const c = roughenPath(path, 772)[0]!;
  assert.deepEqual(a, b);
  assert.notEqual(a.d, path.d);
  assert.notEqual(c.d, a.d);
  assert.ok(a.length > 0);
  assert.equal(a.roughSeed, 771);
  assert.equal(a.roughProfileVersion, ROUGH_PROFILE_VERSION);
});

test('S8 stores seeded element and edge paths in deterministic layout geometry', () => {
  const resolved = resolveScene(spec);
  const first = layoutScene(resolved, { lessonId: 'lesson-a' });
  const repeat = layoutScene(resolved, { lessonId: 'lesson-a' });
  const otherLesson = layoutScene(resolved, { lessonId: 'lesson-b' });
  assert.deepEqual(first, repeat);
  assert.ok(first.elements.flatMap((element) => element.visual.paths).every((path) => path.roughSeed && path.roughProfileVersion === ROUGH_PROFILE_VERSION));
  assert.ok(first.edges.every((edge) => edge.roughPath?.roughSeed && edge.roughPath.roughProfileVersion === ROUGH_PROFILE_VERSION));
  assert.notDeepEqual(first.elements[0]?.visual.paths, otherLesson.elements[0]?.visual.paths);
});

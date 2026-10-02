import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import type { SceneSpec } from '../shared/types.js';

// final_plan/04 §32.
const spec = (elements: SceneSpec['elements']): SceneSpec => ({ schemaVersion: 'claude-scene-spec/v1', sceneId: 'r', title: 'Rough', template: 'chain', elements, edges: [] });

test('math elements bypass roughification (paths stay exact, no seed)', () => {
  const laid = layoutScene(resolveScene(spec([{ id: 'f', anchor: 'sceneStart', prim: 'formula', latex: 'x^2+1' } as SceneSpec['elements'][number]])), { lessonId: 'l' });
  const paths = laid.elements[0]!.visual.paths;
  assert.ok(paths.every((path) => path.roughSeed === undefined));
});

test('hand-drawn primitives carry a seed derived only from versions and ids', () => {
  const a = layoutScene(resolveScene(spec([{ id: 'b', anchor: 'sceneStart', prim: 'box', text: 'Box' }])), { lessonId: 'l' });
  const b = layoutScene(resolveScene(spec([{ id: 'b', anchor: 'sceneStart', prim: 'box', text: 'Box' }])), { lessonId: 'l' });
  assert.deepEqual(a.elements[0]!.visual.paths, b.elements[0]!.visual.paths);
});

test('the Rough adapter never reads randomness or the clock', () => {
  const source = readFileSync('src/render/roughAdapter.ts', 'utf8');
  assert.doesNotMatch(source, /Math\.random|Date\.now|new Date\(|performance\.now|crypto\.randomUUID/);
});

test('render-time code never invokes Rough.js', () => {
  const renderer = readFileSync('src/render/renderScene.ts', 'utf8');
  assert.doesNotMatch(renderer, /roughAdapter|roughjs/);
});

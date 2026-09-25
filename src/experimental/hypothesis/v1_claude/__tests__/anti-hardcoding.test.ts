import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneSpec } from '../types.js';
import { resolveScene } from '../resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';

function renderFromSceneData(topic: string, labels: [string, string], values: [number, number]): string {
  const spec: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'generic_comparison', title: topic,
    template: 'compare_2',
    elements: [
      { id: 'left', slot: 'left', anchor: 'sceneStart', prim: 'box', text: labels[0], fill: 'blue' },
      { id: 'right', slot: 'right', anchor: 'sceneStart', prim: 'meter', values, labels, fill: 'orange' },
    ],
    edges: [],
  };
  const layout = layoutScene(resolveScene(spec));
  const timeline = compileTimelineFull(layout, [], 0, 10_000);
  return renderSVG(layout, timeline, 9_999);
}

test('one generic template follows changed topic, labels, and numeric data without retaining old facts', () => {
  const first = renderFromSceneData('Signal routing', ['QUERY', 'KEY'], [0.2, 0.8]);
  const changed = renderFromSceneData('Plant growth', ['ROOT', 'LEAF'], [0.7, 0.3]);

  assert.notEqual(first, changed);
  assert.match(first, /SIGNAL ROUTING/);
  assert.match(changed, /PLANT GROWTH/);
  assert.match(changed, /ROOT/);
  assert.match(changed, /LEAF/);
  assert.doesNotMatch(changed, /QUERY|KEY/);
  assert.doesNotMatch(changed, /0\.2|0\.8/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneSpec } from '../shared/types.js';
import { resolveScene } from '../assets/resolveScene.js';
import { layoutScene } from '../layout/solver.js';
import { MIN_READABLE_FONT_PX } from '../render/style.js';

test('formula_focus wraps many callouts into rows instead of shrinking text below the readable floor', () => {
  const texts = ['Known sides', 'Missing side', 'Square each', 'Add them up', 'Take the root', 'Check result'];
  const spec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'ff', title: 'Wrap', template: 'formula_focus',
    elements: [
      { id: 'f1', slot: 'formula', anchor: 'sceneStart', prim: 'formula', latex: 'a^2 + b^2 = c^2' },
      ...texts.map((text, index) => ({ id: `c${index + 1}`, slot: 'callout', anchor: 'sceneStart', prim: 'box', text })),
    ],
    edges: [],
  } as unknown as SceneSpec;
  const laid = layoutScene(resolveScene(spec));
  for (const element of laid.elements) {
    const scale = element.bbox.h / element.intrinsicSize.h;
    for (const text of element.visual.texts) assert.ok(text.size * scale >= MIN_READABLE_FONT_PX - 1e-6, `${element.id} text ${(text.size * scale).toFixed(1)}px`);
  }
  const rows = new Set(laid.elements.filter((element) => element.id.startsWith('c')).map((element) => Math.round(element.bbox.y)));
  assert.ok(rows.size >= 2, 'callouts wrap into more than one row');
});

test('a container takes no placement slot, so it never squeezes its siblings below the readable floor', () => {
  const spec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'fc', title: 'Contain', template: 'formula_focus',
    elements: [
      { id: 'f1', slot: 'formula', anchor: 'sceneStart', prim: 'formula', latex: 'x = y' },
      ...['Known sides', 'Missing side', 'Square each', 'Add them up', 'Take the root'].map((text, index) => ({ id: `c${index + 1}`, slot: 'callout', anchor: 'sceneStart', prim: 'box', text })),
      { id: 'box_a_b', slot: 'callout', anchor: 'sceneStart', prim: 'container', children: ['c1', 'c2'], style: 'dashed' },
    ],
    edges: [],
  } as unknown as SceneSpec;
  const laid = layoutScene(resolveScene(spec));
  for (const element of laid.elements) {
    if (element.element.prim === 'container') continue;
    const scale = element.bbox.h / element.intrinsicSize.h;
    for (const text of element.visual.texts) assert.ok(text.size * scale >= MIN_READABLE_FONT_PX - 1e-6, `${element.id} text ${(text.size * scale).toFixed(1)}px`);
  }
});

test('a sparse board (two nodes in a container) is widened until it reaches the occupancy floor', () => {
  const spec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'sp', title: 'Sparse', template: 'hierarchy_tree',
    elements: [
      { id: 'n1', slot: 'root', anchor: 'sceneStart', prim: 'box', text: 'Masked' },
      { id: 'n2', slot: 'branch', anchor: 'sceneStart', prim: 'box', text: 'Decoder' },
      { id: 'box_a_b', slot: 'branch', anchor: 'sceneStart', prim: 'container', children: ['n1', 'n2'], style: 'dashed' },
    ],
    edges: [],
  } as unknown as SceneSpec;
  const laid = layoutScene(resolveScene(spec));
  assert.ok(laid.occupancy >= 0.3 - 1e-9, `occupancy ${laid.occupancy.toFixed(3)}`);
});

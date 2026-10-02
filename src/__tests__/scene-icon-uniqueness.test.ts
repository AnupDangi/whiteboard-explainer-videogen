import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneSpec } from '../shared/types.js';
import { resolveScene } from '../assets/resolveScene.js';
import { allCatalogEntries } from '../assets/semantic.js';

test('one picture never stands for two different concepts in a scene', () => {
  const entry = allCatalogEntries().find((candidate) => candidate.names.some((name) => name.toLowerCase() === 'leaf'));
  assert.ok(entry, 'catalog has a leaf entry');
  const spec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'u', title: 'Unique', template: 'list_icon',
    elements: [
      { id: 'a', slot: 'item', anchor: 'sceneStart', prim: 'object', concept: 'first thing', label: 'First', conceptIds: ['c_a'] },
      { id: 'b', slot: 'item', anchor: 'sceneStart', prim: 'object', concept: 'second thing', label: 'Second', conceptIds: ['c_b'] },
    ],
    edges: [],
  } as unknown as SceneSpec;
  const validatedByConcept = new Map([['c_a', entry!.id], ['c_b', entry!.id]]);
  const scene = resolveScene(spec, { validatedByConcept });
  const ids = scene.elements.map((element) => element.resolution?.assetId).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, `assets ${ids.join(', ')}`);
});

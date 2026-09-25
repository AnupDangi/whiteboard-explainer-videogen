import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneRichness, summarizeRichness } from '../harness/sceneRichness.js';
import { resolveScene } from '../resolveScene.js';
import type { SceneSpec } from '../types.js';

const chain: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 's1', title: 'A To B', template: 'chain', elements: [
  { id: 'a', prim: 'object', slot: 'node', anchor: 'mention:a', concept: 'store', label: 'STORE' },
  { id: 'b', prim: 'box', slot: 'node', anchor: 'mention:b', text: 'B' },
], edges: [{ from: 'a', to: 'b', origin: 'illustrative-example' }] } as SceneSpec;
const list: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 's2', title: 'Items', template: 'list_icon', elements: [
  { id: 'x', prim: 'box', slot: 'item', anchor: 'mention:x', text: 'X' },
  { id: 'y', prim: 'box', slot: 'item', anchor: 'mention:y', text: 'Y' },
  { id: 'z', prim: 'box', slot: 'item', anchor: 'mention:z', text: 'Z' },
], edges: [] } as SceneSpec;

test('sceneRichness counts structure and rungs', () => {
  const row = sceneRichness(chain, resolveScene(chain));
  assert.equal(row.elementCount, 2);
  assert.equal(row.objectCount, 1);
  assert.equal(row.objectShare, 0.5);
  assert.equal(row.edgeCount, 1);
  assert.equal(row.isListScene, false);
  assert.deepEqual(row.primitiveKinds, ['box', 'object']);
  assert.equal(row.rungCounts['2'] + row.rungCounts['3'] + row.rungCounts['4'], 1);
});

test('list_icon and unconnected boxes count as list scenes', () => {
  assert.equal(sceneRichness(list).isListScene, true);
  const unconnectedChain = { ...list, template: 'chain' } as SceneSpec;
  assert.equal(sceneRichness(unconnectedChain).isListScene, true);
});

test('summarizeRichness aggregates deterministically', () => {
  const summary = summarizeRichness([sceneRichness(chain), sceneRichness(list)]);
  assert.equal(summary.scenes, 2);
  assert.equal(summary.listSceneRate, 0.5);
  assert.equal(summary.templateDiversity, 2);
  assert.equal(summary.meanEdges, 0.5);
});

test('summarizeRichness of no scenes is all zeros, not NaN', () => {
  const summary = summarizeRichness([]);
  for (const value of Object.values(summary)) assert.equal(value, 0);
});

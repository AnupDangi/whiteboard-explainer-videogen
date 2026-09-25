import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectPins, iconPinKey } from '../catalog/iconPins.js';
import { QueryEmbeddingCache } from '../catalog/queryEmbeddingCache.js';
import { resolveObject } from '../catalog/ladder.js';
import { allCatalogEntries } from '../catalog/semantic.js';
import { resolveScene } from '../resolveScene.js';
import type { SceneSpec } from '../types.js';

const scene = (sceneId: string, concept: string): SceneSpec => ({ schemaVersion: 'claude-scene-spec/v1', sceneId, title: 'T', template: 'list_icon', elements: [
  { id: 'a', prim: 'object', slot: 'item', anchor: 'mention:a', concept, label: 'A', conceptIds: ['store_front'] },
  { id: 'b', prim: 'box', slot: 'item', anchor: 'mention:b', text: 'B' },
], edges: [] } as SceneSpec);

test('iconPinKey prefers sorted conceptIds and falls back to the normalized concept', () => {
  assert.equal(iconPinKey({ concept: 'Store', conceptIds: ['z', 'a'] }), 'concepts:a,z');
  assert.equal(iconPinKey({ concept: '  Shipping_Truck ' }), 'concept:shipping truck');
});

test('same conceptIds keep one icon across scenes', () => {
  const first = resolveScene(scene('s1', 'store'));
  const pins = collectPins(first, new Map());
  const second = resolveScene(scene('s2', 'shop building'), { pins });
  assert.equal(second.elements[0].resolution?.assetId, first.elements[0].resolution?.assetId);
  assert.equal(second.elements[0].resolution?.rung, first.elements[0].resolution?.rung);
});

test('collectPins never overwrites an existing pin and never pins text fallbacks', () => {
  const first = resolveScene(scene('s1', 'store'));
  const pins = collectPins(first, new Map());
  const again = collectPins(resolveScene(scene('s2', 'zzqxwv')), pins);
  assert.equal(again.get('concepts:store_front')?.assetId, pins.get('concepts:store_front')?.assetId);
  const unknown = scene('s3', 'zzqxwv');
  const fallbackScene = { ...unknown, elements: [{ ...unknown.elements[0], conceptIds: ['other'] }, unknown.elements[1]] } as SceneSpec;
  const resolvedFallback = resolveScene(fallbackScene);
  assert.equal(resolvedFallback.elements[0].resolution?.rung, 4);
  assert.equal(collectPins(resolvedFallback, new Map()).has('concepts:other'), false);
});

test('resolution is independent of catalog array order', () => {
  const catalog = allCatalogEntries();
  const a = resolveObject('store', { size: { w: 200, h: 260 } }, catalog).resolution.assetId;
  const b = resolveObject('store', { size: { w: 200, h: 260 } }, [...catalog].reverse()).resolution.assetId;
  assert.equal(a, b);
});

test('query embedding cache round-trips vectors by model and text', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-qcache-'));
  try {
    const file = path.join(dir, 'q.json');
    const cache = new QueryEmbeddingCache(file, 'model-a');
    cache.set('Store', Float32Array.from([0.5, 0.25]));
    await cache.flush();
    const reread = new QueryEmbeddingCache(file, 'model-a');
    assert.deepEqual([...reread.get('store')!], [0.5, 0.25]);
    assert.equal(new QueryEmbeddingCache(file, 'model-b').get('store'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

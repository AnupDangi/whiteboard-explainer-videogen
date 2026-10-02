import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectPins, iconPinKey } from '../assets/iconPins.js';
import { QueryEmbeddingCache } from '../assets/queryEmbeddingCache.js';
import { resolveObject } from '../assets/ladder.js';
import { allCatalogEntries } from '../assets/semantic.js';
import { resolveScene } from '../assets/resolveScene.js';
import type { SceneSpec } from '../shared/types.js';

const scene = (sceneId: string, concept: string): SceneSpec => ({ schemaVersion: 'claude-scene-spec/v1', sceneId, title: 'T', template: 'list_icon', elements: [
  { id: 'a', prim: 'object', slot: 'item', anchor: 'mention:a', concept, label: 'A', conceptIds: ['store_front'] },
  { id: 'b', prim: 'box', slot: 'item', anchor: 'mention:b', text: 'B' },
], edges: [] } as SceneSpec);

test('iconPinKey combines sorted conceptIds with the normalized depicted referent', () => {
  assert.equal(iconPinKey({ concept: ' Shipping_Truck ', conceptIds: ['z', 'a'] }), 'concepts:a,z|referent:shipping truck');
  assert.equal(iconPinKey({ concept: '  Shipping_Truck ' }), 'concept:shipping truck');
  assert.notEqual(iconPinKey({ concept: 'sun', conceptIds: ['light'] }), iconPinKey({ concept: 'raindrop', conceptIds: ['light'] }));
});

test('same depicted referent and conceptIds keep one icon across scenes', () => {
  const first = resolveScene(scene('s1', 'store'));
  const pins = collectPins(first, new Map(), true);
  const second = resolveScene(scene('s2', 'store'), { pins });
  assert.equal(second.elements[0].resolution?.assetId, first.elements[0].resolution?.assetId);
  assert.equal(second.elements[0].resolution?.rung, first.elements[0].resolution?.rung);
});

test('distinct depicted objects sharing one teaching concept keep distinct board-selected assets', () => {
  const catalog = allCatalogEntries();
  const sunAsset = resolveObject('sun', { size: { w: 200, h: 260 } }, catalog).resolution.assetId;
  const dropAsset = resolveObject('raindrop', { size: { w: 200, h: 260 } }, catalog).resolution.assetId;
  assert.ok(sunAsset && dropAsset && sunAsset !== dropAsset);
  const spec = { ...scene('s1', 'sun'), elements: [
    { id: 'sun', prim: 'object', slot: 'item', anchor: 'mention:a', concept: 'sun', label: 'Sun', conceptIds: ['light'] },
    { id: 'drop', prim: 'object', slot: 'item', anchor: 'mention:b', concept: 'raindrop', label: 'Raindrop', conceptIds: ['light'] },
  ] } as SceneSpec;
  const pins = new Map([
    [iconPinKey(spec.elements[0] as { concept: string; conceptIds?: string[] }), { assetId: sunAsset, rung: 2 as const, score: 1 }],
    [iconPinKey(spec.elements[1] as { concept: string; conceptIds?: string[] }), { assetId: dropAsset, rung: 2 as const, score: 1 }],
  ]);
  const resolved = resolveScene(spec, { pins });
  assert.deepEqual(resolved.elements.map((item) => item.resolution?.assetId), [sunAsset, dropAsset]);
  assert.equal(collectPins(resolved, pins, true).size, 2);
});

test('collectPins never overwrites an existing pin and never pins text fallbacks', () => {
  const first = resolveScene(scene('s1', 'store'));
  const pins = collectPins(first, new Map(), true);
  const failing = resolveScene(scene('s2', 'store'));
  assert.equal(collectPins(failing, new Map(), false).size, 0, 'a scene rejected by B4 cannot seed referent pins');
  const again = collectPins(resolveScene(scene('s2', 'zzqxwv')), pins, true);
  assert.equal(again.get('concepts:store_front|referent:store')?.assetId, pins.get('concepts:store_front|referent:store')?.assetId);
  const unknown = scene('s3', 'zzqxwv');
  const fallbackScene = { ...unknown, elements: [{ ...unknown.elements[0], conceptIds: ['other'] }, unknown.elements[1]] } as SceneSpec;
  const resolvedFallback = resolveScene(fallbackScene);
  assert.equal(resolvedFallback.elements[0].resolution?.rung, 4);
  assert.equal(collectPins(resolvedFallback, new Map(), true).has('concepts:other|referent:zzqxwv'), false);
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

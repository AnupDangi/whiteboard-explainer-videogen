import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../catalog/catalog.js';
import { assertCatalogNormalized, normalizeCatalogEntry } from '../catalog/normalize.js';
import { resolveObject, semanticScore, TAU_HIGH, TAU_MID } from '../catalog/ladder.js';
import { resolveScene } from '../resolveScene.js';
import type { SceneSpec } from '../types.js';

test('catalog: the seed catalog is fully normalized (all licenses allowlisted)', () => {
  assert.doesNotThrow(() => assertCatalogNormalized(CATALOG));
});

test('catalog: an unlicensed entry is rejected by the normalization gate', () => {
  const bad = { id: 'x', names: ['x'], tags: [], meaning: '', source: 'generated' as const, license: 'GPL-3.0-only', lane: 'simple-symbol' as const, strokePaths: 2, render: () => ({ paths: [], fills: [], texts: [] }) };
  const result = normalizeCatalogEntry(bad);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes('license')));
});

test('catalog: normalization preserves lane classification for simple vs rich entries', () => {
  const key = CATALOG.find((c) => c.id === 'key')!;
  const sun = CATALOG.find((c) => c.id === 'sun')!;
  assert.equal(normalizeCatalogEntry(key).lane, 'simple-symbol');
  assert.equal(normalizeCatalogEntry(sun).lane, 'rich-illustration');
});

test('catalog: seed descriptors do not route broad lesson topics to merely associated icons', () => {
  const searchableText = CATALOG.flatMap((entry) => [...entry.names, ...entry.tags, entry.meaning]).join(' ').toLowerCase();
  for (const topicOnlyAssociation of ['photosynthesis', 'carbon dioxide', 'electromagnetism', 'induction', 'physics']) {
    assert.ok(!searchableText.includes(topicOnlyAssociation), `catalog descriptors must not associate assets with lesson topic ${topicOnlyAssociation}`);
  }
  const leaf = CATALOG.find((entry) => entry.id === 'leaf')!;
  const coil = CATALOG.find((entry) => entry.id === 'coil')!;
  assert.ok(leaf.names.includes('leaf'), 'the literal asset name remains available');
  assert.ok(coil.names.includes('coil'), 'the literal asset name remains available');
  for (const topicOnlyAssociation of ['photosynthesis', 'carbon dioxide', 'electromagnetism', 'induction', 'physics']) {
    assert.ok(CATALOG.every((entry) => semanticScore(topicOnlyAssociation, entry) === 0), `${topicOnlyAssociation} must not lexically route to a seed icon`);
    assert.equal(resolveObject(topicOnlyAssociation, { size: { w: 150, h: 220 } }, CATALOG).resolution.rung, 4, `${topicOnlyAssociation} should use the labelled fallback`);
  }
});

test('ladder: exact name match resolves at rung 2 with score 1, preferring the house style (Streamline) over procedural doodles', () => {
  const { resolution } = resolveObject('key', { size: { w: 150, h: 220 } });
  assert.equal(resolution.rung, 2);
  assert.equal(resolution.score, 1);
  assert.equal(resolution.assetId, 'streamline-color:key');
  assert.equal(resolution.license, 'CC-BY-4.0');
});

test('ladder: an explicitly supplied catalog is the only pool searched', () => {
  const { resolution } = resolveObject('key', { size: { w: 150, h: 220 } }, CATALOG);
  assert.equal(resolution.assetId, 'key');
});

test('ladder: a strong embedding candidate from the house catalog beats a procedural exact name', () => {
  const { resolution } = resolveObject('robot', { size: { w: 150, h: 220 }, candidates: [{ id: 'streamline-plump-color:ai-edit-robot', name: 'ai edit robot', score: 0.7 }] });
  assert.equal(resolution.assetId, 'streamline-plump-color:ai-edit-robot');
  assert.equal(resolution.rung, 2);
});

test('ladder: a weak embedding candidate (< TAU_MID_EMB) falls through to the text box rather than a wrong icon', () => {
  const { resolution } = resolveObject('chloroplast', { size: { w: 150, h: 220 }, candidates: [{ id: 'streamline-color:leaf', name: 'leaf', score: 0.35 }] });
  assert.equal(resolution.rung, 4);
});

test('ladder: a related-but-not-exact concept falls to semantic matching (rung 2 or 3), never straight to text unless truly unrelated', () => {
  const score = semanticScore('padlock security', CATALOG.find((c) => c.id === 'lock')!);
  assert.ok(score > 0, 'lock catalog entry should share tokens with "padlock security"');
});

test('ladder: badge composition produces a compound visual (base paths/fills plus the badge glyph)', () => {
  const { visual, resolution } = resolveObject('key', { badge: '⚠', size: { w: 150, h: 220 } });
  assert.equal(resolution.rung, 2);
  const baseOnly = resolveObject('key', { size: { w: 150, h: 220 } }).visual;
  assert.ok(visual.paths.length > baseOnly.paths.length, 'badge must add at least one path (the badge circle)');
  assert.ok(visual.texts.some((t) => t.text === '⚠'), 'badge glyph text must be present');
});

test('ladder: a concept with no plausible catalog match falls back to rung 4 (styled text box) and still resolves', () => {
  const { resolution, visual } = resolveObject('xyzzy_totally_unrelated_concept_zzz', { size: { w: 150, h: 220 } });
  assert.equal(resolution.rung, 4);
  assert.equal(resolution.assetId, null);
  assert.equal(resolution.lane, 'text-fallback');
  assert.ok(visual.texts.length > 0, 'rung 4 must still render a visible label');
});

test('ladder: rung thresholds are ordered (mid < high)', () => {
  assert.ok(TAU_MID < TAU_HIGH);
});

test('resolve stage: every "object" element in a SceneSpec ends up with a resolution record — no unresolved final element is possible', () => {
  const spec: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1',
    sceneId: 'obj_test',
    title: 'Objects',
    template: 'list_icon',
    elements: [
      { id: 'o1', anchor: 'sceneStart', prim: 'object', concept: 'key' },
      { id: 'o2', anchor: 'sceneStart', prim: 'object', concept: 'padlock' },
      { id: 'o3', anchor: 'sceneStart', prim: 'object', concept: 'completely made up nonsense concept' },
    ],
    edges: [],
  };
  const resolved = resolveScene(spec);
  for (const el of resolved.elements) {
    assert.ok(el.resolution, `${el.element.id} must have a resolution record`);
    assert.ok(el.visual.paths.length > 0 || el.visual.texts.length > 0, `${el.element.id} must render something, never an empty placeholder`);
  }
});

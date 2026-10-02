import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneSpec } from '../shared/types.js';
import { safeParseSceneSpec } from '../shared/schema.js';
import { applyPictureUpgrades, pictureCandidates } from '../planner/pictureUpgrade.js';

const evidence = [{ sourceId: 's', spanId: 'sp', startChar: 1, endChar: 9, startLine: 1, endLine: 1, quote: 'some text' }];
const spec = {
  schemaVersion: 'claude-scene-spec/v1', sceneId: 'pu', title: 'Upgrade', template: 'chain',
  elements: [
    { id: 'n1', slot: 'node', anchor: 'mention:a', prim: 'box', text: 'Shopping cart', fill: 'blue', conceptIds: ['c1'], evidenceRefs: evidence },
    { id: 'n2', slot: 'node', anchor: 'mention:b', prim: 'box', text: 'Role glyph box', glyph: 'gear', conceptIds: ['c2'], evidenceRefs: evidence },
    { id: 'n3', slot: 'node', anchor: 'mention:c', prim: 'box', text: 'Unlinked' },
  ],
  edges: [],
} as unknown as SceneSpec;

test('only labelled, concept-linked, glyph-free boxes are picture candidates', () => {
  assert.deepEqual(pictureCandidates(spec).map((candidate) => candidate.elementId), ['n1']);
  assert.equal(pictureCandidates(spec)[0]!.referent, 'shopping cart');
});

test('an approved picture turns the box into an object that keeps its id, anchor, evidence and concept links', () => {
  const upgraded = applyPictureUpgrades(spec, new Map([['shopping cart', 'entry-1']]));
  const object = upgraded.elements.find((element) => element.id === 'n1')!;
  assert.equal(object.prim, 'object');
  assert.equal((object as { concept: string }).concept, 'shopping cart');
  assert.equal(object.label, 'Shopping cart');
  assert.deepEqual(object.conceptIds, ['c1']);
  assert.equal(object.anchor, 'mention:a');
  assert.equal(upgraded.elements.find((element) => element.id === 'n2')!.prim, 'box');
  const single = { ...spec, elements: [spec.elements[0]!] } as SceneSpec;
  assert.ok(safeParseSceneSpec(applyPictureUpgrades(single, new Map([['shopping cart', 'entry-1']]))).success, 'upgraded scene still validates');
  assert.equal(applyPictureUpgrades(spec, new Map()), spec, 'nothing approved, nothing changed');
});

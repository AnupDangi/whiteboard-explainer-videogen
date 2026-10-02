import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSceneFamily } from '../assets/sceneFamily.js';
import { resolveObject } from '../assets/ladder.js';
import type { CatalogEntry } from '../assets/catalog.js';
import { runClaudeGates } from '../validate/gates.js';

const G = 'simi-house-v1/general-drawon';
const D = 'simi-house-v1/domain-outline';
const B = 'simi-house-v1/technical-brand';

const entry = (id: string, name: string, source: string, houseFamily?: string): CatalogEntry => ({
  id, names: [name], tags: [], meaning: '', source, license: 'manual', lane: 'simple-symbol', strokePaths: 1, ...(houseFamily ? { houseFamily } : {}),
  render: () => ({ paths: [], fills: [], texts: [] }),
});

test('scene family is the most used non-exempt family; ties follow the fixed order', () => {
  assert.equal(chooseSceneFamily([G, D, D]), D);
  assert.equal(chooseSceneFamily([G, D]), G);
  assert.equal(chooseSceneFamily([B, undefined]), undefined);
  assert.equal(chooseSceneFamily([]), undefined);
});

test('an asset of another family is filtered before ranking and the element falls to a label', () => {
  const items = [entry('gen', 'cell', 'assetlab-sketchy-downshift:x', G), entry('dom', 'beaker', 'flaticon:local', D)];
  const inFamily = resolveObject('beaker', { size: { w: 300, h: 300 }, sceneFamily: G }, items);
  assert.equal(inFamily.resolution.assetId, null, 'domain-outline beaker must not appear in a general-drawon scene');
  const sameFamily = resolveObject('cell', { size: { w: 300, h: 300 }, sceneFamily: G }, items);
  assert.equal(sameFamily.resolution.assetId, 'gen');
  assert.equal(sameFamily.resolution.houseFamily, G);
});

test('family-mixed is a hard gate when a laid-out scene carries two families', () => {
  const laid = (family: string, id: string) => ({ id, element: { id, prim: 'object', concept: id }, bbox: { x: 0, y: 0, w: 10, h: 10 }, intrinsicSize: { w: 10, h: 10 }, visual: { paths: [], fills: [], texts: [] }, strokeLength: 0, resolution: { rung: 2, assetId: id, score: 1, license: 'manual', lane: 'simple-symbol', source: 's', houseFamily: family } });
  const scene = { sceneId: 's', title: 't', template: 'chain', elements: [laid(G, 'a'), laid(D, 'b')], edges: [], focus: [], carryOver: [] } as never;
  const result = runClaudeGates(scene, { sceneId: 's', events: [], sceneStartMs: 0, sceneEndMs: 1000 } as never);
  assert.ok(result.failures.some((failure) => failure.code === 'family-mixed' && failure.hard));
});

import { domainMatches } from '../assets/ladder.js';
test('taxonomy domain outranks general among exact literals', () => {
  const generic = { ...entry('a-gen', 'cell', 'flaticon:local', D), domain: 'general' };
  const bio = { ...entry('z-bio', 'cell', 'flaticon:local', D), domain: 'biology' };
  assert.equal(domainMatches(bio, 'Biology of cells'), true);
  assert.equal(domainMatches(generic, 'Biology'), false);
  const out = resolveObject('cell', { size: { w: 300, h: 300 }, lessonDomain: 'biology' }, [generic, bio]);
  assert.equal(out.resolution.assetId, 'z-bio');
  const none = resolveObject('cell', { size: { w: 300, h: 300 } }, [generic, bio]);
  assert.equal(none.resolution.assetId, 'a-gen');
});

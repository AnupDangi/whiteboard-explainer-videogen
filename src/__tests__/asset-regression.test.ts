import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObject } from '../assets/ladder.js';
import type { CatalogEntry } from '../assets/catalog.js';
import { collectPins } from '../assets/iconPins.js';

// final_plan/04 §31: the expected fallback rung is part of the test.
const SIZE = { w: 300, h: 300 };
const G = 'simi-house-v1/general-drawon';
const D = 'simi-house-v1/domain-outline';
const entry = (id: string, name: string, source: string, license = 'manual', houseFamily?: string): CatalogEntry => ({
  id, names: [name], tags: [], meaning: '', source, license, lane: 'simple-symbol', strokePaths: 1, ...(houseFamily ? { houseFamily } : {}), render: () => ({ paths: [], fills: [], texts: [] }),
});

const CATALOG = [
  entry('house:lamp', 'lamp', 'assetlab-sketchy-downshift:x', 'manual', G),
  entry('fl:beaker', 'beaker', 'flaticon:local', 'manual', D),
  entry('sk:openai', 'openai', 'sketchi:x', 'manual', 'simi-house-v1/technical-brand'),
  entry('fl:review', 'syringe', 'flaticon:local', 'Flaticon-review', D),
];

const rung = (concept: string, extra: Record<string, unknown> = {}, catalog = CATALOG) => resolveObject(concept, { size: SIZE, label: concept, ...extra }, catalog).resolution;

test('an exact source-approved literal keeps legacy catalogs compatible; a typed Flaticon literal remains eligible', () => {
  const lamp = rung('lamp');
  assert.equal(lamp.strategy, 'R3-house-literal');
  assert.equal(lamp.selectionBasis, 'exact');
  assert.equal(rung('beaker').strategy, 'R4-curated-flaticon');
});
test('metaphor approved: R5 with its reconnect term', () => {
  const metaphor = rung('bottleneck', { visualStrategy: 'metaphor' });
  assert.equal(metaphor.strategy, 'R5-approved-metaphor');
  assert.ok(metaphor.reconnectTerm);
});
test('role primitive: R2; topology: R9', () => {
  assert.equal(rung('gate thing', { visualStrategy: 'semantic-core', semanticRole: 'gate' }).strategy, 'R2-semantic-core');
  assert.equal(rung('some flow', { visualStrategy: 'topology', semanticRole: 'cycle' }).strategy, 'R9-state-topology');
});
test('brand: R7 technical brand', () => {
  assert.equal(rung('openai').strategy, 'R7-technical-brand');
});
test('missing asset: labelled primitive R10 (never a similar icon)', () => {
  assert.equal(rung('quarterly synergy').strategy, 'R10-labelled-primitive');
});
test('license unavailable: a review-licence asset is unusable outside local-dev and falls to R10', () => {
  assert.equal(process.env.ASSET_USAGE_CONTEXT === 'local-dev', false, 'suite runs in the production context');
  assert.equal(rung('syringe').strategy, 'R10-labelled-primitive');
});
test('family mismatch: an asset outside the scene family is filtered, not mixed', () => {
  assert.equal(rung('beaker', { sceneFamily: G }).strategy, 'R10-labelled-primitive');
});
test('duplicate concept: an ambiguous name fails closed to R10', () => {
  const dup = [entry('a:apple', 'apple', 'assetlab-sketchy-downshift:x', 'manual', G)];
  assert.equal(rung('apple', { conceptId: 'apple' }, dup).strategy, 'R10-labelled-primitive');
});
test('pin reuse: a collected pin is reused as R0 for the same referent and never for another', () => {
  const first = resolveObject('beaker', { size: SIZE, label: 'beaker' }, CATALOG);
  const pins = collectPins({ elements: [{ element: { prim: 'object', concept: 'beaker', conceptIds: ['beaker'] } as never, resolution: first.resolution, visual: first.visual, intrinsicSize: SIZE, strokeLength: 0 }] } as never, new Map(), true);
  const pin = [...pins.values()][0]!;
  assert.equal(rung('beaker', { pin }).strategy, 'R0-verified-pin');
  assert.notEqual(rung('lamp', { pin }).strategy, 'R0-verified-pin');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { referentKeys } from '../assets/referent.js';

test('referent keys strip determiners, singularise and emit head-noun suffixes', () => {
  assert.deepEqual(referentKeys('the red blood cells'), ['red blood cell', 'blood cell', 'cell']);
  assert.deepEqual(referentKeys('A thermostat'), ['thermostat']);
  assert.deepEqual(referentKeys('memories'), ['memory']);
  assert.deepEqual(referentKeys('glass'), ['glass']);
  assert.deepEqual(referentKeys('the'), []);
});

import { resolveObject } from '../assets/ladder.js';
import type { CatalogEntry } from '../assets/catalog.js';

const icon = (id: string, name: string, source: string): CatalogEntry => ({ id, names: [name], tags: [], meaning: '', source, license: 'manual', lane: 'simple-symbol', strokePaths: 1, render: () => ({ paths: [], fills: [], texts: [] }) });

test('a semantically validated asset resolves as a curated match; an unknown id falls through to a label', () => {
  const items = [icon('flaticon:syringe-1', 'syringe', 'flaticon:local')];
  const hit = resolveObject('a vaccine shot', { size: { w: 300, h: 300 }, validatedAssetId: 'flaticon:syringe-1' }, items);
  assert.equal(hit.resolution.assetId, 'flaticon:syringe-1');
  assert.equal(hit.resolution.selectionBasis, 'curated');
  assert.equal(hit.resolution.strategy, 'R4-curated-flaticon');
  const miss = resolveObject('a vaccine shot', { size: { w: 300, h: 300 }, validatedAssetId: 'nope' }, items);
  assert.equal(miss.resolution.assetId, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBridge, bridgeConceptFor } from '../assets/bridge.js';
import { typeCompatible } from '../assets/ladder.js';
import type { CatalogEntry } from '../assets/catalog.js';

const entry = (name: string): CatalogEntry => ({ id: name, names: [name], tags: [], meaning: '', source: 'x', license: 'manual', lane: 'simple-symbol', strokePaths: 1, render: () => ({ paths: [], fills: [], texts: [] }) });

test('asset-backed literal concepts are curated (not inferred); abstract ones stay inferred', () => {
  const bridge = loadBridge();
  const literal = bridge.concepts.filter((concept) => concept.approvedAssetRefs.length > 0 && concept.conceptType === 'entity');
  assert.ok(literal.length > 1000);
  assert.ok(literal.every((concept) => concept.inferred === false));
  assert.ok(bridge.concepts.filter((concept) => concept.conceptType === 'system').every((concept) => concept.inferred === true));
});

test('type gate: entity request matches an entity asset, never a system concept, and never when the request type is inferred', () => {
  assert.ok(bridgeConceptFor('abacus'));
  assert.equal(typeCompatible('entity', entry('abacus')), true);
  assert.equal(typeCompatible('system', entry('abacus')), false);
  assert.equal(typeCompatible('entity', entry('abacus'), true), false);
});

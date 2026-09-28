import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadBridge, bridgeConceptFor, bridgeAssetsForConcept, bridgeDiagramsForConcept,
  bridgeHasAsset, bridgeConceptTypeForAsset,
} from '../catalog/bridge.js';

test('bridge loads the vendored v2 manifest with expected counts', () => {
  const bridge = loadBridge();
  assert.equal(bridge.schemaVersion, 'asset-bridge/v2');
  assert.ok(bridge.catalogVersion.length >= 8);
  assert.equal(bridge.counts.concepts, bridge.concepts.length);
  assert.equal(bridge.counts.assets, bridge.assets.length);
  assert.equal(bridge.counts.diagrams, bridge.diagrams.length);
  assert.ok(bridge.counts.assets >= 1000, `expected 1000+ assets, got ${bridge.counts.assets}`);
  assert.ok(bridge.counts.diagrams >= 80, `expected 80+ diagrams, got ${bridge.counts.diagrams}`);
});

test('bridge lookups resolve concepts, assets and diagrams', () => {
  const abacus = bridgeConceptFor('abacus');
  assert.ok(abacus, 'abacus concept exists');
  assert.ok(abacus.approvedAssetRefs.length > 0);
  const byAlias = bridgeConceptFor('Person');
  assert.ok(byAlias, 'alias lookup works');
  assert.equal(bridgeConceptFor('no-such-concept-xyz'), undefined);
  const assets = bridgeAssetsForConcept('abacus');
  assert.ok(assets.length > 0 && assets.every((a) => a.conceptId === 'abacus'));
  assert.ok(assets.some((a) => a.animationMode === 'ink-fill'));
  const diagrams = bridgeDiagramsForConcept('neural-network');
  assert.ok(diagrams.length > 0, 'mechanism concept has diagram specs');
  assert.ok(diagrams.every((d) => d.topology.length > 0 && d.supportRefs.length > 0));
});

test('bridge refs are internally consistent', () => {
  const bridge = loadBridge();
  const assetRefs = new Set(bridge.assets.map((a) => a.ref));
  for (const concept of bridge.concepts) {
    for (const ref of concept.approvedAssetRefs) {
      assert.ok(assetRefs.has(ref), `dangling asset ref ${ref} on ${concept.conceptId}`);
    }
  }
  assert.ok(bridgeHasAsset(bridge.assets[0].ref));
  assert.equal(bridgeHasAsset('missing:ref:xyz'), false);
  const type = bridgeConceptTypeForAsset(bridge.assets[0].ref);
  assert.ok(typeof type === 'string' && type.length > 0);
});

test('bridge load is deterministic across calls', () => {
  assert.equal(loadBridge(), loadBridge(), 'cached instance reused');
  assert.equal(loadBridge().catalogVersion, loadBridge().catalogVersion);
});

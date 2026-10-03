import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogEntry } from '../assets/catalog.js';
import type { BridgeAsset } from '../assets/bridge.js';
import { bridgeRecordForCatalogEntry, buildAssetRightsEvidence, rightsEvidenceFailure } from '../assets/rightsEvidence.js';

const entry: CatalogEntry = {
  id: 'flaticon:abacus-flaticon-local-healthicons-filled-specialties-abacus-svg',
  names: ['abacus'], tags: [], meaning: '', source: 'flaticon:local', license: 'Flaticon-review',
  lane: 'simple-symbol', strokePaths: 1, conceptId: 'abacus', contentHash: 'catalog-hash',
  attribution: 'Catalogue-level attribution', render: () => ({ paths: [], fills: [], texts: [] }),
};
const bridgeAsset: BridgeAsset = {
  ref: 'abacus:flaticon-local:healthicons/filled/specialties/abacus.svg', conceptId: 'abacus', family: 'flaticon-local',
  capability: 'support', animationMode: 'fade', localPath: 'assets/abacus.svg', contentHash: 'source-hash',
  license: { spdx: 'Flaticon', status: 'review', attributionRequired: true },
  attribution: 'Flaticon — healthicons (healthicons/filled/specialties/abacus.svg)',
  provenance: { provider: 'flaticon-local', providerId: 'specialties/abacus.svg', collection: 'healthicons/filled', sourceUrl: 'https://example.test/abacus.svg' },
};

test('Flaticon source matching and export evidence preserve credit, source, hashes, and approval', () => {
  const matched = bridgeRecordForCatalogEntry(entry, [bridgeAsset]);
  assert.equal(matched, bridgeAsset);
  const evidence = buildAssetRightsEvidence({ assetId: entry.id, license: 'Flaticon-review', releaseClean: true, attributionRequired: true, ownerApproved: true }, entry, matched);
  assert.equal(evidence.releaseEligible, true);
  assert.equal(evidence.author, null, 'catalogue has no author field');
  assert.equal(evidence.attribution.text, bridgeAsset.attribution);
  assert.equal(evidence.source.providerId, bridgeAsset.provenance.providerId);
  assert.equal(evidence.source.url, bridgeAsset.provenance.sourceUrl);
  assert.deepEqual(evidence.hashes, { catalogueAsset: 'catalog-hash', sourceAsset: 'source-hash' });
  assert.deepEqual(evidence.approval, {
    approved: true,
    authority: 'project owner',
    date: '2026-10-03',
    decision: 'i give you all the permission use flaticons this is sudo permission for flaticon',
  });
});

test('missing required attribution evidence blocks release and is explicit in the record', () => {
  const evidence = buildAssetRightsEvidence({ assetId: 'required:asset', license: 'CC-BY-4.0', releaseClean: true, attributionRequired: true });
  assert.equal(evidence.releaseEligible, false);
  assert.ok(evidence.missingRequiredEvidence.includes('required attribution text'));
  assert.equal(evidence.attribution.text, null);
  assert.equal(rightsEvidenceFailure(evidence)?.hard, true, 'missing required rights evidence is a hard release blocker');
});

test('generated catalogue recipes receive a deterministic asset hash even without an upstream author field', () => {
  const evidence = buildAssetRightsEvidence({ assetId: 'manual:asset', license: 'MIT', releaseClean: true }, { ...entry, id: 'manual:asset', source: 'generated', contentHash: undefined });
  assert.equal(evidence.releaseEligible, true);
  assert.equal(evidence.author, null);
  assert.match(evidence.hashes.catalogueAsset ?? '', /^[a-f0-9]{64}$/);
  assert.equal(evidence.hashes.sourceAsset, null);
});

test('external catalogue assets without a source hash block release', () => {
  const evidence = buildAssetRightsEvidence({ assetId: 'catalog:asset', license: 'MIT', releaseClean: true }, { ...entry, id: 'catalog:asset', source: 'external-library:icons', contentHash: undefined });
  assert.equal(evidence.releaseEligible, false);
  assert.ok(evidence.missingRequiredEvidence.includes('asset hash'));
  assert.equal(rightsEvidenceFailure(evidence)?.hard, true);
});

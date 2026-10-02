import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  loadBridge, bridgeConceptFor, bridgeAssetsForConcept, bridgeDiagramsForConcept, bridgeCatalogVersion, freezeBridgeSnapshot,
  bridgeHasAsset, bridgeConceptTypeForAsset, bridgeSnapshotDigest, validateBridge, verifyBridgeSnapshot,
} from '../assets/bridge.js';

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
  assert.equal(bridgeConceptFor('apple'), undefined, 'ambiguous concept IDs fail closed');
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

test('bridge validation rejects unsafe paths, unlinked assets, and unresolved approval states', () => {
  const bridge = structuredClone(loadBridge());
  bridge.assets[0]!.localPath = '../outside.svg';
  bridge.concepts[0]!.approvedAssetRefs.push('missing:asset');
  const problems = validateBridge(bridge);
  assert.ok(problems.some((problem) => problem.includes('unsafe localPath')));
  assert.ok(problems.some((problem) => problem.includes('dangling asset ref')));
  bridge.assets[0]!.license.status = 'pending';
  assert.ok(validateBridge(bridge).some((problem) => problem.includes('unresolved license/approval status')));
});

test('bridge validation rejects approvals and diagram links that cross concept referents', () => {
  const bridge = structuredClone(loadBridge());
  const owner = bridge.concepts.find((concept) => concept.approvedAssetRefs.length > 0)!;
  const other = bridge.concepts.find((concept) => concept.conceptId !== owner.conceptId && concept.diagramRefs.length > 0)!;
  const ref = owner.approvedAssetRefs[0]!;
  bridge.assets.find((asset) => asset.ref === ref)!.conceptId = other.conceptId;
  const foreignDiagram = bridge.diagrams.find((diagram) => diagram.conceptId === other.conceptId)!;
  owner.diagramRefs.push(foreignDiagram.ref);
  const problems = validateBridge(bridge);
  assert.ok(problems.some((problem) => problem.includes('approves asset') && problem.includes('owned by')));
  assert.ok(problems.some((problem) => problem.includes('references diagram') && problem.includes('owned by')));
});

test('bridge byte validation checks local content against the pinned SHA-256', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asset-bridge-'));
  try {
    const assetRoot = path.join(root, 'snapshot');
    const bytes = '<svg viewBox="0 0 1 1"/>';
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    mkdirSync(path.join(assetRoot, 'assets'), { recursive: true });
    writeFileSync(path.join(assetRoot, 'assets', 'one.svg'), bytes);
    const minimal = {
      schemaVersion: 'asset-bridge/v2' as const,
      catalogVersion: 'test-v1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      counts: { concepts: 1, assets: 1, diagrams: 0 },
      concepts: [{ conceptId: 'one', aliases: [], domain: 'test', conceptType: 'entity', preferredStrategies: ['literal'], semanticRoles: [], approvedAssetRefs: ['one:asset'], diagramRefs: [], inferred: false }],
      assets: [{ ref: 'one:asset', conceptId: 'one', family: 'test-source', houseFamily: 'house', sceneFamilies: ['process'], capability: 'support' as const, animationMode: 'fade' as const, localPath: 'assets/one.svg', contentHash, license: { spdx: 'MIT', status: 'allowed', attributionRequired: false, allowedUsageContexts: ['teaching'] }, attribution: 'Synthetic fixture asset', provenance: { provider: 'test', providerId: 'one.svg', collection: 'fixture' } }],
      diagrams: [],
    };
    minimal.catalogVersion = bridgeCatalogVersion(minimal);
    assert.deepEqual(validateBridge(minimal, { assetRoot, verifyAssetBytes: true }), []);
    const verified = verifyBridgeSnapshot(minimal, assetRoot);
    assert.match(verified.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(Buffer.from(verified.bytesFor('one:asset')!), Buffer.from(bytes));
    writeFileSync(path.join(assetRoot, 'assets', 'one.svg'), '<svg viewBox="0 0 3 3"/>');
    assert.deepEqual(Buffer.from(verified.bytesFor('one:asset')!), Buffer.from(bytes), 'verified snapshot serves the bytes captured at verification time');
    writeFileSync(path.join(assetRoot, 'assets', 'one.svg'), bytes);
    const callerCopy = verified.bytesFor('one:asset')!;
    callerCopy[0] = 0;
    assert.deepEqual(Buffer.from(verified.bytesFor('one:asset')!), Buffer.from(bytes), 'consumers receive defensive byte copies');
    assert.ok(Object.isFrozen(verified.bridge.concepts[0]));

    const alternateBytes = '<svg viewBox="0 0 2 2"/>';
    writeFileSync(path.join(assetRoot, 'assets', 'one.svg'), alternateBytes);
    const alternate = structuredClone(minimal);
    alternate.assets[0]!.contentHash = createHash('sha256').update(alternateBytes).digest('hex');
    alternate.catalogVersion = bridgeCatalogVersion(alternate);
    const alternateVerified = verifyBridgeSnapshot(alternate, assetRoot);
    assert.notEqual(alternateVerified.digest, verified.digest, 'snapshot digest includes verified SVG identity');
    const reviewOnly = structuredClone(alternate);
    reviewOnly.assets[0]!.license.status = 'review';
    reviewOnly.assets[0]!.license.allowedUsageContexts = [];
    reviewOnly.catalogVersion = bridgeCatalogVersion(reviewOnly);
    assert.equal(verifyBridgeSnapshot(reviewOnly, assetRoot).bytesFor('one:asset'), undefined, 'review-only assets are not exposed for rendering');

    writeFileSync(path.join(assetRoot, 'assets', 'one.svg'), `${bytes} `);
    assert.ok(validateBridge(minimal, { assetRoot, verifyAssetBytes: true }).some((problem) => problem.includes('content hash mismatch')));
    assert.throws(() => verifyBridgeSnapshot(minimal, assetRoot), /content hash mismatch/);

    const maliciousBytes = '<svg onload="alert(1)" viewBox="0 0 1 1"/>';
    writeFileSync(path.join(assetRoot, 'assets', 'one.svg'), maliciousBytes);
    const malicious = structuredClone(minimal);
    malicious.assets[0]!.contentHash = createHash('sha256').update(maliciousBytes).digest('hex');
    malicious.catalogVersion = bridgeCatalogVersion(malicious);
    assert.ok(validateBridge(malicious, { assetRoot, verifyAssetBytes: true }).some((problem) => problem.includes('unsafe or invalid SVG')));
    assert.throws(() => verifyBridgeSnapshot(malicious, assetRoot), /unsafe or invalid SVG/);

    for (const unsafeReference of [
      '<svg viewBox="0 0 1 1"><use href="icons.svg#icon"/></svg>',
      '<svg viewBox="0 0 1 1"><image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>',
      '<svg viewBox="0 0 1 1"><path fill="url(../paint.svg#gradient)" d="M0 0"/></svg>',
      '<svg viewBox="0 0 1 1"><path style="fill:u\\72l(https://example.test/paint.svg#gradient)" d="M0 0"/></svg>',
      '<svg viewBox="0 0 1 1"><animate attributeName="href" values="https://example.test/x.svg"/></svg>',
    ]) {
      writeFileSync(path.join(assetRoot, 'assets', 'one.svg'), unsafeReference);
      const externalRef = structuredClone(minimal);
      externalRef.assets[0]!.contentHash = createHash('sha256').update(unsafeReference).digest('hex');
      externalRef.catalogVersion = bridgeCatalogVersion(externalRef);
      assert.ok(validateBridge(externalRef, { assetRoot, verifyAssetBytes: true }).some((problem) => problem.includes('unsafe or invalid SVG')));
      assert.throws(() => verifyBridgeSnapshot(externalRef, assetRoot), /unsafe or invalid SVG/);
    }

    const safeFragment = '<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0"/><use href="#g"/></svg>';
    writeFileSync(path.join(assetRoot, 'assets', 'one.svg'), safeFragment);
    const localRefs = structuredClone(minimal);
    localRefs.assets[0]!.contentHash = createHash('sha256').update(safeFragment).digest('hex');
    localRefs.catalogVersion = bridgeCatalogVersion(localRefs);
    assert.deepEqual(validateBridge(localRefs, { assetRoot, verifyAssetBytes: true }), [], 'safe fragment references stay available');

    const outside = path.join(root, 'outside.svg');
    writeFileSync(outside, bytes);
    rmSync(path.join(assetRoot, 'assets', 'one.svg'));
    symlinkSync(outside, path.join(assetRoot, 'assets', 'one.svg'));
    assert.ok(validateBridge(minimal, { assetRoot, verifyAssetBytes: true }).some((problem) => problem.includes('escapes assetRoot through a symlink')));
    assert.throws(() => verifyBridgeSnapshot(minimal, assetRoot), /escapes assetRoot through a symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strict snapshot validation rejects malformed nested fields and non-reciprocal approval', () => {
  const minimal = {
    schemaVersion: 'asset-bridge/v2' as const,
    catalogVersion: 'test-v1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    counts: { concepts: 1, assets: 1, diagrams: 0 },
    concepts: [{ conceptId: 'one', aliases: [], domain: 'test', conceptType: 'entity', preferredStrategies: ['literal'], semanticRoles: [], approvedAssetRefs: ['one:asset'], diagramRefs: [], inferred: false }],
    assets: [{ ref: 'one:asset', conceptId: 'one', family: 'test-source', houseFamily: 'house', sceneFamilies: ['process'], capability: 'support' as const, animationMode: 'fade' as const, localPath: 'assets/one.svg', contentHash: 'a'.repeat(64), license: { spdx: 'MIT', status: 'allowed', attributionRequired: false, allowedUsageContexts: ['teaching'] }, attribution: 'Synthetic fixture asset', provenance: { provider: 'test', providerId: 'one.svg', collection: 'fixture' } }],
    diagrams: [],
  };
  minimal.catalogVersion = bridgeCatalogVersion(minimal);
  assert.deepEqual(validateBridge(minimal, { strictSnapshot: true }), []);

  const malformed = structuredClone(minimal);
  (malformed.concepts[0] as unknown as { semanticRoles: unknown }).semanticRoles = { role: 'unsafe' };
  (malformed.assets[0] as unknown as { provenance: unknown }).provenance = { provider: 'test', providerId: 'one.svg', sourceUrl: 'javascript:alert(1)' };
  const problems = validateBridge(malformed, { strictSnapshot: true });
  assert.ok(problems.some((problem) => problem.includes('invalid semanticRoles')));
  assert.ok(problems.some((problem) => problem.includes('invalid provenance sourceUrl')));

  const missingRuntimePolicy = structuredClone(minimal);
  (missingRuntimePolicy.assets[0] as unknown as Record<string, unknown>).sceneFamilies = [];
  delete (missingRuntimePolicy.assets[0] as unknown as Record<string, unknown>).houseFamily;
  (missingRuntimePolicy.assets[0] as unknown as Record<string, unknown>).attribution = '';
  (missingRuntimePolicy.assets[0]!.license as unknown as Record<string, unknown>).allowedUsageContexts = [];
  (missingRuntimePolicy.concepts[0] as unknown as Record<string, unknown>).conceptType = 'unknown-type';
  missingRuntimePolicy.generatedAt = 'yesterday';
  const policyProblems = validateBridge(missingRuntimePolicy, { strictSnapshot: true });
  assert.ok(policyProblems.some((problem) => problem.includes('canonical ISO timestamp')));
  assert.ok(policyProblems.some((problem) => problem.includes('unknown conceptType')));
  assert.ok(policyProblems.some((problem) => problem.includes('houseFamily')));
  assert.ok(policyProblems.some((problem) => problem.includes('sceneFamilies')));
  assert.ok(policyProblems.some((problem) => problem.includes('attribution metadata')));
  assert.ok(policyProblems.some((problem) => problem.includes('allowedUsageContexts')));

  const unapproved = structuredClone(minimal);
  unapproved.concepts[0]!.approvedAssetRefs = [];
  assert.ok(validateBridge(unapproved, { strictSnapshot: true }).some((problem) => problem.includes('not reciprocally approved')));
  // Legacy migration validation stays separate from strict export approval rules.
  assert.deepEqual(validateBridge(unapproved), []);
});

test('bridge snapshot digest pins complete metadata and asset hashes deterministically', () => {
  const first = bridgeSnapshotDigest();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(bridgeSnapshotDigest(), first);
});

test('reviewed bridge freeze copies verified SVG bytes and emits a content-addressed immutable version', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'asset-bridge-freeze-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const destinationRoot = path.join(root, 'snapshot');
    mkdirSync(path.join(sourceRoot, 'assets'), { recursive: true });
    const bytes = '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>';
    writeFileSync(path.join(sourceRoot, 'assets', 'source.svg'), bytes);
    const bridge = {
      schemaVersion: 'asset-bridge/v2' as const, catalogVersion: 'pending', generatedAt: '2026-01-01T00:00:00.000Z',
      counts: { concepts: 1, assets: 1, diagrams: 0 },
      concepts: [{ conceptId: 'one', aliases: [], domain: 'test', conceptType: 'entity', preferredStrategies: ['literal'], semanticRoles: [], approvedAssetRefs: ['one:asset'], diagramRefs: [], inferred: false }],
      assets: [{ ref: 'one:asset', conceptId: 'one', family: 'test-source', houseFamily: 'house', sceneFamilies: ['process'], capability: 'support' as const, animationMode: 'fade' as const, localPath: 'assets/source.svg', contentHash: createHash('sha256').update(bytes).digest('hex'), license: { spdx: 'MIT', status: 'allowed', attributionRequired: false, allowedUsageContexts: ['teaching'] }, attribution: 'Synthetic fixture asset', provenance: { provider: 'test', providerId: 'one.svg', collection: 'fixture' } }],
      diagrams: [],
    };
    await assert.rejects(freezeBridgeSnapshot(bridge, sourceRoot, path.join(sourceRoot, 'nested-snapshot'), '2026-01-01T00:00:00.000Z'), /must not overlap/);
    const verified = await freezeBridgeSnapshot(bridge, sourceRoot, destinationRoot, '2026-01-01T00:00:00.000Z');
    assert.match(verified.bridge.catalogVersion, /^sha256:[a-f0-9]{64}$/);
    assert.match(verified.digest, /^[a-f0-9]{64}$/);
    assert.equal(verified.bridge.assets[0]!.localPath, `assets/${verified.bridge.assets[0]!.contentHash}.svg`);
    assert.deepEqual(Buffer.from(verified.bytesFor('one:asset')!), Buffer.from(bytes));
    writeFileSync(path.join(sourceRoot, 'assets', 'source.svg'), '<svg viewBox="0 0 2 2"/>');
    assert.deepEqual(Buffer.from(verified.bytesFor('one:asset')!), Buffer.from(bytes), 'frozen bytes no longer depend on the source checkout');
    await assert.rejects(freezeBridgeSnapshot(bridge, sourceRoot, destinationRoot, '2026-01-01T00:00:00.000Z'), /destination is not empty/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bridge load is deterministic across calls', () => {
  assert.equal(loadBridge(), loadBridge(), 'cached instance reused');
  assert.equal(loadBridge().catalogVersion, loadBridge().catalogVersion);
});

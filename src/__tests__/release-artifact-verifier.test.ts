import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectReleaseArtifactEvidence, verifyReleaseArtifactDirectory } from '../harness/releaseArtifactVerifier.js';
import { resolveDevelopmentAttempt } from '../harness/developmentBenchmark.js';
import { failedEvaluationEnvelope } from '../harness/failedEvaluation.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

async function fixture(status: 'passed' | 'draft' | 'failed' = 'failed') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-artifact-verifier-'));
  const expected = resolveDevelopmentAttempt(process.cwd(), 'osmosis-trial-1');
  const evaluation = JSON.stringify({
    schemaVersion: 'evaluation-bundle/v2', pipeline: 'claude', runClass: 'generated-lesson', status,
    runId: 'run-3', caseId: 'case-3', metrics: {
      'semantic.majorClaimVisualCoverage': 0.93,
      'semantic.requiredRelationCoverage': 0.9,
      'semantic.stateChangeCoverage': 1,
      'semantic.lastResortTextRate': 0.12,
    }, failures: [], gateRecords: [],
  });
  await writeFile(path.join(root, 'evaluation-bundle.json'), evaluation);
  const manifest: { artifactSha256: Record<string, string>; [key: string]: unknown } = {
    schemaVersion: 'hypothesis-run/v1', pipeline: 'claude', status, runClass: 'generated-lesson',
    runId: 'run-3', caseId: 'case-3', options: { cache: 'cold' },
    benchmark: {
      setId: expected.setId, attemptId: expected.attemptId, topicId: expected.topicId, trial: expected.trial,
      sourcePath: expected.sourcePath, sourceSha256: expected.sourceSha256, instructionSha256: expected.instructionSha256,
    },
    artifactSha256: { 'evaluation-bundle.json': hash(evaluation) },
  };
  await writeFile(path.join(root, 'run-manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}

test('early preparation failures produce identity-complete evidence accepted as a failed frozen attempt', async () => {
  const { root, manifest } = await fixture('failed');
  try {
    const evaluation = JSON.stringify(failedEvaluationEnvelope({ runId: 'run-3', caseId: 'case-3', stage: 'prepare', code: 'source-insufficient', message: 'source does not support requested depth' }));
    await writeFile(path.join(root, 'evaluation-bundle.json'), evaluation);
    manifest.artifactSha256['evaluation-bundle.json'] = hash(evaluation);
    await writeFile(path.join(root, 'run-manifest.json'), JSON.stringify(manifest));
    const result = await verifyReleaseArtifactDirectory(root, process.cwd());
    assert.equal(result.integrity, 'verified');
    assert.equal(result.attempt.completion, 'failed');
    assert.ok(!result.reasons.some((reason) => /identity|run class|pipeline do not match/.test(reason)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release verifier derives attempt identity, cold cache, completion, and rates from hash-pinned artifacts', async () => {
  const { root } = await fixture('failed');
  try {
    const result = await verifyReleaseArtifactDirectory(root, process.cwd());
    assert.equal(result.integrity, 'verified');
    assert.equal(result.attempt.attemptId, 'osmosis-trial-1');
    assert.equal(result.attempt.topicId, 'osmosis');
    assert.equal(result.attempt.trial, 1);
    assert.equal(result.attempt.cold, undefined, 'manifest-only cache claims are not cold-run evidence');
    assert.ok(result.unmeasured.some((reason) => reason.includes('cache mode')));
    assert.equal(result.attempt.completion, 'failed');
    assert.equal(result.attempt.majorVisualCoverage, 0.93);
    assert.equal(result.attempt.lastResortTextRate, 0.12);
    assert.equal(result.attempt.wrongSemanticIcons, undefined);
    assert.ok(result.unmeasured.some((reason) => reason.includes('wrong semantic icon')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing artifact directories remain unmeasured rather than failed', async () => {
  const missing = path.join(os.tmpdir(), `missing-release-run-${Date.now()}`);
  const result = await verifyReleaseArtifactDirectory(missing, process.cwd());
  assert.equal(result.integrity, 'unmeasured');
  assert.equal(result.attempt.completion, 'partial');
  assert.equal(result.reasons.length, 0);
  assert.ok(result.unmeasured.includes('run-manifest.json is missing'));
});

test('hash mismatch invalidates the run and prevents a passed completion claim', async () => {
  const { root, manifest } = await fixture('passed');
  try {
    await writeFile(path.join(root, 'evaluation-bundle.json'), '{"tampered":true}');
    const result = await verifyReleaseArtifactDirectory(root, process.cwd());
    assert.equal(result.integrity, 'failed');
    assert.equal(result.attempt.completion, 'failed');
    assert.ok(result.reasons.some((reason) => reason.includes('SHA-256 mismatch')));
    assert.ok(manifest.artifactSha256['evaluation-bundle.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('run manifest benchmark identity must match the exact frozen topic/trial/source slot', async () => {
  const { root, manifest } = await fixture('failed');
  try {
    const benchmark = manifest['benchmark'] as Record<string, unknown>;
    benchmark['trial'] = 2;
    await writeFile(path.join(root, 'run-manifest.json'), JSON.stringify(manifest));
    const result = await verifyReleaseArtifactDirectory(root, process.cwd());
    assert.equal(result.integrity, 'failed');
    assert.ok(result.reasons.some((reason) => reason.includes('does not match frozen slot osmosis-trial-1')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('passed status requires hash-pinned lock and render artifacts', async () => {
  const { root } = await fixture('passed');
  try {
    const result = await verifyReleaseArtifactDirectory(root, process.cwd());
    assert.equal(result.attempt.completion, 'partial');
    assert.ok(result.unmeasured.some((reason) => reason.includes('requires hash-pinned lesson.lock.json')));
    assert.equal(result.attempt.lockRerenderPassed, undefined, 'missing artifacts are unmeasured rather than a rerender failure');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('draft status proceeds to mechanical completion checks and still requires the hashed render boundary', async () => {
  const { root } = await fixture('draft');
  try {
    const result = await verifyReleaseArtifactDirectory(root, process.cwd());
    assert.equal(result.attempt.completion, 'partial');
    assert.ok(result.unmeasured.some((reason) => reason.includes('requires hash-pinned lesson.lock.json')));
    assert.ok(!result.unmeasured.some((reason) => reason.includes('evaluation bundle status')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('collection leaves held-out, human review, and asset rights evidence unmeasured', async () => {
  const { root } = await fixture('failed');
  try {
    const report = await collectReleaseArtifactEvidence([root], process.cwd());
    assert.equal(report.status, 'unmeasured', 'artifact integrity is separate from an incomplete benchmark design');
    assert.deepEqual(report.topicIds, ['drug-half-life', 'osmosis', 'spaced-repetition', 'thermostat-feedback', 'vaccination']);
    assert.ok(report.reasons.some((reason) => reason.includes('osmosis-trial-2 is missing')));
    assert.equal(report.humanReview.status, 'unmeasured');
    assert.equal(report.heldOut.status, 'unmeasured');
    assert.equal(report.assetRights.status, 'unmeasured');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('manifest cannot use an artifact path that escapes its run directory', async () => {
  const { root, manifest } = await fixture('failed');
  const outside = path.join(root, '..', `${path.basename(root)}-outside.json`);
  try {
    await writeFile(outside, '{}');
    manifest.artifactSha256['../' + path.basename(outside)] = hash('{}');
    await writeFile(path.join(root, 'run-manifest.json'), JSON.stringify(manifest));
    const result = await verifyReleaseArtifactDirectory(root, process.cwd());
    assert.equal(result.integrity, 'failed');
    assert.ok(result.reasons.some((reason) => reason.includes('unsafe artifact path')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

test('a run whose lock admitted review-licence assets (local-dev) can never satisfy release rights compliance', async () => {
  const { root, manifest } = await fixture('draft');
  try {
    const lock = JSON.stringify({ schemaVersion: 'lesson.lock/v4', status: 'renderable', execution: { cacheMode: 'cold' }, modelSettings: { run: { cache: 'cold' } }, assets: { usageContext: 'local-dev' } });
    await writeFile(path.join(root, 'lesson.lock.json'), lock);
    manifest.artifactSha256['lesson.lock.json'] = hash(lock);
    await writeFile(path.join(root, 'run-manifest.json'), JSON.stringify(manifest));
    const result = await verifyReleaseArtifactDirectory(root, process.cwd());
    assert.ok(result.reasons.some((reason) => /local-dev/.test(reason)), result.reasons.join(' | '));
    assert.equal(result.attempt.assetRightsAndProvenanceComplete, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

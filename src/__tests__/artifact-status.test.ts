import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { certifyArtifact, isArtifactStatus, REQUIRED_ARTIFACT_GATE_IDS, verifyArtifactCertification } from '../shared/artifactStatus.js';

const passed = REQUIRED_ARTIFACT_GATE_IDS.map((id) => ({ id, status: 'passed' as const }));
const hash = 'a'.repeat(64);
const reportBytes = JSON.stringify({ schemaVersion: 'artifact-human-review-report/v1', status: 'passed', artifactSha256: hash });
const reportSha256 = createHash('sha256').update(reportBytes, 'utf8').digest('hex');

test('artifact certification is fail-closed across the four states', () => {
  assert.equal(certifyArtifact({ artifactValid: false, gates: passed }).artifactStatus, 'FAILED');
  assert.equal(certifyArtifact({ artifactValid: true, gates: [] }).artifactStatus, 'DRAFT', 'missing gate evidence is not a pass');
  assert.equal(certifyArtifact({ artifactValid: true, gates: [...passed, { id: 'fallback-free', status: 'failed' }] }).artifactStatus, 'DRAFT');
  assert.equal(certifyArtifact({ artifactValid: true, gates: [...passed, { id: 'human-quality', status: 'unmeasured' }] }).artifactStatus, 'DRAFT');
  assert.equal(certifyArtifact({ artifactValid: true, gates: passed }).artifactStatus, 'PASSED_AUTOMATED');
  const attestation = { schemaVersion: 'artifact-human-review/v1' as const, status: 'passed' as const, artifactSha256: hash, reportSha256 };
  assert.equal(certifyArtifact({ artifactValid: true, artifactSha256: hash, gates: passed, humanReview: attestation, humanReviewReportBytes: reportBytes }).artifactStatus, 'PASSED_REVIEW');
  assert.equal(certifyArtifact({ artifactValid: true, artifactSha256: hash, gates: passed, humanReview: attestation }).artifactStatus, 'DRAFT', 'a digest string alone is not proof of a review report');
  assert.equal(certifyArtifact({ artifactValid: true, artifactSha256: hash, gates: passed, humanReview: attestation, humanReviewReportBytes: `${reportBytes} ` }).artifactStatus, 'DRAFT', 'report bytes must match the attested digest');
  assert.equal(certifyArtifact({ artifactValid: true, artifactSha256: hash, gates: passed, humanReview: { ...attestation, artifactSha256: 'c'.repeat(64) }, humanReviewReportBytes: reportBytes }).artifactStatus, 'DRAFT', 'review against another artifact cannot promote this one');
});

test('legacy lowercase statuses cannot be promoted by inference', () => {
  assert.equal(isArtifactStatus('PASSED_AUTOMATED'), true);
  assert.equal(isArtifactStatus('PASSED_REVIEW'), true);
  assert.equal(isArtifactStatus('passed'), false);
  assert.equal(isArtifactStatus('draft'), false);
});

test('persisted passing certificates must agree with their automatic gates and pinned review evidence', () => {
  const automated = certifyArtifact({ artifactValid: true, artifactSha256: hash, gates: passed });
  assert.equal(verifyArtifactCertification(automated, { artifactSha256: hash }), true);
  assert.equal(verifyArtifactCertification({ ...automated, artifactGates: [...passed, { id: 'mutated-gate', status: 'unmeasured' }] }, { artifactSha256: hash }), false);
  const reviewed = certifyArtifact({
    artifactValid: true, artifactSha256: hash, gates: passed,
    humanReview: { schemaVersion: 'artifact-human-review/v1', status: 'passed', artifactSha256: hash, reportSha256 },
    humanReviewReportBytes: reportBytes,
  });
  assert.equal(verifyArtifactCertification(reviewed, { artifactSha256: hash, humanReviewReportBytes: reportBytes }), true);
  assert.equal(verifyArtifactCertification(reviewed, { artifactSha256: hash }), false, 'review pass needs the report bytes, not only a certificate claim');
  assert.equal(verifyArtifactCertification(reviewed, { artifactSha256: 'c'.repeat(64), humanReviewReportBytes: reportBytes }), false);
});

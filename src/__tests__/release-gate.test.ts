import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateReleaseEvidence,
  RELEASE_GATE_VERSION,
  type ColdAttemptEvidence,
  type ReleaseEvidence,
} from '../harness/releaseGate.js';
import { unverifiedArtifactReport } from '../harness/releaseGateCli.js';

const topics = ['topic-A', 'topic-B', 'topic-C', 'topic-D', 'topic-E'];

function completeAttempt(topicId: string, trial: number): ColdAttemptEvidence {
  return {
    attemptId: `${topicId}-${trial}`,
    topicId,
    trial,
    cold: true,
    completion: 'complete',
    wrongSemanticIcons: 0,
    unsupportedMajorClaims: 0,
    meaningChangingGeometryFailures: 0,
    majorVisualCoverage: 0.9,
    requiredRelationCoverage: 0.9,
    stateChangeCoverage: 0.9,
    lastResortTextRate: 0.15,
    lockRerenderPassed: true,
    assetRightsAndProvenanceComplete: true,
  };
}

function validEvidence(): ReleaseEvidence {
  const attempts = topics.flatMap((topicId) => [1, 2, 3].map((trial) => completeAttempt(topicId, trial)));
  // Fourteen complete runs meets the aggregate threshold while leaving one
  // explicitly recorded partial attempt; every topic still has at least two.
  attempts[14] = { ...attempts[14]!, completion: 'partial' };
  const majorSceneIds = ['scene-a', 'scene-b'];
  const responses = majorSceneIds.flatMap((sceneId) => [1, 2, 3].map((reviewer) => ({
    sceneId,
    reviewerId: `reviewer-${reviewer}`,
    responseId: `${sceneId}-response-${reviewer}`,
    score: sceneId === 'scene-a' || reviewer < 3 ? 2 : 1,
  })));
  return {
    topicIds: topics,
    majorSceneIds,
    mutedBoardPackSha256: 'c'.repeat(64),
    attempts,
    heldOut: { datasetVersion: 'heldout/v1', frozenBeforeFinalTuning: true, reportSha256: 'a'.repeat(64), attemptedRuns: 8, allFailuresReported: true, releaseCriteriaPassed: true },
    alignmentCalibration: { calibrationId: 'alignment/v1', calibrationSha256: 'b'.repeat(64), status: 'measured', reviewerIds: ['annotator-a', 'annotator-b'], sourceDocumentCount: 3, wordItemCount: 100, reviewerAgreementPassed: true },
    mutedBoardResponses: responses,
  };
}

test('release evaluator passes exactly at all proposed threshold edges', () => {
  const report = evaluateReleaseEvidence(validEvidence());
  assert.equal(report.schemaVersion, RELEASE_GATE_VERSION);
  assert.equal(report.status, 'passed');
  for (const [name, gate] of Object.entries(report.gates)) {
    assert.equal(gate.status, 'passed', `${name}: ${gate.reasons.join('; ')}`);
  }
});

test('release CLI cannot report caller-supplied all-pass JSON as verified release evidence', () => {
  const preview = evaluateReleaseEvidence(validEvidence());
  assert.equal(preview.status, 'passed');
  const report = unverifiedArtifactReport(preview, 'a'.repeat(64));
  assert.equal(report.status, 'unmeasured');
  assert.equal(report.artifactVerification.status, 'unverified');
  assert.equal(report.calculatedPreview.status, 'passed', 'threshold preview remains inspectable for offline evaluator tests');
  assert.ok(Object.values(report.gates).every((gate) => gate.status === 'unmeasured'));
});

test('release evaluator fails when fewer than 14 runs complete or a topic has fewer than two', () => {
  const evidence = validEvidence();
  evidence.attempts![0] = { ...evidence.attempts![0]!, completion: 'failed' };
  evidence.attempts![1] = { ...evidence.attempts![1]!, completion: 'partial' };
  const report = evaluateReleaseEvidence(evidence);
  assert.equal(report.gates.completeRunCount.status, 'failed');
  assert.equal(report.gates.perTopicCompletion.status, 'failed');
  assert.equal(report.status, 'failed');
});

test('per-run acceptance limits fail on any wrong icon, unsupported claim, geometry failure, or threshold breach', () => {
  const evidence = validEvidence();
  evidence.attempts![3] = {
    ...evidence.attempts![3]!,
    wrongSemanticIcons: 1,
    unsupportedMajorClaims: 1,
    meaningChangingGeometryFailures: 1,
    majorVisualCoverage: 0.899,
    requiredRelationCoverage: 0.899,
    stateChangeCoverage: 0.899,
    lastResortTextRate: 0.151,
    lockRerenderPassed: false,
    assetRightsAndProvenanceComplete: false,
  };
  const report = evaluateReleaseEvidence(evidence);
  for (const gateName of [
    'wrongSemanticIcons', 'unsupportedMajorClaims', 'meaningChangingGeometry',
    'majorVisualCoverage', 'requiredRelationCoverage', 'stateChangeCoverage', 'lastResortTextRate',
    'lockRerender', 'assetRightsAndProvenance',
  ] as const) assert.equal(report.gates[gateName].status, 'failed', gateName);
  assert.equal(report.status, 'failed');
});

test('missing run, metric, rerender, rights, and human results remain unmeasured', () => {
  const evidence = validEvidence();
  evidence.attempts![0] = { ...evidence.attempts![0]!, completion: undefined };
  evidence.attempts![1] = { ...evidence.attempts![1]!, majorVisualCoverage: undefined };
  evidence.attempts![2] = { ...evidence.attempts![2]!, lockRerenderPassed: undefined };
  evidence.attempts![3] = { ...evidence.attempts![3]!, assetRightsAndProvenanceComplete: undefined };
  evidence.mutedBoardResponses = [{ sceneId: 'scene-a', reviewerId: 'reviewer-1' }];
  evidence.heldOut = undefined;
  evidence.alignmentCalibration = undefined;
  const report = evaluateReleaseEvidence(evidence);
  assert.equal(report.gates.completeRunCount.status, 'unmeasured');
  assert.equal(report.gates.perTopicCompletion.status, 'unmeasured');
  assert.equal(report.gates.majorVisualCoverage.status, 'unmeasured');
  assert.equal(report.gates.lockRerender.status, 'unmeasured');
  assert.equal(report.gates.assetRightsAndProvenance.status, 'unmeasured');
  assert.equal(report.gates.mutedBoardInterpretation.status, 'unmeasured');
  assert.equal(report.status, 'unmeasured');
});

test('partial and failed cold attempts count toward trial design but require no completed-run quality metrics', () => {
  const evidence: ReleaseEvidence = {
    topicIds: topics,
    attempts: topics.flatMap((topicId) => [1, 2, 3].map((trial) => ({
      attemptId: `${topicId}-${trial}`, topicId, trial, cold: true,
      completion: trial === 1 ? 'complete' as const : trial === 2 ? 'partial' as const : 'failed' as const,
      ...(trial === 1 ? {
        wrongSemanticIcons: 0, unsupportedMajorClaims: 0, meaningChangingGeometryFailures: 0,
        majorVisualCoverage: 0.9, requiredRelationCoverage: 0.9, stateChangeCoverage: 0.9,
        lastResortTextRate: 0.15, lockRerenderPassed: true, assetRightsAndProvenanceComplete: true,
      } : {}),
    }))),
    majorSceneIds: ['scene-a'],
    mutedBoardPackSha256: 'c'.repeat(64),
    mutedBoardResponses: [1, 2, 3].map((reviewer) => ({ sceneId: 'scene-a', reviewerId: `r${reviewer}`, responseId: `x${reviewer}`, score: 2 })),
  };
  const report = evaluateReleaseEvidence(evidence);
  assert.equal(report.gates.coldAttemptDesign.status, 'passed');
  assert.equal(report.gates.completeRunCount.status, 'failed');
  assert.equal(report.gates.wrongSemanticIcons.status, 'passed');
  assert.equal(report.gates.mutedBoardInterpretation.status, 'passed');
  assert.equal(report.status, 'failed');
});

test('missing, duplicate, non-cold, or unknown trials never satisfy the cold design gate', () => {
  const evidence = validEvidence();
  evidence.attempts![0] = { ...evidence.attempts![0]!, cold: false };
  evidence.attempts![1] = { ...evidence.attempts![1]!, trial: 1 };
  const report = evaluateReleaseEvidence(evidence);
  assert.equal(report.gates.coldAttemptDesign.status, 'failed');

  const missing = evaluateReleaseEvidence({ topicIds: topics, attempts: validEvidence().attempts!.slice(0, 14) });
  assert.equal(missing.gates.coldAttemptDesign.status, 'unmeasured');
  assert.equal(missing.gates.completeRunCount.status, 'unmeasured');
});

test('muted-board score uses score 2 only and requires two independent reviewers for every major scene', () => {
  const below = validEvidence();
  below.majorSceneIds = ['scene-a'];
  below.mutedBoardResponses = Array.from({ length: 5 }, (_, index) => ({ sceneId: 'scene-a', reviewerId: `r${index}`, responseId: `x${index}`, score: index < 3 ? 2 : 1 }));
  assert.equal(evaluateReleaseEvidence(below).gates.mutedBoardInterpretation.status, 'failed');

  const exact = validEvidence();
  exact.majorSceneIds = ['scene-a'];
  exact.mutedBoardResponses = Array.from({ length: 5 }, (_, index) => ({ sceneId: 'scene-a', reviewerId: `r${index}`, responseId: `y${index}`, score: index < 4 ? 2 : 0 }));
  assert.equal(evaluateReleaseEvidence(exact).gates.mutedBoardInterpretation.status, 'passed');

  exact.majorSceneIds = ['scene-a'];
  exact.mutedBoardResponses = [{ sceneId: 'scene-a', reviewerId: 'r1', responseId: 'only-one', score: 2 }, { sceneId: 'scene-a', reviewerId: 'r2', responseId: 'two', score: 2 }];
  assert.equal(evaluateReleaseEvidence(exact).gates.mutedBoardInterpretation.status, 'passed');
  exact.majorSceneIds = ['scene-a', 'scene-b'];
  exact.mutedBoardResponses = [{ sceneId: 'scene-a', reviewerId: 'r1', responseId: 'only-one', score: 2 }];
  assert.equal(evaluateReleaseEvidence(exact).gates.mutedBoardInterpretation.status, 'unmeasured');
});

test('release cannot pass without held-out, measured alignment calibration, and separate relation/state evidence', () => {
  const evidence = validEvidence();
  evidence.heldOut = undefined;
  evidence.alignmentCalibration = undefined;
  evidence.attempts![0] = { ...evidence.attempts![0]!, stateChangeCoverage: undefined };
  const report = evaluateReleaseEvidence(evidence);
  assert.equal(report.gates.heldOutBenchmark.status, 'unmeasured');
  assert.equal(report.gates.alignmentCalibration.status, 'unmeasured');
  assert.equal(report.gates.stateChangeCoverage.status, 'unmeasured');
  assert.equal(report.status, 'unmeasured');

  const underpowered = validEvidence();
  underpowered.alignmentCalibration = {
    ...underpowered.alignmentCalibration!, sourceDocumentCount: 2, wordItemCount: 99,
  };
  assert.equal(evaluateReleaseEvidence(underpowered).gates.alignmentCalibration.status, 'unmeasured');
});

test('duplicate muted-board response artifacts cannot count twice', () => {
  const evidence = validEvidence();
  evidence.mutedBoardResponses![1] = { ...evidence.mutedBoardResponses![1]!, responseId: evidence.mutedBoardResponses![0]!.responseId };
  assert.equal(evaluateReleaseEvidence(evidence).gates.mutedBoardInterpretation.status, 'failed');
});

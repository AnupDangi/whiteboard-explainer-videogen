import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash as sha256 } from 'node:crypto';
import { buildE5BlindPackages, evaluateE5HumanVotes, sumSuccessfulVideoApiCost, type E5BlindPairInput, type E5HumanVoteFile } from '../harness/e5HumanReview.js';
import { auditE5Organizer } from '../harness/e5HumanReviewAudit.js';
import type { StageRunRecord } from '../../shared/contracts.js';

const pairs: E5BlindPairInput[] = ['topic-one', 'topic-two', 'topic-three'].map((caseId, index) => ({
  pairId: `pair-${index + 1}`, caseId, contrast: 'prompt-arm',
  runA: { runId: `zero-${index}`, treatment: { arm: 'zero', exampleOrder: 'ranked', plannerModel: 'planner-x' }, successfulVideoCostUsd: 0.08, videoPath: `/generated/${caseId}/zero/video.mp4` },
  runB: { runId: `mechanism-${index}`, treatment: { arm: 'mechanism', exampleOrder: 'ranked', plannerModel: 'planner-x' }, successfulVideoCostUsd: 0.06, videoPath: `/generated/${caseId}/mechanism/video.mp4` },
}));

function makePack() {
  let nextId = 0;
  return buildE5BlindPackages('package-1', pairs, () => 0.2, () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`);
}
function makeVote(participantId: 'judge-1' | 'judge-2', packageId: string, itemIds: string[], preferred: 'A' | 'B'): E5HumanVoteFile {
  return { schemaVersion: 'e5-human-vote/v1', packageId, participantId, votes: itemIds.map((itemId) => ({ itemId, preferred, clarityA: participantId === 'judge-1' ? 5 : 3, clarityB: participantId === 'judge-1' ? 3 : 5, mechanismA: participantId === 'judge-1' ? 4 : 2, mechanismB: participantId === 'judge-1' ? 2 : 4, factualConcernA: false, factualConcernB: true })) };
}

test('E5 timed-video review packages hide treatments and counterbalance A/B order for two judges', () => {
  const result = makePack();
  assert.equal(result.participants.length, 2);
  assert.equal(result.participants[0]!.pairs.length, 3);
  assert.deepEqual(result.participants[0]!.pairs.map(({ itemId }) => itemId), result.participants[1]!.pairs.map(({ itemId }) => itemId));
  for (const [index, first] of result.answerKey.participants['judge-1'].entries()) {
    const second = result.answerKey.participants['judge-2'][index]!;
    assert.equal(first.leftRunId, second.rightRunId);
    assert.equal(first.rightRunId, second.leftRunId);
  }
  const participantJson = JSON.stringify(result.participants);
  assert.doesNotMatch(participantJson, /runId|plannerModel|mechanism/);
  assert.match(participantJson, /videos\/[a-f0-9-]+\.mp4/);
});

test('E5 report preserves individual votes and scores preference, clarity, mechanism, factual concerns, and full-video cost by treatment', () => {
  const { answerKey } = makePack();
  const ids = answerKey.participants['judge-1'].map(({ itemId }) => itemId);
  const report = evaluateE5HumanVotes(answerKey, [makeVote('judge-1', answerKey.packageId, ids, 'A'), makeVote('judge-2', answerKey.packageId, ids, 'B')]);
  assert.equal(report.status, 'measured');
  assert.equal(report.distinctCases, 3);
  assert.equal(report.judges.length, 2);
  const zero = report.aggregateByTreatment.find(({ treatment }) => treatment.arm === 'zero')!;
  const mechanism = report.aggregateByTreatment.find(({ treatment }) => treatment.arm === 'mechanism')!;
  assert.equal(zero.preferenceShare, 1);
  assert.equal(mechanism.preferenceShare, 0);
  assert.equal(zero.meanClarity, 5);
  assert.equal(mechanism.meanClarity, 3);
  assert.equal(zero.meanMechanismExplanation, 4);
  assert.equal(mechanism.factualConcernRate, 0.5);
  assert.equal(zero.meanSuccessfulVideoCostUsd, 0.08);
  assert.equal(mechanism.meanSuccessfulVideoCostUsd, 0.06);
  assert.equal((report.judges[0]!.votes[0] as { caseId: string }).caseId, 'topic-one');
});

test('E5 leaves incomplete or malformed human reviews unmeasured', () => {
  const { answerKey } = makePack();
  const ids = answerKey.participants['judge-1'].map(({ itemId }) => itemId);
  const oneJudge = evaluateE5HumanVotes(answerKey, [makeVote('judge-1', answerKey.packageId, ids, 'A')]);
  assert.equal(oneJudge.status, 'unmeasured');
  assert.match(oneJudge.reasons.join('|'), /requires two independent human judges/);
  const incomplete = makeVote('judge-2', answerKey.packageId, ids.slice(1), 'B');
  const missingPair = evaluateE5HumanVotes(answerKey, [makeVote('judge-1', answerKey.packageId, ids, 'A'), incomplete]);
  assert.equal(missingPair.status, 'unmeasured');
  assert.match(missingPair.reasons.join('|'), /cover each pair exactly once/);
});

test('E5 accepts a controlled planner-model contrast while rejecting uncontrolled pair inputs', () => {
  const plannerPair = structuredClone(pairs.slice(0, 1));
  plannerPair[0]!.contrast = 'planner-model';
  plannerPair[0]!.runB.treatment = { ...plannerPair[0]!.runA.treatment, plannerModel: 'planner-y' };
  assert.doesNotThrow(() => buildE5BlindPackages('model-pair', plannerPair, () => 0.3, () => 'opaque'));
  const invalid = structuredClone(pairs.slice(0, 1));
  invalid[0]!.runB.treatment = { ...invalid[0]!.runA.treatment };
  assert.throws(() => buildE5BlindPackages('invalid', invalid), /treatment contrast/);
});

test('successful-video cost restores original spend from warm cached provider artifacts', () => {
  const stages: StageRunRecord[] = [
    { stage: 'S2', kind: 'provider', status: 'completed', durationMs: 1, apiCostUsd: 0.03, cacheHit: false, fallbackCount: 0, failures: [] },
    { stage: 'S3', kind: 'provider', status: 'completed', durationMs: 1, apiCostUsd: 0, artifactApiCostUsd: 0.05, cacheHit: true, fallbackCount: 0, failures: [] },
    { stage: 'S5', kind: 'local', status: 'completed', durationMs: 1, apiCostUsd: 0, cacheHit: true, fallbackCount: 0, failures: [] },
    { stage: 'S6', kind: 'mixed', status: 'completed', durationMs: 1, apiCostUsd: 0.02, cacheHit: false, fallbackCount: 0, failures: [] },
  ];
  assert.equal(sumSuccessfulVideoApiCost(stages), 0.1);
  assert.throws(() => sumSuccessfulVideoApiCost([{ ...stages[1]!, artifactApiCostUsd: undefined }]), /cached without its original artifact cost/);
});

test('E5 organizer audit binds scoring to the sealed key, matched treatments, costs, and held-out provenance', () => {
  const { answerKey } = makePack();
  const answerKeyText = `${JSON.stringify(answerKey, null, 2)}\n`;
  const zeros = 'a'.repeat(64);
  const provenance = pairs.map((input) => {
    const row = answerKey.participants['judge-1'].find((item) => item.caseId === input.caseId)!;
    const runA = input.runA.runId === row.leftRunId ? input.runA : input.runB;
    const runB = input.runA.runId === row.rightRunId ? input.runA : input.runB;
    const organizerRun = (run: typeof runA) => ({
      runId: run.runId, caseId: input.caseId, treatment: run.treatment, successfulVideoCostUsd: run.successfulVideoCostUsd,
      runManifestSha256: zeros, evaluationBundleSha256: zeros, sourceDocumentSha256: zeros, videoSha256: zeros,
    });
    return { pairId: input.pairId, itemId: row.itemId, contrast: input.contrast, runA: organizerRun(runA), runB: organizerRun(runB) };
  });
  const organizer = {
    schemaVersion: 'e5-organizer-record/v1', packageId: answerKey.packageId, answerKeySha256: sha256('sha256').update(answerKeyText).digest('hex'), pairListSha256: zeros,
    heldOutSet: { setId: 'heldout-v1', version: '1', sha256: zeros }, pairs: provenance,
  };
  const serializedOrganizer = JSON.stringify(organizer);
  assert.equal(auditE5Organizer(answerKey, organizer, answerKeyText, serializedOrganizer).status, 'verified');
  const altered = structuredClone(answerKey);
  altered.participants['judge-1'][0]!.leftCostUsd += 0.01;
  assert.match(auditE5Organizer(altered, organizer, JSON.stringify(altered), serializedOrganizer).reasons.join('|'), /hash does not match|cost mapping differs/);
  const changedProvenance = structuredClone(organizer);
  changedProvenance.pairs[0]!.runA.runId = 'unrelated-run';
  assert.match(auditE5Organizer(answerKey, changedProvenance, answerKeyText, JSON.stringify(changedProvenance)).reasons.join('|'), /run mapping differs/);
});

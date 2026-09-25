import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildE1BlindPackage, evaluateE1HumanVotes, type E1AnswerKey, type E1HumanVoteFile } from '../harness/humanReview.js';
import { writeE1ParticipantPack } from '../harness/humanReviewPack.js';
import { buildE1ReviewHtml } from '../harness/humanReviewViewer.js';

const key: E1AnswerKey = {
  schemaVersion: 'e1-answer-key/v1', packageId: 'e1-test',
  itemSources: Object.fromEntries([
    ...Array.from({ length: 10 }, (_, i) => [`gen-${i}`, 'generated']),
    ...Array.from({ length: 10 }, (_, i) => [`ref-${i}`, 'reference']),
  ]) as E1AnswerKey['itemSources'],
};

function review(participantId: string, reverse = false): E1HumanVoteFile {
  const votes = Object.entries(key.itemSources).map(([itemId, source], index) => {
    const firstHalf = index % 10 < 5;
    const generatedIsA = reverse ? !firstHalf : firstHalf;
    const sourceGroup = (source === 'generated') === generatedIsA ? 'A' : 'B';
    return { itemId, sourceGroup: sourceGroup as 'A' | 'B', styleCoherence: 4 };
  });
  return { schemaVersion: 'e1-human-vote/v1', packageId: key.packageId, participantId, votes };
}

test('E1 preserves individual votes and passes only two blind judges meeting both thresholds', () => {
  const reviews = [review('judge-a'), review('judge-b', true)];
  const report = evaluateE1HumanVotes(key, reviews);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.judges.map((judge) => judge.sourceAccuracy), [0.5, 0.5]);
  assert.deepEqual(report.judges.map((judge) => judge.styleCoherence), [4, 4]);
  assert.deepEqual(report.rawVotes, reviews);
});

test('E1 remains unmeasured for incomplete votes and fails when source separation or style exceeds limits', () => {
  assert.equal(evaluateE1HumanVotes(key, [review('judge-a')]).status, 'unmeasured');
  const tooAccurate = review('judge-a');
  tooAccurate.votes = tooAccurate.votes.map((vote) => ({ ...vote, sourceGroup: key.itemSources[vote.itemId] === 'generated' ? 'A' : 'B' }));
  const lowStyle = review('judge-b', true);
  lowStyle.votes = lowStyle.votes.map((vote) => ({ ...vote, styleCoherence: 3 }));
  const report = evaluateE1HumanVotes(key, [tooAccurate, lowStyle]);
  assert.equal(report.status, 'failed');
  assert.equal(report.judges[0].sourceAccuracy, 1);
  assert.equal(report.judges[1].styleCoherence, 3);
  assert.ok(report.reasons.some((reason) => reason.includes('exceeds 60%')));
  assert.ok(report.reasons.some((reason) => reason.includes('below 4/5')));
});

test('strong reference ratings cannot hide generated-frame style below the floor', () => {
  const judgeA = review('judge-a');
  const judgeB = review('judge-b', true);
  for (const vote of judgeA.votes) vote.styleCoherence = key.itemSources[vote.itemId] === 'generated' ? 3 : 5;
  const report = evaluateE1HumanVotes(key, [judgeA, judgeB]);
  assert.equal(report.judges[0].styleCoherence, 4);
  assert.equal(report.judges[0].generatedStyleCoherence, 3);
  assert.equal(report.judges[0].referenceStyleCoherence, 5);
  assert.equal(report.status, 'failed');
  assert.ok(report.reasons.some((reason) => reason.includes('generated-frame style coherence 3.00 is below 4/5')));
});

test('E1 refuses an answer key that is not a balanced 10+10 sample', () => {
  const report = evaluateE1HumanVotes({ ...key, itemSources: { onlyOne: 'generated' } }, [review('judge-a'), review('judge-b')]);
  assert.equal(report.status, 'unmeasured');
  assert.ok(report.reasons.some((reason) => reason.includes('exactly 10 generated and 10 reference')));
  assert.equal(report.judges.length, 0);
});

test('malformed answer keys and vote files return unmeasured without throwing', () => {
  const goodVotes = [review('judge-a'), review('judge-b', true)];
  const malformedKey = evaluateE1HumanVotes({ schemaVersion: 'e1-answer-key/v1', packageId: 'x', itemSources: null }, goodVotes);
  assert.equal(malformedKey.status, 'unmeasured');
  assert.ok(malformedKey.reasons.length > 0);

  for (const invalidVote of [{}, null, { schemaVersion: 'e1-human-vote/v1', packageId: 'e1-test', participantId: 'judge-a', votes: null }]) {
    const report = evaluateE1HumanVotes(key, [invalidVote, review('judge-b')]);
    assert.equal(report.status, 'unmeasured');
    assert.equal(report.rawVotes[0], invalidVote);
    assert.ok(report.reasons.some((reason) => reason.includes('judge 1 vote file')));
  }

  const invalidJson = evaluateE1HumanVotes(key, [{ __parseError: 'Unexpected token' }, review('judge-b')]);
  assert.equal(invalidJson.status, 'unmeasured');
  assert.ok(invalidJson.reasons.some((reason) => reason.includes('JSON parse error')));
});

test('blind package keeps source labels out of independently shuffled participant manifests', () => {
  const inputs = Object.entries(key.itemSources).map(([itemId, source], index) => ({
    itemId, source, imagePath: `images/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.png`,
  }));
  let randomCall = 0;
  const pack = buildE1BlindPackage('blind-test', inputs, () => ((randomCall++ * 73 + 19) % 997) / 997);
  const [first, second] = pack.participants;
  assert.equal(Object.keys(pack.answerKey.itemSources).length, 20);
  for (const participant of pack.participants) {
    assert.equal(participant.items.length, 20);
    assert.ok(participant.items.every((item) => !('source' in item)));
    assert.ok(participant.items.every((item) => /^images\/[a-f0-9-]+\.png$/i.test(item.imagePath)));
  }
  assert.notDeepEqual(first.items.map(({ itemId }) => itemId), second.items.map(({ itemId }) => itemId));
});

test('human review page is offline, portable, and exports the expected vote contract', () => {
  const inputs = Object.entries(key.itemSources).map(([itemId, source], index) => ({
    itemId, source, imagePath: `images/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.png`,
  }));
  const participant = buildE1BlindPackage('portable-test', inputs, () => 0).participants[0];
  const html = buildE1ReviewHtml(participant);
  assert.match(html, /review-pack/);
  assert.match(html, /item\.imagePath/);
  assert.match(html, /e1-human-vote\/v1/);
  assert.match(html, /Download vote JSON/);
  assert.match(html, /images\/00000000-0000-4000-8000-000000000000\.png/);
  assert.doesNotMatch(html, /"source":"(?:generated|reference)"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('participant folder copies its opaque images beside the review page', async () => {
  const packRoot = await mkdtemp(path.join(os.tmpdir(), 'e1-participant-pack-'));
  const imagePath = 'images/00000000-0000-4000-8000-000000000123.png';
  const imageBytes = Buffer.from('synthetic-png-bytes');
  try {
    await mkdir(path.join(packRoot, 'images'), { recursive: true });
    await writeFile(path.join(packRoot, imagePath), imageBytes);
    const participant = { schemaVersion: 'e1-blind-pack/v1' as const, packageId: 'portable-pack', participantId: 'judge-1', items: [{ itemId: 'opaque-item-1', imagePath }] };
    const participantDir = await writeE1ParticipantPack(packRoot, participant);
    assert.deepEqual(await readFile(path.join(participantDir, imagePath)), imageBytes);
    assert.match(await readFile(path.join(participantDir, 'review.html'), 'utf8'), /images\/00000000-0000-4000-8000-000000000123\.png/);
    assert.equal(JSON.parse(await readFile(path.join(participantDir, 'blind-pack.json'), 'utf8')).items[0].itemId, 'opaque-item-1');
    assert.ok((await readFile(path.join(participantDir, 'instructions.txt'), 'utf8')).includes('do not share this folder'));
  } finally {
    await rm(packRoot, { recursive: true, force: true });
  }
});

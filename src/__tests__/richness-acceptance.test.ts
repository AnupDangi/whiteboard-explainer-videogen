import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeReviewFrom } from '../assets/badgeReview.js';
import { scoreWrongIcons } from '../harness/wrongIcon.js';
import { evaluateRichnessAcceptance } from '../harness/richnessAcceptance.js';
import type { IconUse, V2RichnessSummary } from '../harness/v2Richness.js';
import type { RichnessReport } from '../harness/v2RichnessReport.js';

const use = (assetId: string, referent: string): IconUse => ({ elementId: referent, referent, assetId, sidePx: 80, kind: 'badge' });
const summary = (over: Partial<V2RichnessSummary>): V2RichnessSummary => ({ scenes: 4, iconBearingShare: 0, labelOnlyEntityRatio: 1, distinctAssetIds: 0, familyMixScenes: 0, assetReuseConflicts: 0, minIconSidePx: null, meanTextChars: 100, meanWordsOnBoard: 20, meanElementVariety: 3, ...over });
const report = (pooled: V2RichnessSummary, hardFailures: number | null = 0): RichnessReport => ({ schemaVersion: 'v2-richness/v1', composition: 'icon-cards', pooled, runs: [{ runDir: 'r', lessonId: 'l', complete: true, status: 'loaded', hardFailures, timelineReplayMismatches: 0, summary: pooled, scenes: [], icons: [], pendingReview: [] }] });

test('wrong-icon rate counts only reviewed uses and reports coverage', () => {
  const review = badgeReviewFrom([
    { assetId: 'a', referent: 'cell', verdict: 'accept', reviewer: 'r', date: '2026-10-08' },
    { assetId: 'b', referent: 'time', verdict: 'reject', reviewer: 'r', date: '2026-10-08' },
  ]);
  const score = scoreWrongIcons([use('a', 'cell'), use('b', 'time'), use('c', 'coin')], review);
  assert.equal(score.uses, 3);
  assert.equal(score.reviewed, 2);
  assert.equal(score.wrong, 1);
  assert.equal(score.wrongIconRate, 0.5);
  assert.equal(score.coverage, 2 / 3);
  assert.deepEqual(score.unreviewedKeys, ['c|coin']);
});

test('acceptance passes only when every rule holds', () => {
  const full = { uses: 10, reviewed: 10, wrong: 0, coverage: 1, wrongIconRate: 0, unreviewedKeys: [] };
  const ok = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live: report(summary({ iconBearingShare: 0.45, minIconSidePx: 60, meanTextChars: 105 })), wrongIcons: full });
  assert.equal(ok.passed, true, JSON.stringify(ok.checks));
  const partialReview = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live: report(summary({ iconBearingShare: 0.45, minIconSidePx: 60 })), wrongIcons: { ...full, reviewed: 9, coverage: 0.9 } });
  assert.equal(partialReview.passed, false);
  const hard = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live: report(summary({ iconBearingShare: 0.45, minIconSidePx: 60 }), 1), wrongIcons: full });
  assert.equal(hard.passed, false);
  const mixed = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live: report(summary({ iconBearingShare: 0.45, minIconSidePx: 60, familyMixScenes: 1 })), wrongIcons: full });
  assert.equal(mixed.passed, false);
});

test('a failed attempt in the live batch fails acceptance even when another run completed', () => {
  const full = { uses: 10, reviewed: 10, wrong: 0, coverage: 1, wrongIconRate: 0, unreviewedKeys: [] };
  const pooled = summary({ iconBearingShare: 0.45, minIconSidePx: 60 });
  const live = report(pooled);
  live.runs.push({ ...live.runs[0]!, runDir: 'failed', complete: false, status: 'unavailable', hardFailures: 2, summary: summary({}) });
  const result = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live, wrongIcons: full });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === 'hard failures')!.pass, false);
  assert.equal(result.checks.find((check) => check.name === 'complete live runs')!.pass, false);
});

test('a complete run whose replay does not match the recorded timeline fails acceptance', () => {
  const full = { uses: 10, reviewed: 10, wrong: 0, coverage: 1, wrongIconRate: 0, unreviewedKeys: [] };
  const live = report(summary({ iconBearingShare: 0.45, minIconSidePx: 60 }));
  live.runs[0]!.timelineReplayMismatches = 1;
  const result = evaluateRichnessAcceptance({ baseline: summary({}), projection: summary({ iconBearingShare: 0.5 }), live, wrongIcons: full });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === 'replay matches recorded timeline')!.pass, false);
});

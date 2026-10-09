import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EMPTY_BADGE_REVIEW, badgeReviewFrom, loadBadgeReview } from '../assets/badgeReview.js';
import { planSceneBadges } from '../visual-v2/resolver/referentBadge.js';

const gold = JSON.parse(readFileSync(path.resolve('src/__tests__/fixtures/icon-gold.v1.json'), 'utf8')) as {
  expectNoBadge: string[]; expectSynonymRefusal: Array<{ label: string; primaryName: string }>; reviewCandidates: string[];
};
const one = (label: string, review = EMPTY_BADGE_REVIEW) => planSceneBadges([{ elementId: 'g', label }], { review });

test('gold: abstract labels with no exact catalog name never badge', () => {
  for (const label of gold.expectNoBadge) assert.equal(one(label).badges.length, 0, label);
});

test('gold: a synonym-only match is refused', () => {
  for (const { label, primaryName } of gold.expectSynonymRefusal) {
    const plan = one(label);
    assert.equal(plan.badges.length, 0, label);
    assert.match(plan.refusals[0]!.reason, new RegExp(`synonym of "${primaryName}"`));
  }
});

test('gold: review candidates resolve to exactly one primary-name badge', () => {
  for (const label of gold.reviewCandidates) assert.equal(one(label).badges.length, 1, label);
});

test('gold: a rejected verdict removes a candidate (abstract-noun guard by review)', () => {
  const first = one('time').badges[0]!;
  const review = badgeReviewFrom([{ assetId: first.assetId, referent: 'time', verdict: 'reject', reviewer: 'test', date: '2026-10-08' }]);
  assert.equal(one('time', review).badges.length, 0);
});

test('the shipped verdict file validates', () => {
  assert.doesNotThrow(() => loadBadgeReview());
});

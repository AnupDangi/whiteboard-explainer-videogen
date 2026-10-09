import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogEntry } from '../assets/catalog.js';
import { EMPTY_BADGE_REVIEW, badgeReviewFrom, reviewKey, validateBadgeDecisions } from '../assets/badgeReview.js';
import { planSceneBadges, placeBadges } from '../visual-v2/resolver/referentBadge.js';

// Synthetic catalog for contract tests only (same shape as scene-family.test.ts); never a visual measurement.
const G = 'simi-house-v1/general-drawon';
const D = 'simi-house-v1/domain-outline';
const entry = (id: string, names: string[], houseFamily: string): CatalogEntry => ({
  id, names, tags: [], meaning: '', source: 'assetlab-sketchy-downshift:x', license: 'MIT', lane: 'simple-symbol', strokePaths: 1, houseFamily,
  render: (size) => ({ paths: [{ d: `M0 0 L${size.w} ${size.h}`, length: Math.hypot(size.w, size.h) }], fills: [], texts: [] }),
});
const catalog = [entry('gen-cell', ['cell'], G), entry('dom-beaker', ['beaker'], D), entry('dom-flask', ['flask'], D), entry('gen-book', ['book', 'source'], G), entry('gen-mitosis', ['mitosis'], G)];
const opts = { catalog, review: EMPTY_BADGE_REVIEW };

test('an exact primary-name match badges and records licence and family', () => {
  const plan = planSceneBadges([{ elementId: 't1', label: 'Cells' }], opts);
  assert.equal(plan.badges.length, 1);
  assert.equal(plan.badges[0]!.assetId, 'gen-cell');
  assert.equal(plan.badges[0]!.referent, 'cell');
  assert.equal(plan.badges[0]!.license, 'MIT');
  assert.equal(plan.badges[0]!.review, 'unreviewed');
  assert.equal(plan.family, G);
  const placed = placeBadges(plan, catalog).get('t1')!;
  assert.equal(placed.draw(64).paths.length, 1);
});

test('a synonym match is refused: badges need the asset primary name', () => {
  const plan = planSceneBadges([{ elementId: 't1', label: 'source' }], opts);
  assert.equal(plan.badges.length, 0);
  assert.match(plan.refusals[0]!.reason, /synonym of "book"|no exact catalog picture/);
});

test('abstract and process labels never badge', () => {
  const plan = planSceneBadges([
    { elementId: 'e1', label: 'Mitosis', concept: { id: 'c1', label: 'Mitosis', kind: 'process' } },
    { elementId: 't1', label: '2 cells' },
    { elementId: 't2', label: 'energy' },
    { elementId: 't3', label: 'one very long noun phrase here' },
  ], opts);
  assert.equal(plan.badges.length, 0);
  assert.deepEqual(plan.refusals.map((refusal) => refusal.elementId), ['e1', 't1', 't3', 't2']);
});

test('a participant of a process concept may badge when its own label names a thing', () => {
  const plan = planSceneBadges([{ elementId: 'e1', label: 'Cell', concept: { id: 'c1', label: 'Mitosis', kind: 'process' } }], opts);
  assert.equal(plan.badges[0]?.assetId, 'gen-cell');
});

test('one family per scene: minority-family icons fall back to labels', () => {
  const plan = planSceneBadges([{ elementId: 'a', label: 'cell' }, { elementId: 'b', label: 'beaker' }, { elementId: 'c', label: 'flask' }], opts);
  assert.equal(plan.family, D);
  assert.deepEqual(plan.badges.map((badge) => badge.elementId), ['b', 'c']);
  assert.equal(plan.refusals[0]!.elementId, 'a');
});

test('a reserved asset is not reused for another referent', () => {
  const plan = planSceneBadges([{ elementId: 't1', label: 'cell' }], { ...opts, reservedAssets: new Map([['gen-cell', 'nucleus']]) });
  assert.equal(plan.badges.length, 0);
  assert.match(plan.refusals[0]!.reason, /already depicts "nucleus"/);
});

test('a rejected verdict blocks the badge; an accepted one is marked', () => {
  const rejected = planSceneBadges([{ elementId: 't1', label: 'cell' }], { catalog, review: badgeReviewFrom([{ assetId: 'gen-cell', referent: 'cell', verdict: 'reject', reviewer: 'owner', date: '2026-10-08' }]) });
  assert.equal(rejected.badges.length, 0);
  const accepted = planSceneBadges([{ elementId: 't1', label: 'cell' }], { catalog, review: badgeReviewFrom([{ assetId: 'gen-cell', referent: 'cell', verdict: 'accept', reviewer: 'owner', date: '2026-10-08' }]) });
  assert.equal(accepted.badges[0]!.review, 'accepted');
});

test('verdict validation refuses unnormalised referents, bad dates and conflicting verdicts', () => {
  const { problems } = validateBadgeDecisions([
    { assetId: 'a', referent: 'Cells', verdict: 'accept', reviewer: 'r', date: '2026-10-08' },
    { assetId: 'a', referent: 'cell', verdict: 'accept', reviewer: 'r', date: '8 Oct' },
    { assetId: 'b', referent: 'cell', verdict: 'accept', reviewer: 'r', date: '2026-10-08' },
    { assetId: 'b', referent: 'cell', verdict: 'reject', reviewer: 'r', date: '2026-10-08' },
  ]);
  assert.equal(problems.length, 3);
  assert.equal(reviewKey('a', 'cell'), 'a|cell');
});

test('entity pictures fix the scene family: badges in another family are refused, never outvote them', () => {
  const plan = planSceneBadges([{ elementId: 'b', label: 'beaker' }, { elementId: 'c', label: 'flask' }], { ...opts, extraFamilies: [G] });
  assert.equal(plan.family, G);
  assert.equal(plan.badges.length, 0);
});

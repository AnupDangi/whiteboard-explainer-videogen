import test from 'node:test';
import assert from 'node:assert/strict';
import {licensePolicy, isPermitted, assertPermitted} from '../dist/src/semantic/assets/external/license.js';
import {COLLECTION_PROFILES, collectionsFor, profileFor} from '../dist/src/semantic/assets/external/policy.js';
import {rankCandidates} from '../dist/src/semantic/assets/external/rank.js';

/** P3 (deterministic half) — licence, policy and ranking must be reproducible
 *  and fail closed, because they decide what a future network fetch is even
 *  allowed to look at. */

test('the licence gate is fail-closed and blocks share-alike and non-commercial terms', () => {
  for (const id of ['MIT', 'mit', 'ISC', 'Apache-2.0', 'CC0-1.0', 'BSD-3-Clause', 'Unlicense', '0BSD']) {
    assert.equal(licensePolicy(id), 'auto', `${id} must be auto-permitted`);
  }
  for (const id of ['CC-BY-4.0', 'CC-BY-3.0', 'OFL-1.1']) {
    assert.equal(licensePolicy(id), 'attribution', `${id} must require attribution`);
  }
  for (const id of ['CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'GPL-3.0', 'proprietary', '', '   ']) {
    assert.equal(licensePolicy(id), 'blocked', `${id || '(empty)'} must be blocked`);
  }
  assert.equal(isPermitted('MIT'), true);
  assert.equal(isPermitted('CC-BY-SA-4.0'), false);
  assert.throws(() => assertPermitted('CC-BY-SA-4.0'), /not permitted/);
  assert.doesNotThrow(() => assertPermitted('CC-BY-4.0'));
});

test('every collection profile is internally consistent with the licence gate', () => {
  for (const [prefix, profile] of Object.entries(COLLECTION_PROFILES)) {
    assert.equal(profile.prefix, prefix);
    assert.equal(profile.license.policy, licensePolicy(profile.license.id),
      `${prefix} declares ${profile.license.policy} but its licence resolves to ${licensePolicy(profile.license.id)}`);
  }
});

test('retrieval modes widen deterministically and never admit a blocked collection', () => {
  assert.deepEqual(collectionsFor('off'), []);
  const strict = collectionsFor('strict');
  const balanced = collectionsFor('balanced');
  const broad = collectionsFor('broad');
  assert.ok(strict.length > 0, 'strict must admit the stroke-only collections');
  assert.deepEqual(balanced.slice(0, strict.length), strict, 'balanced prefers stroke-only first');
  assert.ok(balanced.length > strict.length, 'balanced widens beyond strict');
  assert.deepEqual([...broad].sort(), broad, 'broad is sorted');
  for (const list of [strict, balanced, broad]) {
    assert.ok(!list.includes('openmoji'), 'a share-alike collection must never be permitted');
    assert.equal(new Set(list).size, list.length, 'a collection must not appear twice');
  }
  assert.ok(strict.every(prefix => { const p = profileFor(prefix); return p.style.outline && !p.style.fill; }),
    'strict must only admit stroke-only collections');
});

const candidate = (over) => ({provider: 'iconify', collection: 'tabler', name: 'database', licenseId: 'MIT', hasStroke: true, hasFill: false, ...over});

test('ranking excludes blocked licences and unpermitted collections, with a reason', () => {
  const outcome = rankCandidates([
    candidate({name: 'ok'}),
    candidate({name: 'share-alike', collection: 'openmoji', licenseId: 'CC-BY-SA-4.0'}),
    candidate({name: 'fill-only', collection: 'twemoji', licenseId: 'CC-BY-4.0'}),
  ], 'strict');
  assert.deepEqual(outcome.ranked.map(r => r.name), ['ok']);
  const rejected = Object.fromEntries(outcome.rejected.map(r => [r.name, r.reason]));
  assert.match(rejected['share-alike'], /licence not permitted/);
  assert.match(rejected['fill-only'], /collection not permitted in strict mode/);
});

test('retrieval disabled rejects everything instead of silently returning nothing', () => {
  const outcome = rankCandidates([candidate({})], 'off');
  assert.deepEqual(outcome.ranked, []);
  assert.equal(outcome.rejected.length, 1);
  assert.match(outcome.rejected[0].reason, /disabled/);
});

test('stroke-native candidates outrank fill-only and duotone ones', () => {
  const outcome = rankCandidates([
    candidate({name: 'filled', hasStroke: false, hasFill: true}),
    candidate({name: 'duotone', hasStroke: true, hasFill: true, duotone: true}),
    candidate({name: 'stroked'}),
  ], 'balanced');
  assert.equal(outcome.ranked[0].name, 'stroked');
  assert.ok(outcome.ranked.find(r => r.name === 'stroked').reasons.includes('stroke-native'));
  assert.ok(outcome.ranked.at(-1).score < outcome.ranked[0].score);
});

test('ranking is order-independent and stable across repeated calls', () => {
  const input = [
    candidate({name: 'zeta', collection: 'tabler'}),
    candidate({name: 'alpha', collection: 'lucide'}),
    candidate({name: 'mid', collection: 'tabler'}),
  ];
  const first = rankCandidates(input, 'balanced');
  const shuffled = rankCandidates([input[2], input[0], input[1]], 'balanced');
  assert.deepEqual(shuffled, first, 'input order must not change the outcome');
  assert.deepEqual(rankCandidates(input, 'balanced'), first, 'repeated calls must be identical');
  // equal scores fall back to collection then name
  const tied = first.ranked.filter(r => r.score === first.ranked[0].score);
  if (tied.length > 1) {
    const keys = tied.map(r => `${r.collection}/${r.name}`);
    assert.deepEqual(keys, [...keys].sort());
  }
});

test('a complexity budget penalises busy glyphs and the cap is enforced', () => {
  const outcome = rankCandidates([
    candidate({name: 'busy', partCount: 60}),
    candidate({name: 'simple', partCount: 6}),
  ], 'balanced');
  assert.equal(outcome.ranked[0].name, 'simple');
  assert.match(outcome.ranked.find(r => r.name === 'busy').reasons.join(','), /very complex/);
  assert.equal(rankCandidates(Array.from({length: 20}, (_, i) => candidate({name: `n${i}`})), 'balanced', {maxCandidates: 3}).ranked.length, 3);
  assert.throws(() => rankCandidates([], 'balanced', {maxCandidates: 0}), /maxCandidates/);
});

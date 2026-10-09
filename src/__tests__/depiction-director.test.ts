import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeDepictionNouns, resolveNouns } from '../assets/depictionDirector.js';
import type { CatalogEntry } from '../assets/catalog.js';

const G = 'simi-house-v1/general-drawon';
const D = 'simi-house-v1/domain-outline';
const entry = (id: string, name: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, names: [name], tags: [], meaning: '', source: 's', license: 'manual', lane: 'simple-symbol', strokePaths: 3, render: () => ({ paths: [], fills: [], texts: [] }), ...extra });

const CATALOG = [
  entry('bolt-g', 'lightning bolt', { houseFamily: G }),
  entry('flask-d', 'flask', { houseFamily: D, tags: ['laboratory flask'], domain: 'chemistry' }),
  entry('flask-g', 'flask', { houseFamily: G, domain: 'general' }),
  entry('clock-g', 'clock', { houseFamily: G }),
];

test('the first noun with a usable asset wins; names and aliases both match; plural and article noise is ignored', () => {
  assert.equal(resolveNouns(['rocket', 'a lightning bolts'], CATALOG)?.entryId, 'bolt-g');
  assert.equal(resolveNouns(['laboratory flask'], CATALOG)?.entryId, 'flask-d');
  assert.equal(resolveNouns(['dragon'], CATALOG), undefined);
});

test('family lock, already-used icons and lesson domain decide between equal names', () => {
  assert.equal(resolveNouns(['flask'], CATALOG, { sceneFamily: G })?.entryId, 'flask-g');
  assert.equal(resolveNouns(['flask'], CATALOG, { lessonDomain: 'Chemistry lab' })?.entryId, 'flask-d');
  assert.equal(resolveNouns(['flask'], CATALOG, { avoid: new Set(['flask-g']), sceneFamily: G }), undefined);
  assert.equal(resolveNouns(['flask', 'clock'], CATALOG, { avoid: new Set(['flask-g', 'flask-d']) })?.entryId, 'clock-g');
});

test('the director returns nouns per referent and never asks for or returns asset ids', async () => {
  let prompt = '';
  const fetcher: typeof fetch = async (_input, init) => {
    prompt = (JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages.map((message) => message.content).join('\n');
    const body = JSON.stringify({ items: [{ referent: 'trapped energy', nouns: ['Lightning Bolt', 'battery'] }, { referent: 'ratio', nouns: [] }] });
    return new Response(JSON.stringify({ choices: [{ message: { content: body }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await proposeDepictionNouns({
    items: [{ referent: 'trapped energy', context: 'process: energy captured', vocabulary: ['lightning bolt', 'battery'] }, { referent: 'ratio', context: 'quantity', vocabulary: [] }],
    model: 'test/model', apiKey: 'k', remainingBudgetUsd: 1, fetcher,
  });
  assert.deepEqual(result.nouns.get('trapped energy'), ['lightning bolt', 'battery']);
  assert.deepEqual(result.nouns.get('ratio'), []);
  assert.doesNotMatch(prompt, /asset|\.svg|provider/i);
});

import { isNumericReferent } from '../assets/depictionDirector.js';
test('amounts and number words are text, not pictures; real things are not', () => {
  assert.equal(isNumericReferent('sixteen'), true);
  assert.equal(isNumericReferent('nine plus sixteen'), true);
  assert.equal(isNumericReferent('3.5'), true);
  assert.equal(isNumericReferent('right half'), false);
  assert.equal(isNumericReferent('triangle'), false);
});

test('one picture never serves two referents: a noun already drawn in the lesson is skipped for the next referent', () => {
  const c = [entry('calc-1', 'calculator', { houseFamily: G }), entry('calc-2', 'calculator', { houseFamily: G }), entry('clock-g2', 'clock', { houseFamily: G })];
  const first = resolveNouns(['calculator'], c);
  assert.ok(first);
  const second = resolveNouns(['calculator', 'clock'], c, { avoidNouns: new Set([first!.nounKey]) });
  assert.equal(second?.entryId, 'clock-g2');
});

import { judgeDepictions, selectDepictions } from '../assets/depictionDirector.js';

const ok = (body: unknown): typeof fetch => async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });

test('the judge keeps only approved pairs; rejecting is the safe default', async () => {
  const result = await judgeDepictions({
    pairs: [{ referent: 'time', context: 'quantity', picture: 'clock' }, { referent: 'halving the search', context: 'process', picture: 'shears' }],
    model: 'm', apiKey: 'k', remainingBudgetUsd: 1, fetcher: ok({ verdicts: [{ index: 1, keep: true }, { index: 2, keep: false }] }),
  });
  assert.equal(result.approved.size, 1);
  assert.ok(result.approved.has('time\u0000clock'));
});

test('selectDepictions: director nouns -> exact entries -> approved pictures only; a rejected metaphor yields no picture', async () => {
  const catalog = [entry('clock-g', 'clock', { houseFamily: G }), entry('shears-g', 'shears', { houseFamily: G })];
  const taken = { takenEntries: new Set<string>(), takenNouns: new Set<string>() };
  const result = await selectDepictions({
    items: [{ referent: 'time', context: 'c', vocabulary: [] }, { referent: 'halving the search', context: 'c', vocabulary: [] }],
    catalog, model: 'm', apiKey: 'k', remainingBudgetUsd: 1, ...taken,
    propose: async () => ({ nouns: new Map([['time', ['clock']], ['halving the search', ['shears']]]), usage: { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0 }, failures: [] }),
    judge: async ({ pairs }) => ({ approved: new Set(pairs.filter((pair) => pair.picture === 'clock').map((pair) => `${pair.referent}\u0000${pair.picture}`)), usage: { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0 }, failures: [] }),
  });
  assert.deepEqual([...result.picks.keys()], ['time']);
  assert.equal(result.picks.get('time')!.entryId, 'clock-g');
  assert.ok(taken.takenEntries.has('clock-g') && !taken.takenEntries.has('shears-g'));
});

test('selectDepictions: when the director nouns match no exact name, a guarded embedding candidate supplies the picture; a look-alike is rejected', async () => {
  const catalog = [entry('gauge-g', 'pressure gauge', { houseFamily: G }), entry('berry-x', 'strawberry', { houseFamily: G })];
  const taken = { takenEntries: new Set<string>(), takenNouns: new Set<string>() };
  const usage = { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0 };
  const result = await selectDepictions({
    items: [
      { referent: 'pressure', context: 'quantity', vocabulary: ['pressure gauge'], candidates: [{ id: 'gauge-g', name: 'pressure gauge', score: 0.9 }] },
      { referent: 'blueberry', context: 'entity', vocabulary: ['strawberry'], candidates: [{ id: 'berry-x', name: 'strawberry', score: 0.7 }] },
    ],
    catalog, model: 'm', apiKey: 'k', remainingBudgetUsd: 1, ...taken,
    propose: async () => ({ nouns: new Map([['pressure', ['dial']], ['blueberry', ['berry']]]), usage, failures: [] }),
    judge: async ({ pairs }) => ({ approved: new Set(pairs.map((pair) => `${pair.referent}\u0000${pair.picture}`)), usage, failures: [] }),
  });
  assert.equal(result.picks.get('pressure')?.entryId, 'gauge-g', 'a containing name at cosine >= 0.80 is admitted');
  assert.equal(result.picks.get('blueberry'), undefined, 'a different object at low cosine is not admitted');
});

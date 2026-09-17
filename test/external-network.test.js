import test from 'node:test';
import assert from 'node:assert/strict';
import {createIconifyClient} from '../dist/src/semantic/assets/external/iconify.js';
import {resolveExternalConcept} from '../dist/src/semantic/assets/external/resolve.js';
import {representationCandidates, retrievalMode} from '../dist/src/semantic/planning/representation-external.js';

/** P3 failure injection. External retrieval is the only network boundary in the
 *  asset pipeline, so every way it can fail must be visible and must leave the
 *  job with its existing deterministic fallback rather than a placeholder. */

const BASE = {baseUrl: 'https://fake.test', searchTimeoutMs: 200, fetchTimeoutMs: 200};
const searchBody = (icons) => JSON.stringify({icons});
const clientWith = (handler) => createIconifyClient({...BASE, fetchImpl: handler});

const goodSearch = searchBody(['tabler:database', 'mdc:database']);
const goodSvg = '<svg viewBox="0 0 24 24"><path d="M4 6 L20 6 L20 18 L4 18 Z" stroke="#000" fill="none"/></svg>';

const happy = async (url, init) => {
  if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), {name: 'AbortError'});
  return String(url).includes('/search') ? new Response(goodSearch, {status: 200}) : new Response(goodSvg, {status: 200});
};

test('a healthy provider yields hits and an SVG body', async () => {
  const client = clientWith(happy);
  assert.deepEqual(await client.search('database'), [{prefix: 'tabler', name: 'database'}, {prefix: 'mdc', name: 'database'}]);
  assert.match(await client.fetchSvg({prefix: 'tabler', name: 'database'}), /<svg/);
});

test('search down, malformed JSON, an oversized body and a rejected reference all fail loudly', async () => {
  await assert.rejects(() => clientWith(async () => new Response('nope', {status: 503})).search('x'), /503/);
  await assert.rejects(() => clientWith(async () => new Response('{not json', {status: 200})).search('x'), /malformed JSON/);
  await assert.rejects(() => clientWith(async () => new Response('{}', {status: 200})).search('x'), /no icons array/);
  await assert.rejects(() => clientWith(async () => new Response('x'.repeat(400_000), {status: 200})).search('x'), /too large/);
  await assert.rejects(async () => clientWith(happy).search(''), /empty/);
  await assert.rejects(async () => clientWith(happy).fetchSvg({prefix: '../etc', name: 'passwd'}), /Invalid icon reference/);
});

test('a hung provider is aborted by the search timeout instead of hanging the job', async () => {
  const never = (url, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})));
  });
  await assert.rejects(() => clientWith(never).search('x'), /unreachable/);
});

test('a 404 on an individual icon is reported per candidate, not swallowed', async () => {
  const client = clientWith(async (url, init) => {
    if (String(url).includes('/search')) return new Response(goodSearch, {status: 200});
    return new Response('missing', {status: 404});
  });
  const outcome = await resolveExternalConcept(
    {conceptId: 'c1', query: 'database', archetypes: ['flow']},
    {client, mode: 'balanced', fetchedAt: '2026-01-01T00:00:00.000Z', maxFetches: 2},
  );
  assert.equal(outcome.asset, undefined);
  assert.ok(outcome.warnings.some(w => /rejected/.test(w)), 'each failed candidate must be reported');
  assert.ok(outcome.warnings.some(w => /no usable icon/.test(w)));
});

test('an unsupported SVG is rejected by the sanitizer before it becomes an asset', async () => {
  const client = clientWith(async (url) => String(url).includes('/search')
    ? new Response(searchBody(['tabler:evil']), {status: 200})
    : new Response('<svg><script>alert(1)</script></svg>', {status: 200}));
  const outcome = await resolveExternalConcept(
    {conceptId: 'c1', query: 'evil', archetypes: ['flow']},
    {client, mode: 'balanced', fetchedAt: '2026-01-01T00:00:00.000Z'},
  );
  assert.equal(outcome.asset, undefined);
  assert.ok(outcome.warnings.some(w => /forbidden element/.test(w)));
});

test('a complexity violation from the validator is a candidate rejection, not a crash', async () => {
  const huge = `<svg viewBox="0 0 24 24">${'<path d="M0 0 L1 1"/>'.repeat(120)}</svg>`;
  const client = clientWith(async (url) => String(url).includes('/search')
    ? new Response(searchBody(['tabler:huge']), {status: 200})
    : new Response(huge, {status: 200}));
  const outcome = await resolveExternalConcept(
    {conceptId: 'c1', query: 'huge', archetypes: ['flow']},
    {client, mode: 'balanced', fetchedAt: '2026-01-01T00:00:00.000Z'},
  );
  assert.equal(outcome.asset, undefined);
  assert.ok(outcome.warnings.some(w => /Invalid asset parts|complexity/.test(w)));
});

test('a blocked or unprofiled collection is never fetched, even when the provider offers it', async () => {
  let fetches = 0;
  const client = clientWith(async (url) => {
    if (String(url).includes('/search')) return new Response(searchBody(['openmoji:face', 'unknowncollection:face']), {status: 200});
    fetches++;
    return new Response(goodSvg, {status: 200});
  });
  const outcome = await resolveExternalConcept(
    {conceptId: 'c1', query: 'face', archetypes: ['flow']},
    {client, mode: 'broad', fetchedAt: '2026-01-01T00:00:00.000Z'},
  );
  assert.equal(fetches, 0, 'no body may be fetched for a blocked or unprofiled collection');
  assert.equal(outcome.asset, undefined);
  assert.ok(outcome.rejected.some(r => /licence not permitted/.test(r.reason)));
  assert.ok(outcome.rejected.some(r => /unprofiled collection/.test(r.reason)));
});

const planScene = {
  version: 2, id: 's', centralConceptId: 'c1', teachingGoal: 'g', learnerShouldUnderstand: 'u', mentalModel: 'm',
  beats: [], requiredConceptIds: ['c1'], requiredRelations: [], candidateArchetypes: ['flow'],
  continuity: {keepFromPrevious: [], prepareForNext: []},
};
const registry = [{id: 'c1', canonicalName: 'Ledger', aliases: [], semanticType: 'entity', evidenceRefs: []}];
const model = {mentalModel: 'm', candidateArchetypes: ['flow'], heroConceptIds: ['c1'], supportConceptIds: [], relationStrategy: [], requiredObjectStates: []};

test('VISUAL_ICONS=off performs no work at all', async () => {
  // Icons are on by default: the curated catalog does not cover the
  // machine-learning and systems material the product is asked to teach, so
  // leaving retrieval off meant every concept resolved to a generic composition.
  // `off` is now explicit and still performs no network work.
  assert.equal(retrievalMode(undefined), 'balanced', 'icons default on; off must be explicit');
  assert.equal(retrievalMode('off'), 'off');
  assert.equal(retrievalMode('BALANCED'), 'balanced');
  assert.throws(() => retrievalMode('sometimes'), /VISUAL_ICONS/);
  const {catalog, candidates} = await representationCandidates(planScene, registry, model, {mode: 'off', fetchedAt: '2026-01-01T00:00:00.000Z'});
  assert.deepEqual(catalog, {}, 'off must not build a catalog');
  assert.deepEqual(candidates.map(c => c.candidates), [[]], 'off must not add external candidates');
});

test('an unresolved concept gains a catalog-backed candidate and nothing else changes', async () => {
  const ledgerClient = clientWith(async (url) => String(url).includes('/search') ? new Response(searchBody(['tabler:ledger']), {status: 200}) : new Response(goodSvg, {status: 200}));
  const before = await representationCandidates(planScene, registry, model, {mode: 'off', fetchedAt: '2026-01-01T00:00:00.000Z'});
  const after = await representationCandidates(planScene, registry, model, {mode: 'balanced', client: ledgerClient, fetchedAt: '2026-01-01T00:00:00.000Z'});
  assert.deepEqual(Object.keys(after.catalog), ['external.tabler.ledger']);
  const asset = after.catalog['external.tabler.ledger'];
  assert.equal(asset.styleFamily, 'chalk-ink-v2');
  assert.equal(asset.parts[0].strokeRole, 'outline');
  assert.deepEqual(asset.states.neutral.partIds, ['p0']);
  assert.equal(after.candidates[0].candidates[0].id, 'external.tabler.ledger');
  assert.deepEqual(before.candidates[0].candidates, [], 'the local-only run had no curated asset');
  assert.ok(after.warnings.length >= 0);
});

test('a total external miss leaves the deterministic fallback exactly as it was', async () => {
  const client = clientWith(async (url) => String(url).includes('/search') ? new Response(searchBody([]), {status: 200}) : new Response('', {status: 404}));
  const off = await representationCandidates(planScene, registry, model, {mode: 'off', fetchedAt: '2026-01-01T00:00:00.000Z'});
  const missed = await representationCandidates(planScene, registry, model, {mode: 'balanced', client, fetchedAt: '2026-01-01T00:00:00.000Z'});
  assert.deepEqual(missed.catalog, {});
  assert.deepEqual(missed.candidates, off.candidates);
  assert.ok(missed.warnings.some(w => /no suitable candidate/.test(w)));
});

test('an icon name must be the concept once style vocabulary is removed', async () => {
  const {iconNameMatchesQuery, contentTokens} = await import('../dist/src/semantic/assets/external/suitability.js');
  assert.deepEqual(contentTokens('database-outline'), ['database']);
  assert.deepEqual(contentTokens('floor-lamp'), ['floor', 'lamp']);
  assert.equal(iconNameMatchesQuery('database', 'Database'), true);
  assert.equal(iconNameMatchesQuery('database-outline', 'database'), true);
  assert.equal(iconNameMatchesQuery('server-line', 'server'), true);
  assert.equal(iconNameMatchesQuery('floor-lamp', 'floor'), false, 'a compound adds meaning');
  assert.equal(iconNameMatchesQuery('bill-x', 'bill'), false);
  assert.equal(iconNameMatchesQuery('building-bank', 'legislature'), false, 'a literal miss is not a match');
  assert.equal(iconNameMatchesQuery('', 'bill'), false);
});

test('an icon that does not name the concept is never fetched', async () => {
  let fetches = 0;
  const client = clientWith(async (url) => {
    if (String(url).includes('/search')) return new Response(searchBody(['tabler:floor-lamp', 'tabler:floor-plan']), {status: 200});
    fetches++;
    return new Response(goodSvg, {status: 200});
  });
  const outcome = await resolveExternalConcept(
    {conceptId: 'c1', query: 'floor', archetypes: ['flow']},
    {client, mode: 'balanced', fetchedAt: '2026-01-01T00:00:00.000Z'},
  );
  assert.equal(fetches, 0, 'no body may be fetched for an unsuitable name');
  assert.equal(outcome.asset, undefined);
  assert.ok(outcome.rejected.every(r => /does not match the concept/.test(r.reason)));
});

const composedScene = {
  version: 2, id: 's', centralConceptId: 'c1', teachingGoal: 'g', learnerShouldUnderstand: 'u', mentalModel: 'm',
  beats: [], requiredConceptIds: ['c1'], requiredRelations: [], candidateArchetypes: ['flow'],
  continuity: {keepFromPrevious: [], prepareForNext: []},
};

test('a concrete concept prefers a real icon over a procedural composition', async () => {
  const withFamily = [{id: 'c1', canonicalName: 'Ledger', aliases: [], semanticType: 'entity', visualFamily: 'container', evidenceRefs: []}];
  const off = await representationCandidates(composedScene, withFamily, model, {mode: 'off', fetchedAt: '2026-01-01T00:00:00.000Z'});
  assert.ok(off.candidates[0].representation, 'the local tier offers a composition');
  const on = await representationCandidates(composedScene, withFamily, model, {mode: 'balanced', client: clientWith(async (url) => String(url).includes('/search') ? new Response(searchBody(['tabler:ledger']), {status: 200}) : new Response(goodSvg, {status: 200})), fetchedAt: '2026-01-01T00:00:00.000Z'});
  assert.equal(on.candidates[0].representation, undefined, 'the icon must replace the composition');
  assert.equal(on.candidates[0].candidates[0].id, 'external.tabler.ledger');
  assert.deepEqual(Object.keys(on.catalog), ['external.tabler.ledger']);
});

test('an abstraction keeps its composition even when an icon would match', async () => {
  const processConcept = [{id: 'c1', canonicalName: 'Ledger', aliases: [], semanticType: 'process', visualFamily: 'container', evidenceRefs: []}];
  let searched = 0;
  const client = clientWith(async (url) => { if (String(url).includes('/search')) searched++; return String(url).includes('/search') ? new Response(searchBody(['tabler:ledger']), {status: 200}) : new Response(goodSvg, {status: 200}); });
  const on = await representationCandidates(composedScene, processConcept, model, {mode: 'balanced', client, fetchedAt: '2026-01-01T00:00:00.000Z'});
  assert.equal(searched, 0, 'a process is not an object; its composition stands');
  assert.ok(on.candidates[0].representation, 'the composition is untouched');
});

test('the search term is the model-supplied noun, not the concept name', async () => {
  const withQuery = [{id: 'c1', canonicalName: 'Legislative Bill', aliases: ['bill'], semanticType: 'entity', visualQuery: 'document', evidenceRefs: []}];
  const seen = [];
  const client = clientWith(async (url) => {
    if (!String(url).includes('/search')) return new Response(goodSvg, {status: 200});
    seen.push(decodeURIComponent(/query=([^&]*)/.exec(String(url))[1]));
    return new Response(searchBody(['tabler:document']), {status: 200});
  });
  const on = await representationCandidates(planScene, withQuery, model, {mode: 'balanced', client, fetchedAt: '2026-01-01T00:00:00.000Z'});
  assert.deepEqual(seen, ['document'], 'a concept phrase would never match an icon; the model picks the term');
  assert.equal(on.candidates[0].candidates[0].id, 'external.tabler.document');
  assert.deepEqual(Object.keys(on.catalog), ['external.tabler.document']);
});

test('without a visualQuery the concept name is used but usually yields nothing', async () => {
  const seen = [];
  const client = clientWith(async (url) => {
    if (!String(url).includes('/search')) return new Response(goodSvg, {status: 200});
    seen.push(decodeURIComponent(/query=([^&]*)/.exec(String(url))[1]));
    return new Response(searchBody([]), {status: 200});
  });
  await representationCandidates(planScene, registry, model, {mode: 'balanced', client, fetchedAt: '2026-01-01T00:00:00.000Z'});
  assert.deepEqual(seen, ['Ledger'], 'the fallback is the canonical name');
});

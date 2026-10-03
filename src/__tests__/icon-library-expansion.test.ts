import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allCatalogEntries } from '../assets/semantic.js';
import { CATALOG_DATA_DIR, loadCatalogLibraries } from '../assets/streamline.js';
import { ENABLED_LIBRARIES } from '../assets/registry.js';
import { assetEligibilityProblems, resolveObject, similarityAdmissible, typeCompatible } from '../assets/ladder.js';
import type { CatalogEntry } from '../assets/catalog.js';

const vendored = (): CatalogEntry[] => loadCatalogLibraries().entries.filter((entry) => entry.source.startsWith('iconify-'));
const SIZE = { w: 300, h: 300 };

test('vendored Iconify sets are loaded, typed as concrete entities, and carry per-set attribution', () => {
  const entries = vendored();
  assert.ok(entries.length > 10000, `expected the vendored sets to add >10k icons, got ${entries.length}`);
  assert.ok(entries.every((entry) => entry.conceptType === 'entity' && entry.attribution && entry.houseFamily));
  const sources = new Set(entries.map((entry) => entry.source.split(':')[0]));
  for (const library of ENABLED_LIBRARIES.filter((item) => item.libraryId.startsWith('iconify-'))) assert.ok(sources.has(library.libraryId), library.libraryId);
});

test('a vendored icon is type-compatible with an entity request and with nothing else', () => {
  const [entry] = vendored();
  assert.equal(typeCompatible('entity', entry, false), true);
  assert.equal(typeCompatible('process', entry, false), false);
  assert.equal(typeCompatible('entity', entry, true), false, 'an inferred request type still fails closed');
});

test('taxonomy domain is a preference: a general icon stays eligible in a domain lesson, a different specific domain is excluded from similarity', () => {
  const general = vendored().find((entry) => entry.names[0] === 'heart') ?? vendored()[0];
  const context = { lessonDomain: 'biology', exactReferent: true, exactReferentName: general.names[0] };
  assert.deepEqual(assetEligibilityProblems(general, context), []);

  const otherDomain = { ...general, domain: 'astronomy' };
  assert.deepEqual(assetEligibilityProblems(otherDomain, context), [], 'an exact-name literal is not blocked by a different tag');
  const similarity = assetEligibilityProblems(otherDomain, { lessonDomain: 'biology', validatedAssetId: undefined });
  assert.ok(similarity.some((problem) => /does not match lesson domain/.test(problem)));
});

test('a lesson domain no longer drops exact literals to labels', () => {
  const plain = resolveObject('heart', { size: SIZE });
  const biology = resolveObject('heart', { size: SIZE, lessonDomain: 'biology' });
  assert.ok(plain.resolution.assetId, 'heart resolves to a picture');
  assert.equal(biology.resolution.assetId, plain.resolution.assetId);
});

test('equal-name literals resolve in registry order, so the house family wins over vendored duplicates', () => {
  const { resolution } = resolveObject('key', { size: SIZE });
  assert.equal(resolution.source.split(':')[0], ENABLED_LIBRARIES[0].libraryId);
  const dupes = allCatalogEntries().filter((entry) => entry.names[0] === 'key');
  assert.ok(dupes.length > 1, 'several libraries draw a key');
});

test('plural catalog names match a singular request', () => {
  const entries = allCatalogEntries();
  const { resolution } = resolveObject('lung', { size: SIZE }, entries.filter((entry) => entry.names[0] === 'lungs' && entry.source.startsWith('iconify-')));
  assert.ok(resolution.assetId?.includes('lungs'), `got ${resolution.strategy}`);
});

test('importer recovery is recorded: the bridge ingest report keeps transform, CSS and gradient dialects', () => {
  const report = JSON.parse(readFileSync(resolve(CATALOG_DATA_DIR, 'bridge-ingest-report.json'), 'utf8')) as { families: Record<string, { accepted: number }> };
  assert.ok(report.families['flaticon-local'].accepted >= 4600);
  assert.ok(report.families.streamline.accepted >= 45);
  assert.ok(report.families.sketchi.accepted >= 200);
});

test('unvalidated similarity binds only near-synonyms, never opposites, siblings or look-alikes', () => {
  assert.equal(similarityAdmissible('call center 13', ['call center 14'], 0.9), true, 'numbering is not meaning');
  assert.equal(similarityAdmissible('gauge', ['gauge full'], 0.86), true, 'containing name at high cosine');
  assert.equal(similarityAdmissible('bandaged', ['bandage'], 0.86), true);
  assert.equal(similarityAdmissible('female condom', ['male condom'], 0.85), false, 'one-word substitution flips meaning');
  assert.equal(similarityAdmissible('blood ab p', ['blood ab n'], 0.86), false);
  assert.equal(similarityAdmissible('blueberries', ['strawberry'], 0.69), false, 'sibling at middling cosine');
  assert.equal(similarityAdmissible('bullfinch', ['bulldozer'], 0.67), false, 'lexical look-alike');
  assert.equal(similarityAdmissible('aland islands', ['british virgin islands'], 0.62), false, 'shared generic noun is not enough');
  assert.equal(similarityAdmissible('', ['anything'], 0.99), false);
});

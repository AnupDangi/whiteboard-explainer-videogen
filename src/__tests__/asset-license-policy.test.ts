import test from 'node:test';
import assert from 'node:assert/strict';
import { depictEntity, licensePolicy, type EntityResolver } from '../visual-v2/resolver/typeGate.js';

const resolver = (license: string): EntityResolver => () => ({ visual: { paths: [], fills: [], texts: [] }, resolution: { rung: 2, assetId: 'a1', score: 1, license, lane: 'simple-symbol', source: 'test', selectionBasis: 'exact' } });
const rect = { x: 0, y: 0, w: 240, h: 210 };
const concept = { id: 'c', label: 'cat', kind: 'entity' as const };

test('licence policy: permissive ships, attribution ships with attribution recorded, review-pending and unknown never count as release-clean', () => {
  assert.deepEqual(licensePolicy('MIT'), { releaseClean: true, attributionRequired: false, ownerApproved: false });
  assert.deepEqual(licensePolicy('CC-BY-4.0'), { releaseClean: true, attributionRequired: true, ownerApproved: false });
  assert.deepEqual(licensePolicy('Flaticon-review'), { releaseClean: true, attributionRequired: true, ownerApproved: true }, 'owner-approved, attribution required');
  for (const license of ['Review-local-dev', 'mixed', '', 'GPL-3.0']) assert.equal(licensePolicy(license).releaseClean, false, license);
});

test('a picture carries its licence verdict so the run can record provenance and flag drafts', () => {
  const clean = depictEntity(concept, 'cat', rect, resolver('MIT'));
  assert.equal(clean.meaningful, true); assert.equal(clean.releaseClean, true); assert.equal(clean.license, 'MIT');
  const review = depictEntity(concept, 'cat', rect, resolver('Review-local-dev'));
  assert.equal(review.meaningful, true); assert.equal(review.releaseClean, false);
  assert.equal(depictEntity(concept, 'cat', rect, resolver('Flaticon-review')).ownerApproved, true);
  assert.equal(depictEntity(concept, 'cat', rect, resolver('CC-BY-4.0')).attributionRequired, true);
});

test('V2 entity resolution receives the lesson domain from the concept, whatever the topic', () => {
  const seen: Array<string | undefined> = [];
  const spy: EntityResolver = (label, size, conceptId, lessonDomain) => { seen.push(lessonDomain); return resolver('MIT')(label, size, conceptId, lessonDomain); };
  depictEntity({ id: 'c1', label: 'cat', kind: 'entity', domain: 'Wave physics' }, 'cat', rect, spy);
  depictEntity({ id: 'c2', label: 'cat', kind: 'entity', domain: 'Personal finance' }, 'cat', rect, spy);
  depictEntity({ id: 'c3', label: 'cat', kind: 'entity' }, 'cat', rect, spy);
  assert.deepEqual(seen, ['Wave physics', 'Personal finance', undefined]);
});

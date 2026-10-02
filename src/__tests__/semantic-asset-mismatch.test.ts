import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticAssetMismatchFailures } from '../validate/gates.js';

const rung2 = { rung: 2 as const, assetId: 'lib:sun', score: 1, license: 'CC BY 4.0', lane: 'rich-illustration' as const, source: 'streamline' };
const rung3 = { rung: 3 as const, assetId: 'lib:atom', score: 0.55, license: 'CC BY 4.0', lane: 'rich-illustration' as const, source: 'streamline' };
const rung4 = { rung: 4 as const, assetId: null, score: 0.1, license: 'manual', lane: 'text-fallback' as const, source: 'generated' };

test('a weak rung-3 match shown as an icon is a hard failure', () => {
  const failures = semanticAssetMismatchFailures({
    sceneId: 'scene-refraction',
    elements: [
      { id: 'n1', element: { prim: 'object', concept: 'refraction', iconBasis: 'metaphor' }, resolution: rung3 },
    ],
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.code, 'semantic-asset-mismatch');
  assert.equal(failures[0]!.hard, true);
  assert.match(failures[0]!.message, /refraction/);
});

test('confident rung-2 icons and rung-4 text fallbacks pass', () => {
  const failures = semanticAssetMismatchFailures({
    sceneId: 'scene-clean',
    elements: [
      { id: 'n1', element: { prim: 'object', concept: 'sun', iconBasis: 'retrieval' }, resolution: rung2 },
      { id: 'n2', element: { prim: 'box', concept: 'refraction' }, resolution: undefined },
      { id: 'n3', element: { prim: 'object', concept: 'refraction', iconBasis: 'metaphor' }, resolution: rung4 },
    ],
  });
  assert.deepEqual(failures, []);
});

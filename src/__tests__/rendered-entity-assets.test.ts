import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredSelectedIconConceptIds, requiredSelectedIconProblems, type RenderedEntityAssetEvidence } from '../pipeline-v2/renderedEntityAssets.js';

const evidence = (overrides: Partial<RenderedEntityAssetEvidence> = {}): RenderedEntityAssetEvidence => ({
  elementId: 'frame-1', conceptId: 'frame', selectedAssetId: 'iconify-lucide:frame', resolvedAssetId: 'iconify-lucide:frame',
  depictionFamily: 'pictorial', meaningful: true, pathCount: 4, fillCount: 0, embedCount: 0, resolutionReason: 'exact selected library icon',
  ...overrides,
});

test('required icon coverage follows visual beat concepts and exact selected catalog ids', () => {
  const selected = { frame: 'iconify-lucide:frame', unused: 'iconify-lucide:box' };
  const required = requiredSelectedIconConceptIds(['frame', 'frame', 'missing', 'unused'], selected);
  assert.deepEqual(required, ['frame', 'unused']);
  assert.deepEqual(requiredSelectedIconProblems(required, selected, [evidence()]), [
    'unused selected iconify-lucide:box but no live rendered entity uses it',
  ]);
});

test('a selected icon that resolves to a label or different asset fails required coverage', () => {
  const selected = { frame: 'iconify-lucide:frame' };
  const problems = requiredSelectedIconProblems(['frame'], selected, [evidence({
    resolvedAssetId: null, depictionFamily: 'labelled', meaningful: false, pathCount: 0, fillCount: 0,
    resolutionReason: 'label fallback',
  })]);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /selected iconify-lucide:frame but rendered labelled with 0 paths/);
});

test('icon selections unrelated to a visual beat do not become a rendering requirement', () => {
  const selected = { unused: 'iconify-lucide:box' };
  const required = requiredSelectedIconConceptIds(['frame'], selected);
  assert.deepEqual(required, []);
  assert.deepEqual(requiredSelectedIconProblems(required, selected, []), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPicturesVisually, parseVerdicts, renderPictureSheet } from '../assets/pictureCheck.js';
import { allCatalogEntries } from '../assets/semantic.js';

test('verdicts are parsed from model text and out-of-range or malformed entries are ignored', () => {
  const verdicts = parseVerdicts('Sure: {"verdicts":[{"n":1,"keep":true},{"n":2,"keep":false},{"n":9,"keep":false},{"n":"x","keep":true}]}', 3)!;
  assert.equal(verdicts.get(1), true);
  assert.equal(verdicts.get(2), false);
  assert.equal(verdicts.has(9), false);
  assert.equal(parseVerdicts('no json here', 3), undefined);
});

test('a vision rejection removes the referent; a failed call keeps the text-judge verdict and records a soft failure', async () => {
  const pictures = [{ referent: 'encoder', label: 'encoder', entryId: 'a' }, { referent: 'leaf', label: 'leaf', entryId: 'b' }];
  const png = Buffer.from('png');
  const fakeUsage = { promptTokens: 10, completionTokens: 5, cachedTokens: 0, costUsd: 0.001 };
  const rejecting = await checkPicturesVisually({ pictures, model: 'v', apiKey: 'k', render: () => png, chat: async () => ({ content: '{"verdicts":[{"n":1,"keep":false},{"n":2,"keep":true}]}', finishReason: 'stop', usage: fakeUsage }) });
  assert.deepEqual([...rejecting.rejected], ['encoder']);
  assert.equal(rejecting.usage.calls, 1);
  const failing = await checkPicturesVisually({ pictures, model: 'v', apiKey: 'k', render: () => png, chat: async () => { throw new Error('network down'); } });
  assert.equal(failing.rejected.size, 0);
  assert.ok(failing.failures.some((failure) => failure.code === 'picture-check-failed' && !failure.hard));
});

test('the picture sheet renders real catalog pictures with their labels into a PNG', () => {
  const entry = allCatalogEntries().find((candidate) => candidate.names.some((name) => name.toLowerCase() === 'leaf'));
  assert.ok(entry);
  const png = renderPictureSheet([{ referent: 'leaf', label: 'leaf', entryId: entry!.id }, { referent: 'unknown thing', label: 'unknown thing', entryId: entry!.id }]);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.length > 2000);
});

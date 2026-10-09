import test from 'node:test';
import assert from 'node:assert/strict';
import { caseFromPrep, sheetArgs, v030Matches } from './cmp-v1.mjs';

const text = '[S1] A semipermeable membrane lets water pass but blocks most solutes. [S2] More.\n';
const prep = { request: { id: 'cmp-bio01', source: text, instruction: 'Explain it.', targetDurationSec: 60, sourceDoc: { text, contentSha256: '' } } };

test('caseFromPrep keeps the verbatim source, instruction and hash check', async () => {
  const { createHash } = await import('node:crypto');
  prep.request.sourceDoc.contentSha256 = createHash('sha256').update(text).digest('hex');
  const item = caseFromPrep(prep);
  assert.equal(item.id, 'cmp-bio01');
  assert.equal(item.instruction, 'Explain it.');
  assert.equal(item.durationSec, 60);
  assert.equal(item.source, text);
  assert.equal(item.sourceMatchesSourceDoc, true);
});

test('v0.3.0 output names are matched to a source by their first-sentence slug', () => {
  assert.equal(v030Matches(text, 'S1-A-semipermeable-membrane-lets-water-pass-but-blocks-most--1min.mp4'), true);
  assert.equal(v030Matches(text, 'S1-Binary-search-needs-a-sorted-array-1min.mp4'), false);
});

test('sheetArgs tiles evenly spaced frames with integer rates', () => {
  const args = sheetArgs('in.mp4', 'out.png', 59.998, 10);
  assert.deepEqual(args.slice(-3), ['-frames:v', '1', 'out.png']);
  assert.match(args[args.indexOf('-vf') + 1], /^fps=10000\/59998,scale=384:-2,tile=5x2$/);
});

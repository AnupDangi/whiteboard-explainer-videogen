import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_AUTO_SPAN_CHARS,
  sourceDocFromText,
  splitLongSourceSpans,
  splitSourceSpan,
} from '../intake/sourceDoc.js';
import { anchorQuote } from '../plan/evidenceAnchor.js';

/** Domain-neutral long source: one ~2000-char paragraph of plain sentences. */
const longParagraph = Array.from(
  { length: 40 },
  (_, i) => `Sentence ${i + 1} states one plain observation about the process.`,
).join(' ');

test('long auto-spans split into excerpt-bounded chunks with stable, mapped ids', () => {
  const doc = sourceDocFromText(`# Study\n\n${longParagraph}`, 'pdf');
  const paras = doc.spans.filter((span) => span.kind === 'paragraph');
  assert.ok(paras.length >= 3, `expected a split paragraph, got ${paras.length} span(s)`);
  for (const span of paras) {
    assert.ok(
      span.text.length <= MAX_AUTO_SPAN_CHARS + 100,
      `chunk over bound: ${span.text.length} chars`,
    );
  }
  assert.deepEqual(paras.map((span) => span.text).join(''), longParagraph);
  for (const span of paras) {
    assert.equal(doc.text.slice(span.startChar, span.endChar), span.text);
    assert.match(span.id, /^[a-z0-9_]+$/);
    assert.ok(span.id.length <= 40, span.id);
  }
  const ids = paras.map((span) => span.id);
  assert.equal(new Set(ids).size, ids.length);
  const parentPrefix = ids[0]!.split('__p')[0];
  assert.ok(ids.every((id) => id.startsWith(`${parentPrefix}__p`)));
  const again = sourceDocFromText(`# Study\n\n${longParagraph}`, 'pdf');
  assert.deepEqual(
    again.spans.filter((span) => span.kind === 'paragraph').map((span) => span.id),
    ids,
    'split ids must be stable across runs',
  );
});

test('split chunks keep contiguous, gap-free offsets and line ranges', () => {
  const doc = sourceDocFromText(`# Study\n\n${longParagraph}`, 'pdf');
  const paras = doc.spans.filter((span) => span.kind === 'paragraph');
  for (let i = 1; i < paras.length; i++) {
    assert.equal(paras[i]!.startChar, paras[i - 1]!.endChar);
  }
  assert.equal(paras[0]!.startLine, 3);
  for (const span of paras) {
    assert.ok(span.endLine >= span.startLine);
    assert.equal(span.endChar - span.startChar, span.text.length);
  }
});

test('short sources keep their exact original spans', () => {
  const doc = sourceDocFromText('# Study\n\nOne short paragraph here.', 'markdown');
  const paras = doc.spans.filter((span) => span.kind === 'paragraph');
  assert.equal(paras.length, 1);
  assert.equal(paras[0]!.text, 'One short paragraph here.');
  const { spans, map } = splitLongSourceSpans(doc.spans);
  assert.equal(spans.length, doc.spans.length);
  assert.equal(map.size, 0);
});

test('structural spans are never split, even when long', () => {
  const row = '| Alpha Beta Gamma Delta | Epsilon Zeta Eta Theta |';
  const table = Array.from({ length: 30 }, () => row).join('\n');
  const doc = sourceDocFromText(`# Study\n\n${table}\n`, 'markdown');
  const tables = doc.spans.filter((span) => span.kind === 'table');
  assert.ok(tables.length >= 1);
  assert.ok(tables.every((span) => splitSourceSpan(span).length === 1));
});

test('quotes anchor inside the correct split chunk', () => {
  const doc = sourceDocFromText(`# Study\n\n${longParagraph}`, 'pdf');
  const paras = doc.spans.filter((span) => span.kind === 'paragraph');
  const target = paras[1]!;
  const sentence = 'Sentence 15 states one plain observation about the process.';
  assert.ok(target.text.includes(sentence), 'fixture sentence must land in the probed chunk');
  const hit = anchorQuote(doc, target.id, sentence);
  assert.equal(hit?.match, 'exact');
  assert.equal(hit?.ref.spanId, target.id);
  assert.equal(doc.text.slice(hit!.ref.startChar, hit!.ref.endChar), sentence);
});

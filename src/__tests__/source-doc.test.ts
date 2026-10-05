import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSourceEvidence, sourceDocFromText, sourceEvidenceRefMatches } from '../intake/sourceDoc.js';

test('Markdown source spans preserve heading, table, equation, figure reference, and exact offsets', () => {
  const source = '# Photosynthesis\n\nRate depends on light. See Figure 2.\n\n| Factor | Effect |\n| Light | More rate |\n\n$$\nrate = input\n$$\n';
  const doc = sourceDocFromText(source, 'markdown');
  assert.equal(doc.text, source);
  assert.equal(doc.title, 'Photosynthesis');
  assert.ok(doc.spans.some((span) => span.kind === 'heading'));
  assert.ok(doc.spans.some((span) => span.kind === 'figure-reference'));
  assert.ok(doc.spans.some((span) => span.kind === 'table'));
  const equation = doc.spans.find((span) => span.kind === 'equation');
  assert.ok(equation);
  assert.match(equation!.text, /rate = input/);
  for (const span of doc.spans) assert.equal(source.slice(span.startChar, span.endChar), span.text);
});

test('evidence quotes resolve to source and line locations; unsupported quotes are rejected', () => {
  const doc = sourceDocFromText('First line.\nSecond line says the signal rises.\n');
  const span = doc.spans.find((candidate) => candidate.text.includes('signal rises'))!;
  const ref = resolveSourceEvidence(doc, span.id, 'signal rises');
  assert.deepEqual(ref && { startLine: ref.startLine, quote: ref.quote }, { startLine: 2, quote: 'signal rises' });
  assert.match(ref!.documentSha256!, /^[a-f0-9]{64}$/u);
  assert.match(ref!.quoteSha256!, /^[a-f0-9]{64}$/u);
  assert.equal(sourceEvidenceRefMatches(doc, ref!), true);
  assert.equal(sourceEvidenceRefMatches(doc, { ...ref!, quoteSha256: '0'.repeat(64) }), false);
  assert.equal(sourceEvidenceRefMatches(doc, { ...ref!, documentSha256: '0'.repeat(64) }), false);
  const legacy = structuredClone(ref!);
  delete legacy.quoteSha256;
  delete legacy.documentSha256;
  assert.equal(sourceEvidenceRefMatches(doc, legacy), true, 'pre-digest evidence remains verifiable against the in-memory source');
  assert.equal(resolveSourceEvidence(doc, span.id, 'the signal falls'), undefined);
});

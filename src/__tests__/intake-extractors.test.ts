import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSourceDoc, loadSourceDocFromBytes, registerSourceExtractor } from '../intake/sourceIntake.js';
import { detectSourceKind, finalizeSourceDoc, planSourceIntake, titleFromName } from '../intake/registry.js';
import { stripRunningLines, usablePdfTitle } from '../intake/pdfPoppler.js';
import { doclingItemsToBlocks } from '../intake/pdfDocling.js';
import { canonicalizeText, joinBlocks } from '../intake/blocks.js';
import { extractHtmlSource } from '../intake/html.js';
import { MAX_SPAN_CHARS, sourceDocFromText } from '../intake/sourceDoc.js';
import { anchorQuote } from '../plan/evidenceAnchor.js';
import { sha256 } from '../shared/artifacts.js';
import type { SourceExtractor } from '../intake/types.js';

// Synthetic fixtures; regenerate with __tests__/fixtures/intake/make_fixtures.py.
const FIXTURES = path.join(process.cwd(), 'src/__tests__/fixtures/intake');
const hasTool = (bin: string) => { try { execFileSync(bin, ['-v'], { stdio: 'ignore' }); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT'; } };
const POPPLER = hasTool('pdftotext');

async function withAssetsDir<T>(run: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-intake-assets-'));
  const previous = process.env.HYPOTHESIS_SOURCE_ASSETS_DIR;
  process.env.HYPOTHESIS_SOURCE_ASSETS_DIR = dir;
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.HYPOTHESIS_SOURCE_ASSETS_DIR; else process.env.HYPOTHESIS_SOURCE_ASSETS_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test('PDF (poppler): metadata title, reading-order paragraphs, running lines stripped, empty pages reported', { skip: !POPPLER && 'pdftotext is not installed (poppler path unmeasured here)' }, async () => {
  const doc = await withAssetsDir(() => loadSourceDoc(path.join(FIXTURES, 'valve.pdf')));
  assert.equal(doc.title, 'Synthetic Valve Study', 'the title comes from PDF metadata, never a generated "Page 1" heading');
  assert.equal(doc.intake?.extractor, 'pdf-poppler');
  assert.doesNotMatch(doc.text, /running header/, 'a line repeated at the top of every page is removed');
  assert.doesNotMatch(doc.text, /^\d+$/m, 'bare page numbers are removed');
  assert.match(doc.text, /efficient design/, 'a word hyphenated across lines is joined');
  assert.match(doc.text, /the flow loss/, 'the ligature is expanded to plain letters');
  const codes = doc.intake!.warnings.map((warning) => warning.code);
  assert.ok(codes.includes('page-without-text') && codes.includes('running-lines-removed') && codes.includes('text-canonicalized'));
  const paragraph = doc.spans.find((span) => span.text.includes('The valve opens'))!;
  assert.equal(paragraph.kind, 'paragraph', '"the tables below" is prose, not a figure reference');
  assert.deepEqual(paragraph.sourceLocation, { kind: 'pdf-page', page: 1 });
  assert.deepEqual(doc.spans.find((span) => span.text.includes('Final remarks'))!.sourceLocation, { kind: 'pdf-page', page: 3 }, 'the blank page keeps later page numbers true');
});

test('DOCX: content controls kept; field codes and deleted revisions dropped; runs joined; core title used', async () => {
  const doc = await withAssetsDir(() => loadSourceDoc(path.join(FIXTURES, 'valve.docx')));
  assert.equal(doc.title, 'Valve Handbook');
  assert.match(doc.text, /Controlled content survives\./);
  assert.match(doc.text, /Kept inserted text with a filter and softhyphen\./);
  assert.doesNotMatch(doc.text, /REMOVED|MERGEFORMAT|PAGE/);
  assert.match(doc.text, /\| Photosynthesis \| Rate \|/, 'runs inside one word are not split by spaces');
  assert.equal(doc.figureAssets?.length, 1);
  assert.deepEqual(doc.figureAssets![0]!.sourceLocation, { kind: 'docx-paragraph', bodyBlock: 5, paragraph: 4 });
  assert.equal(doc.figureAssets![0]!.sourceId, doc.sourceId);
});

test('PPTX: presentation order, grouped shapes, hidden slides skipped, title from the title placeholder', async () => {
  const doc = await withAssetsDir(() => loadSourceDoc(path.join(FIXTURES, 'valve.pptx')));
  assert.equal(doc.title, 'Valve Overview', 'a placeholder core title ("PowerPoint Presentation") is ignored');
  assert.ok(doc.text.indexOf('Valve Overview') < doc.text.indexOf('Second in presentation order'), 'slide2.xml is first in presentation.xml');
  assert.match(doc.text, /Grouped shape text/);
  assert.doesNotMatch(doc.text, /Hidden slide text/);
  assert.deepEqual(doc.spans.find((span) => span.text.includes('Grouped shape'))!.sourceLocation, { kind: 'pptx-slide', slide: 1 });
  assert.deepEqual(doc.spans.find((span) => span.text.includes('Second in presentation'))!.sourceLocation, { kind: 'pptx-slide', slide: 2 });
  assert.ok(doc.intake!.warnings.some((warning) => warning.code === 'hidden-slides-skipped'));
  assert.deepEqual(doc.figureAssets?.map((figure) => figure.sourceLocation), [{ kind: 'pptx-slide', slide: 1 }]);
});

test('HTML: nested blocks appear once; blockquote, pre and prose divs are kept; charset honoured', () => {
  const html = Buffer.from('<html><head><meta charset="windows-1252"><title>Valves</title></head><body><main><h5>Detail</h5><ul><li><p>Nested item text</p></li></ul><blockquote><p>Quoted claim</p></blockquote><pre>line one\n  line two</pre><div>A div with <em>direct</em> prose.</div><p>Caf\xe9 visit.</p></main></body></html>', 'latin1');
  const extracted = extractHtmlSource(html, 'https://example.org/valves');
  assert.equal((extracted.text.match(/Nested item text/g) ?? []).length, 1);
  assert.match(extracted.text, /^##### Detail$/m);
  assert.match(extracted.text, /^- Nested item text$/m);
  assert.match(extracted.text, /Quoted claim/);
  assert.match(extracted.text, /line one\n {2}line two/);
  assert.match(extracted.text, /A div with direct prose\./);
  assert.match(extracted.text, /Café visit\./);
});

test('canonical text: NFC, ligatures and invisible characters, applied before locations are recorded', () => {
  assert.equal(canonicalizeText('é ﬁne soft­hyphen zero​width'), 'é fine softhyphen zerowidth');
  const joined = joinBlocks([{ text: 'ﬁrst', sourceLocation: { kind: 'pdf-page', page: 1 } }, { text: 'second', sourceLocation: { kind: 'pdf-page', page: 2 } }]);
  assert.equal(joined.text, 'first\n\nsecond');
  assert.deepEqual(joined.nativeLocations.map((range) => joined.text.slice(range.startChar, range.endChar)), ['first', 'second']);
});

test('running-line removal needs repetition across pages and leaves body text alone', () => {
  const pages = ['Header\nBody one.\n1', 'Header\nBody two.\n2', 'Header\nBody three.\n3'];
  assert.deepEqual(stripRunningLines(pages).pages, ['Body one.', 'Body two.', 'Body three.']);
  assert.deepEqual(stripRunningLines(pages.slice(0, 2)).pages, pages.slice(0, 2), 'two pages are too few to tell a header from content');
  assert.equal(usablePdfTitle('Microsoft Word - draft.docx'), undefined);
  assert.equal(usablePdfTitle('A Real Title'), 'A Real Title');
});

test('Docling items map to located blocks; running headers and attached captions are not duplicated', () => {
  const mapped = doclingItemsToBlocks([
    { type: 'page_header', page: 1, text: 'Journal header' },
    { type: 'title', page: 1, text: 'Heat Engines' },
    { type: 'text', page: 1, text: 'Heat flows from hot to cold.' },
    { type: 'list_item', page: 1, text: 'first' },
    { type: 'list_item', page: 1, text: 'second' },
    { type: 'formula', page: 2, latex: 'W = Q_h - Q_c' },
    { type: 'picture', page: 2, selfRef: '#/pictures/0', captions: ['Figure 1: engine cycle'] },
    { type: 'caption', page: 2, text: 'Figure 1: engine cycle' },
    { type: 'table', page: 2, columns: ['Stage', 'Heat'], rows: [['1', 'in']] },
  ]);
  assert.equal(mapped.title, 'Heat Engines');
  assert.equal(mapped.dropped.running, 1);
  assert.deepEqual(mapped.blocks.map((block) => block.text), ['# Heat Engines', 'Heat flows from hot to cold.', '- first\n- second', '$$\nW = Q_h - Q_c\n$$', '[Figure metadata: Figure 1: engine cycle]', '| Stage | Heat |\n| --- | --- |\n| 1 | in |']);
  assert.deepEqual(mapped.blocks.at(-1)!.sourceLocation, { kind: 'pdf-page', page: 2 });
});

test('format detection and the title fallback', () => {
  assert.equal(detectSourceKind({ bytes: Buffer.from('%PDF-1.7'), name: 'x' }), 'pdf');
  assert.throws(() => detectSourceKind({ bytes: Buffer.from('nope'), name: 'fake.pdf' }), /not a valid PDF/);
  assert.equal(detectSourceKind({ bytes: Buffer.from('<!doctype html><p>x'), name: 'page' }), 'html');
  assert.equal(detectSourceKind({ bytes: Buffer.from('a'), name: 'notes.md' }), 'markdown');
  assert.throws(() => detectSourceKind({ bytes: Buffer.from('a'), name: 'image.png' }), /Unsupported source/);
  assert.equal(titleFromName({ bytes: Buffer.alloc(0), name: '/tmp/DeepSeek_V41_Tech-Report.pdf' }), 'DeepSeek V41 Tech Report');
  assert.equal(titleFromName({ bytes: Buffer.alloc(0), name: 'x', url: 'https://example.org/files/llms-cant-jump.pdf' }), 'llms cant jump');
});

test('byte-backed intake parses the same bytes the caller hashed even if the path changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hyp-intake-byte-snapshot-'));
  const filename = path.join(dir, 'source.md');
  const original = Buffer.from('# Original source\n\nThe original source contains enough words to satisfy the minimum extractable text requirement.');
  try {
    await writeFile(filename, original);
    const bytes = await readFile(filename);
    const plan = await planSourceIntake({ bytes, name: filename });
    await writeFile(filename, '# Changed source\n\nThese changed bytes must not replace the snapshot supplied to intake.');
    const doc = await loadSourceDocFromBytes({ bytes, name: filename }, plan);
    assert.equal(doc.contentSha256, sha256(original));
    assert.match(doc.text, /original source contains/);
    assert.doesNotMatch(doc.text, /changed bytes/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an explicitly requested PDF reader that is missing fails visibly; auto records the fallback', async () => {
  const pdf = { bytes: Buffer.from('%PDF-1.7 synthetic'), name: 'x.pdf' };
  const env = { DOCLING_PYTHON: '/nonexistent/python' };
  await assert.rejects(() => planSourceIntake(pdf, { ...env, HYPOTHESIS_PDF_EXTRACTOR: 'docling' }), /No PDF reader is available: pdf-docling is unavailable/);
  await assert.rejects(() => planSourceIntake(pdf, { HYPOTHESIS_PDF_EXTRACTOR: 'pymupdf' }), /must be one of poppler, docling, auto/);
  if (POPPLER) {
    const plan = await planSourceIntake(pdf, { ...env, HYPOTHESIS_PDF_EXTRACTOR: 'auto' });
    assert.equal(plan.extractor.id, 'pdf-poppler');
    assert.equal(plan.warnings[0]?.code, 'extractor-fallback');
  }
});

test('a registered extractor takes precedence for its kinds and its id/version is recorded', async () => {
  const fake: SourceExtractor = {
    id: 'test-markdown', version: '9', kinds: ['markdown'],
    available: async () => ({ ok: true }),
    extract: async () => ({ format: 'markdown', text: '# From the plug-in\n\nPlug-in text that is long enough.', nativeLocations: [], figures: [], warnings: [{ code: 'plugin-note', message: 'synthetic' }] }),
  };
  registerSourceExtractor(fake);
  const plan = await planSourceIntake({ bytes: Buffer.from('ignored'), name: 'x.md' });
  assert.equal(plan.extractor.id, 'test-markdown');
  const doc = finalizeSourceDoc(await fake.extract({ bytes: Buffer.from('ignored'), name: 'x.md' }), { bytes: Buffer.from('ignored'), name: 'x.md' }, fake);
  assert.deepEqual([doc.title, doc.intake?.extractor, doc.intake?.extractorVersion, doc.intake?.warnings[0]?.code], ['From the plug-in', 'test-markdown', '9', 'plugin-note']);
});

test('long paragraphs split at sentence ends; spans never cross a native location', () => {
  const sentence = 'The pump raises the pressure in the line.\n';
  const text = sentence.repeat(Math.ceil((MAX_SPAN_CHARS * 2) / sentence.length));
  const doc = sourceDocFromText(text, 'pdf', [{ startChar: 0, endChar: text.length, sourceLocation: { kind: 'pdf-page', page: 1 } }]);
  assert.ok(doc.spans.length >= 2);
  assert.ok(doc.spans.every((span) => span.text.length <= MAX_SPAN_CHARS + sentence.length));
  for (const span of doc.spans) assert.equal(text.slice(span.startChar, span.endChar), span.text);
});

test('an open display equation does not swallow the next page', () => {
  const text = '$$\nx = 1\n\nPage two prose.';
  const doc = sourceDocFromText(text, 'pdf', [{ startChar: 0, endChar: 7, sourceLocation: { kind: 'pdf-page', page: 1 } }, { startChar: 9, endChar: text.length, sourceLocation: { kind: 'pdf-page', page: 2 } }]);
  assert.equal(doc.spans.find((span) => span.text.includes('Page two'))!.kind, 'paragraph');
});

test('a figure mentioned inside prose stays in its paragraph; a caption line is its own span', () => {
  const doc = sourceDocFromText('The rate rises as shown\nin Figure 2 for all loads.\n\nFigure 2: Rate against load.', 'markdown');
  assert.deepEqual(doc.spans.map((span) => span.kind), ['paragraph', 'figure-reference']);
});

// Two unrelated vocabularies through the same anchoring rules (topic-swap).
for (const [word, first, second] of [['well-known', 'well-', 'known'], ['short-term', 'short-', 'term']] as const) {
  test(`anchoring: a compound word split at a line end matches with its hyphen (${word})`, () => {
    const doc = sourceDocFromText(`# Notes\n\nIt is a ${first}\n${second} effect in the data.`, 'pdf');
    const span = doc.spans.find((item) => item.kind === 'paragraph')!;
    const hit = anchorQuote(doc, span.id, `a ${word} effect`);
    assert.equal(hit?.match, 'normalized');
    assert.equal(hit?.ref.quote, `a ${first}\n${second} effect`);
  });
}

test('anchoring folds ligatures, accents, soft hyphens and curly edge quotes, and keeps exact source bytes', () => {
  const doc = sourceDocFromText('# Notes\n\nThe eﬀect of café soft­ware on flow.', 'markdown');
  const span = doc.spans.find((item) => item.kind === 'paragraph')!;
  const hit = anchorQuote(doc, span.id, '“The effect of cafe software on flow”');
  assert.equal(hit?.match, 'normalized');
  assert.equal(hit?.ref.quote, 'The eﬀect of café soft­ware on flow');
  assert.equal(doc.text.slice(hit!.ref.startChar, hit!.ref.endChar), hit!.ref.quote);
});

test('a quote repeated inside its own cited span anchors to the first occurrence', () => {
  const doc = sourceDocFromText('# Notes\n\nSo the valve’s seat wears. Later the valve’s seat wears again.', 'markdown');
  const span = doc.spans.find((item) => item.kind === 'paragraph')!;
  assert.equal(anchorQuote(doc, span.id, "the valve's seat wears")?.ref.startChar, doc.text.indexOf('the valve’s seat wears'));
});

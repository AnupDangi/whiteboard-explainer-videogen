import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSourceBundle } from '../plan/sourceBundle.js';
import { extractHtmlSource } from '../plan/sourceIntake.js';
import { resolveSourceEvidence, sourceDocFromText } from '../plan/sourceDoc.js';
import { chunkQuote, contentListForRag, indexSourceBundleWithRag, isReusableRagIndexManifest, mapRagChunksToEvidence, ragIndexCompletionProblems, ragQueryCompletionProblems, ragRetrievalStatus, ragWorkingDirectoryNeedsReset } from '../plan/ragSidecar.js';
import { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('source bundle ranks exact evidence across documents and preserves conflicting source citations', () => {
  const first = sourceDocFromText('# Chemistry\n\nA water molecule has two hydrogen atoms.', 'markdown');
  first.title = 'Chemistry Notes';
  const second = sourceDocFromText('# Alternate account\n\nA water molecule has one hydrogen atom in this disputed source.', 'markdown');
  second.title = 'Lab Handout';

  const { sourceDoc, sourceBundle } = buildSourceBundle([first, second], 'water hydrogen atoms');
  assert.equal(sourceBundle.retrievalMode, 'local-text');
  assert.equal(sourceBundle.documents.length, 2);
  assert.ok(sourceBundle.evidenceHits.length >= 2);
  assert.match(sourceBundle.evidenceHits[0]!.text, /water molecule/i);
  assert.deepEqual(new Set(sourceBundle.evidenceHits.map((hit) => hit.citation.sourceId)), new Set([first.sourceId, second.sourceId]));
  for (const hit of sourceBundle.evidenceHits) {
    const bundledRef = resolveSourceEvidence(sourceDoc, hit.citation.spanId, hit.citation.quote)!;
    assert.equal(bundledRef.sourceId, hit.citation.sourceId);
    const original = [first, second].find((doc) => doc.sourceId === hit.citation.sourceId)!;
    const originalRef = resolveSourceEvidence(original, original.spans.find((span) => span.text.includes(hit.text))!.id, hit.text)!;
    assert.equal(bundledRef.startChar, originalRef.startChar, 'citation character offsets refer to the original document');
    assert.equal(bundledRef.startLine, originalRef.startLine, 'citation line numbers refer to the original document');
    assert.equal(hit.citation.quote, hit.text);
  }
  assert.equal(sourceDoc.retrievalEvidence?.length, sourceBundle.evidenceHits.length);
});

test('multimodal content-list carries page, equation, table, and query-relevant embedded figure provenance', async () => {
  const doc = sourceDocFromText('## Page 3\n\nThe graph compares the two methods.\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n$$\ny = x^2\n$$', 'pdf', [{ startChar: 0, endChar: 100, sourceLocation: { kind: 'pdf-page', page: 3 } }]);
  const dir = await mkdtemp(join(tmpdir(), 'hyp-rag-figure-'));
  const figurePath = join(dir, 'figure.png');
  await writeFile(figurePath, Buffer.from('png test asset'));
  doc.figureAssets = [{ sourceId: doc.sourceId, sha256: 'a'.repeat(64), page: 3, mediaType: 'image/png', assetPath: figurePath, caption: 'A graph compares the two methods.', derivationStatus: 'embedded-image-crop', indexStatus: 'not-indexed' }];
  const { sourceBundle } = buildSourceBundle([doc], 'graph methods');
  try {
    const items = contentListForRag(doc, sourceBundle, 'graph methods');
    assert.ok(items.some((item) => item.type === 'table' && item.page_idx === 2));
    assert.ok(items.some((item) => item.type === 'equation' && item.latex?.includes('y = x^2') && item.page_idx === 2));
    assert.ok(items.some((item) => item.type === 'image' && item.img_path === figurePath && item.page_idx === 2));
    assert.equal(contentListForRag(doc, sourceBundle, 'ocean currents').some((item) => item.type === 'image'), false);
    assert.equal(sourceBundle.figures.length, 1, 'figure gating is retrieval-only and does not remove source metadata');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deep RAG chunks map back only to exact source spans and retain original citations', () => {
  const first = sourceDocFromText('# Chemistry\n\nWater contains two hydrogen atoms.', 'markdown');
  const second = sourceDocFromText('# Biology\n\nCells use energy to build proteins.', 'markdown');
  const { sourceDoc, sourceBundle } = buildSourceBundle([first, second], 'water hydrogen atoms proteins');
  const mapped = mapRagChunksToEvidence({ data: { chunks: [{ content: 'Retrieved: Cells use energy to build proteins.' }] } }, sourceDoc, sourceBundle);
  assert.equal(mapped.length, 1);
  assert.match(mapped[0]!.text, /Cells use energy/);
  assert.equal(mapped[0]!.citation.sourceId, second.sourceId);
  assert.equal(resolveSourceEvidence(sourceDoc, mapped[0]!.citation.spanId, mapped[0]!.citation.quote)?.sourceId, second.sourceId);
  assert.deepEqual(mapRagChunksToEvidence({ data: { chunks: [{ content: 'generated image caption with no exact source text' }] } }, sourceDoc, sourceBundle), []);
});

test('LightRAG aquery_data envelope and normalized source chunk map to the original exact citation', () => {
  const doc = sourceDocFromText('# Dynamics\n\nAcceleration equals change in velocity divided by elapsed time.', 'markdown');
  const { sourceDoc, sourceBundle } = buildSourceBundle([doc], 'acceleration velocity elapsed time');
  const sourceSpan = sourceDoc.spans.find((span) => span.kind === 'paragraph')!;
  const normalizedChunk = sourceSpan.text.trim().replace(/\s+/gu, '  ');
  const rawAqueryData = {
    status: 'success',
    message: 'Query executed successfully',
    data: { entities: [], relationships: [], chunks: [{ content: normalizedChunk, chunk_id: 'retrieved-source-chunk', reference_id: '1' }], references: [] },
    metadata: { query_mode: 'naive' },
  };
  const mapped = mapRagChunksToEvidence({ ok: true, data: rawAqueryData }, sourceDoc, sourceBundle);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]!.text, sourceSpan.text.trim());
  assert.equal(mapped[0]!.citation.quote, sourceSpan.text.trim());
  assert.equal(mapped[0]!.citation.sourceId, doc.sourceId);
});

test('partial index results fail closed and never qualify as reusable cache manifests', () => {
  const partial = { ok: true, indexStatus: 'partial', items: 12, multimodal: { expected: 3, completed: 2, failed: 1 }, actualUsage: { failedCalls: 1 } };
  assert.ok(ragIndexCompletionProblems(partial, 12, 3).some((problem) => /index status is partial/.test(problem)));
  assert.ok(ragIndexCompletionProblems(partial, 12, 3).some((problem) => /provider failure count is 1/.test(problem)));
  assert.equal(isReusableRagIndexManifest({ schemaVersion: 'rag-index-manifest/v1', digest: 'd', itemCount: 12 }, 'd', 12, 3), false);
  assert.equal(isReusableRagIndexManifest({ schemaVersion: 'rag-index-manifest/v2', status: 'partial', digest: 'd', itemCount: 12 }, 'd', 12, 3), false);
  assert.equal(isReusableRagIndexManifest({ schemaVersion: 'rag-index-manifest/v2', status: 'complete', digest: 'd', itemCount: 12, expectedMultimodalItems: 3, completedMultimodalItems: 3, providerUsage: { failedCalls: 0 } }, 'd', 12, 3), true);
  assert.equal(isReusableRagIndexManifest({ schemaVersion: 'rag-index-manifest/v2', status: 'complete', digest: 'd', itemCount: 12, expectedMultimodalItems: 3, completedMultimodalItems: 2, providerUsage: { failedCalls: 1 } }, 'd', 12, 3), false);
});

test('a stale LightRAG store without a reusable manifest must be reset before indexing', () => {
  const orphanedStore = ['kv_store_doc_status.json', 'kv_store_full_docs.json', 'kv_store_llm_response_cache.json'];
  assert.equal(ragWorkingDirectoryNeedsReset(orphanedStore, false), true);
  assert.equal(ragWorkingDirectoryNeedsReset([], false), false);
  assert.equal(ragWorkingDirectoryNeedsReset(orphanedStore, true), false);
});

test('a successful RAG query with no exact source-span match is explicitly a retrieval miss', () => {
  assert.equal(ragRetrievalStatus(0), 'miss');
  assert.equal(ragRetrievalStatus(1), 'matched');
});

test('query provider failures cannot be reported as completed retrieval', () => {
  assert.deepEqual(ragQueryCompletionProblems({ queryStatus: 'partial', actualUsage: { failedCalls: 1 } }), [
    'query status is partial', 'provider failure count is 1',
  ]);
  assert.deepEqual(ragQueryCompletionProblems({ queryStatus: 'complete', actualUsage: { failedCalls: 0 } }), []);
});

test('optional RAG sidecar falls back to local ranked evidence when disabled', async () => {
  const original = process.env.RAG_ENGINE;
  process.env.RAG_ENGINE = 'off';
  const doc = sourceDocFromText('# Optics\n\nLight bends when it enters glass.', 'markdown');
  const { sourceBundle } = buildSourceBundle([doc], 'light bends');
  const dir = await mkdtemp(join(tmpdir(), 'hyp-rag-disabled-'));
  try {
    const outcome = await indexSourceBundleWithRag({ sourceDoc: doc, sourceBundle, query: 'light bends', workingDir: dir, ledger: new PersistentBudgetLedger(join(dir, 'ledger.json'), 0.1), remainingBudgetUsd: 0.1, providerEnv: {} });
    assert.equal(outcome.enabled, false);
    assert.equal(outcome.indexed, false);
    assert.equal(sourceBundle.retrievalMode, 'local-text');
    assert.ok(sourceBundle.evidenceHits.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (original === undefined) delete process.env.RAG_ENGINE;
    else process.env.RAG_ENGINE = original;
  }
});

test('HTML extraction retains structural text and stable URL selectors for evidence citations', () => {
  const html = Buffer.from('<html><head><title>Velocity</title></head><body><nav>Menu</nav><main><h1>Velocity</h1><p>Velocity is distance traveled per unit time.</p><figure><img src="/plot.png" alt="A distance over time plot"><figcaption>A distance over time plot.</figcaption></figure></main><script>ignore()</script></body></html>');
  const extracted = extractHtmlSource(html, 'https://example.org/velocity');
  assert.equal(extracted.title, 'Velocity');
  assert.match(extracted.text, /distance traveled per unit time/);
  assert.doesNotMatch(extracted.text, /Menu|ignore/);
  assert.ok(extracted.locations.every((range) => range.sourceLocation?.kind === 'web-url'));
  assert.deepEqual(extracted.figures, [{ url: 'https://example.org/plot.png', caption: 'A distance over time plot.', selector: 'figure' }]);
  const doc = sourceDocFromText(extracted.text, 'markdown', extracted.locations);
  const evidenceSpan = doc.spans.find((span) => /distance traveled/.test(span.text))!;
  assert.deepEqual(evidenceSpan.sourceLocation, { kind: 'web-url', url: 'https://example.org/velocity', selector: 'p' });
  const figureSpan = doc.spans.find((span) => /Figure metadata/.test(span.text))!;
  assert.equal(figureSpan.kind, 'figure');
  const { sourceBundle } = buildSourceBundle([doc], 'distance over time plot');
  assert.ok(sourceBundle.evidenceHits.some((hit) => hit.modality === 'figure-metadata' && hit.citation.sourceLocation?.kind === 'web-url'));
});

test('a retrieval chunk that cuts a long span maps to the exact sentences it reproduces', () => {
  const span = 'Short intro. The first long sentence explains how the pump raises line pressure. The second long sentence explains why the valve closes at low flow. A closing remark.';
  assert.equal(chunkQuote(span, '...pressure. The second long sentence explains why the valve closes at low flow. A closing'), 'The second long sentence explains why the valve closes at low flow.');
  assert.equal(chunkQuote(span, 'The first long sentence explains how the pump raises line pressure.  The second long sentence explains why the valve closes at low flow.'), 'The first long sentence explains how the pump raises line pressure. The second long sentence explains why the valve closes at low flow.');
  assert.equal(chunkQuote(span, 'Short intro. A closing remark.'), undefined, 'short generic sentences never establish a match');
});

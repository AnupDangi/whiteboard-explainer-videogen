import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import type { RagSidecarEnv } from '../planner/env.js';
import { resolveSourceEvidence, type EvidenceHit, type SourceBundle, type SourceDoc } from './sourceDoc.js';

interface RagContentItem {
  type: 'text' | 'table' | 'equation' | 'image';
  page_idx: number;
  text?: string;
  table_body?: string;
  table_caption?: string[];
  latex?: string;
  img_path?: string;
  image_caption?: string[];
}

export interface RagIndexOutcome {
  enabled: boolean;
  status: 'completed' | 'partial' | 'failed' | 'disabled';
  retrievalStatus: 'matched' | 'miss' | 'failed' | 'not-run';
  indexed: boolean;
  cacheHit: boolean;
  itemCount: number;
  elapsedMs: number;
  estimatedCostUsd: number;
  actualUsage?: { callAttempts: number; successfulCallAttempts: number; failedCalls: number; providerReportedUsageResponses: number; promptTokens: number; completionTokens: number; totalTokens: number; costUsd: null; costStatus: string };
  artifactEstimatedCostUsd?: number;
  error?: string;
}

function repositoryRoot(): string { return path.resolve(process.env.HYPOTHESIS_REPO_ROOT ?? process.cwd()); }
function pythonPath(): string { return process.env.RAG_PYTHON ?? path.join(repositoryRoot(), 'rag-engine', '.venv', 'bin', 'python'); }
function servicePath(): string { return path.join(repositoryRoot(), 'rag-engine', 'service.py'); }
function enabled(): boolean { return (process.env.RAG_ENGINE ?? '').toLowerCase() === 'on' && existsSync(pythonPath()) && existsSync(servicePath()); }
const hashJson = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function isReusableRagIndexManifest(value: unknown, digest: string, itemCount: number, expectedMultimodalCount: number): boolean {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  const usage = manifest.providerUsage && typeof manifest.providerUsage === 'object' ? manifest.providerUsage as Record<string, unknown> : {};
  return manifest.schemaVersion === 'rag-index-manifest/v2' && manifest.status === 'complete'
    && manifest.digest === digest && manifest.itemCount === itemCount
    && manifest.expectedMultimodalItems === expectedMultimodalCount
    && manifest.completedMultimodalItems === expectedMultimodalCount
    && usage.failedCalls === 0;
}

export function ragIndexCompletionProblems(value: unknown, expectedItemCount: number, expectedMultimodalCount: number): string[] {
  if (!value || typeof value !== 'object') return ['RAG sidecar returned no index result'];
  const result = value as Record<string, unknown>;
  const problems: string[] = [];
  if (result.indexStatus !== 'complete') problems.push(`index status is ${String(result.indexStatus ?? 'missing')}`);
  if (result.items !== expectedItemCount) problems.push(`indexed item count ${String(result.items ?? 'missing')} does not match expected ${expectedItemCount}`);
  const multimodal = result.multimodal && typeof result.multimodal === 'object' ? result.multimodal as Record<string, unknown> : {};
  if (multimodal.expected !== expectedMultimodalCount) problems.push(`multimodal expected count ${String(multimodal.expected ?? 'missing')} does not match ${expectedMultimodalCount}`);
  if (multimodal.completed !== expectedMultimodalCount) problems.push(`multimodal completed count ${String(multimodal.completed ?? 'missing')} does not match ${expectedMultimodalCount}`);
  if (multimodal.failed !== 0) problems.push(`multimodal failure count is ${String(multimodal.failed ?? 'missing')}`);
  const usage = result.actualUsage && typeof result.actualUsage === 'object' ? result.actualUsage as Record<string, unknown> : {};
  if (usage.failedCalls !== 0) problems.push(`provider failure count is ${String(usage.failedCalls ?? 'missing')}`);
  const stores = result.stores && typeof result.stores === 'object' ? result.stores as Record<string, unknown> : {};
  const indexedChunks = finiteNumber(stores.indexedChunks);
  const storedTextChunks = finiteNumber(stores.textChunks);
  const storedChunkVectors = finiteNumber(stores.chunkVectors);
  if (indexedChunks === undefined || indexedChunks < 1) problems.push(`persisted indexed chunk count ${String(stores.indexedChunks ?? 'missing')} is not positive`);
  if (storedTextChunks === undefined || storedTextChunks < indexedChunks!) problems.push(`persisted text chunk count ${String(stores.textChunks ?? 'missing')} is less than indexed chunk count ${String(stores.indexedChunks ?? 'missing')}`);
  if (storedChunkVectors === undefined || storedChunkVectors < indexedChunks!) problems.push(`persisted chunk vector count ${String(stores.chunkVectors ?? 'missing')} is less than indexed chunk count ${String(stores.indexedChunks ?? 'missing')}`);
  return problems;
}

/** A directory without a reusable manifest may contain stale LightRAG state from a crashed index. */
export function ragWorkingDirectoryNeedsReset(entries: string[], hasReusableManifest: boolean): boolean {
  return !hasReusableManifest && entries.length > 0;
}

export function ragRetrievalStatus(exactSpanHitCount: number): 'matched' | 'miss' {
  return Number.isInteger(exactSpanHitCount) && exactSpanHitCount > 0 ? 'matched' : 'miss';
}

export function ragQueryCompletionProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['RAG sidecar returned no query result'];
  const result = value as Record<string, unknown>;
  const problems: string[] = [];
  if (result.queryStatus !== 'complete') problems.push(`query status is ${String(result.queryStatus ?? 'missing')}`);
  const usage = result.actualUsage && typeof result.actualUsage === 'object' ? result.actualUsage as Record<string, unknown> : {};
  if (usage.failedCalls !== 0) problems.push(`provider failure count is ${String(usage.failedCalls ?? 'missing')}`);
  return problems;
}

const SIDE_CAR_RUNTIME_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'VIRTUAL_ENV', 'PYTHONPATH',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE',
  'RAG_MAX_FIGURES', 'RAG_API_CONCURRENCY', 'RAG_ITEM_CONCURRENCY', 'RAG_MODEL_CONCURRENCY',
  'RAG_REQUEST_TIMEOUT_SECONDS', 'RAG_OPERATION_TIMEOUT_SECONDS', 'RAG_INDEX_TIMEOUT_MS', 'RAG_QUERY_TIMEOUT_MS',
] as const;

/** Build a small Python environment; provider credentials come from .env parsing, never process.env mutation. */
export function buildRagSidecarProcessEnv(runtimeEnv: NodeJS.ProcessEnv, providerEnv: RagSidecarEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of SIDE_CAR_RUNTIME_ENV_KEYS) {
    const value = runtimeEnv[key];
    if (value) childEnv[key] = value;
  }
  for (const [key, value] of Object.entries(providerEnv)) {
    if (value) childEnv[key] = value;
  }
  return childEnv;
}

function pageIndex(page?: number): number { return typeof page === 'number' && page > 0 ? page - 1 : 0; }

const figureStopWords = new Set('a an and are as at be by for from how in into is it of on or that the their this to was what when where which with why teach supplied introductory learner explain distinguish cite exact spans claims resolve differences stated only convention'.split(' '));
function relevanceTokens(value: string): Set<string> {
  return new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((token) => token.replace(/ies$/, 'y').replace(/ing$/, '').replace(/s$/, '')).filter((token) => token.length > 1 && !figureStopWords.has(token)));
}

/** Select only captioned source figures that lexically match the requested lesson; local evidence remains complete. */
export function relevantRagFigures(sourceDoc: SourceDoc, sourceBundle: SourceBundle, query: string, maxFigures = Number(process.env.RAG_MAX_FIGURES ?? 6)): SourceBundle['figures'] {
  const cap = Number.isFinite(maxFigures) ? Math.max(0, Math.min(20, Math.floor(maxFigures))) : 6;
  if (cap === 0) return [];
  const sourceTerms = relevanceTokens(sourceDoc.text);
  const terms = new Set([...relevanceTokens(query)].filter((term) => sourceTerms.has(term)));
  if (!terms.size) return [];
  const titles = new Map(sourceBundle.documents.map((document) => [document.sourceId, document.title]));
  return sourceBundle.figures.map((figure, sourceIndex) => {
    const caption = figure.caption?.trim() ?? '';
    if (!caption || !existsSync(figure.assetPath) || !/^(image\/(?:png|jpe?g|webp|gif)|application\/octet-stream)$/i.test(figure.mediaType)) return undefined;
    const title = titles.get(figure.sourceId) ?? '';
    const captionTerms = relevanceTokens(caption);
    const score = [...terms].reduce((sum, term) => {
      if (!captionTerms.has(term)) return sum;
      const documentFrequency = sourceBundle.figures.reduce((count, candidate) => count + Number(relevanceTokens(candidate.caption ?? '').has(term)), 0);
      return sum + Math.log(1 + sourceBundle.figures.length / (documentFrequency + 0.5));
    }, 0);
    const titleScore = [...terms].filter((term) => relevanceTokens(title).has(term)).length * 0.05;
    return { figure, sourceIndex, score: score + titleScore };
  }).filter((item): item is { figure: SourceBundle['figures'][number]; sourceIndex: number; score: number } => Boolean(item))
    .filter((item) => item.score >= Math.max(0.4, Math.log(1 + sourceBundle.figures.length / 1.5) * 0.9))
    .sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex).slice(0, cap).map(({ figure }) => figure);
}

export function contentListForRag(doc: SourceDoc, bundle: SourceBundle, query = ''): RagContentItem[] {
  const items: RagContentItem[] = [];
  for (const span of doc.spans) {
    const page = span.sourceLocation?.kind === 'pdf-page' ? span.sourceLocation.page : undefined;
    if (span.kind === 'equation') items.push({ type: 'equation', page_idx: pageIndex(page), text: span.text, latex: span.text.replace(/^\s*(?:\$\$|\\\[)|(?:\$\$|\\\])\s*$/g, '').trim() });
    else if (span.kind === 'table') items.push({ type: 'table', page_idx: pageIndex(page), table_body: span.text, table_caption: span.sourceTitle ? [span.sourceTitle] : undefined });
    else if (span.text.trim()) items.push({ type: 'text', page_idx: pageIndex(page), text: span.text });
  }
  const seenFigureHashes = new Set<string>();
  for (const figure of relevantRagFigures(doc, bundle, query)) {
    if (seenFigureHashes.has(figure.sha256)) continue;
    seenFigureHashes.add(figure.sha256);
    const page = figure.page ?? (figure.sourceLocation?.kind === 'pdf-page' ? figure.sourceLocation.page : figure.sourceLocation?.kind === 'pptx-slide' ? figure.sourceLocation.slide : undefined);
    const caption = figure.caption ?? doc.spans.find((span) => {
      const spanPage = span.sourceLocation?.kind === 'pdf-page' ? span.sourceLocation.page : span.sourceLocation?.kind === 'pptx-slide' ? span.sourceLocation.slide : undefined;
      return spanPage === page && /\b(?:fig(?:ure)?|diagram|chart|plot|table)\b/i.test(span.text);
    })?.text.trim();
    items.push({ type: 'image', page_idx: pageIndex(page), img_path: figure.assetPath, image_caption: [caption || `Embedded source figure${page ? ` on page or slide ${page}` : ''}; SHA-256 ${figure.sha256}`] });
  }
  return items;
}

function runSidecar(command: 'index' | 'query', payload: Record<string, unknown>, timeoutMs: number, providerEnv: RagSidecarEnv): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), [servicePath(), command], { stdio: ['pipe', 'pipe', 'pipe'], env: buildRagSidecarProcessEnv(process.env, providerEnv) });
    let stdout = '';
    let stderr = '';
    let stderrPending = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`RAG sidecar timed out after ${timeoutMs}ms; recent telemetry: ${stderr.trim().split('\n').slice(-6).join(' | ') || 'none'}`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => {
      const data = String(chunk);
      stderr = `${stderr}${data}`.slice(-12_000);
      stderrPending += data;
      const lines = stderrPending.split('\n');
      stderrPending = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (typeof event.telemetry === 'string') console.info(`[RAG] ${event.telemetry} ${JSON.stringify(Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'telemetry')))}`);
        } catch { /* library logs remain in the diagnostic tail; only structured telemetry is surfaced */ }
      }
    });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout.trim().split('\n').at(-1) || '{}') as Record<string, unknown>;
        if (code === 0 && result.ok === true) resolve(result);
        else reject(new Error(String(result.error ?? stderr.trim().slice(-600) ?? `RAG sidecar exited ${code}`)));
      } catch (error) { reject(new Error(`RAG sidecar returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Keep only retrieval chunks that can be mapped to exact original source spans. */
export function mapRagChunksToEvidence(data: unknown, sourceDoc: SourceDoc, sourceBundle: SourceBundle): EvidenceHit[] {
  if (!data || typeof data !== 'object') return [];
  // LightRAG aquery_data returns `status/message/data/{chunks}`, while wrappers
  // may add another `data` or `result` envelope. Walk only known envelope keys.
  let rawData: Record<string, unknown> | undefined;
  let cursor: unknown = data;
  for (let depth = 0; depth < 5 && cursor && typeof cursor === 'object'; depth += 1) {
    const record = cursor as Record<string, unknown>;
    if (Array.isArray(record.chunks)) { rawData = record; break; }
    cursor = ['data', 'result', 'raw_data', 'rawData'].map((key) => record[key]).find((value) => value && typeof value === 'object');
  }
  const chunks = rawData && Array.isArray(rawData.chunks) ? rawData.chunks : [];
  const localBySpan = new Map(sourceBundle.evidenceHits.map((hit) => [hit.citation.spanId, hit]));
  const found = new Map<string, { hit: EvidenceHit; rank: number }>();
  for (const [chunkIndex, rawChunk] of chunks.entries()) {
    if (!rawChunk || typeof rawChunk !== 'object') continue;
    const chunk = rawChunk as Record<string, unknown>;
    const content = typeof chunk.content === 'string' ? chunk.content : typeof chunk.text === 'string' ? chunk.text : '';
    if (!content.trim()) continue;
    for (const span of sourceDoc.spans) {
      const quote = span.text.trim();
      if (!quote || !sourceTextMatchesChunk(quote, content)) continue;
      const citation = resolveSourceEvidence(sourceDoc, span.id, quote);
      if (!citation || found.has(span.id)) continue;
      const existing = localBySpan.get(span.id);
      const origin = sourceBundle.documents.find((document) => document.sourceId === citation.sourceId);
      const hit: EvidenceHit = existing ?? {
        rank: chunkIndex + 1,
        score: 0,
        text: quote,
        modality: span.kind === 'table' ? 'table' : span.kind === 'equation' ? 'equation' : span.kind === 'figure' || span.kind === 'figure-reference' ? 'figure-metadata' : 'text',
        retrievalMode: 'local-text',
        citation,
        documentSha256: origin?.sha256 ?? sourceDoc.contentSha256 ?? '',
        documentTitle: origin?.title ?? sourceDoc.title ?? 'Source',
      };
      found.set(span.id, { hit: { ...hit, citation, text: quote }, rank: chunkIndex });
    }
  }
  return [...found.values()].sort((a, b) => a.rank - b.rank).map(({ hit }, index) => ({ ...hit, rank: index + 1 }));
}

function sourceTextMatchesChunk(sourceQuote: string, retrievedChunk: string): boolean {
  if (retrievedChunk.includes(sourceQuote)) return true;
  const normalizeWhitespace = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalizeWhitespace(retrievedChunk).includes(normalizeWhitespace(sourceQuote));
}

/** Optional multimodal index. Lesson evidence remains exact local spans with citations; the sidecar indexes those same blocks and images. */
export async function indexSourceBundleWithRag(input: {
  sourceDoc: SourceDoc;
  sourceBundle: SourceBundle;
  query: string;
  workingDir: string;
  ledger: PersistentBudgetLedger;
  remainingBudgetUsd: number;
  providerEnv: RagSidecarEnv;
}): Promise<RagIndexOutcome> {
  const startedAtMs = Date.now();
  if (!enabled()) return { enabled: false, status: 'disabled', retrievalStatus: 'not-run', indexed: false, cacheHit: false, itemCount: 0, elapsedMs: Date.now() - startedAtMs, estimatedCostUsd: 0 };
  const items = contentListForRag(input.sourceDoc, input.sourceBundle, input.query);
  if (!items.length) return { enabled: true, status: 'failed', retrievalStatus: 'not-run', indexed: false, cacheHit: false, itemCount: 0, elapsedMs: Date.now() - startedAtMs, estimatedCostUsd: 0, error: 'Source bundle contains no indexable blocks.' };
  const digest = hashJson({ contentVersion: 'rag-index-content/v2', bundleId: input.sourceBundle.bundleId, items });
  await mkdir(input.workingDir, { recursive: true });
  const manifestPath = path.join(input.workingDir, 'index-manifest.json');
  let cacheHit = false;
  let indexed = false;
  let itemCount = items.length;
  let indexCostUsd = 0;
  let queryCostUsd = 0;
  let artifactEstimatedCostUsd: number | undefined;
  let actualUsage: NonNullable<RagIndexOutcome['actualUsage']> = emptyUsage();
  let indexStatus: 'complete' | 'partial' | 'failed' | 'not-run' = 'failed';
  let retrievalStatus: 'matched' | 'miss' | 'failed' | 'not-run' = 'not-run';
  let exactSpanHits = 0;
  const selectedFigures = relevantRagFigures(input.sourceDoc, input.sourceBundle, input.query);
  const expectedMultimodalItems = items.filter((item) => item.type === 'image' || item.type === 'table' || item.type === 'equation').length;
  let reusableManifest = false;
  try {
    const prior = JSON.parse(await readFile(manifestPath, 'utf8')) as { schemaVersion?: string; digest?: string; estimatedCostUsd?: number; itemCount?: number; status?: string };
    if (isReusableRagIndexManifest(prior, digest, items.length, expectedMultimodalItems)) {
      reusableManifest = true;
      for (const figure of selectedFigures) figure.indexStatus = 'indexed';
      cacheHit = true;
      indexed = true;
      indexStatus = 'complete';
      itemCount = Number(prior.itemCount) || items.length;
      artifactEstimatedCostUsd = Number(prior.estimatedCostUsd) || undefined;
    }
  } catch { /* no reusable index manifest */ }

  if (!reusableManifest) {
    // LightRAG persists multiple stores independently. A prior failed run can leave
    // doc_status/full_docs behind without chunks or vectors; reusing it makes
    // insert_content_list treat this source as a duplicate and falsely complete.
    const existingEntries = await readdir(input.workingDir).catch(() => []);
    if (ragWorkingDirectoryNeedsReset(existingEntries, false)) {
      await rm(input.workingDir, { recursive: true, force: true });
      await mkdir(input.workingDir, { recursive: true });
    }
  }

  const indexEstimate = Number(process.env.RAG_INDEX_ESTIMATE_USD ?? 0.02);
  const queryEstimate = Number(process.env.RAG_QUERY_ESTIMATE_USD ?? 0.005);
  if (![indexEstimate, queryEstimate].every((value) => Number.isFinite(value) && value >= 0)) return { enabled: true, status: 'failed', retrievalStatus: 'not-run', indexed: false, cacheHit, itemCount: 0, elapsedMs: Date.now() - startedAtMs, estimatedCostUsd: 0, error: 'RAG index and query cost estimates must be finite non-negative values.' };
  try {
    if (!cacheHit) {
      const indexResult = await input.ledger.call(input.remainingBudgetUsd, async (allowedUsd) => {
        if (allowedUsd < indexEstimate) throw new Error(`RAG index estimate $${indexEstimate.toFixed(4)} exceeds remaining run budget $${allowedUsd.toFixed(4)}`);
        const value = await runSidecar('index', { contentList: items, filePath: `${input.sourceBundle.bundleId}.pdf`, workingDir: input.workingDir, docId: input.sourceBundle.bundleId, forceMultimodalReprocess: true }, Number(process.env.RAG_INDEX_TIMEOUT_MS ?? 240_000), input.providerEnv);
        return { value, costUsd: indexEstimate };
      });
      if (!indexResult.allowed) throw new Error(`RAG index is over budget; ledger has spent $${indexResult.spentUsd.toFixed(4)}`);
      indexCostUsd = indexResult.costUsd;
      actualUsage = mergeUsage(actualUsage, usageFrom(indexResult.value));
      const indexStatusValue = indexResult.value.indexStatus;
      const monitor = indexResult.value.multimodal && typeof indexResult.value.multimodal === 'object' ? indexResult.value.multimodal as Record<string, unknown> : {};
      const expectedItems = finiteNumber(monitor.expected);
      const completedItems = finiteNumber(monitor.completed);
      const completionProblems = ragIndexCompletionProblems(indexResult.value, items.length, expectedMultimodalItems);
      const failedCalls = actualUsage.failedCalls;
      if (indexStatusValue !== 'complete' || completionProblems.length > 0) {
        indexStatus = 'partial';
        input.sourceBundle.ragStatus = { index: 'partial', retrieval: 'not-run', exactSpanHits: 0, ...(expectedItems !== undefined ? { expectedMultimodalItems: expectedItems } : {}), ...(completedItems !== undefined ? { completedMultimodalItems: completedItems } : {}), failedProviderCalls: failedCalls };
        throw new Error(`RAG index is partial: ${completionProblems.join('; ')}. Query skipped and no cache manifest was written.`);
      }
      indexed = true;
      indexStatus = 'complete';
      itemCount = Number(indexResult.value.items) || items.length;
      for (const figure of selectedFigures) figure.indexStatus = 'indexed';
      const manifest = { schemaVersion: 'rag-index-manifest/v2', status: 'complete', digest, bundleId: input.sourceBundle.bundleId, itemCount, expectedMultimodalItems: expectedItems ?? 0, completedMultimodalItems: completedItems ?? 0, estimatedCostUsd: indexCostUsd, costEstimated: true, providerUsage: actualUsage, indexedAt: new Date().toISOString() };
      const temporary = `${manifestPath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
      await rename(temporary, manifestPath);
    }
    const queried = await input.ledger.call(input.remainingBudgetUsd, async (allowedUsd) => {
      if (allowedUsd < queryEstimate) throw new Error(`RAG query estimate $${queryEstimate.toFixed(4)} exceeds remaining run budget $${allowedUsd.toFixed(4)}`);
      // Naive mode returns retrieved source chunks directly without graph/LLM
      // paraphrase, which is required for exact-span citation mapping.
      const value = await runSidecar('query', { workingDir: input.workingDir, question: input.query, mode: 'naive', topK: 20, chunkTopK: 12 }, Number(process.env.RAG_QUERY_TIMEOUT_MS ?? 100_000), input.providerEnv);
      return { value, costUsd: queryEstimate };
    });
    if (!queried.allowed) throw new Error(`RAG query is over budget; ledger has spent $${queried.spentUsd.toFixed(4)}`);
    queryCostUsd = queried.costUsd;
    actualUsage = mergeUsage(actualUsage, usageFrom(queried.value));
    const queryProblems = ragQueryCompletionProblems(queried.value);
    if (queryProblems.length > 0) {
      retrievalStatus = 'failed';
      throw new Error(`RAG query is partial: ${queryProblems.join('; ')}. Retrieved data discarded and local-text retrieval retained.`);
    }
    const ranked = mapRagChunksToEvidence(queried.value.data, input.sourceDoc, input.sourceBundle);
    exactSpanHits = ranked.length;
    if (ranked.length) {
      const deepIds = new Set(ranked.map((hit) => hit.citation.spanId));
      const combined = [...ranked, ...input.sourceBundle.evidenceHits.filter((hit) => !deepIds.has(hit.citation.spanId))];
      input.sourceBundle.evidenceHits = combined.map((hit, index) => ({ ...hit, rank: index + 1, retrievalMode: deepIds.has(hit.citation.spanId) ? 'deep-indexed+local-text' : 'local-text' }));
      input.sourceBundle.retrievalMode = 'deep-indexed+local-text';
      retrievalStatus = ragRetrievalStatus(ranked.length);
    } else {
      input.sourceBundle.retrievalMode = 'local-text';
      retrievalStatus = ragRetrievalStatus(ranked.length);
    }
    input.sourceDoc.retrievalEvidence = input.sourceBundle.evidenceHits;
    const estimatedCostUsd = indexCostUsd + queried.costUsd;
    input.sourceBundle.retrievalCost = { apiCostUsd: estimatedCostUsd, estimated: true, elapsedMs: Date.now() - startedAtMs };
    input.sourceBundle.ragStatus = { index: 'complete', retrieval: retrievalStatus, exactSpanHits, failedProviderCalls: actualUsage.failedCalls };
    const retrievalMiss = retrievalStatus === 'miss';
    return { enabled: true, status: retrievalMiss ? 'partial' : 'completed', retrievalStatus, indexed: true, cacheHit, itemCount, elapsedMs: Date.now() - startedAtMs, estimatedCostUsd, artifactEstimatedCostUsd, actualUsage, ...(retrievalMiss ? { error: 'RAG query completed but returned no chunks that map to exact original source spans; continuing with local-text evidence.' } : {}) };
  } catch (error) {
    if (indexStatus === 'failed' && cacheHit) indexStatus = 'complete';
    if (retrievalStatus === 'not-run' && indexed) retrievalStatus = 'failed';
    input.sourceBundle.retrievalMode = 'local-text';
    input.sourceBundle.evidenceHits = input.sourceBundle.evidenceHits.map((hit) => ({ ...hit, retrievalMode: 'local-text' }));
    input.sourceDoc.retrievalEvidence = input.sourceBundle.evidenceHits;
    input.sourceBundle.retrievalCost = { apiCostUsd: indexCostUsd + queryCostUsd, estimated: true, elapsedMs: Date.now() - startedAtMs };
    input.sourceBundle.ragStatus ??= { index: indexStatus, retrieval: retrievalStatus, exactSpanHits, failedProviderCalls: actualUsage.failedCalls };
    return { enabled: true, status: indexStatus === 'complete' && retrievalStatus === 'failed' ? 'partial' : indexStatus === 'partial' ? 'partial' : 'failed', retrievalStatus, indexed, cacheHit, itemCount, elapsedMs: Date.now() - startedAtMs, estimatedCostUsd: indexCostUsd + queryCostUsd, ...(artifactEstimatedCostUsd !== undefined ? { artifactEstimatedCostUsd } : {}), actualUsage, error: error instanceof Error ? error.message : String(error) };
  }
}

function finiteNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

function emptyUsage(): NonNullable<RagIndexOutcome['actualUsage']> {
  return { callAttempts: 0, successfulCallAttempts: 0, failedCalls: 0, providerReportedUsageResponses: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null, costStatus: 'unknown; provider response did not expose billed dollars' };
}

function usageFrom(result: Record<string, unknown>): NonNullable<RagIndexOutcome['actualUsage']> {
  const usage = result.actualUsage;
  if (!usage || typeof usage !== 'object') return emptyUsage();
  const row = usage as Record<string, unknown>;
  const number = (key: string) => Number.isFinite(Number(row[key])) ? Number(row[key]) : 0;
  return { callAttempts: number('callAttempts'), successfulCallAttempts: number('successfulCallAttempts'), failedCalls: number('failedCalls'), providerReportedUsageResponses: number('providerReportedUsageResponses'), promptTokens: number('promptTokens'), completionTokens: number('completionTokens'), totalTokens: number('totalTokens'), costUsd: null, costStatus: typeof row.costStatus === 'string' ? row.costStatus : 'unknown; provider response did not expose billed dollars' };
}

function mergeUsage(a: NonNullable<RagIndexOutcome['actualUsage']>, b: NonNullable<RagIndexOutcome['actualUsage']>): NonNullable<RagIndexOutcome['actualUsage']> {
  return { callAttempts: a.callAttempts + b.callAttempts, successfulCallAttempts: a.successfulCallAttempts + b.successfulCallAttempts, failedCalls: a.failedCalls + b.failedCalls, providerReportedUsageResponses: a.providerReportedUsageResponses + b.providerReportedUsageResponses, promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, totalTokens: a.totalTokens + b.totalTokens, costUsd: null, costStatus: a.costStatus };
}

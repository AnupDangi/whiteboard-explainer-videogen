import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG, type CatalogEntry } from './catalog.js';
import { ENABLED_LIBRARIES } from './registry.js';
import { CATALOG_DATA_DIR, loadCatalogLibraries } from './streamline.js';
import type { QueryEmbeddingCache } from './queryEmbeddingCache.js';

/**
 * Memoize concurrent initialization while allowing a later retry after a
 * transient load failure. A rejected promise must not poison this process for
 * every subsequent lesson.
 * @internal
 */
export function createRetryingLazyLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      const current = Promise.resolve().then(load);
      pending = current;
      void current.catch(() => {
        if (pending === current) pending = undefined;
      });
    }
    return pending;
  };
}

/**
 * Catalog retrieval (hypothesis/v1_claude/01 §3.3 "top-k catalog candidates",
 * §4 rung 2/3 "embedding >= tau"). Catalog vectors are precomputed offline by
 * scripts/embed-catalog.mjs with a local MiniLM model (spike S-10, zero API
 * cost); queries are embedded with the same model at plan time. Retrieval is
 * async, so it runs BEFORE the (sync, pure) resolve stage and its results are
 * handed to resolveScene — never computed inside rendering.
 */
export interface Candidate {
  id: string;
  name: string;
  /** Pure cosine similarity (what the E4 thresholds are defined on); ranking additionally uses lexical/domain boosts. */
  score: number;
}

/** At most this many entries per depicted name survive in a top-k, so duplicate icons from many libraries cannot crowd out other concepts. */
const MAX_PER_NAME = 2;
const LEXICAL_EXACT_BOOST = 0.25;
const LEXICAL_TOKEN_BOOST = 0.1;
const DOMAIN_BOOST = 0.05;
const tokens = (text: string): string[] => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 1);
const inDomain = (entry: { domain?: string }, lessonDomain: string): boolean => {
  const domain = entry.domain?.toLowerCase();
  return Boolean(domain && domain !== 'general' && (lessonDomain.toLowerCase().includes(domain) || domain.includes(lessonDomain.toLowerCase())));
};
const stem = (token: string): string => (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token);

let tokenIndex: Array<{ name: string; names: Set<string>; bag: Set<string> }> | undefined;
function entryTokens(entries: CatalogEntry[]): NonNullable<typeof tokenIndex> {
  if (!tokenIndex || tokenIndex.length !== entries.length) {
    tokenIndex = entries.map((entry) => ({
      name: entry.names.map((name) => tokens(name).map(stem).join(' ')).find(Boolean) ?? '',
      names: new Set(entry.names.flatMap((name) => tokens(name).map(stem))),
      bag: new Set([...entry.names, ...entry.tags].flatMap((text) => tokens(text).map(stem))),
    }));
  }
  return tokenIndex;
}

const DIMS = 384;
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** Every retrievable entry: enabled libraries in registry order, then the procedural seed catalog. */
export function allCatalogEntries(): CatalogEntry[] {
  return [...loadCatalogLibraries().entries, ...CATALOG];
}

let matrix: Float32Array | undefined;
function catalogMatrix(): Float32Array {
  if (!matrix) {
    const buffers = ENABLED_LIBRARIES.map((library) => readFileSync(resolve(CATALOG_DATA_DIR, library.embeddings)));
    const byteLength = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    if (byteLength % 4 !== 0) throw new Error('catalog embedding files must contain complete Float32 values');
    matrix = new Float32Array(byteLength / 4);
    let offset = 0;
    for (const buffer of buffers) {
      if (buffer.byteLength % 4 !== 0) throw new Error('catalog embedding file length is not a multiple of 4');
      for (let byte = 0; byte < buffer.byteLength; byte += 4) matrix[offset++] = buffer.readFloatLE(byte);
    }
  }
  return matrix;
}

type Embedder = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array | number[] }>;
const getEmbedder = createRetryingLazyLoader<Embedder>(async () => {
  const m = await import('@huggingface/transformers');
  return (await m.pipeline('feature-extraction', EMBEDDING_MODEL)) as unknown as Embedder;
});

/** Top-k enabled-library candidates per query by cosine similarity (vectors are unit-normalized). */
export async function rankConcepts(queries: string[], k = 8, cache?: QueryEmbeddingCache, options: { domain?: string } = {}): Promise<Map<string, Candidate[]>> {
  const unique = [...new Set(queries.map((q) => q.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, Candidate[]>();
  if (unique.length === 0) return out;
  const entries = loadCatalogLibraries().entries;
  const m = catalogMatrix();
  if (m.length !== entries.length * DIMS) throw new Error(`catalog embeddings (${m.length / DIMS} rows) do not match catalog entries (${entries.length}); rerun scripts/embed-catalog.mjs`);

  const vectors = new Map<string, Float32Array>();
  const missing: string[] = [];
  for (const query of unique) {
    const cached = cache?.get(query);
    if (cached && cached.length === DIMS && cached.every(Number.isFinite)) vectors.set(query, cached);
    else missing.push(query);
  }
  if (missing.length) {
    const embed = await getEmbedder();
    const result = await embed(missing, { pooling: 'mean', normalize: true });
    const embedded = Float32Array.from(result.data);
    if (embedded.length !== missing.length * DIMS) throw new Error(`query embeddings (${embedded.length / DIMS} rows) do not match query count (${missing.length})`);
    missing.forEach((query, index) => {
      const vector = embedded.slice(index * DIMS, (index + 1) * DIMS);
      vectors.set(query, vector);
      cache?.set(query, vector);
    });
  }

  const index = entryTokens(entries);
  unique.forEach((query, qi) => {
    const queryVector = vectors.get(query);
    if (!queryVector) throw new Error(`missing query embedding for ${query} at index ${qi}`);
    const queryTokens = tokens(query).map(stem);
    const queryName = queryTokens.join(' ');
    const ranked = entries.map((e, ei) => {
      let dot = 0;
      for (let d = 0; d < DIMS; d++) dot += queryVector[d] * m[ei * DIMS + d];
      const t = index[ei];
      const lexical = queryName && t.name === queryName ? LEXICAL_EXACT_BOOST
        : queryTokens.length > 0 && queryTokens.every((token) => t.names.has(token)) ? LEXICAL_TOKEN_BOOST : 0;
      const domain = options.domain && inDomain(e, options.domain) ? DOMAIN_BOOST : 0;
      return { candidate: { id: e.id, name: e.names[0], score: dot } as Candidate, rank: dot + lexical + domain };
    });
    ranked.sort((a, b) => b.rank - a.rank || a.candidate.id.localeCompare(b.candidate.id));
    const perName = new Map<string, number>();
    const picked: Candidate[] = [];
    for (const { candidate } of ranked) {
      const seen = perName.get(candidate.name) ?? 0;
      if (seen >= MAX_PER_NAME) continue;
      perName.set(candidate.name, seen + 1);
      picked.push(candidate);
      if (picked.length >= k) break;
    }
    out.set(query, picked);
  });
  return out;
}

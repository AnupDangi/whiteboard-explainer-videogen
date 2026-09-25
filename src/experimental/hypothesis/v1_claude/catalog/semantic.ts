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
  score: number;
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
export async function rankConcepts(queries: string[], k = 8, cache?: QueryEmbeddingCache): Promise<Map<string, Candidate[]>> {
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

  unique.forEach((query, qi) => {
    const queryVector = vectors.get(query);
    if (!queryVector) throw new Error(`missing query embedding for ${query} at index ${qi}`);
    const scores: Candidate[] = entries.map((e, ei) => {
      let dot = 0;
      for (let d = 0; d < DIMS; d++) dot += queryVector[d] * m[ei * DIMS + d];
      return { id: e.id, name: e.names[0], score: dot };
    });
    scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    out.set(query, scores.slice(0, k));
  });
  return out;
}

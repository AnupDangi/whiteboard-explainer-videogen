import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG, type CatalogEntry } from './catalog.js';
import { CATALOG_DATA_DIR, loadStreamlineCatalog } from './streamline.js';

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
const MODEL = 'Xenova/all-MiniLM-L6-v2';

/** Every retrievable entry: Streamline first (house style), then the procedural seed catalog. */
export function allCatalogEntries(): CatalogEntry[] {
  return [...loadStreamlineCatalog().entries, ...CATALOG];
}

let matrix: Float32Array | undefined;
function catalogMatrix(): Float32Array {
  if (!matrix) {
    const buf = readFileSync(resolve(CATALOG_DATA_DIR, 'streamline.emb.bin'));
    matrix = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  return matrix;
}

type Embedder = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array | number[] }>;
const getEmbedder = createRetryingLazyLoader<Embedder>(async () => {
  const m = await import('@huggingface/transformers');
  return (await m.pipeline('feature-extraction', MODEL)) as unknown as Embedder;
});

/** Top-k Streamline candidates per query by cosine similarity (vectors are unit-normalized). */
export async function rankConcepts(queries: string[], k = 8): Promise<Map<string, Candidate[]>> {
  const unique = [...new Set(queries.map((q) => q.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, Candidate[]>();
  if (unique.length === 0) return out;
  const entries = loadStreamlineCatalog().entries;
  const m = catalogMatrix();
  if (m.length !== entries.length * DIMS) throw new Error(`catalog embeddings (${m.length / DIMS} rows) do not match catalog entries (${entries.length}); rerun scripts/embed-catalog.mjs`);
  const embed = await getEmbedder();
  const q = await embed(unique, { pooling: 'mean', normalize: true });
  const qv = Float32Array.from(q.data);
  unique.forEach((query, qi) => {
    const scores: Candidate[] = entries.map((e, ei) => {
      let dot = 0;
      for (let d = 0; d < DIMS; d++) dot += qv[qi * DIMS + d] * m[ei * DIMS + d];
      return { id: e.id, name: e.names[0], score: dot };
    });
    scores.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    out.set(query, scores.slice(0, k));
  });
  return out;
}

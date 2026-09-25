#!/usr/bin/env node
// Precompute catalog embeddings (spike S-10: local MiniLM, zero API cost).
// Writes a Float32 little-endian matrix [entries x 384] in catalog entry order.
// Usage: node scripts/embed-catalog.mjs [catalog.json] [out.bin]
import { readFileSync, writeFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';

const [src = 'src/experimental/hypothesis/v1_claude/catalog/data/streamline.json', out = 'src/experimental/hypothesis/v1_claude/catalog/data/streamline.emb.bin'] = process.argv.slice(2);
const catalog = JSON.parse(readFileSync(src, 'utf8'));
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const descriptor = (e) => `${e.name}. ${e.tags.join(', ')}`;
const dims = 384;
const buf = new Float32Array(catalog.entries.length * dims);
const BATCH = 64;
for (let i = 0; i < catalog.entries.length; i += BATCH) {
  const batch = catalog.entries.slice(i, i + BATCH).map(descriptor);
  const t = await embed(batch, { pooling: 'mean', normalize: true });
  buf.set(t.data, i * dims);
}
writeFileSync(out, Buffer.from(buf.buffer));
console.log(`embedded ${catalog.entries.length} entries -> ${out} (${buf.byteLength} bytes)`);

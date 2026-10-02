#!/usr/bin/env node
// Precompute embeddings for each enabled icon library (local MiniLM, zero API cost).
// Each output is a Float32 [entries x 384] matrix in catalog entry order.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from '@huggingface/transformers';

const dataDir = 'src/assets/data';
// Same registry file catalog/registry.ts reads, so the two can never drift.
const { libraries: ENABLED_LIBRARIES } = JSON.parse(readFileSync(join(dataDir, 'enabled-libraries.json'), 'utf8'));
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const descriptor = (e) => `${e.name}. ${e.tags.join(', ')}`;
const dims = 384;
const BATCH = 64;

for (const library of ENABLED_LIBRARIES) {
  const catalog = JSON.parse(readFileSync(join(dataDir, library.file), 'utf8'));
  const buf = new Float32Array(catalog.entries.length * dims);
  for (let i = 0; i < catalog.entries.length; i += BATCH) {
    const batch = catalog.entries.slice(i, i + BATCH).map(descriptor);
    const result = await embed(batch, { pooling: 'mean', normalize: true });
    buf.set(result.data, i * dims);
  }
  const output = join(dataDir, library.embeddings);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  console.log(`embedded ${catalog.entries.length} entries -> ${output} (${buf.byteLength} bytes)`);
}

#!/usr/bin/env node
// Capture the ElevenLabs capability snapshot that synthesis requires (models, credit rates, languages; read-only GETs, no credits spent).
//   node scripts/elevenlabs-capture.mjs [out=.data/elevenlabs-capabilities.json] [--voices]
// Then run lessons with ELEVENLABS_CAPABILITIES_FILE=<out>. Run `pnpm run build` first. The key is read from .env (ELEVENLABS_API_KEY or _1).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const { captureElevenLabsCapabilities } = await import(path.resolve('dist/src/audio/elevenlabsCapture.js'));
const { elevenLabsKeys } = await import(path.resolve('dist/src/audio/elevenlabs.js'));
const out = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? '.data/elevenlabs-capabilities.json';
const [apiKey] = elevenLabsKeys();
if (!apiKey) { console.error('no ElevenLabs key found (ELEVENLABS_API_KEY or ELEVENLABS_API_KEY_1 in .env)'); process.exit(2); }
const fetcher = async (url, init) => { const response = await fetch(url, init); return { ok: response.ok, status: response.status, json: () => response.json(), text: () => response.text() }; };
const snapshot = await captureElevenLabsCapabilities({ apiKey, fetcher, includeVoices: process.argv.includes('--voices') });
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(path.resolve(out), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`${snapshot.snapshotId}: ${snapshot.models.length} speech models (${snapshot.models.map((m) => `${m.id}@${m.creditsPerChar}`).join(', ')}) -> ${out}`);

#!/usr/bin/env node
// Operator-captured ElevenLabs capability snapshot.
// Probes (model x language) with a tiny paid sample (~10 chars each) and records
// which model accepts which language. Synthesis later routes ONLY through this
// snapshot; a provider contradiction becomes a hard error, never silent fallback.
// Usage: node scripts/elevenlabs-capabilities.mjs [en hi ne ...] [--out=config/elevenlabs-capabilities.json]
// Reads keys from .env (ELEVENLABS_API_KEY_1..9). Spends roughly 5 credits per probe on flash.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const keys = ['ELEVENLABS_API_KEY_1', 'ELEVENLABS_API_KEY_2', 'ELEVENLABS_API_KEY_3', 'ELEVENLABS_API_KEY']
  .map((k) => process.env[k]).filter(Boolean);
if (keys.length === 0) { console.error('no ElevenLabs key in .env'); process.exit(2); }
const dead = new Set();
async function probe(url, body) {
  for (const key of keys) {
    if (dead.has(key)) continue;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { console.log(`network error, skipped (${String(e).slice(0, 80)})`); continue; }
    const detail = await res.text();
    if (/quota|exceeded|insufficient.*credit/i.test(detail)) { dead.add(key); console.log('key exhausted, rotating'); continue; }
    return { ok: res.ok, status: res.status, detail };
  }
  throw new Error('all ElevenLabs keys exhausted or unreachable');
}

const args = process.argv.slice(2);
const flag = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const langs = args.filter((a) => !a.startsWith('--'));
const languages = langs.length ? langs : ['en', 'hi', 'ne'];
const out = flag('out', 'config/elevenlabs-capabilities.json');

const MODELS = [
  { id: 'eleven_flash_v2_5', creditsPerChar: 0.5 },
  { id: 'eleven_multilingual_v2', creditsPerChar: 1 },
  { id: 'eleven_v3', creditsPerChar: 1 },
];
const SAMPLES = {
  en: 'Water flows.',
  hi: 'पानी बहता है।',
  ne: 'पानी बग्छ।',
};
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'Xb7hH8MSUJpSbSDYk0k2';

const support = new Map(MODELS.map((m) => [m.id, []]));
for (const language of languages) {
  for (const model of MODELS) {
    const text = SAMPLES[language] ?? SAMPLES.en;
    let res;
    try {
      res = await probe(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=pcm_24000`, { text, model_id: model.id, language_code: language });
    } catch (e) { console.log(`${model.id} ${language}: ${String(e.message ?? e).slice(0, 80)}`); continue; }
    const detail = res.detail;
    if (res.ok) { support.get(model.id).push(language); console.log(`${model.id} ${language}: SUPPORTED`); }
    else if (res.status === 400 && /unsupported_language|does not support language/i.test(detail)) console.log(`${model.id} ${language}: rejected`);
    else console.log(`${model.id} ${language}: HTTP ${res.status} ${detail.slice(0, 120)}`);
  }
}
const snapshot = {
  snapshotId: `elevenlabs-cap-${new Date().toISOString().slice(0, 10)}`,
  capturedAt: new Date().toISOString(),
  models: MODELS.map((m) => ({ ...m, languages: support.get(m.id) })).filter((m) => m.languages.length > 0),
};
if (snapshot.models.length === 0) { console.error('no model accepted any language; snapshot not written'); process.exit(1); }
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`wrote ${out}: ${snapshot.models.map((m) => `${m.id}[${m.languages.join(',')}]`).join(' ')}`);

#!/usr/bin/env node
// Live ElevenLabs check: node scripts/elevenlabs-smoke.mjs [lang ...]   (default: en hi ne). Reads keys from .env; spends a few hundred credits.
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
for (const line of readFileSync('.env', 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { synthesizeWithElevenLabs } = await import('../dist/src/audio/elevenlabs.js');
const { tokenizeWords } = await import('../dist/src/narration/align.js');
const SAMPLES = {
  en: 'Water moves across a membrane from the dilute side to the concentrated side. This movement is called osmosis.',
  hi: 'पानी झिल्ली के पार पतले घोल से गाढ़े घोल की ओर जाता है। इस गति को परासरण कहते हैं।',
  ne: 'पानी झिल्लीबाट पातलो घोलबाट गाढा घोलतिर जान्छ। यो गतिलाई परासरण भनिन्छ।',
};
const langs = process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'hi', 'ne'];
mkdirSync('.data/elevenlabs-smoke', { recursive: true });
for (const language of langs) {
  const text = SAMPLES[language] ?? SAMPLES.en;
  const r = await synthesizeWithElevenLabs(text, { language });
  const tokens = tokenizeWords(text).length, aligned = r.words.flatMap((w) => tokenizeWords(w.word)).length;
  copyFileSync(r.audioPath, path.join('.data/elevenlabs-smoke', `${language}.wav`));
  console.log(JSON.stringify({ language, model: r.model, credits: r.credits, durationMs: r.durationMs, words: r.words.length, tokens, alignedTokens: aligned, tokensMatch: tokens === aligned, firstWords: r.words.slice(0, 3), allPositive: r.words.every((w) => w.endMs > w.startMs) }));
}

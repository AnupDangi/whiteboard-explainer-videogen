import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AlignedWord, AlignmentResult } from '../shared/alignment/align.js';

/**
 * ElevenLabs speech with character timestamps. The provider returns audio AND the time of every character, so word clocks come
 * from the synthesis itself: no forced-alignment pass, no zero-length words. Any language ElevenLabs offers can be selected with an
 * ISO 639-1 code; the cheapest model that accepts the language is used.
 *
 * Keys: ELEVENLABS_API_KEY_1..9 (or ELEVENLABS_API_KEY), used one at a time; a key with too few credits left is skipped.
 */
const API = 'https://api.elevenlabs.io/v1';
export const DEFAULT_VOICE_ID = 'Xb7hH8MSUJpSbSDYk0k2'; // premade, clear British educator voice (available on free plans)

/** Candidate models, cheapest first, with credits per character. A model that rejects a language falls through to the next. */
export const ELEVENLABS_MODELS = [
  { id: 'eleven_flash_v2_5', creditsPerChar: 0.5 },
  { id: 'eleven_multilingual_v2', creditsPerChar: 1 },
  { id: 'eleven_v3', creditsPerChar: 1 },
] as const;

export interface ElevenLabsEnv { [name: string]: string | undefined }
export type FetchLike = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** process.env plus ELEVENLABS_* / TTS_* lines of the working directory's .env (the pipeline's own loader only knows OpenRouter settings). */
let merged: ElevenLabsEnv | undefined;
export function elevenLabsEnv(): ElevenLabsEnv {
  if (merged) return merged;
  const fromFile: ElevenLabsEnv = {};
  try {
    for (const line of readFileSync(path.join(process.cwd(), '.env'), 'utf8').split('\n')) {
      const m = /^\s*(ELEVENLABS_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) fromFile[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env: only process.env counts */ }
  merged = { ...fromFile, ...process.env };
  return merged;
}

export function elevenLabsKeys(env: ElevenLabsEnv = elevenLabsEnv()): string[] {
  const keys: string[] = [];
  if (env.ELEVENLABS_API_KEY) keys.push(env.ELEVENLABS_API_KEY);
  for (let i = 1; i <= 9; i++) { const key = env[`ELEVENLABS_API_KEY_${i}`]; if (key) keys.push(key); }
  return [...new Set(keys)];
}

interface Balance { remaining: number; checkedAt: number }

/** Uses one key at a time: the first with enough credits for the request; a spent or rejected key is skipped until the month turns. */
export class ElevenKeyPool {
  private readonly balances = new Map<string, Balance>();
  private readonly dead = new Set<string>();
  constructor(private readonly keys: readonly string[], private readonly fetcher: FetchLike) {}

  get size(): number { return this.keys.length; }

  private async balance(key: string): Promise<number | undefined> {
    const known = this.balances.get(key);
    if (known && Date.now() - known.checkedAt < 60_000) return known.remaining;
    const res = await this.fetcher(`${API}/user/subscription`, { headers: { 'xi-api-key': key } });
    if (!res.ok) return undefined;
    const body = await res.json() as { character_count?: number; character_limit?: number };
    if (typeof body.character_count !== 'number' || typeof body.character_limit !== 'number') return undefined;
    const remaining = body.character_limit - body.character_count;
    this.balances.set(key, { remaining, checkedAt: Date.now() });
    return remaining;
  }

  /** The first key with at least `credits` left. */
  async pick(credits: number): Promise<string> {
    for (const key of this.keys) {
      if (this.dead.has(key)) continue;
      const remaining = await this.balance(key);
      if (remaining === undefined) { this.dead.add(key); continue; }
      if (remaining >= credits) return key;
    }
    throw new Error(`no ElevenLabs key has ${Math.ceil(credits)} credits left (${this.keys.length} key${this.keys.length === 1 ? '' : 's'} configured)`);
  }

  spent(key: string, credits: number): void {
    const known = this.balances.get(key);
    if (known) known.remaining -= credits;
  }

  /** The key was refused (invalid, out of credits): do not use it again in this process. */
  retire(key: string): void { this.dead.add(key); }
}

export interface ElevenLabsOptions {
  language: string;
  voice?: string;
  /** Force one model id; otherwise the cheapest one that supports the language. */
  model?: string;
  fetcher?: FetchLike;
  env?: ElevenLabsEnv;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
const pools = new Map<string, ElevenKeyPool>();
const workingModel = new Map<string, string>();

function poolFor(env: ElevenLabsEnv, fetcher: FetchLike): ElevenKeyPool {
  const keys = elevenLabsKeys(env);
  if (keys.length === 0) throw new Error('ElevenLabs needs ELEVENLABS_API_KEY_1 (and optionally _2.._9) in .env');
  const id = keys.join('|');
  let pool = pools.get(id);
  if (!pool) { pool = new ElevenKeyPool(keys, fetcher); pools.set(id, pool); }
  return pool;
}

/** Characters with start/end times to words: maximal runs of non-space characters, each with a positive, ordered interval. */
export function wordsFromCharacterTimes(alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }, durationMs: number): AlignedWord[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (characters.length === 0 || starts.length !== characters.length || ends.length !== characters.length) throw new Error('ElevenLabs alignment is empty or inconsistent');
  const words: AlignedWord[] = [];
  let text = ''; let from = -1; let to = -1;
  const flush = (): void => {
    if (!text) return;
    words.push({ word: text, startMs: from, endMs: to });
    text = ''; from = -1; to = -1;
  };
  characters.forEach((char, i) => {
    if (/\s/u.test(char)) { flush(); return; }
    if (!text) from = starts[i]! * 1000;
    text += char; to = ends[i]! * 1000;
  });
  flush();
  // Positive, ordered, inside the audio: later words never start before the word before them ends.
  let cursor = 0;
  return words.map((word) => {
    const startMs = Math.min(Math.max(word.startMs, cursor), Math.max(0, durationMs - 10));
    const endMs = Math.min(Math.max(word.endMs, startMs + 10), durationMs);
    cursor = endMs;
    return { word: word.word, startMs: Math.round(startMs), endMs: Math.round(Math.max(endMs, startMs + 1)) };
  });
}

export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const wavDurationMs = (wav: Buffer): number => { const rate = wav.readUInt32LE(24); const bytes = wav.readUInt32LE(40); return Math.round((bytes / 2 / rate) * 1000); };

interface Attempt { wav: Buffer; alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }; model: string; credits: number }

/** One synthesis with timestamps, trying models cheapest-first until one accepts the language. */
async function synthesize(text: string, opts: ElevenLabsOptions): Promise<Attempt> {
  const fetcher = opts.fetcher ?? defaultFetch;
  const pool = poolFor(opts.env ?? elevenLabsEnv(), fetcher);
  const voice = opts.voice ?? (opts.env ?? elevenLabsEnv()).ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
  const forced = opts.model ?? (opts.env ?? elevenLabsEnv()).ELEVENLABS_MODEL;
  const known = workingModel.get(opts.language);
  const models = forced ? ELEVENLABS_MODELS.filter((m) => m.id === forced) : known ? ELEVENLABS_MODELS.filter((m) => m.id === known) : [...ELEVENLABS_MODELS];
  if (models.length === 0) throw new Error(`unknown ElevenLabs model ${forced}`);
  let lastError = '';
  for (const model of models) {
    const credits = Math.ceil(text.length * model.creditsPerChar);
    for (let attempt = 0; attempt < pool.size + 1; attempt++) {
      const key = await pool.pick(credits);
      const res = await fetcher(`${API}/text-to-speech/${voice}/with-timestamps?output_format=pcm_24000`, {
        method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: model.id, language_code: opts.language, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 } }),
      });
      if (res.ok) {
        const body = await res.json() as { audio_base64: string; alignment?: Attempt['alignment'] | null };
        if (!body.alignment) throw new Error('ElevenLabs returned no character alignment');
        pool.spent(key, credits);
        workingModel.set(opts.language, model.id);
        return { wav: pcmToWav(Buffer.from(body.audio_base64, 'base64'), 24000), alignment: body.alignment, model: model.id, credits };
      }
      const detail = await res.text();
      lastError = `${model.id} ${res.status}: ${detail.slice(0, 240)}`;
      if (res.status === 400 && /unsupported_language|does not support language/.test(detail)) break; // try the next model
      if (res.status === 401 || res.status === 402 || res.status === 429 || /quota|credits/i.test(detail)) { pool.retire(key); continue; } // try the next key
      throw new Error(`ElevenLabs request failed: ${lastError}`);
    }
  }
  throw new Error(`ElevenLabs could not synthesize language "${opts.language}": ${lastError}`);
}

/**
 * Same contract as `synthesizeAndAlign` (audio file + word clock), produced by ElevenLabs. Timings are the provider's own, so
 * `repairedWordIndexes` is always empty.
 */
export async function synthesizeWithElevenLabs(text: string, opts: ElevenLabsOptions): Promise<AlignmentResult & { audioPath: string; model: string; credits: number }> {
  if (!text.trim()) throw new Error('synthesizeWithElevenLabs: text is required');
  const result = await synthesize(text, opts);
  const durationMs = wavDurationMs(result.wav);
  const words = wordsFromCharacterTimes(result.alignment, durationMs);
  const dir = await mkdtemp(path.join(tmpdir(), 'elevenlabs-'));
  const audioPath = path.join(dir, 'speech.wav');
  await writeFile(audioPath, result.wav);
  return { durationMs, words, aligner: 'elevenlabs-timestamps', repairedWordIndexes: [], audioPath, model: result.model, credits: result.credits };
}

/** Drop-in for `synthesizeAndAlign` in the scene-audio stage. */
export const elevenLabsAligner = async (text: string, options: { language: string; voice?: string }): Promise<AlignmentResult & { audioPath: string }> =>
  synthesizeWithElevenLabs(text, { language: options.language, ...(options.voice ? { voice: options.voice } : {}) });


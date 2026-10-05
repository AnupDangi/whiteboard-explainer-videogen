import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AlignedWord, AlignmentResult } from '../shared/alignment/align.js';
import { FileReservationStore } from './reservations.js';

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

export interface ElevenLabsCapabilitySnapshot {
  snapshotId: string;
  capturedAt: string;
  models: Array<{ id: string; creditsPerChar: number; languages: string[] }>;
  /** Optional voice allowlist by language; absent means the provider accepts the selected voice. */
  voices?: Array<{ id: string; languages: string[] }>;
}

export const normalizeLanguageCode = (value: string): string => value.trim().replaceAll('_', '-').toLowerCase();
export function modelsForLanguage(snapshot: ElevenLabsCapabilitySnapshot, language: string): ElevenLabsCapabilitySnapshot['models'] {
  const code = normalizeLanguageCode(language);
  return snapshot.models.filter((model) => model.languages.some((candidate) => normalizeLanguageCode(candidate) === code || normalizeLanguageCode(candidate) === code.split('-')[0]))
    .sort((a, b) => a.creditsPerChar - b.creditsPerChar || a.id.localeCompare(b.id));
}
export function assertVoiceSupportsLanguage(snapshot: ElevenLabsCapabilitySnapshot, voiceId: string, language: string): void {
  const known = snapshot.voices?.find((voice) => voice.id === voiceId);
  if (snapshot.voices && !known) throw new Error(`voice ${voiceId} is absent from ElevenLabs capability snapshot ${snapshot.snapshotId}`);
  if (known && !known.languages.some((candidate) => normalizeLanguageCode(candidate) === normalizeLanguageCode(language) || normalizeLanguageCode(candidate) === normalizeLanguageCode(language).split('-')[0])) {
    throw new Error(`voice ${voiceId} does not support language ${language} in capability snapshot ${snapshot.snapshotId}`);
  }
}

export interface ElevenLabsEnv { [name: string]: string | undefined }
export type FetchLike = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** process.env plus ELEVENLABS_* / TTS_* lines of the working directory's .env (the pipeline's own loader only knows OpenRouter settings). */
let cachedEnvPath: string | undefined;
let cachedEnvFile: ElevenLabsEnv = {};
export function elevenLabsEnv(): ElevenLabsEnv {
  const filename = path.resolve(process.env.HYPOTHESIS_ENV_FILE || '.env');
  if (cachedEnvPath !== filename) {
    const fromFile: ElevenLabsEnv = {};
    try {
      for (const line of readFileSync(filename, 'utf8').split('\n')) {
        const m = /^\s*(?:export\s+)?((?:ELEVENLABS|TTS)_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m) fromFile[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
      }
    } catch { /* no env file: only process.env counts */ }
    cachedEnvPath = filename;
    cachedEnvFile = fromFile;
  }
  return { ...cachedEnvFile, ...process.env };
}

export function elevenLabsKeys(env: ElevenLabsEnv = elevenLabsEnv()): string[] {
  const keys: string[] = [];
  if (env.ELEVENLABS_API_KEY) keys.push(env.ELEVENLABS_API_KEY);
  for (let i = 1; i <= 9; i++) { const key = env[`ELEVENLABS_API_KEY_${i}`]; if (key) keys.push(key); }
  return [...new Set(keys)];
}

/** Loads an operator-captured capability snapshot; no provider discovery request is made. */
export function loadElevenLabsCapabilitySnapshot(env: ElevenLabsEnv = elevenLabsEnv()): ElevenLabsCapabilitySnapshot | undefined {
  const filename = env.ELEVENLABS_CAPABILITIES_FILE;
  if (!filename) return undefined;
  const parsed = JSON.parse(readFileSync(path.resolve(filename), 'utf8')) as Partial<ElevenLabsCapabilitySnapshot>;
  const valid = typeof parsed.snapshotId === 'string' && parsed.snapshotId.length > 0
    && typeof parsed.capturedAt === 'string' && Number.isFinite(Date.parse(parsed.capturedAt))
    && Array.isArray(parsed.models) && parsed.models.length > 0
    && parsed.models.every((model) => typeof model.id === 'string' && typeof model.creditsPerChar === 'number' && model.creditsPerChar > 0 && Array.isArray(model.languages) && model.languages.length > 0 && model.languages.every((language) => typeof language === 'string'))
    && (parsed.voices === undefined || Array.isArray(parsed.voices) && parsed.voices.every((voice) => typeof voice.id === 'string' && Array.isArray(voice.languages) && voice.languages.every((language) => typeof language === 'string')));
  if (!valid) throw new Error(`Invalid ElevenLabs capability snapshot in ${path.resolve(filename)}`);
  return parsed as ElevenLabsCapabilitySnapshot;
}

export const resolveElevenLabsVoice = (voice?: string, env: ElevenLabsEnv = elevenLabsEnv()): string => voice ?? env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
export const resolveElevenLabsModel = (model?: string, env: ElevenLabsEnv = elevenLabsEnv()): string | undefined => model ?? env.ELEVENLABS_MODEL;

interface Balance { remaining: number; checkedAt: number }

/** Uses one key at a time: the first with enough credits for the request; a spent or rejected key is skipped until the month turns. */
export class ElevenKeyPool {
  private readonly balances = new Map<string, Balance>();
  private readonly dead = new Set<string>();
  private readonly reservations = new Map<string, number>();
  private readonly selection = new Map<string, Promise<void>>();
  private readonly pendingReleases = new Set<Promise<void>>();
  constructor(private readonly keys: readonly string[], private readonly fetcher: FetchLike, private readonly store?: FileReservationStore) {}

  get size(): number { return this.keys.length; }

  /** Resolves when every hold released by settle/cancel has been written to the shared store. */
  async idle(): Promise<void> { while (this.pendingReleases.size) await Promise.all([...this.pendingReleases]); }

  private async balance(key: string): Promise<number | undefined> {
    const known = this.balances.get(key);
    if (known && Date.now() - known.checkedAt < 60_000) return known.remaining;
    let res: Awaited<ReturnType<FetchLike>>;
    try { res = await this.fetcher(`${API}/user/subscription`, { headers: { 'xi-api-key': key } }); }
    catch { return undefined; }
    if (!res.ok) { if (res.status === 401) this.dead.add(key); return undefined; }
    const body = await res.json() as { character_count?: number; character_limit?: number };
    if (typeof body.character_count !== 'number' || typeof body.character_limit !== 'number') return undefined;
    const remaining = body.character_limit - body.character_count;
    this.balances.set(key, { remaining, checkedAt: Date.now() });
    return remaining;
  }

  private async lock(key: string): Promise<() => void> {
    const previous = this.selection.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => { unlock = resolve; });
    const queued = previous.then(() => current);
    this.selection.set(key, queued);
    await previous;
    return () => { unlock(); if (this.selection.get(key) === queued) this.selection.delete(key); };
  }

  /** Atomically reserves a key's remaining credits for one in-flight request. */
  async reserve(credits: number, excludedKeys: ReadonlySet<string> = new Set()): Promise<{ key: string; settle(actualCredits?: number): void; cancel(): void; markUncertain(): void }> {
    await this.idle();
    for (const key of this.keys) {
      if (this.dead.has(key) || excludedKeys.has(key)) continue;
      const unlock = await this.lock(key);
      try {
        const remaining = await this.balance(key);
        if (remaining === undefined) continue;
        // With a store the hold is shared with every process using this key; without one it is process-local.
        const holdId = this.store ? await this.store.tryHold(FileReservationStore.keyId(key), credits, remaining) : undefined;
        if (this.store ? holdId === undefined : remaining - (this.reservations.get(key) ?? 0) < credits) continue;
        if (!this.store) this.reservations.set(key, (this.reservations.get(key) ?? 0) + credits);
        let done = false;
        const release = (actual?: number): void => {
          if (done) return; done = true;
          if (this.store && holdId) { const pending = this.store.release(holdId).catch(() => undefined); this.pendingReleases.add(pending); void pending.finally(() => this.pendingReleases.delete(pending)); }
          else this.reservations.set(key, Math.max(0, (this.reservations.get(key) ?? 0) - credits));
          const known = this.balances.get(key);
          if (known && actual !== undefined) known.remaining = Math.max(0, known.remaining - actual);
        };
        return {
          key,
          settle: (actual = credits) => release(actual),
          cancel: () => release(),
          // A request may have been billed even when its response was lost or returned 5xx.
          // Keep the hold until this process exits or its TTL expires, and avoid this key for
          // later scenes in the same process. The event remains `uncertain`, not `succeeded`.
          markUncertain: () => { if (done) return; done = true; this.dead.add(key); },
        };
      } finally { unlock(); }
    }
    throw new Error(`no ElevenLabs key has ${Math.ceil(credits)} credits left (${this.keys.length} key${this.keys.length === 1 ? '' : 's'} configured)`);
  }

  /** Compatibility helper for callers that only inspect a candidate. */
  async pick(credits: number): Promise<string> { const hold = await this.reserve(credits); hold.cancel(); return hold.key; }

  spent(key: string, credits: number): void { const known = this.balances.get(key); if (known) known.remaining = Math.max(0, known.remaining - credits); }

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
  capabilities?: ElevenLabsCapabilitySnapshot;
  voiceSettings?: { stability: number; similarity_boost: number; speed: number };
  onUsage?: (event: ElevenLabsUsageEvent) => void;
}

export interface ElevenLabsUsageEvent { status: 'succeeded' | 'failed' | 'uncertain'; language: string; model?: string; voice: string; credits?: number; /** 1-based position in the configured deduplicated key pool; never a key or key fragment. */ keyIndex?: number; message?: string }

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
const pools = new Map<string, ElevenKeyPool>();
const workingModel = new Map<string, string>();

function poolFor(env: ElevenLabsEnv, fetcher: FetchLike): ElevenKeyPool {
  const keys = elevenLabsKeys(env);
  if (keys.length === 0) throw new Error('ElevenLabs needs ELEVENLABS_API_KEY_1 (and optionally _2.._9) in .env');
  // Scripted fetchers are isolated test doubles; never bind one into the
  // process-wide live key pool, whose reservations are shared across runs.
  if (fetcher !== defaultFetch) return new ElevenKeyPool(keys, fetcher);
  const id = keys.join('|');
  let pool = pools.get(id);
  // Live pools share credit holds with every other process through a file (benchmarks and demos run lessons as parallel processes).
  if (!pool) { pool = new ElevenKeyPool(keys, fetcher, new FileReservationStore(path.resolve(env.ELEVENLABS_RESERVATIONS_FILE ?? '.data/elevenlabs-reservations.json'))); pools.set(id, pool); }
  return pool;
}

/** Characters with start/end times to words: maximal runs of non-space characters, each with a positive, ordered interval. */
export function wordsFromCharacterTimes(alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }, durationMs: number, language = 'und'): AlignedWord[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (characters.length === 0 || starts.length !== characters.length || ends.length !== characters.length) throw new Error('ElevenLabs alignment is empty or inconsistent');
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('ElevenLabs audio duration is invalid');
  let lastStart = -Infinity; let lastEnd = -Infinity;
  characters.forEach((char, i) => {
    const start = starts[i]! * 1000; const end = ends[i]! * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > durationMs + 2) throw new Error(`ElevenLabs character clock is malformed at character ${i}`);
    if (start < lastStart || start < lastEnd - 2) throw new Error(`ElevenLabs character clock is out of order at character ${i}`);
    if (char.trim() && end - start < 1) throw new Error(`ElevenLabs returned a zero-length character interval at character ${i}`);
    lastStart = start; lastEnd = end;
  });
  const joined = characters.join('');
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(joined)) {
    const ranges: Array<{ start: number; end: number; startMs: number; endMs: number }> = [];
    let offset = 0;
    characters.forEach((char, i) => {
      const end = offset + char.length;
      ranges.push({ start: offset, end, startMs: starts[i]! * 1000, endMs: ends[i]! * 1000 });
      offset = end;
    });
    const segmented = [...new Intl.Segmenter(language, { granularity: 'word' }).segment(joined)]
      .filter((part) => part.isWordLike)
      .map((part) => {
        const end = part.index + part.segment.length;
        const covered = ranges.filter((range) => range.start < end && range.end > part.index);
        if (covered.length === 0) throw new Error('ElevenLabs CJK word segment has no character clock coverage');
        const startMs = Math.round(Math.min(...covered.map((range) => range.startMs)));
        const endMs = Math.round(Math.max(...covered.map((range) => range.endMs)));
        if (endMs <= startMs || endMs > durationMs + 2) throw new Error(`ElevenLabs CJK word clock is malformed for "${part.segment}"`);
        return { word: part.segment, startMs, endMs: Math.min(endMs, durationMs) };
      });
    for (let i = 1; i < segmented.length; i++) if (segmented[i]!.startMs < segmented[i - 1]!.endMs) throw new Error(`ElevenLabs CJK word clock overlaps at word ${i}`);
    return segmented;
  }
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
  // Preserve provider boundaries exactly (rounded to ms); malformed/zero clocks fail above.
  let cursor = 0;
  return words.map((word) => {
    const startMs = Math.round(word.startMs);
    const endMs = Math.round(word.endMs);
    if (endMs <= startMs || startMs < cursor || endMs > durationMs + 2) throw new Error(`ElevenLabs word clock is malformed for "${word.word}"`);
    cursor = endMs;
    return { word: word.word, startMs, endMs: Math.min(endMs, durationMs) };
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

interface ProviderAlignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
interface Attempt { wav: Buffer; alignment: ProviderAlignment; normalizedAlignment?: ProviderAlignment; model: string; credits: number; voice: string; capabilitySnapshotId?: string }

export interface CharacterClock { characters: string[]; startTimesSeconds: number[]; endTimesSeconds: number[] }

/** Maps provider code-point clocks to the submitted text's NFKC/whitespace-normalized code points. */
export function normalizedCharacterClock(alignment: CharacterClock): CharacterClock {
  const raw = alignment.characters.join('');
  if (alignment.characters.length !== alignment.startTimesSeconds.length || alignment.characters.length !== alignment.endTimesSeconds.length) throw new Error('ElevenLabs alignment arrays do not match provider character entries');
  const pointStarts = alignment.characters.flatMap((character, index) => [...character].map(() => alignment.startTimesSeconds[index]!));
  const pointEnds = alignment.characters.flatMap((character, index) => [...character].map(() => alignment.endTimesSeconds[index]!));
  if (pointStarts.length !== [...raw].length || pointEnds.length !== [...raw].length) throw new Error('ElevenLabs alignment arrays do not map to transcript code points');
  const mapped: CharacterClock = { characters: [], startTimesSeconds: [], endTimesSeconds: [] };
  let pointIndex = 0;
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  for (const { segment } of segmenter.segment(raw)) {
    const sourcePoints = [...segment];
    const from = pointIndex; const to = pointIndex + sourcePoints.length;
    const start = Math.min(...pointStarts.slice(from, to));
    const end = Math.max(...pointEnds.slice(from, to));
    pointIndex = to;
    for (const char of [...segment.normalize('NFKC')]) {
      const value = /\s/u.test(char) ? ' ' : char;
      if (value === ' ' && mapped.characters.at(-1) === ' ') {
        mapped.endTimesSeconds[mapped.endTimesSeconds.length - 1] = end;
      } else {
        mapped.characters.push(value); mapped.startTimesSeconds.push(start); mapped.endTimesSeconds.push(end);
      }
    }
  }
  while (mapped.characters[0] === ' ') { mapped.characters.shift(); mapped.startTimesSeconds.shift(); mapped.endTimesSeconds.shift(); }
  while (mapped.characters.at(-1) === ' ') { mapped.characters.pop(); mapped.startTimesSeconds.pop(); mapped.endTimesSeconds.pop(); }
  return mapped;
}

/** One timestamped synthesis routed only through an operator-captured capability snapshot. */
async function synthesize(text: string, opts: ElevenLabsOptions): Promise<Attempt> {
  const fetcher = opts.fetcher ?? defaultFetch;
  const env = opts.env ?? elevenLabsEnv();
  const configuredKeys = elevenLabsKeys(env);
  const voice = resolveElevenLabsVoice(opts.voice, env);
  const forced = resolveElevenLabsModel(opts.model, env);
  const known = workingModel.get(normalizeLanguageCode(opts.language));
  const capabilities = opts.capabilities ?? loadElevenLabsCapabilitySnapshot(env);
  if (!capabilities) throw new Error('ElevenLabs requires a captured capability snapshot; set ELEVENLABS_CAPABILITIES_FILE before synthesis');
  const snapshotModels = modelsForLanguage(capabilities, opts.language);
  assertVoiceSupportsLanguage(capabilities, voice, opts.language);
  const candidates = snapshotModels.map((entry) => ({ id: entry.id, creditsPerChar: entry.creditsPerChar }));
  const models = forced ? candidates.filter((m) => m.id === forced) : known && candidates.some((model) => model.id === known) ? candidates.filter((m) => m.id === known) : candidates;
  if (models.length === 0 && !forced) throw new Error(`no ElevenLabs model in capability snapshot ${capabilities.snapshotId} supports ${opts.language}`);
  if (models.length === 0 && forced && !snapshotModels.some((model) => model.id === forced)) throw new Error(`ElevenLabs model ${forced} is not eligible for ${opts.language} in capability snapshot ${capabilities.snapshotId}`);
  if (models.length === 0) throw new Error(`unknown or unsupported ElevenLabs model ${forced}`);
  const pool = poolFor(env, fetcher);
  let lastError = '';
  const maxAttempts = Math.max(1, pool.size);
  for (const model of models) {
    const credits = Math.ceil([...text].length * model.creditsPerChar);
    let keyRetries = 0;
    const excludedKeys = new Set<string>();
    const throttleRetries = new Map<string, number>();
    while (keyRetries < maxAttempts) {
      let reservation: Awaited<ReturnType<ElevenKeyPool['reserve']>>;
      try { reservation = await pool.reserve(credits, excludedKeys); }
      catch (error) { lastError = error instanceof Error ? error.message : String(error); break; }
      const key = reservation.key;
      const keyIndex = configuredKeys.indexOf(key) + 1;
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetcher(`${API}/text-to-speech/${voice}/with-timestamps?output_format=pcm_24000`, {
          method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model_id: model.id, language_code: opts.language, voice_settings: opts.voiceSettings ?? { stability: 0.5, similarity_boost: 0.75, speed: 1 } }),
        });
      } catch (error) {
        reservation.markUncertain();
        excludedKeys.add(key); keyRetries++;
        const message = error instanceof Error ? error.message : String(error);
        opts.onUsage?.({ status: 'uncertain', language: opts.language, model: model.id, voice, credits, keyIndex, message });
        lastError = `key ${keyIndex} outcome is uncertain: ${message}`;
        continue;
      }
      if (res.ok) {
        let body: { audio_base64: string; alignment?: ProviderAlignment | null; normalized_alignment?: ProviderAlignment | null };
        try {
          body = await res.json() as { audio_base64: string; alignment?: ProviderAlignment | null; normalized_alignment?: ProviderAlignment | null };
          if (!body.alignment || typeof body.audio_base64 !== 'string') throw new Error('ElevenLabs response omitted audio or character alignment');
        } catch (error) {
          reservation.markUncertain(); excludedKeys.add(key); keyRetries++;
          const message = error instanceof Error ? error.message : String(error);
          lastError = `key ${keyIndex} returned an unusable success response: ${message}`;
          opts.onUsage?.({ status: 'uncertain', language: opts.language, model: model.id, voice, credits, keyIndex, message: lastError });
          continue;
        }
        reservation.settle(credits);
        workingModel.set(normalizeLanguageCode(opts.language), model.id);
        opts.onUsage?.({ status: 'succeeded', language: opts.language, model: model.id, voice, credits, keyIndex });
        return { wav: pcmToWav(Buffer.from(body.audio_base64, 'base64'), 24000), alignment: body.alignment, ...(body.normalized_alignment ? { normalizedAlignment: body.normalized_alignment } : {}), model: model.id, credits, voice, capabilitySnapshotId: capabilities.snapshotId };
      }
      const detail = await res.text();
      lastError = `${model.id} ${res.status}: ${detail.slice(0, 240)}`;
      if (res.status === 400 && /unsupported_language|does not support language/.test(detail)) {
        reservation.cancel();
        throw new Error(`ElevenLabs capability snapshot ${capabilities.snapshotId} was contradicted: ${lastError}`);
      }
      if (res.status === 401 || res.status === 402 || res.status === 403 || /quota|credits/i.test(detail)) {
        reservation.cancel();
        pool.retire(key); keyRetries++;
        excludedKeys.add(key);
        opts.onUsage?.({ status: 'failed', language: opts.language, model: model.id, voice, credits, keyIndex, message: lastError });
        continue;
      }
      if (res.status === 429) {
        // One short retry handles a transient throttle; a repeated 429 is treated as key-scoped
        // and moves to the next key. Do not spend the remaining keys retrying one throttled slot.
        const keyThrottleRetries = throttleRetries.get(key) ?? 0;
        if (keyThrottleRetries < 1) { reservation.cancel(); throttleRetries.set(key, keyThrottleRetries + 1); continue; }
        reservation.cancel(); pool.retire(key); keyRetries++; excludedKeys.add(key);
        opts.onUsage?.({ status: 'failed', language: opts.language, model: model.id, voice, credits, keyIndex, message: lastError });
        continue;
      }
      if (res.status >= 500) {
        reservation.markUncertain(); excludedKeys.add(key); keyRetries++;
        opts.onUsage?.({ status: 'uncertain', language: opts.language, model: model.id, voice, credits, keyIndex, message: lastError });
        continue;
      }
      reservation.cancel();
      opts.onUsage?.({ status: 'failed', language: opts.language, model: model.id, voice, credits, keyIndex, message: lastError });
      throw new Error(`ElevenLabs request failed: ${lastError}`);
    }
  }
  opts.onUsage?.({ status: 'failed', language: opts.language, voice, message: lastError });
  throw new Error(`ElevenLabs could not synthesize language "${opts.language}": ${lastError}`);
}

/**
 * Same contract as `synthesizeAndAlign` (audio file + word clock), produced by ElevenLabs. Timings are the provider's own, so
 * `repairedWordIndexes` is always empty.
 */
export async function synthesizeWithElevenLabs(text: string, opts: ElevenLabsOptions): Promise<AlignmentResult & { audioPath: string; model: string; credits: number; voice: string; submittedText: string; normalizedText: string; normalizationVersion: string; rawCharacterClock: CharacterClock; normalizedCharacterClock: CharacterClock; capabilitySnapshotId?: string }> {
  if (!text.trim()) throw new Error('synthesizeWithElevenLabs: text is required');
  const result = await synthesize(text, opts);
  const durationMs = wavDurationMs(result.wav);
  const normalizedText = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const alignedText = result.alignment.characters.join('').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (normalizedText !== alignedText) throw new Error('ElevenLabs timestamp transcript does not map exactly to submitted text after NFKC whitespace normalization');
  const rawCharacterClock = { characters: result.alignment.characters, startTimesSeconds: result.alignment.character_start_times_seconds, endTimesSeconds: result.alignment.character_end_times_seconds };
  const mappedClock = result.normalizedAlignment
    ? { characters: result.normalizedAlignment.characters, startTimesSeconds: result.normalizedAlignment.character_start_times_seconds, endTimesSeconds: result.normalizedAlignment.character_end_times_seconds }
    : normalizedCharacterClock(rawCharacterClock);
  if (mappedClock.characters.join('') !== normalizedText) throw new Error('ElevenLabs normalized character clock does not map to submitted text');
  const words = wordsFromCharacterTimes(result.normalizedAlignment ?? result.alignment, durationMs, opts.language);
  const dir = await mkdtemp(path.join(tmpdir(), 'elevenlabs-'));
  const audioPath = path.join(dir, 'speech.wav');
  await writeFile(audioPath, result.wav);
  return { durationMs, words, aligner: 'elevenlabs-timestamps', repairedWordIndexes: [], audioPath, model: result.model, credits: result.credits, voice: result.voice, submittedText: text, normalizedText, normalizationVersion: 'nfkc-whitespace/v1', rawCharacterClock, normalizedCharacterClock: mappedClock, ...(result.capabilitySnapshotId ? { capabilitySnapshotId: result.capabilitySnapshotId } : {}) };
}

/** Drop-in for `synthesizeAndAlign` in the scene-audio stage. */
export const elevenLabsAligner = async (text: string, options: { language: string; voice?: string; model?: string; capabilities?: ElevenLabsCapabilitySnapshot; voiceSettings?: ElevenLabsOptions['voiceSettings']; onUsage?: ElevenLabsOptions['onUsage'] }): Promise<AlignmentResult & { audioPath: string; model: string; credits: number; voice: string; submittedText: string; normalizedText: string; normalizationVersion: string; rawCharacterClock: CharacterClock; normalizedCharacterClock: CharacterClock; capabilitySnapshotId?: string }> =>
  synthesizeWithElevenLabs(text, { language: options.language, ...(options.voice ? { voice: options.voice } : {}), ...(options.model ? { model: options.model } : {}), ...(options.capabilities ? { capabilities: options.capabilities } : {}), ...(options.voiceSettings ? { voiceSettings: options.voiceSettings } : {}), ...(options.onUsage ? { onUsage: options.onUsage } : {}) });

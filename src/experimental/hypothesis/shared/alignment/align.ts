/**
 * Node/TS adapter for the local forced-alignment Python sidecar (`align.py`).
 *
 * `alignAudio` spawns the sidecar as a subprocess (JSON on stdin, JSON on
 * stdout -- same convention voice-engine's own CLI uses) and returns
 * word-level timestamps. `synthesizeAndAlign` is a convenience that first
 * calls the local voice-engine's `synthesize()` and then forced-aligns the
 * resulting WAV against the exact text that was synthesized.
 *
 * This module makes no network calls and never silently degrades: any
 * failure (missing venv, python crash, malformed output, voice-engine
 * synthesis failure) throws. Callers decide fallback policy, matching
 * `HypothesisRunOptions.alignment` in contracts.ts. An unmeasured calibration
 * permits diagnostic collection only: the live pipeline records a hard S5
 * failure, so the run cannot publish. A measured value comes from the
 * versioned calibration record, never from this adapter.
 */
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, resolve, sep} from 'node:path';

const RAW_HERE = dirname(fileURLToPath(import.meta.url));
/**
 * tsc's outDir='dist' + rootDir='.' mirrors the whole source tree under
 * dist/ (so this compiled file lands at .../dist/src/.../shared/alignment).
 * The sidecar's non-TS assets (align.py, the .venv/ python environment)
 * are never copied into dist/ -- they only exist in the source tree at
 * .../src/.../shared/alignment. Map a dist/ import back to its source
 * directory so subprocess paths resolve correctly whether this module runs
 * from compiled JS or straight from source.
 */
const DIST_SRC_MARKER = `${sep}dist${sep}src${sep}`;
const HERE = RAW_HERE.includes(DIST_SRC_MARKER) ? RAW_HERE.replace(DIST_SRC_MARKER, `${sep}src${sep}`) : RAW_HERE;

/** Where this repo's own alignment venv lives (created via `setup.sh`). */
const DEFAULT_PYTHON_BIN = resolve(HERE, '.venv/bin/python');
const DEFAULT_ALIGN_SCRIPT = resolve(HERE, 'align.py');

/**
 * Default location of the local voice-engine package's built entry point.
 * Each hypothesis worktree carries its own copy of voice-engine at its repo
 * root (`<worktree>/voice-engine/`), kept independent from the other
 * worktree and from the original explain-canvas-lab checkout, so this is a
 * relative path within THIS repo -- not a cross-repo or machine-specific
 * assumption. It must be built first (`cd voice-engine && npm run build`);
 * `resolveSynthesize` throws a clear, actionable error if `dist/index.js`
 * isn't there yet. Callers on a different layout should pass
 * `voiceEngineModulePath` or inject `synthesize` directly instead.
 */
const DEFAULT_VOICE_ENGINE_MODULE = resolve(
  HERE,
  '../../../../../voice-engine/dist/index.js',
);

export interface AlignedWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface AlignmentResult {
  durationMs: number;
  words: AlignedWord[];
}

export interface AlignAudioOptions {
  /** BCP-47-ish language code passed to the aligner. Default 'en'. */
  language?: string;
  /** faster-whisper model size ('tiny'|'base'|'small'|'medium'|'large-v3'|...). Default 'base'. */
  model?: string;
  /** Override the python interpreter (defaults to this directory's .venv). */
  pythonBin?: string;
  /** Override the align.py script path. */
  alignScript?: string;
  /** Abort the alignment subprocess. */
  signal?: AbortSignal;
}

/**
 * Forced-align `text` against the WAV file at `audioPath` using the local
 * stable-ts + faster-whisper sidecar. Throws on any failure -- missing
 * file, python/venv not set up, malformed sidecar output, or empty text
 * (this is forced alignment, not blind transcription: text is required).
 */
export async function alignAudio(
  audioPath: string,
  text: string,
  options: AlignAudioOptions = {},
): Promise<AlignmentResult> {
  if (!audioPath || !audioPath.trim()) throw new Error('alignAudio: audioPath is required');
  if (!text || !text.trim()) throw new Error('alignAudio: text is required for forced alignment (blind transcription is not supported)');

  const pythonBin = options.pythonBin ?? DEFAULT_PYTHON_BIN;
  const alignScript = options.alignScript ?? DEFAULT_ALIGN_SCRIPT;
  const payload = JSON.stringify({
    audioPath,
    text,
    language: options.language ?? 'en',
    model: options.model ?? 'base',
  });

  const stdout = await new Promise<string>((resolvePromise, reject) => {
    let out = '';
    let err = '';
    let settled = false;
    const child = spawn(pythonBin, [alignScript], {stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal});
    child.stdout.on('data', chunk => {out += String(chunk);});
    child.stderr.on('data', chunk => {err += String(chunk);});
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    child.on('error', error => {
      const hint = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? ` (python interpreter not found at ${pythonBin} -- run shared/alignment/setup.sh first)`
        : '';
      fail(new Error(`forced alignment subprocess failed to start: ${error.message}${hint}`));
    });
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(`forced alignment failed (exit ${code}): ${err.trim().slice(0, 500) || 'no stderr output'}`));
        return;
      }
      settled = true;
      resolvePromise(out);
    });
    child.stdin.end(payload);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`forced alignment produced invalid JSON on stdout: ${error instanceof Error ? error.message : String(error)}`);
  }

  return validateAlignmentResult(parsed);
}

function validateAlignmentResult(value: unknown): AlignmentResult {
  if (!value || typeof value !== 'object') throw new Error('forced alignment output is not an object');
  const record = value as Record<string, unknown>;
  if (typeof record.durationMs !== 'number' || !Number.isFinite(record.durationMs)) {
    throw new Error('forced alignment output missing numeric durationMs');
  }
  if (!Array.isArray(record.words)) throw new Error('forced alignment output missing words array');
  const words: AlignedWord[] = record.words.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`forced alignment word[${index}] is not an object`);
    const word = entry as Record<string, unknown>;
    if (typeof word.word !== 'string') throw new Error(`forced alignment word[${index}].word is not a string`);
    if (typeof word.startMs !== 'number' || !Number.isFinite(word.startMs)) throw new Error(`forced alignment word[${index}].startMs is not a finite number`);
    if (typeof word.endMs !== 'number' || !Number.isFinite(word.endMs)) throw new Error(`forced alignment word[${index}].endMs is not a finite number`);
    return {word: word.word, startMs: word.startMs, endMs: word.endMs};
  });
  return {durationMs: record.durationMs, words};
}

/** Minimal shape of voice-engine's `synthesize()` this adapter depends on. */
export interface SynthesizeFn {
  (input: {text: string; language: string; voice?: string; provider?: 'auto' | 'supertonic' | 'piper'}): Promise<{audioPath: string}>;
}

export interface SynthesizeAndAlignOptions extends AlignAudioOptions {
  language: string;
  voice?: string;
  provider?: 'auto' | 'supertonic' | 'piper';
  /**
   * Inject voice-engine's `synthesize` directly (preferred -- avoids any
   * path assumption). If omitted, this function tries to dynamically
   * import it from `voiceEngineModulePath` (or the default sibling-repo
   * guess) instead.
   */
  synthesize?: SynthesizeFn;
  /** Override where to dynamically import voice-engine's synthesize() from, if `synthesize` isn't injected. */
  voiceEngineModulePath?: string;
}

let cachedSynthesize: SynthesizeFn | undefined;
let cachedSynthesizeModulePath: string | undefined;

async function resolveSynthesize(modulePath: string): Promise<SynthesizeFn> {
  if (cachedSynthesize && cachedSynthesizeModulePath === modulePath) return cachedSynthesize;
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    throw new Error(
      `synthesizeAndAlign: could not load voice-engine's synthesize() from ${modulePath}. ` +
      `Build voice-engine first (cd voice-engine && npm run build), or pass options.synthesize / options.voiceEngineModulePath explicitly. ` +
      `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const candidate = (mod as {synthesize?: unknown}).synthesize;
  if (typeof candidate !== 'function') throw new Error(`synthesizeAndAlign: module at ${modulePath} does not export a synthesize() function`);
  cachedSynthesize = candidate as SynthesizeFn;
  cachedSynthesizeModulePath = modulePath;
  return cachedSynthesize;
}

/**
 * Convenience pipeline helper: synthesize `text` with the local voice-engine,
 * then forced-align the result against that exact text. Throws (does not
 * fall back) if either synthesis or alignment fails.
 */
export async function synthesizeAndAlign(
  text: string,
  options: SynthesizeAndAlignOptions,
): Promise<AlignmentResult & {audioPath: string}> {
  if (!text || !text.trim()) throw new Error('synthesizeAndAlign: text is required');
  const synthesize = options.synthesize ?? await resolveSynthesize(options.voiceEngineModulePath ?? DEFAULT_VOICE_ENGINE_MODULE);
  const synthResult = await synthesize({text, language: options.language, voice: options.voice, provider: options.provider});
  if (!synthResult?.audioPath) throw new Error('synthesizeAndAlign: voice-engine synthesize() returned no audioPath');
  const aligned = await alignAudio(synthResult.audioPath, text, {
    language: options.language,
    model: options.model,
    pythonBin: options.pythonBin,
    alignScript: options.alignScript,
    signal: options.signal,
  });
  return {...aligned, audioPath: synthResult.audioPath};
}

/**
 * Node/TS adapter for the local forced-alignment Python sidecar (`align.py`).
 *
 * `alignAudio` sends newline-delimited JSON to a persistent worker pool; each
 * worker retains its stable-ts model between scene requests. `synthesizeAndAlign` first
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
import {createInterface} from 'node:readline';

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
  '../../../voice-engine/dist/index.js',
);

export interface AlignedWord {
  word: string;
  startMs: number;
  endMs: number;
}

export type AlignerIdentity = 'stable-ts' | 'stable-ts-fast-mode' | 'torchaudio-wav2vec2-ctc' | 'stable-ts+collapsed-repair' | 'elevenlabs-timestamps';

export interface AlignmentResult {
  durationMs: number;
  words: AlignedWord[];
  /** Which aligner actually produced these timings (pass order: default -> fast_mode -> CTC -> bounded repair). Defaults to 'stable-ts' when the sidecar output omits it (older cached payloads). */
  aligner: AlignerIdentity;
  /** Indexes (into `words`) of any words whose interval was synthesized by the bounded collapsed-word repair pass, rather than measured. Empty when no repair ran. */
  repairedWordIndexes: number[];
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
  /** Number of persistent CPU aligner workers. Defaults to HYPOTHESIS_ALIGNMENT_WORKERS or 2. */
  workerPoolSize?: number;
}

interface AlignmentRequest { audioPath: string; text: string; language: string; model: string }
interface AlignmentTask { payload: AlignmentRequest; resolve: (value: AlignmentResult) => void; reject: (error: Error) => void; signal?: AbortSignal; abortListener?: () => void }
interface AlignmentWorker { child: ReturnType<typeof spawn>; current?: AlignmentTask; stderr: string; dead: boolean }

class AlignmentWorkerPool {
  private readonly queue: AlignmentTask[] = [];
  private readonly workers: AlignmentWorker[] = [];
  private closed = false;
  constructor(private readonly pythonBin: string, private readonly alignScript: string, private readonly size: number) {}

  run(payload: AlignmentRequest, signal?: AbortSignal): Promise<AlignmentResult> {
    return new Promise((resolvePromise, reject) => {
      if (this.closed) return reject(new Error('alignment worker pool is closed'));
      if (signal?.aborted) return reject(alignmentAbortError());
      const task: AlignmentTask = { payload, resolve: resolvePromise, reject, signal };
      if (signal) {
        task.abortListener = () => {
          const queuedIndex = this.queue.indexOf(task);
          if (queuedIndex >= 0) {
            this.queue.splice(queuedIndex, 1);
            this.detachAbort(task);
            task.reject(alignmentAbortError());
            return;
          }
          const worker = this.workers.find((candidate) => candidate.current === task);
          if (!worker) return;
          this.detachAbort(task);
          task.reject(alignmentAbortError());
          worker.current = undefined;
          this.failWorker(worker, alignmentAbortError());
        };
        signal.addEventListener('abort', task.abortListener, { once: true });
      }
      if (signal?.aborted) { this.detachAbort(task); reject(alignmentAbortError()); return; }
      this.queue.push(task);
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
    const error = new Error('alignment worker pool closed');
    for (const task of this.queue.splice(0)) { this.detachAbort(task); task.reject(error); }
    for (const worker of this.workers) {
      worker.dead = true;
      if (worker.current) { this.detachAbort(worker.current); worker.current.reject(error); }
      worker.child.kill('SIGTERM');
    }
    this.workers.length = 0;
  }

  private pump(): void {
    if (this.closed) return;
    while (this.queue.length) {
      let worker = this.workers.find((candidate) => !candidate.dead && !candidate.current);
      if (!worker && this.workers.filter((candidate) => !candidate.dead).length < this.size) worker = this.startWorker();
      if (!worker) return;
      const task = this.queue.shift()!;
      worker.current = task;
      worker.child.stdin!.write(`${JSON.stringify(task.payload)}\n`, (error) => {
        if (error) this.failWorker(worker!, new Error(`could not send alignment request: ${error.message}`));
      });
    }
  }

  private startWorker(): AlignmentWorker {
    const child = spawn(this.pythonBin, [this.alignScript, '--worker'], {stdio: ['pipe', 'pipe', 'pipe']});
    const worker: AlignmentWorker = { child, stderr: '', dead: false };
    this.workers.push(worker);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const task = worker.current;
      if (!task) return this.failWorker(worker, new Error('alignment worker returned an unsolicited response'));
      worker.current = undefined;
      this.detachAbort(task);
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.error === 'string') task.reject(new Error(`forced alignment failed: ${parsed.error}`));
        else task.resolve(validateAlignmentResult(parsed));
      } catch (error) {
        task.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pump();
    });
    child.stderr.on('data', (chunk) => { worker.stderr = `${worker.stderr}${String(chunk)}`.slice(-2000); });
    child.on('error', (error) => this.failWorker(worker, new Error(`forced alignment worker failed to start: ${error.message}`)));
    child.on('close', (code) => this.failWorker(worker, new Error(`forced alignment worker exited (${code}): ${worker.stderr.trim().slice(-500) || 'no stderr output'}`)));
    return worker;
  }

  private failWorker(worker: AlignmentWorker, error: Error): void {
    if (worker.dead) return;
    worker.dead = true;
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    worker.current?.reject(error);
    if (worker.current) this.detachAbort(worker.current);
    worker.current = undefined;
    worker.child.kill('SIGTERM');
    this.pump();
  }

  private detachAbort(task: AlignmentTask): void {
    if (task.signal && task.abortListener) task.signal.removeEventListener('abort', task.abortListener);
    task.abortListener = undefined;
  }
}

function alignmentAbortError(): Error {
  const error = new Error('forced alignment request was aborted');
  error.name = 'AbortError';
  return error;
}

const workerPools = new Map<string, AlignmentWorkerPool>();
function alignmentPool(pythonBin: string, alignScript: string, model: string, language: string, size: number): AlignmentWorkerPool {
  const key = JSON.stringify({ pythonBin, alignScript, model, language, size });
  let pool = workerPools.get(key);
  if (!pool) { pool = new AlignmentWorkerPool(pythonBin, alignScript, size); workerPools.set(key, pool); }
  return pool;
}

/** Stop persistent model workers during application shutdown and tests. */
export function closeAlignmentWorkers(): void {
  for (const pool of workerPools.values()) pool.close();
  workerPools.clear();
}

let cachedCloseVoiceEngineWorkers: (() => void) | undefined;
/** Close both sides of the local speech pipeline from one-shot lesson CLIs. */
export function closeSpeechWorkers(): void {
  closeAlignmentWorkers();
  cachedCloseVoiceEngineWorkers?.();
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
  const payload = {
    audioPath,
    text,
    language: options.language ?? 'en',
    model: options.model ?? 'base',
  };
  if (options.signal?.aborted) throw alignmentAbortError();
  const size = Math.max(1, Math.min(8, Math.floor(options.workerPoolSize ?? (Number(process.env.HYPOTHESIS_ALIGNMENT_WORKERS) || 2))));
  return alignmentPool(pythonBin, alignScript, payload.model, payload.language, size).run(payload, options.signal);
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
  const alignerValues: AlignerIdentity[] = ['stable-ts', 'stable-ts-fast-mode', 'torchaudio-wav2vec2-ctc', 'stable-ts+collapsed-repair', 'elevenlabs-timestamps'];
  const aligner = record.aligner;
  if (aligner !== undefined && !alignerValues.includes(aligner as AlignerIdentity)) {
    throw new Error('forced alignment output has an unsupported aligner identity');
  }
  const repairedWordIndexesRaw = record.repairedWordIndexes;
  if (repairedWordIndexesRaw !== undefined && !Array.isArray(repairedWordIndexesRaw)) {
    throw new Error('forced alignment output repairedWordIndexes is not an array');
  }
  const repairedWordIndexes: number[] = Array.isArray(repairedWordIndexesRaw)
    ? repairedWordIndexesRaw.map((value, index) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`forced alignment repairedWordIndexes[${index}] is not a finite number`);
      if (!Number.isInteger(value) || value < 0 || value >= words.length) throw new Error(`forced alignment repairedWordIndexes[${index}] is out of range`);
      return value;
    })
    : [];
  return {
    durationMs: record.durationMs,
    words,
    aligner: aligner !== undefined ? (aligner as AlignerIdentity) : 'stable-ts',
    repairedWordIndexes,
  };
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
  const closeWorkers = (mod as {closeVoiceEngineWorkers?: unknown}).closeVoiceEngineWorkers;
  cachedCloseVoiceEngineWorkers = typeof closeWorkers === 'function' ? closeWorkers as () => void : undefined;
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

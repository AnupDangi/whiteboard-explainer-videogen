import {log} from './logger.js';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import type {ProviderOptions,Timing} from './types.js';

export const KOKORO_VOICES = ['af_heart', 'am_michael', 'bf_emma', 'af_bella', 'am_adam'] as const;

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8765';
const PERSISTENT_VENV_PYTHON = fileURLToPath(new URL('../../.kokoro-venv/bin/python', import.meta.url));

/** Self-healing: the actual reliability problem historically was never the model —
 *  it was remembering to start the persistent server. If KOKORO_SERVER_URL (defaulted
 *  below) isn't answering, spawn scripts/kokoro_server.py detached (once per process,
 *  guarded so concurrent callers share the same startup) and poll /health until it is.
 *  Falls back to KOKORO_PYTHON / plain python3 if the persistent venv isn't set up
 *  (run scripts/setup-kokoro.sh) — never silently substitutes a different voice. */
let serverStarting: Map<string,Promise<void>> = new Map();
export function ensureKokoroServer(serverUrl: string, env: NodeJS.ProcessEnv, fetcher: typeof fetch): Promise<void> {
  const health = () => fetcher(`${serverUrl}/health`, {signal: AbortSignal.timeout(1500)}).then(r => r.ok, () => false);
  return health().then(ok => {
    if (ok) return;
    const pending = serverStarting.get(serverUrl);
    if (pending) return pending;
    log('speech.server-starting', {provider: 'kokoro', serverUrl}, 'warn');
    const port = new URL(serverUrl).port || '8765';
    const python = existsSync(PERSISTENT_VENV_PYTHON) ? PERSISTENT_VENV_PYTHON : (env.KOKORO_PYTHON || 'python3');
    const started = new Promise<void>((resolve, reject) => {
      const child = spawn(python, [fileURLToPath(new URL('../../scripts/kokoro_server.py', import.meta.url)), '--port', port], {
        env, detached: true, stdio: 'ignore',
      });
      child.unref();
      child.on('error', error => reject(new Error(`Could not start the Kokoro server (run scripts/setup-kokoro.sh first): ${error}`)));
      const deadline = Date.now() + 40000;
      const poll = (): void => {
        health().then(ok => {
          if (ok) return resolve();
          if (Date.now() > deadline) return reject(new Error('Kokoro server did not become healthy within 40s (model load can be slow on first run — check the process manually if this persists)'));
          setTimeout(poll, 500);
        });
      };
      poll();
    }).finally(() => serverStarting.delete(serverUrl));
    serverStarting.set(serverUrl, started);
    return started;
  });
}

/** Kokoro neural speech with native word timings. Persistent-server transport only —
 *  the per-request spawn path (~4-5s of cold model load every single scene) is now
 *  only a fallback ensureServer reaches for when the venv exists but the server isn't
 *  running yet; once it's up, every subsequent call reuses it. */
function classifyGap(timing:Timing):{gapClassification:string;activeAfterLastWordMs:number}{
  const lastWordEnd=timing.words[timing.words.length-1].endMs;
  const gapMs=timing.durationMs-lastWordEnd;
  if(gapMs<=0)return{gapClassification:'none',activeAfterLastWordMs:0};
  if(timing.trailingNonSilent)return{gapClassification:'non-silent-signal',activeAfterLastWordMs:gapMs};
  return{gapClassification:'silent-tail',activeAfterLastWordMs:gapMs};
}
export interface KokoroServerResult {audio:Buffer;timing:Timing;format:'wav';gapClassification:string;activeAfterLastWordMs:number}

/** POST one synthesis to a specific worker URL and classify its trailing gap. Shared by
 *  the single-server adapter and the bounded worker pool (src/tts-pool.ts); the deadline
 *  is supplied by the caller so the pool can exclude queue-wait from service time. */
export async function synthesizeAtServer(serverUrl:string,text:string,voiceId:string|undefined,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<KokoroServerResult> {
  const started=performance.now();
  const response=await fetcher(`${serverUrl}/synthesize`,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:voiceId||'af_heart'})});
  const result=await response.json() as {audio_base64?:string;timing?:Timing;error?:string};
  if(!response.ok||!result.audio_base64||!result.timing?.words?.length)throw new Error(result.error||`Kokoro server HTTP ${response.status}`);
  const timing=result.timing as Timing;
  const gapClassification=classifyGap(timing);
  log('speech.alignment',{provider:'kokoro',gapMs:timing.durationMs-timing.words[timing.words.length-1].endMs,gapClassification:gapClassification.gapClassification,words:timing.words.length,trailingNonSilent:timing.trailingNonSilent});
  log('speech.transport',{provider:'kokoro',via:'server',elapsedMs:Math.round(performance.now()-started)});
  return {audio:Buffer.from(result.audio_base64,'base64'),timing,format:'wav' as const,gapClassification:gapClassification.gapClassification,activeAfterLastWordMs:gapClassification.activeAfterLastWordMs};
}

export function generateKokoroSpeech(text: string, {signal, env = process.env, voiceId, fetcher = fetch}: ProviderOptions & {fetcher?: typeof fetch} = {}) {
  const voice = voiceId || 'af_heart';
  log('speech.request', {provider: 'kokoro', voice, characters: text.length});
  if (voiceId && !(KOKORO_VOICES as readonly string[]).includes(voiceId)) {
    return Promise.reject(new Error(`Unknown Kokoro voice ${voiceId}; use one of ${KOKORO_VOICES.join(', ')}`));
  }
  const serverUrl = (env.KOKORO_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  return ensureKokoroServer(serverUrl, env, fetcher).then(() => {
    const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
    return synthesizeAtServer(serverUrl, text, voice, timeout, fetcher).then(r => ({
      audio: r.audio, timing: r.timing, format: r.format,
      _gapClassification: r.gapClassification, _activeAfterLastWordMs: r.activeAfterLastWordMs,
    }));
  });
}

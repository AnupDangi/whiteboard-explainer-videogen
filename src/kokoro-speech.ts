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
let serverStarting: Promise<void> | null = null;
function ensureServer(serverUrl: string, env: NodeJS.ProcessEnv, fetcher: typeof fetch): Promise<void> {
  const health = () => fetcher(`${serverUrl}/health`, {signal: AbortSignal.timeout(1500)}).then(r => r.ok, () => false);
  return health().then(ok => {
    if (ok) return;
    if (serverStarting) return serverStarting;
    log('speech.server-starting', {provider: 'kokoro', serverUrl}, 'warn');
    const port = new URL(serverUrl).port || '8765';
    const python = existsSync(PERSISTENT_VENV_PYTHON) ? PERSISTENT_VENV_PYTHON : (env.KOKORO_PYTHON || 'python3');
    serverStarting = new Promise((resolve, reject) => {
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
    });
    return serverStarting;
  });
}

/** Kokoro neural speech with native word timings. Persistent-server transport only —
 *  the per-request spawn path (~4-5s of cold model load every single scene) is now
 *  only a fallback ensureServer reaches for when the venv exists but the server isn't
 *  running yet; once it's up, every subsequent call reuses it. */
export function generateKokoroSpeech(text: string, {signal, env = process.env, voiceId, fetcher = fetch}: ProviderOptions & {fetcher?: typeof fetch} = {}) {
  const voice = voiceId || 'af_heart';
  log('speech.request', {provider: 'kokoro', voice, characters: text.length});
  const started = performance.now();
  if (voiceId && !(KOKORO_VOICES as readonly string[]).includes(voiceId)) {
    return Promise.reject(new Error(`Unknown Kokoro voice ${voiceId}; use one of ${KOKORO_VOICES.join(', ')}`));
  }
  const serverUrl = (env.KOKORO_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  return ensureServer(serverUrl, env, fetcher).then(() => {
    const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
    return fetcher(`${serverUrl}/synthesize`, {method: 'POST', signal: timeout, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, voice})}).then(
      async response => {
        const result = await response.json() as {audio_base64?: string; timing?: Timing; error?: string};
        if (!response.ok || !result.audio_base64 || !result.timing?.words?.length) throw new Error(result.error || `Kokoro server HTTP ${response.status}`);
        log('speech.transport', {provider: 'kokoro', via: 'server', elapsedMs: Math.round(performance.now() - started)});
        return {audio: Buffer.from(result.audio_base64, 'base64'), timing: result.timing, format: 'wav' as const};
      },
    );
  });
}

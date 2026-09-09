import {log} from './logger.js';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {ProviderOptions,Timing} from './types.js';

export const KOKORO_VOICES = ['af_heart', 'am_michael', 'bf_emma', 'af_bella', 'am_adam'] as const;

/** Kokoro neural speech with native word timings.
 *  Phase 4 transport: KOKORO_SERVER_URL (persistent server, model loaded once) is
 *  tried first; any failure falls back to spawning the bridge with KOKORO_PYTHON
 *  (or plain python3). Missing runtime everywhere is a loud failure — never silent. */
export function generateKokoroSpeech(text: string, {signal, env = process.env, voiceId, fetcher = fetch}: ProviderOptions & {fetcher?: typeof fetch} = {}) {
  const voice = voiceId || 'af_heart';
  log('speech.request', {provider: 'kokoro', voice, characters: text.length});
  const started = performance.now();
  return new Promise<{audio: Buffer; timing: Timing; format: 'wav'}>((resolve, reject) => {
    if (voiceId && !(KOKORO_VOICES as readonly string[]).includes(voiceId)) {
      reject(new Error(`Unknown Kokoro voice ${voiceId}; use one of ${KOKORO_VOICES.join(', ')}`));
      return;
    }
    const serverUrl = (env.KOKORO_SERVER_URL || '').replace(/\/+$/, '');
    if (serverUrl) {
      const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
      fetcher(`${serverUrl}/synthesize`, {method: 'POST', signal: timeout, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, voice})}).then(
        async response => {
          const result = await response.json() as {audio_base64?: string; timing?: Timing; error?: string};
          if (!response.ok || !result.audio_base64 || !result.timing?.words?.length) throw new Error(result.error || `Kokoro server HTTP ${response.status}`);
          log('speech.transport', {provider: 'kokoro', via: 'server', elapsedMs: Math.round(performance.now() - started)});
          resolve({audio: Buffer.from(result.audio_base64, 'base64'), timing: result.timing, format: 'wav'});
        },
        () => {
          log('speech.transport', {provider: 'kokoro', via: 'spawn-fallback'}, 'warn');
          spawnBridge().then(resolve, reject);
        },
      );
      return;
    }
    spawnBridge().then(resolve, reject);
    function spawnBridge(): Promise<{audio: Buffer; timing: Timing; format: 'wav'}> {
      return new Promise((resolveSpawn, rejectSpawn) => {
        const child = spawn(env.KOKORO_PYTHON || 'python3', [fileURLToPath(new URL('../../scripts/kokoro_tts.py', import.meta.url))], {
          env, signal, timeout: 180000, stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '', error = '';
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 100_000_000) child.kill(); });
        child.stderr.on('data', (chunk: string) => { error = (error + chunk).slice(-2000); });
        child.on('error', error => { log('speech.process-error', {provider: 'kokoro', error}, 'error'); rejectSpawn(error); });
        child.stdin.on('error', () => {});
        child.on('close', code => {
          log('speech.process-exit', {provider: 'kokoro', code, elapsedMs: Math.round(performance.now() - started), error: error || undefined}, code === 0 ? 'info' : 'error');
          if (code !== 0) {
            const reason = code === null && !error
              ? 'process killed before producing output (likely timeout under load; retry usually succeeds)'
              : ((error || '') + ' (check KOKORO_PYTHON; under parallel load the OS may also kill the process — retry usually succeeds)').slice(0, 400);
            return rejectSpawn(new Error(`Kokoro TTS failed: ${reason}`));
          }
          try {
            const result = JSON.parse(output);
            if (!result.audio_base64 || !result.timing?.words?.length) throw new Error('Missing audio or word timings');
            log('speech.transport', {provider: 'kokoro', via: 'spawn'});
            resolveSpawn({audio: Buffer.from(result.audio_base64, 'base64'), timing: result.timing, format: 'wav'});
          } catch (e) { rejectSpawn(e); }
        });
        child.stdin.end(JSON.stringify({text, voice}));
      });
    }
  });
}

import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {VENV_PYTHON} from './paths.js';

export interface BridgeResult {
  audioPath: string;
  audioDurationMs: number;
  generationMs: number;
}

/** Run one one-shot Python bridge: JSON request on stdin, JSON result on stdout. */
export function runPythonBridge(scriptPath: string, payload: unknown): Promise<BridgeResult> {
  return new Promise((resolvePromise, reject) => {
    const started = performance.now();
    const child = spawn(VENV_PYTHON, [scriptPath], {stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => reject(new Error(`Could not start ${scriptPath} (${VENV_PYTHON}): ${error.message}`)));
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`${scriptPath} exited ${code}: ${stderr.trim() || 'no stderr'}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {audioPath: string; durationMs: number};
        resolvePromise({
          audioPath: parsed.audioPath,
          audioDurationMs: parsed.durationMs,
          generationMs: performance.now() - started,
        });
      } catch {
        reject(new Error(`Unreadable bridge output from ${scriptPath}: ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

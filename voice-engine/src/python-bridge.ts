import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {performance} from 'node:perf_hooks';
import {VENV_PYTHON} from './paths.js';

export interface BridgeResult {
  audioPath: string;
  audioDurationMs: number;
  generationMs: number;
}

interface BridgeTask { payload: unknown; started: number; resolve: (result: BridgeResult) => void; reject: (error: Error) => void }
interface BridgeWorker { child: ChildProcessWithoutNullStreams; current?: BridgeTask; stderr: string; dead: boolean }

/** Persistent provider worker pool; each Python process keeps its voice model loaded between scenes. */
class PythonBridgePool {
  private readonly queue: BridgeTask[] = [];
  private readonly workers: BridgeWorker[] = [];
  private closed = false;
  constructor(private readonly pythonBin: string, private readonly scriptPath: string, private readonly size: number) {}

  run(payload: unknown): Promise<BridgeResult> {
    return new Promise((resolvePromise, reject) => {
      if (this.closed) return reject(new Error('voice-engine worker pool is closed'));
      this.queue.push({payload, started: performance.now(), resolve: resolvePromise, reject});
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
    const error = new Error('voice-engine worker pool closed');
    for (const task of this.queue.splice(0)) task.reject(error);
    for (const worker of this.workers) {
      worker.dead = true;
      worker.current?.reject(error);
      worker.child.kill('SIGTERM');
    }
    this.workers.length = 0;
  }

  private pump(): void {
    if (this.closed) return;
    while (this.queue.length) {
      let worker = this.workers.find(candidate => !candidate.dead && !candidate.current);
      if (!worker && this.workers.filter(candidate => !candidate.dead).length < this.size) worker = this.startWorker();
      if (!worker) return;
      const task = this.queue.shift()!;
      worker.current = task;
      worker.child.stdin.write(`${JSON.stringify(task.payload)}\n`, error => {
        if (error) this.failWorker(worker!, new Error(`Could not send request to ${this.scriptPath}: ${error.message}`));
      });
    }
  }

  private startWorker(): BridgeWorker {
    const child = spawn(this.pythonBin, [this.scriptPath, '--worker'], {stdio: ['pipe', 'pipe', 'pipe']});
    const worker: BridgeWorker = {child, stderr: '', dead: false};
    this.workers.push(worker);
    const lines = createInterface({input: child.stdout});
    lines.on('line', line => {
      const task = worker.current;
      if (!task) return this.failWorker(worker, new Error(`Unsolicited worker response from ${this.scriptPath}`));
      worker.current = undefined;
      try {
        const result = JSON.parse(line) as {audioPath?: unknown; durationMs?: unknown; synthMs?: unknown; error?: unknown};
        if (typeof result.error === 'string') task.reject(new Error(`${this.scriptPath} synthesis failed: ${result.error}`));
        else if (typeof result.audioPath !== 'string' || typeof result.durationMs !== 'number' || !Number.isFinite(result.durationMs)) task.reject(new Error(`Unreadable bridge response from ${this.scriptPath}: ${line.slice(0, 300)}`));
        else task.resolve({audioPath: result.audioPath, audioDurationMs: result.durationMs, generationMs: typeof result.synthMs === 'number' && Number.isFinite(result.synthMs) ? result.synthMs : performance.now() - task.started});
      } catch (error) {
        task.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pump();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { worker.stderr = `${worker.stderr}${String(chunk)}`.slice(-2000); });
    child.on('error', error => this.failWorker(worker, new Error(`Could not start ${this.scriptPath} (${this.pythonBin}): ${error.message}`)));
    child.on('close', code => this.failWorker(worker, new Error(`${this.scriptPath} worker exited ${code}: ${worker.stderr.trim().slice(-500) || 'no stderr'}`)));
    return worker;
  }

  private failWorker(worker: BridgeWorker, error: Error): void {
    if (worker.dead) return;
    worker.dead = true;
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    worker.current?.reject(error);
    worker.current = undefined;
    worker.child.kill('SIGTERM');
    this.pump();
  }
}

const pools = new Map<string, PythonBridgePool>();
function bridgePool(scriptPath: string): PythonBridgePool {
  const configured = Number(process.env.VOICE_ENGINE_WORKERS) || 1;
  const size = Math.max(1, Math.min(4, Math.floor(configured)));
  const key = JSON.stringify({pythonBin: VENV_PYTHON, scriptPath, size});
  let pool = pools.get(key);
  if (!pool) { pool = new PythonBridgePool(VENV_PYTHON, scriptPath, size); pools.set(key, pool); }
  return pool;
}

/** Stop all persistent provider/model workers during shutdown and tests. */
export function closeVoiceEngineWorkers(): void {
  for (const pool of pools.values()) pool.close();
  pools.clear();
}

/** Submit one scene to a bounded local provider pool using JSON-line IPC. */
export function runPythonBridge(scriptPath: string, payload: unknown): Promise<BridgeResult> {
  return bridgePool(scriptPath).run(payload);
}

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

interface RasterJob {
  id: number;
  svg: string;
  width: number;
  resolve: (png: Buffer) => void;
  reject: (error: Error) => void;
}
interface RasterWorkerSlot { worker: Worker; active?: RasterJob }

/** Bounded CPU raster workers. SVG production stays in the shared pure renderer. */
export class RasterPool {
  private readonly slots: RasterWorkerSlot[];
  private readonly queue: RasterJob[] = [];
  private nextId = 1;
  private stopped?: Error;
  private closing = false;

  constructor(size = Math.max(1, Math.min(4, availableParallelism() - 1))) {
    if (!Number.isInteger(size) || size < 1 || size > 8) throw new Error('RasterPool size must be an integer from 1 to 8');
    const workerUrl = new URL('./rasterWorker.js', import.meta.url);
    this.slots = Array.from({ length: size }, () => {
      const worker = new Worker(fileURLToPath(workerUrl));
      const slot: RasterWorkerSlot = { worker };
      worker.on('message', (result: { id: number; png?: ArrayBuffer; error?: string }) => {
        const job = slot.active;
        if (!job || job.id !== result.id) return this.fail(new Error(`Raster worker returned unexpected job ${result.id}`));
        slot.active = undefined;
        if (result.error || !result.png) job.reject(new Error(result.error ?? 'Raster worker returned no PNG data'));
        else job.resolve(Buffer.from(result.png));
        this.pump();
      });
      worker.on('error', (error) => this.fail(new Error(`Raster worker failed: ${error instanceof Error ? error.message : String(error)}`)));
      worker.on('exit', (code) => { if (code !== 0 && !this.stopped && !this.closing) this.fail(new Error(`Raster worker exited ${code}`)); });
      return slot;
    });
  }

  render(svg: string, width: number): Promise<Buffer> {
    if (this.stopped) return Promise.reject(this.stopped);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.queue.push({ id, svg, width, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.stopped) return;
    for (const slot of this.slots) {
      if (slot.active || this.queue.length === 0) continue;
      const job = this.queue.shift()!;
      slot.active = job;
      try { slot.worker.postMessage({ id: job.id, svg: job.svg, width: job.width }); }
      catch (error) { slot.active = undefined; job.reject(error instanceof Error ? error : new Error(String(error))); }
    }
  }

  private fail(error: Error): void {
    if (this.stopped) return;
    this.stopped = error;
    for (const job of this.queue.splice(0)) job.reject(error);
    for (const slot of this.slots) {
      slot.active?.reject(error);
      slot.active = undefined;
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.slots.map(({ worker }) => worker.terminate()));
  }
}

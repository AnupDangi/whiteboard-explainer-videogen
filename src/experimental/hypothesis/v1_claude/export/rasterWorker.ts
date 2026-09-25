import { parentPort } from 'node:worker_threads';
import { Resvg } from '@resvg/resvg-js';
import { RESVG_FONT_OPTIONS } from '../render/fonts.js';

if (!parentPort) throw new Error('rasterWorker must run inside a worker thread');

parentPort.on('message', (job: { id: number; svg: string; width: number }) => {
  try {
    const png = new Resvg(job.svg, { ...RESVG_FONT_OPTIONS, fitTo: { mode: 'width', value: job.width } }).render().asPng();
    const exact = Uint8Array.from(png);
    parentPort!.postMessage({ id: job.id, png: exact.buffer }, [exact.buffer]);
  } catch (error) {
    parentPort!.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) });
  }
});

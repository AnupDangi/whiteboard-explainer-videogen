import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { availableParallelism } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import type { Timeline } from '../types.js';
import { STYLE } from '../style.js';
import { spawnFrameEncoder } from './ffmpeg.js';
import { RasterPool } from './rasterPool.js';
import { frameSvgAt, type VideoScene } from './frame.js';
import { RESVG_FONT_OPTIONS } from '../render/fonts.js';

export { ERASE_MS, frameSvgAt, type VideoScene } from './frame.js';

/**
 * S10 export mode + S11 encode (claude_pipeline.md §16/§28): rasterize
 * `renderSVG(scene, timeline, t)` at `fps` via @resvg/resvg-js and pipe PNG
 * frames into ffmpeg (image2pipe), muxing in the real master WAV produced by
 * audioStitch.ts. `renderSVG` itself stays untouched and pure — this module
 * only calls it at successive timestamps and rasterizes each result.
 */
export async function encodeVideo(scenes: VideoScene[], totalDurationMs: number, audioWavPath: string, outPath: string, fps = 30, workerCount = Math.max(1, Math.min(4, availableParallelism() - 1))): Promise<{ frames: number; ffmpegArgs: string[] }> {
  if (scenes.length === 0) throw new Error('encodeVideo: no scenes to render');
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8) throw new Error('encodeVideo: workerCount must be an integer from 1 to 8');
  await mkdir(dirname(outPath), { recursive: true });
  const totalFrames = Math.max(1, Math.round((totalDurationMs / 1000) * fps));
  const encoder = spawnFrameEncoder(outPath, fps, audioWavPath);
  const pool = new RasterPool(workerCount);

  const sorted = [...scenes].sort((a, b) => a.startMs - b.startMs);
  const pending = new Map<number, Promise<{ png?: Buffer; error?: unknown }>>();
  const maxInFlight = workerCount * 2;
  let scheduled = 0;
  let written = 0;
  try {
    while (written < totalFrames) {
      while (scheduled < totalFrames && pending.size < maxInFlight) {
        const frame = scheduled++;
        const svg = frameSvgAt(sorted, (frame / fps) * 1000);
        pending.set(frame, pool.render(svg, STYLE.canvas.w).then((png) => ({ png }), (error: unknown) => ({ error })));
      }
      const result = await pending.get(written)!;
      pending.delete(written);
      if (result.error) throw result.error;
      await encoder.write(result.png!);
      written++;
    }
    encoder.end();
    await encoder.done;
  } catch (error) {
    encoder.abort();
    await encoder.done.catch(() => undefined);
    throw error;
  } finally {
    await pool.close();
  }
  return { frames: totalFrames, ffmpegArgs: encoder.args };
}

/** Publish an MP4 only after ffmpeg has completed successfully. Interrupted or failed encodes leave no final-path artifact. */
export async function encodeVideoAtomically(
  scenes: VideoScene[], totalDurationMs: number, audioWavPath: string, outPath: string, fps = 30,
  workerCount = Math.max(1, Math.min(4, availableParallelism() - 1)),
  encode: typeof encodeVideo = encodeVideo,
): Promise<{ frames: number; ffmpegArgs: string[] }> {
  const partialPath = `${outPath}.${process.pid}.${randomUUID()}.partial.mp4`;
  try {
    const result = await encode(scenes, totalDurationMs, audioWavPath, partialPath, fps, workerCount);
    await rename(partialPath, outPath);
    return result;
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Rasterize a single already-built SVG string (e.g. the contact sheet) to a PNG file via resvg. */
export function rasterizePng(svg: string, width: number): Buffer {
  // Contact sheets are one-off images; keep their synchronous helper separate from frame workers.
  return new Resvg(svg, { ...RESVG_FONT_OPTIONS, fitTo: { mode: 'width', value: width } }).render().asPng();
}

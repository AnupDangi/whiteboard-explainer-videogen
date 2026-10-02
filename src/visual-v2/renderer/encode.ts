import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { STYLE } from '../../render/style.js';
import { spawnFrameEncoder } from '../../export/ffmpeg.js';
import { RasterPool } from '../../export/rasterPool.js';
import { rasterizeCachedFrame } from '../../export/videoEncode.js';
import { holdKey, renderSceneSvg, type CompiledScene } from './frame.js';

export interface V2VideoScene { scene: CompiledScene; startMs: number; endMs: number }

/**
 * Encode board scenes to MP4. Frames are a pure function of (scene, time). A frame inside a hold (nothing animating) is rendered
 * once and reused, so a long still board costs one rasterization, not hundreds. The master audio is muxed in unchanged.
 */
export async function encodeV2Video(scenes: readonly V2VideoScene[], totalDurationMs: number, audioWavPath: string, outPath: string, options: { fps?: number; workerCount?: number; cacheDir?: string } = {}): Promise<{ frames: number; rendered: number; reused: number }> {
  if (scenes.length === 0) throw new Error('encodeV2Video: no scenes to render');
  const fps = options.fps ?? 30;
  const workerCount = options.workerCount ?? Math.max(1, Math.min(4, availableParallelism() - 1));
  const cacheDir = options.cacheDir ?? join(dirname(outPath), '.raster-frame-cache');
  await mkdir(dirname(outPath), { recursive: true });
  const sorted = [...scenes].sort((a, b) => a.startMs - b.startMs);
  const totalFrames = Math.max(1, Math.round((totalDurationMs / 1000) * fps));
  const encoder = spawnFrameEncoder(outPath, fps, audioWavPath);
  const pool = new RasterPool(workerCount);
  const pending = new Map<number, Promise<Buffer>>();
  const maxInFlight = workerCount * 2;
  let scheduled = 0;
  let written = 0;
  let rendered = 0;
  let reused = 0;
  let lastKey: string | undefined;
  let lastPng: Promise<Buffer> | undefined;
  const sceneAt = (t: number): V2VideoScene => { let found = sorted[0]!; for (const s of sorted) if (s.startMs <= t) found = s; return found; };
  try {
    while (written < totalFrames) {
      while (scheduled < totalFrames && pending.size < maxInFlight) {
        const frame = scheduled++;
        const t = (frame / fps) * 1000;
        const active = sceneAt(t);
        const local = Math.max(0, Math.min(t - active.startMs, active.scene.timeline.durationMs + (active.endMs - active.startMs)));
        const key = holdKey(active.scene, local);
        if (key !== undefined && key === lastKey && lastPng) { pending.set(frame, lastPng); reused++; continue; }
        const svg = renderSceneSvg(active.scene, local);
        const png = rasterizeCachedFrame(svg, { cacheDir, width: STYLE.canvas.w }, (source, width) => pool.render(source, width)).then(({ png: buffer }) => buffer);
        pending.set(frame, png);
        rendered++;
        lastKey = key;
        lastPng = key === undefined ? undefined : png;
      }
      const buffer = await pending.get(written)!;
      pending.delete(written);
      await encoder.write(buffer);
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
  return { frames: totalFrames, rendered, reused };
}

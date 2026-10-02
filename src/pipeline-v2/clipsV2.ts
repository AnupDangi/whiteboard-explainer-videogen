import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { canonicalHash } from '../harness/replayDeterminism.js';
import { concatClips, spawnClipEncoder } from '../export/ffmpeg.js';
import { RasterPool } from '../export/rasterPool.js';
import { verifiedInputs, type LessonLockV2, type RenderSegment } from './lockV2.js';

/**
 * Per-scene clips (V2 plan Phase 15). Each scene's frame range encodes to its own silent clip, keyed by the hashes of every
 * frame it shows, so an unchanged scene is never re-rendered and a failed clip is retried alone. Clips are joined in lesson
 * order without re-encoding, and the master audio is muxed once so no join carries an audio gap.
 */
export const CLIP_ENCODER_VERSION = 'scene-clip/v1';

export interface SceneClipPlan { sceneId: string; firstFrame: number; frameCount: number; key: string; segments: RenderSegment[] }

const frameHashes = (segment: RenderSegment): string[] => segment.kind === 'hold' ? [segment.svgHash] : segment.svgHashes;

/** Group the lock's frame plan by scene, in order; segments of one scene must be contiguous and scenes must tile the render. */
export function planSceneClips(lock: LessonLockV2): SceneClipPlan[] {
  const plans: SceneClipPlan[] = [];
  let expectedFrame = 0;
  for (const segment of lock.renderPlan) {
    if (segment.firstFrame !== expectedFrame) throw new Error(`render plan has a gap or overlap at frame ${expectedFrame}`);
    expectedFrame += segment.frameCount;
    const last = plans[plans.length - 1];
    if (last && last.sceneId === segment.sceneId) { last.frameCount += segment.frameCount; last.segments.push(segment); continue; }
    if (plans.some((plan) => plan.sceneId === segment.sceneId)) throw new Error(`scene ${segment.sceneId} is split across the render plan`);
    plans.push({ sceneId: segment.sceneId, firstFrame: segment.firstFrame, frameCount: segment.frameCount, key: '', segments: [segment] });
  }
  if (expectedFrame !== lock.render.frames) throw new Error(`render plan covers ${expectedFrame} frames, lock says ${lock.render.frames}`);
  for (const plan of plans) {
    plan.key = canonicalHash({
      encoder: CLIP_ENCODER_VERSION, fps: lock.render.fps, width: lock.render.width, height: lock.render.height, ffmpeg: lock.versions.ffmpeg, resvg: lock.versions.resvg,
      segments: plan.segments.map((segment) => [segment.kind, segment.frameCount, frameHashes(segment)]),
    });
  }
  return plans;
}

export interface ClipEncodeDeps {
  createRasterPool?: (workers: number) => Pick<RasterPool, 'render' | 'close'>;
  spawnClipEncoder?: typeof spawnClipEncoder;
  concat?: typeof concatClips;
  /** Where clips are cached; share it between runs so an edit to one scene re-renders only that scene. Defaults to `<outputDir>/clips`. */
  cacheDir?: string;
  /** Attempts per clip before the export fails (default 2). */
  attempts?: number;
  /** Clips encoded at once (default 2). */
  concurrency?: number;
  /** Called, in lesson order, as each scene's clip becomes available. */
  onClipReady?: (clip: { sceneId: string; path: string; index: number }) => void;
}

export interface ClipEncodeResult {
  frames: number; rendered: number; reused: number;
  clips: Array<{ sceneId: string; key: string; cached: boolean; attempts: number; path: string }>;
}

const exists = async (file: string): Promise<boolean> => { try { return (await stat(file)).size > 0; } catch { return false; } };

/** Encode a locked lesson as cached per-scene clips and join them in order with the verified master audio. */
export async function encodeLockedLessonV2Clips(outputDir: string, outPath: string, deps: ClipEncodeDeps = {}): Promise<ClipEncodeResult> {
  const { lock, audio, svgs } = await verifiedInputs(outputDir);
  const plans = planSceneClips(lock);
  const cacheDir = deps.cacheDir ?? path.join(outputDir, 'clips');
  await mkdir(cacheDir, { recursive: true });
  await mkdir(path.dirname(outPath), { recursive: true });
  const workers = Math.max(1, Math.min(4, availableParallelism() - 1));
  const pool = (deps.createRasterPool ?? ((size) => new RasterPool(size)))(workers);
  const attemptsMax = Math.max(1, deps.attempts ?? 2);
  const concurrency = Math.max(1, deps.concurrency ?? 2);
  const results: ClipEncodeResult['clips'] = new Array(plans.length);
  let rendered = 0; let reused = 0; let next = 0; let announced = 0;
  let manifestWrites: Promise<void> = Promise.resolve();
  const announceReady = (): void => {
    while (announced < plans.length && results[announced]) {
      const clip = results[announced]!;
      deps.onClipReady?.({ sceneId: clip.sceneId, path: clip.path, index: announced });
      announced++;
    }
  };

  async function encodeOnce(plan: SceneClipPlan, final: string): Promise<void> {
    const partial = path.join(cacheDir, `.${plan.key}.${randomUUID()}.partial.mp4`);
    const encoder = (deps.spawnClipEncoder ?? spawnClipEncoder)(partial, lock.render.fps);
    void encoder.done.catch(() => undefined);
    const pending: Array<Promise<Buffer>> = [];
    try {
      let lastHash: string | undefined; let lastPng: Promise<Buffer> | undefined; let written = 0; let scheduled = 0;
      const hashAt = (frame: number): string => {
        let offset = 0;
        for (const segment of plan.segments) {
          if (frame < offset + segment.frameCount) return segment.kind === 'hold' ? segment.svgHash : segment.svgHashes[frame - offset]!;
          offset += segment.frameCount;
        }
        throw new Error(`frame ${frame} is outside scene ${plan.sceneId}`);
      };
      while (written < plan.frameCount) {
        while (scheduled < plan.frameCount && pending.length < workers * 2) {
          const hash = hashAt(scheduled++);
          let png: Promise<Buffer>;
          if (hash === lastHash && lastPng) { png = lastPng; reused++; } else { png = pool.render(svgs.get(hash)!, lock.render.width); rendered++; }
          lastHash = hash; lastPng = png; pending.push(png);
        }
        await encoder.write(await pending.shift()!); written++;
      }
      encoder.end(); await encoder.done; await rename(partial, final);
    } catch (error) {
      encoder.abort(); await encoder.done.catch(() => undefined); await rm(partial, { force: true }); throw error;
    }
  }

  async function produce(index: number): Promise<void> {
    const plan = plans[index]!;
    const final = path.join(cacheDir, `${plan.key}.mp4`);
    if (await exists(final)) { results[index] = { sceneId: plan.sceneId, key: plan.key, cached: true, attempts: 0, path: final }; return; }
    let attempts = 0; let failure: unknown;
    while (attempts < attemptsMax) {
      attempts++;
      try { await encodeOnce(plan, final); results[index] = { sceneId: plan.sceneId, key: plan.key, cached: false, attempts, path: final }; return; } catch (error) { failure = error; }
    }
    throw new Error(`scene ${plan.sceneId} clip failed after ${attemptsMax} attempt${attemptsMax === 1 ? '' : 's'}: ${failure instanceof Error ? failure.message : String(failure)}`);
  }

  const nonce = randomUUID();
  const listPath = path.join(cacheDir, `.concat.${nonce}.txt`);
  const audioSnapshot = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${nonce}.audio.wav`);
  const partialOut = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${nonce}.partial.mp4`);
  try {
    let failed: unknown;
    await Promise.all(Array.from({ length: Math.min(concurrency, plans.length) }, async () => {
      while (failed === undefined && next < plans.length) {
        const index = next++;
        try { await produce(index); announceReady(); manifestWrites = manifestWrites.then(() => writeManifest(cacheDir, plans, results)); await manifestWrites; } catch (error) { failed = error; }
      }
    }));
    if (failed !== undefined) throw failed;
    await writeFile(audioSnapshot, audio[0]!, { flag: 'wx' });
    await writeFile(listPath, results.map((clip) => `file '${clip.path.replaceAll("'", "'\\''")}'`).join('\n') + '\n');
    await (deps.concat ?? concatClips)(listPath, audioSnapshot, partialOut);
    await access(partialOut); await rename(partialOut, outPath);
  } catch (error) {
    await rm(partialOut, { force: true }); throw error;
  } finally {
    try { await pool.close(); } finally { await Promise.all([rm(audioSnapshot, { force: true }), rm(listPath, { force: true })]); }
  }
  return { frames: lock.render.frames, rendered, reused, clips: results };
}

/** The ready prefix of clips, so a player can start at scene 1 while later scenes are still encoding. Written atomically. */
async function writeManifest(cacheDir: string, plans: SceneClipPlan[], results: ClipEncodeResult['clips']): Promise<void> {
  const ready: Array<{ sceneId: string; file: string }> = [];
  for (let i = 0; i < plans.length && results[i]; i++) ready.push({ sceneId: results[i]!.sceneId, file: path.basename(results[i]!.path) });
  const file = path.join(cacheDir, 'manifest.json');
  const partial = `${file}.${randomUUID()}.partial`;
  await writeFile(partial, `${JSON.stringify({ schemaVersion: 'scene-clips/v1', total: plans.length, ready }, null, 2)}\n`);
  await rename(partial, file);
}

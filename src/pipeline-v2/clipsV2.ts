import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { canonicalHash } from '../harness/replayDeterminism.js';
import { concatClips, probeMediaDurationMs, spawnClipEncoder } from '../export/ffmpeg.js';
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
  probeDurationMs?: typeof probeMediaDurationMs;
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

const fileHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const expectedDurationMs = (frames: number, fps: number): number => Math.round(frames * 1000 / fps);

async function verifiedCachedClip(file: string, metadataFile: string, plan: SceneClipPlan, fps: number, probe: typeof probeMediaDurationMs): Promise<boolean> {
  try {
    const [bytes, metadataBytes] = await Promise.all([readFile(file), readFile(metadataFile)]);
    const metadata = JSON.parse(metadataBytes.toString('utf8')) as { schemaVersion?: string; key?: string; sha256?: string; bytes?: number; durationMs?: number };
    if (metadata.schemaVersion !== 'scene-clip-cache/v1' || metadata.key !== plan.key || !bytes.length || metadata.bytes !== bytes.length || metadata.sha256 !== fileHash(bytes)) return false;
    const measured = await probe(file);
    return Number.isFinite(measured) && Math.abs(measured - expectedDurationMs(plan.frameCount, fps)) <= Math.ceil(1000 / fps) && metadata.durationMs === measured;
  } catch { return false; }
}

async function acquireClipLock(lockFile: string, isReady: () => Promise<boolean>): Promise<Awaited<ReturnType<typeof open>> | undefined> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { return await open(lockFile, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await isReady()) return undefined;
      const stale = await stat(lockFile).then((info) => Date.now() - info.mtimeMs > 60 * 60_000, () => false);
      if (stale) { await rm(lockFile, { force: true }); continue; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`timed out waiting for shared clip cache lock ${path.basename(lockFile)}`);
}

/** Encode a locked lesson as cached per-scene clips and join them in order with the verified master audio. */
export async function encodeLockedLessonV2Clips(outputDir: string, outPath: string, deps: ClipEncodeDeps = {}): Promise<ClipEncodeResult> {
  const { lock, audio, svgs } = await verifiedInputs(outputDir);
  const plans = planSceneClips(lock);
  const cacheDir = deps.cacheDir ?? path.join(outputDir, 'clips');
  const progressDir = path.join(outputDir, 'v2');
  await mkdir(cacheDir, { recursive: true });
  await mkdir(progressDir, { recursive: true });
  await mkdir(path.dirname(outPath), { recursive: true });
  const workers = Math.max(1, Math.min(4, availableParallelism() - 1));
  const createPool = deps.createRasterPool ?? ((size: number) => new RasterPool(size));
  const attemptsMax = Math.max(1, deps.attempts ?? 2);
  const probe = deps.probeDurationMs ?? probeMediaDurationMs;
  const concurrency = Math.max(1, deps.concurrency ?? 2);
  const activeConcurrency = Math.min(concurrency, plans.length);
  const workersPerClip = Math.max(1, Math.floor(workers / activeConcurrency));
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

  async function encodeOnce(plan: SceneClipPlan, final: string, pool: Pick<RasterPool, 'render' | 'close'>): Promise<void> {
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
        while (scheduled < plan.frameCount && pending.length < workersPerClip * 2) {
          const hash = hashAt(scheduled++);
          let png: Promise<Buffer>;
          if (hash === lastHash && lastPng) { png = lastPng; reused++; } else { png = pool.render(svgs.get(hash)!, lock.render.width); rendered++; }
          lastHash = hash; lastPng = png; pending.push(png);
        }
        await encoder.write(await pending.shift()!); written++;
      }
      encoder.end(); await encoder.done; await rename(partial, final);
    } catch (error) {
      encoder.abort(); await encoder.done.catch(() => undefined); await Promise.allSettled(pending); await rm(partial, { force: true }); throw error;
    }
  }

  async function produce(index: number): Promise<void> {
    const plan = plans[index]!;
    const final = path.join(cacheDir, `${plan.key}.mp4`);
    const metadataFile = `${final}.json`;
    if (await verifiedCachedClip(final, metadataFile, plan, lock.render.fps, probe)) { results[index] = { sceneId: plan.sceneId, key: plan.key, cached: true, attempts: 0, path: final }; return; }
    const lockFile = `${final}.lock`;
    const cacheLock = await acquireClipLock(lockFile, () => verifiedCachedClip(final, metadataFile, plan, lock.render.fps, probe));
    if (!cacheLock) { results[index] = { sceneId: plan.sceneId, key: plan.key, cached: true, attempts: 0, path: final }; return; }
    const cacheLockId = randomUUID();
    let pool: Pick<RasterPool, 'render' | 'close'> | undefined;
    try {
      await cacheLock.writeFile(cacheLockId);
      pool = createPool(workersPerClip);
      if (await verifiedCachedClip(final, metadataFile, plan, lock.render.fps, probe)) { results[index] = { sceneId: plan.sceneId, key: plan.key, cached: true, attempts: 0, path: final }; return; }
      await Promise.all([rm(final, { force: true }), rm(metadataFile, { force: true })]);
      let attempts = 0; let failure: unknown;
      while (attempts < attemptsMax) {
        attempts++;
        try {
          try { await encodeOnce(plan, final, pool); }
          catch (error) {
            // A crashed raster worker can leave the pool unusable. Close it and
            // give the bounded retry a fresh pool rather than retrying in a dead one.
            await pool.close().catch(() => undefined);
            pool = createPool(workersPerClip);
            throw error;
          }
          const bytes = await readFile(final);
          const durationMs = await probe(final);
          if (!Number.isFinite(durationMs) || Math.abs(durationMs - expectedDurationMs(plan.frameCount, lock.render.fps)) > Math.ceil(1000 / lock.render.fps)) throw new Error(`scene ${plan.sceneId} clip duration ${durationMs}ms does not match its locked frame range`);
          const metadata = { schemaVersion: 'scene-clip-cache/v1', key: plan.key, sha256: fileHash(bytes), bytes: bytes.length, durationMs };
          const tempMetadata = `${metadataFile}.${randomUUID()}.partial`;
          try { await writeFile(tempMetadata, `${JSON.stringify(metadata)}\n`, { flag: 'wx' }); await rename(tempMetadata, metadataFile); }
          finally { await rm(tempMetadata, { force: true }); }
          results[index] = { sceneId: plan.sceneId, key: plan.key, cached: false, attempts, path: final }; return;
        } catch (error) { failure = error; await rm(final, { force: true }); await rm(metadataFile, { force: true }); }
      }
      throw new Error(`scene ${plan.sceneId} clip failed after ${attemptsMax} attempt${attemptsMax === 1 ? '' : 's'}: ${failure instanceof Error ? failure.message : String(failure)}`);
    } finally {
      await pool?.close().catch(() => undefined);
      await cacheLock.close();
      if (await readFile(lockFile, 'utf8').then((value) => value === cacheLockId, () => false)) await rm(lockFile, { force: true });
    }
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
        try { await produce(index); announceReady(); manifestWrites = manifestWrites.then(() => writeManifest(progressDir, plans, results)); await manifestWrites; } catch (error) { failed = error; }
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
    await Promise.all([rm(audioSnapshot, { force: true }), rm(listPath, { force: true })]);
  }
  return { frames: lock.render.frames, rendered, reused, clips: results };
}

/** The ready prefix of clips, so a player can start at scene 1 while later scenes are still encoding. Written atomically. */
async function writeManifest(progressDir: string, plans: SceneClipPlan[], results: ClipEncodeResult['clips']): Promise<void> {
  const ready: Array<{ sceneId: string; file: string }> = [];
  for (let i = 0; i < plans.length && results[i]; i++) ready.push({ sceneId: results[i]!.sceneId, file: path.basename(results[i]!.path) });
  const file = path.join(progressDir, 'clip-progress.json');
  const partial = `${file}.${randomUUID()}.partial`;
  await writeFile(partial, `${JSON.stringify({ schemaVersion: 'scene-clips/v1', total: plans.length, ready }, null, 2)}\n`);
  await rename(partial, file);
}

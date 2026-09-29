import { execFileSync } from 'node:child_process';
import { createHash as createNodeHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableJson } from '../../shared/artifacts.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { renderSVG } from '../render/renderScene.js';
import type { LaidOutScene, Timeline } from '../types.js';

/**
 * lesson.lock.json (Teaching Compiler V1 §6): the hard boundary after which
 * the system is 100% deterministic. The lock names every input a pure render
 * needs — source, plan, narration, visual intents, resolved assets + bridge
 * version, audio + alignment, geometry, timeline, fonts, tool versions — each
 * by content hash. Anything not in the lock must not affect the pixels.
 *
 * - buildLessonLock: assemble from a finished run outputDir (+ in-memory
 *   per-scene final-frame SVGs for hash purposes; SVGs themselves are
 *   re-derivable and NOT stored).
 * - verifyLessonLock: recompute every file hash + the content hash from
 *   outputDir alone. Pure: no LLM, network, TTS, or randomness.
 * - rerenderFinalFrame: re-derive a scene's final SVG from locked geometry +
 *   timeline (the S10 purity check).
 */

export const LESSON_LOCK_VERSION = 'lesson.lock/v1';

export interface LockAssetRef {
  assetId: string | null;
  strategy?: string;
  rung?: number;
}

export interface LockScene {
  sceneId: string;
  files: { spec: string; resolved: string; layout: string; timeline: string; audio?: string };
  fileHashes: { spec: string; resolved: string; layout: string; timeline: string; audio?: string };
  alignmentHash?: string;
  finalFrameSvgHash: string;
  assetRefs: LockAssetRef[];
}

export interface LessonLock {
  schemaVersion: 'lesson.lock/v1';
  runId: string;
  status: string;
  createdAt: string;
  source?: { files: string[]; hashes: Record<string, string> };
  narration?: { file: string; hash: string };
  alignment?: { file: string; hash: string };
  scenes: LockScene[];
  /** Scenes with no rendered frame (coverage fail, planner fail): excluded from scenes, listed here. */
  blockedScenes?: string[];
  media: { audio?: string; audioHash?: string; video?: string; videoHash?: string; captions?: string; captionsHash?: string };
  assets: { bridgeVersion?: string; catalogVersion?: string };
  versions: {
    node: string;
    pipeline: string;
    resvg: string;
    ffmpeg: string;
    kalamSha256: string;
    promptVersions: Record<string, string>;
    modelIds: string[];
  };
  contentHash: string;
}

const hashText = (text: string): string => createNodeHash('sha256').update(text, 'utf8').digest('hex');

async function hashFile(outputDir: string, rel: string): Promise<string> {
  return sha256(await readFile(path.join(outputDir, rel)));
}

async function hashFileIfPresent(outputDir: string, rel: string | undefined): Promise<{ rel?: string; hash?: string }> {
  if (!rel) return {};
  try {
    return { rel, hash: await hashFile(outputDir, rel) };
  } catch {
    return {};
  }
}

export interface LockSceneInput {
  sceneId: string;
  finalFrameSvg: string;
  assetRefs: LockAssetRef[];
  audioFile?: string;
  alignmentHash?: string;
}

export interface BuildLockInput {
  runId: string;
  status: string;
  outputDir: string;
  scenes: LockSceneInput[];
  blockedScenes?: string[];
  sourceFiles?: string[];
  assets?: { bridgeVersion?: string; catalogVersion?: string };
  promptVersions?: Record<string, string>;
  modelIds?: string[];
}

/** Best-effort tool versions; 'unknown' when the tool cannot be probed (never throws). */
export function probeToolVersions(): { node: string; pipeline: string; resvg: string; ffmpeg: string } {
  let pipeline = 'unknown';
  try {
    pipeline = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    try {
      const dirty = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
      if (dirty) pipeline += '-dirty';
    } catch { /* status unreadable: keep bare sha */ }
  } catch { /* not a git checkout */ }
  let resvg = 'unknown';
  try {
    resvg = (execFileSync('node', ['-p', "require('@resvg/resvg-js/package.json').version"], { encoding: 'utf8' }) as string).trim();
  } catch { /* intra-repo require path differs at runtime */ }
  let ffmpeg = 'unknown';
  try {
    const out = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }) as string;
    ffmpeg = (out.split('\n')[0] ?? 'unknown').slice(0, 120);
  } catch { /* ffmpeg absent (offline fixture runs) */ }
  return { node: process.version, pipeline, resvg, ffmpeg };
}

/** Canonical content hash: everything except createdAt/contentHash themselves. */
export function lockContentHash(lock: Omit<LessonLock, 'createdAt' | 'contentHash'> & { createdAt?: string; contentHash?: string }): string {
  const { createdAt: _created, contentHash: _hash, ...rest } = lock;
  return hashText(stableJson(rest));
}

export async function buildLessonLock(input: BuildLockInput): Promise<LessonLock> {
  const { outputDir } = input;
  const sourceFiles = (input.sourceFiles ?? []).filter(Boolean);
  const sourceHashes: Record<string, string> = {};
  for (const file of [...new Set(sourceFiles)]) {
    try {
      sourceHashes[file] = await hashFile(outputDir, file);
    } catch { /* listed but unwritten: omitted from the lock, verifier flags drift separately */ }
  }
  const narration = await hashFileIfPresent(outputDir, 'narration.json');
  const alignment = await hashFileIfPresent(outputDir, 'aligned-audio.json');
  const audio = await hashFileIfPresent(outputDir, 'audio.wav');
  const video = await hashFileIfPresent(outputDir, 'video.mp4');
  const captions = await hashFileIfPresent(outputDir, 'captions.vtt');

  const scenes: LockScene[] = [];
  for (const scene of input.scenes) {
    const files = {
      spec: `scene-spec.${scene.sceneId}.json`,
      resolved: `resolved-scene.${scene.sceneId}.json`,
      layout: `layout.${scene.sceneId}.json`,
      timeline: `timeline.${scene.sceneId}.json`,
      ...(scene.audioFile ? { audio: scene.audioFile } : {}),
    };
    scenes.push({
      sceneId: scene.sceneId,
      files,
      fileHashes: {
        spec: await hashFile(outputDir, files.spec),
        resolved: await hashFile(outputDir, files.resolved),
        layout: await hashFile(outputDir, files.layout),
        timeline: await hashFile(outputDir, files.timeline),
        ...(files.audio ? { audio: await hashFile(outputDir, files.audio) } : {}),
      },
      ...(scene.alignmentHash ? { alignmentHash: scene.alignmentHash } : {}),
      finalFrameSvgHash: hashText(scene.finalFrameSvg),
      assetRefs: scene.assetRefs,
    });
  }

  const tools = probeToolVersions();
  const unsigned: Omit<LessonLock, 'createdAt' | 'contentHash'> = {
    schemaVersion: LESSON_LOCK_VERSION,
    runId: input.runId,
    status: input.status,
    ...(input.blockedScenes?.length ? { blockedScenes: [...input.blockedScenes] } : {}),
    ...(Object.keys(sourceHashes).length ? { source: { files: Object.keys(sourceHashes), hashes: sourceHashes } } : {}),    ...(narration.hash ? { narration: { file: narration.rel!, hash: narration.hash } } : {}),
    ...(alignment.hash ? { alignment: { file: alignment.rel!, hash: alignment.hash } } : {}),
    scenes,
    media: {
      ...(audio.hash ? { audio: audio.rel, audioHash: audio.hash } : {}),
      ...(video.hash ? { video: video.rel, videoHash: video.hash } : {}),
      ...(captions.hash ? { captions: captions.rel, captionsHash: captions.hash } : {}),
    },
    assets: {
      ...(input.assets?.bridgeVersion ? { bridgeVersion: input.assets.bridgeVersion } : {}),
      ...(input.assets?.catalogVersion ? { catalogVersion: input.assets.catalogVersion } : {}),
    },
    versions: {
      node: tools.node,
      pipeline: tools.pipeline,
      resvg: tools.resvg,
      ffmpeg: tools.ffmpeg,
      kalamSha256: KALAM_FONT_SHA256,
      promptVersions: input.promptVersions ?? {},
      modelIds: [...new Set(input.modelIds ?? [])].sort(),
    },
  };
  return { ...unsigned, createdAt: new Date().toISOString(), contentHash: lockContentHash(unsigned) };
}

/** Re-derive a scene's final-frame SVG from locked geometry + timeline. Pure. */
export function rerenderFinalFrame(laidOut: LaidOutScene, timeline: Timeline): string {
  return renderSVG(laidOut, timeline, timeline.sceneEndMs - 1);
}

/** Verify a written lock against its outputDir. Returns problems (empty = valid). */
export async function verifyLessonLock(outputDir: string): Promise<string[]> {
  const problems: string[] = [];
  let lock: LessonLock;
  try {
    lock = JSON.parse(await readFile(path.join(outputDir, 'lesson.lock.json'), 'utf8')) as LessonLock;
  } catch (error) {
    return [`lesson.lock.json unreadable: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (lock.schemaVersion !== LESSON_LOCK_VERSION) problems.push(`schema ${String(lock.schemaVersion)} !== ${LESSON_LOCK_VERSION}`);
  const check = async (rel: string | undefined, expected: string | undefined, what: string): Promise<void> => {
    if (expected === undefined) return;
    if (!rel) { problems.push(`${what}: hash recorded without a file`); return; }
    try {
      const actual = await hashFile(outputDir, rel);
      if (actual !== expected) problems.push(`${what}: ${rel} hash drift (${actual.slice(0, 12)} !== ${expected.slice(0, 12)})`);
    } catch {
      problems.push(`${what}: ${rel} missing from outputDir`);
    }
  };
  for (const [file, hash] of Object.entries(lock.source?.hashes ?? {})) await check(file, hash, 'source');
  if (lock.narration) await check(lock.narration.file, lock.narration.hash, 'narration');
  if (lock.alignment) await check(lock.alignment.file, lock.alignment.hash, 'alignment');
  for (const scene of lock.scenes) {
    await check(scene.files.spec, scene.fileHashes.spec, `scene ${scene.sceneId} spec`);
    await check(scene.files.resolved, scene.fileHashes.resolved, `scene ${scene.sceneId} resolved`);
    await check(scene.files.layout, scene.fileHashes.layout, `scene ${scene.sceneId} layout`);
    await check(scene.files.timeline, scene.fileHashes.timeline, `scene ${scene.sceneId} timeline`);
    if (scene.fileHashes.audio) await check(scene.files.audio, scene.fileHashes.audio, `scene ${scene.sceneId} audio`);
    // Purity: the final frame must re-derive byte-identically from locked geometry + timeline.
    try {
      const laidOut = JSON.parse(await readFile(path.join(outputDir, scene.files.layout), 'utf8')) as LaidOutScene;
      const timeline = JSON.parse(await readFile(path.join(outputDir, scene.files.timeline), 'utf8')) as Timeline;
      const actual = hashText(rerenderFinalFrame(laidOut, timeline));
      if (actual !== scene.finalFrameSvgHash) problems.push(`scene ${scene.sceneId} final frame is not a pure function of locked geometry + timeline`);
    } catch (error) {
      problems.push(`scene ${scene.sceneId} rerender failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (lock.media.audioHash) await check(lock.media.audio, lock.media.audioHash, 'media audio');
  if (lock.media.videoHash) await check(lock.media.video, lock.media.videoHash, 'media video');
  if (lock.media.captionsHash) await check(lock.media.captions, lock.media.captionsHash, 'media captions');
  if (lockContentHash(lock) !== lock.contentHash) problems.push('content hash mismatch: lock was edited after signing');
  return problems;
}

import { execFileSync } from 'node:child_process';
import { createHash as createNodeHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson } from '../shared/artifacts.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { renderSVG } from '../render/renderScene.js';
import { encodeVideoAtomically } from '../export/videoEncode.js';
import { bridgeSnapshotDigest } from '../assets/bridge.js';
import { concatSceneAudio } from '../export/audioStitch.js';
import { assembleModuleVideos, encodeModuleVideos, type ModuleVideoInput } from '../export/moduleVideo.js';
import { buildWebVttForRun } from '../export/captions.js';
import { buildModuleSceneClock } from './moduleClock.js';
import type { AlignedAudio, LaidOutScene, Timeline } from '../shared/types.js';

/**
 * lesson.lock.json (Teaching Compiler V1 §6): the hard boundary after which
 * the system is 100% deterministic. The lock names every input a pure render
 * needs — source, plan, narration, visual intents, resolved assets + bridge
 * version, audio + alignment, geometry, timeline, fonts, tool versions — each
 * by content hash. Anything not in the lock must not affect the pixels.
 *
 * - buildLessonLock: freeze S1–S9 inputs before any S10 renderer call.
 * - verifyLessonLock: recompute every file hash + the content hash from
 *   outputDir alone. Pure: no LLM, network, TTS, or randomness.
 * - verifyRenderPurity: compare post-lock SVG artifacts to a fresh pure render.
 */

export const LESSON_LOCK_VERSION = 'lesson.lock/v4';

export interface LockAssetRef {
  assetId: string | null;
  strategy?: string;
  rung?: number;
  selectionBasis?: 'exact' | 'curated' | 'similarity' | 'procedural';
}

export interface LockScene {
  sceneId: string;
  files: { spec: string; resolved: string; layout: string; timeline: string; audio?: string };
  fileHashes: { spec: string; resolved: string; layout: string; timeline: string; audio?: string };
  alignmentHash?: string;
  assetRefs: LockAssetRef[];
}

export interface LockAudioScene {
  sceneId: string;
  file: string;
  hash: string;
  alignmentHash?: string;
}

export interface LessonLock {
  schemaVersion: 'lesson.lock/v4';
  status: string;
  source?: { files: string[]; hashes: Record<string, string> };
  narration?: { file: string; hash: string };
  alignment?: { file: string; hash: string };
  events?: { file: string; hash: string };
  scenes: LockScene[];
  /** S5 scene audio includes blocked-visual scenes so partial module diagnostics remain reproducible. */
  audioScenes: LockAudioScene[];
  /** Scenes with no rendered frame (coverage fail, planner fail): excluded from scenes, listed here. */
  blockedScenes?: string[];
  failure?: Array<{ stage: string; code: string; message: string }>;
  inputs?: { requestHash: string; settingsHash: string };
  /** Effective cache mode is retained in early failure locks, before full model settings exist. */
  execution?: { cacheMode: string };
  /** Non-secret effective provider and run controls, pinned alongside the opaque settings hash. */
  modelSettings?: {
    models: { syllabus: string; concepts: string; plan: string; script: string; visual: string; planner: string; vision?: string };
    planner: { id: string; promptArm: string; exampleOrder: string };
    structuredOutput: { temperaturePolicy: 'zero-when-supported'; format: 'stage-schema-json' };
    audio: { ttsProviderSelector: string; voiceId?: string; language: string; alignerModel: string; alignerProvider: string; calibrationMedianErrorMs?: number };
    run: { cache: string; maxCostUsd: number; maxRepairs: number; seed?: number };
  };
  media: { audio?: string; audioHash?: string; video?: string; videoHash?: string; captions?: string; captionsHash?: string };
  render?: { fps: number; durationMs: number; width: number; height: number; sceneGapMs?: number; diagnosticCaptionlessVideo?: boolean };
  modules?: Array<{ id: string; title: string; sceneIds: string[]; durationMs?: number }>;
  assets: { bridgeVersion?: string; bridgeDigest?: string; catalogVersion?: string; /** `local-dev` admits review-licence assets; such a lock can never pass the release gates. */ usageContext?: 'production' | 'local-dev' };
  /** S3b Visual Discovery output (how each concept was drawn), pinned so replay never rediscovers. */
  visualVocabulary?: { file: string; hash: string };
  versions: {
    node: string;
    pipeline: string;
    resvg: string;
    roughjs: string;
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
  assetRefs: LockAssetRef[];
  audioFile?: string;
  alignmentHash?: string;
}

export interface LockAudioSceneInput {
  sceneId: string;
  audioFile: string;
  alignmentHash?: string;
}

export interface BuildLockInput {
  runId: string;
  status: string;
  outputDir: string;
  scenes: LockSceneInput[];
  audioScenes?: LockAudioSceneInput[];
  blockedScenes?: string[];
  failure?: LessonLock['failure'];
  sourceFiles?: string[];
  /** Failure locks retain whatever evidence exists; renderable locks require every listed source. */
  allowMissingSourceFiles?: boolean;
  assets?: { bridgeVersion?: string; bridgeDigest?: string; catalogVersion?: string; usageContext?: 'production' | 'local-dev' };
  inputs?: LessonLock['inputs'];
  execution?: LessonLock['execution'];
  modelSettings?: LessonLock['modelSettings'];
  promptVersions?: Record<string, string>;
  modelIds?: string[];
  render?: LessonLock['render'];
  modules?: LessonLock['modules'];
}

/** Best-effort tool versions; 'unknown' when the tool cannot be probed (never throws). */
export function probeToolVersions(): { node: string; pipeline: string; resvg: string; roughjs: string; ffmpeg: string } {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  let pipeline = 'unknown';
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: sourceDir, encoding: 'utf8' }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter(Boolean).filter((file) =>
        file.startsWith('src/run/') ||
        file.startsWith('src/shared/') ||
        file === 'package.json' || file === 'pnpm-lock.yaml' || file === 'package-lock.json' || file === 'npm-shrinkwrap.json')
      .filter((file) => existsSync(path.join(root, file)));
    const digest = createNodeHash('sha256');
    for (const file of files.sort()) {
      digest.update(file).update('\0').update(readFileSync(path.join(root, file))).update('\0');
    }
    pipeline = `${head}+${digest.digest('hex')}`;
  } catch { /* not a git checkout */ }
  let resvg = 'unknown';
  try {
    resvg = (execFileSync('node', ['-p', "require('@resvg/resvg-js/package.json').version"], { encoding: 'utf8' }) as string).trim();
  } catch { /* intra-repo require path differs at runtime */ }
  let roughjs = 'unknown';
  try {
    const require = createRequire(import.meta.url);
    roughjs = `${require('roughjs/package.json').version}`;
  } catch { /* missing/incompatible Rough.js installation */ }
  let ffmpeg = 'unknown';
  try {
    const out = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }) as string;
    ffmpeg = (out.split('\n')[0] ?? 'unknown').slice(0, 120);
  } catch { /* ffmpeg absent (offline fixture runs) */ }
  return { node: process.version, pipeline, resvg, roughjs, ffmpeg };
}

/** Canonical content hash over deterministic render inputs and compiled outputs. */
export function lockContentHash(lock: Omit<LessonLock, 'contentHash'> & { contentHash?: string }): string {
  const { contentHash: _hash, ...rest } = lock;
  return hashText(stableJson(rest));
}

export async function buildLessonLock(input: BuildLockInput): Promise<LessonLock> {
  const { outputDir } = input;
  const sourceFiles = (input.sourceFiles ?? []).filter(Boolean);
  const sourceHashes: Record<string, string> = {};
  for (const file of [...new Set(sourceFiles)]) {
    try {
      sourceHashes[file] = await hashFile(outputDir, file);
    } catch (error) {
      if (!input.allowMissingSourceFiles) throw new Error(`required lock source ${file} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const narration = await hashFileIfPresent(outputDir, 'narration.json');
  const alignment = await hashFileIfPresent(outputDir, 'aligned-audio.json');
  const events = await hashFileIfPresent(outputDir, 'scene-events.jsonl');
  const audio = await hashFileIfPresent(outputDir, 'audio.wav');
  const captions = await hashFileIfPresent(outputDir, 'captions.vtt');
  const vocabulary = await hashFileIfPresent(outputDir, 'visual-vocabulary.json');

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
      assetRefs: scene.assetRefs,
    });
  }

  const audioInputs = new Map<string, LockAudioSceneInput>();
  for (const scene of input.audioScenes ?? []) {
    if (!scene.sceneId || audioInputs.has(scene.sceneId)) throw new Error(`duplicate or empty locked audio scene id: ${scene.sceneId}`);
    audioInputs.set(scene.sceneId, scene);
  }
  for (const scene of input.scenes) {
    if (scene.audioFile && !audioInputs.has(scene.sceneId)) audioInputs.set(scene.sceneId, { sceneId: scene.sceneId, audioFile: scene.audioFile, ...(scene.alignmentHash ? { alignmentHash: scene.alignmentHash } : {}) });
  }
  const audioScenes: LockAudioScene[] = [];
  for (const scene of [...audioInputs.values()].sort((a, b) => a.sceneId.localeCompare(b.sceneId))) {
    audioScenes.push({ sceneId: scene.sceneId, file: scene.audioFile, hash: await hashFile(outputDir, scene.audioFile), ...(scene.alignmentHash ? { alignmentHash: scene.alignmentHash } : {}) });
  }

  const tools = probeToolVersions();
  const unsigned: Omit<LessonLock, 'contentHash'> = {
    schemaVersion: LESSON_LOCK_VERSION,
    status: input.status,
    ...(input.blockedScenes?.length ? { blockedScenes: [...input.blockedScenes] } : {}),
    ...(input.failure?.length ? { failure: input.failure } : {}),
    ...(input.inputs ? { inputs: input.inputs } : {}),
    ...(input.execution ? { execution: input.execution } : {}),
    ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
    ...(Object.keys(sourceHashes).length ? { source: { files: Object.keys(sourceHashes), hashes: sourceHashes } } : {}),
    ...(narration.hash ? { narration: { file: narration.rel!, hash: narration.hash } } : {}),
    ...(alignment.hash ? { alignment: { file: alignment.rel!, hash: alignment.hash } } : {}),
    ...(events.hash ? { events: { file: events.rel!, hash: events.hash } } : {}),
    ...(vocabulary.hash ? { visualVocabulary: { file: vocabulary.rel!, hash: vocabulary.hash } } : {}),
    scenes,
    audioScenes,
    media: {
      ...(audio.hash ? { audio: audio.rel, audioHash: audio.hash } : {}),
      ...(captions.hash ? { captions: captions.rel, captionsHash: captions.hash } : {}),
    },
    ...(input.render ? { render: input.render } : {}),
    ...(input.modules?.length ? { modules: input.modules } : {}),
    assets: {
      ...(input.assets?.bridgeVersion ? { bridgeVersion: input.assets.bridgeVersion } : {}),
      ...(input.assets?.bridgeDigest ? { bridgeDigest: input.assets.bridgeDigest } : {}),
      ...(input.assets?.catalogVersion ? { catalogVersion: input.assets.catalogVersion } : {}),
      ...(input.assets?.usageContext ? { usageContext: input.assets.usageContext } : {}),
    },
    versions: {
      node: tools.node,
      pipeline: tools.pipeline,
      resvg: tools.resvg,
      roughjs: tools.roughjs,
      ffmpeg: tools.ffmpeg,
      kalamSha256: KALAM_FONT_SHA256,
      promptVersions: input.promptVersions ?? {},
      modelIds: [...new Set(input.modelIds ?? [])].sort(),
    },
  };
  const completeProblems = renderableLockProblems(unsigned as LessonLock);
  if (input.status === 'renderable' && completeProblems.length) {
    throw new Error(`renderable lesson lock is incomplete: ${completeProblems.join('; ')}`);
  }
  return { ...unsigned, contentHash: lockContentHash(unsigned) };
}

/** Persist a lock without ever replacing an earlier compile boundary. */
export async function writeLessonLockExclusive(outputDir: string, lock: LessonLock): Promise<void> {
  await writeFile(path.join(outputDir, 'lesson.lock.json'), `${stableJson(lock)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function renderableLockProblems(lock: LessonLock): string[] {
  if (lock.status !== 'renderable') return [];
  const problems: string[] = [];
  const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  if (!lock.inputs || !hash(lock.inputs.requestHash) || !hash(lock.inputs.settingsHash)) problems.push('request/settings hashes are required');
  const settings = lock.modelSettings;
  if (!settings || !settings.models || !settings.planner || !settings.structuredOutput || !settings.audio || !settings.run) problems.push('effective model and run settings are required');
  else {
    const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
    for (const stage of ['syllabus', 'concepts', 'plan', 'script', 'visual', 'planner'] as const) {
      if (!nonEmpty(settings.models[stage])) problems.push(`model setting ${stage} is required`);
    }
    if (!nonEmpty(settings.planner.id) || !nonEmpty(settings.planner.promptArm) || !nonEmpty(settings.planner.exampleOrder)) problems.push('planner selection settings are incomplete');
    if (settings.structuredOutput.temperaturePolicy !== 'zero-when-supported' || settings.structuredOutput.format !== 'stage-schema-json') problems.push('structured output settings are invalid');
    if (!nonEmpty(settings.audio.ttsProviderSelector) || !nonEmpty(settings.audio.language) || !nonEmpty(settings.audio.alignerModel) || !nonEmpty(settings.audio.alignerProvider)) problems.push('audio settings are incomplete');
    if (!nonEmpty(settings.run.cache) || !Number.isFinite(settings.run.maxCostUsd) || settings.run.maxCostUsd < 0 || !Number.isInteger(settings.run.maxRepairs) || settings.run.maxRepairs < 0) problems.push('run settings are incomplete');
  }
  if (!lock.source || !lock.source.files?.length || lock.source.files.some((file) => !hash(lock.source!.hashes?.[file]))) problems.push('source hashes are required in every renderable lock');
  if (lock.assets?.usageContext !== 'production' && lock.assets?.usageContext !== 'local-dev') problems.push('asset usage context is required');
  if (!lock.narration || !hash(lock.narration.hash)) problems.push('narration artifact hash is required');
  if (!lock.alignment || !hash(lock.alignment.hash)) problems.push('alignment artifact hash is required');
  if (!lock.events || !hash(lock.events.hash)) problems.push('scene event artifact hash is required');
  if (!lock.media.audio || !hash(lock.media.audioHash)) problems.push('master audio path/hash is required');
  if (!lock.render || !Number.isInteger(lock.render.fps) || lock.render.fps < 1 || !Number.isFinite(lock.render.durationMs) || lock.render.durationMs <= 0 || !Number.isInteger(lock.render.width) || lock.render.width <= 0 || !Number.isInteger(lock.render.height) || lock.render.height <= 0) problems.push('valid render settings are required');
  for (const name of ['node', 'pipeline', 'resvg', 'roughjs', 'ffmpeg'] as const) {
    const version = lock.versions[name];
    if (typeof version !== 'string' || version.trim() === '' || version === 'unknown') problems.push(`renderable lock requires a known ${name} version`);
  }
  if (!Array.isArray(lock.scenes) || !lock.scenes.length) problems.push('at least one complete scene is required');
  if (!Array.isArray(lock.audioScenes) || !lock.audioScenes.length) problems.push('locked per-scene audio artifacts are required');
  const safeLockedPath = (value: unknown): value is string => typeof value === 'string'
    && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
  const sceneIds = new Set<string>();
  for (const scene of Array.isArray(lock.scenes) ? lock.scenes : []) {
    if (typeof scene.sceneId !== 'string' || !scene.sceneId.trim()) problems.push('renderable scene has an empty sceneId');
    else if (sceneIds.has(scene.sceneId)) problems.push(`duplicate renderable scene ${scene.sceneId}`);
    else sceneIds.add(scene.sceneId);
    for (const kind of ['spec', 'resolved', 'layout', 'timeline'] as const) {
      if (!safeLockedPath(scene.files?.[kind])) problems.push(`scene ${scene.sceneId} ${kind} path is required and must be relative`);
      if (!hash(scene.fileHashes?.[kind])) problems.push(`scene ${scene.sceneId} ${kind} hash is required`);
    }
    if (!scene.files.audio || !hash(scene.fileHashes.audio)) problems.push(`scene ${scene.sceneId} audio path/hash is required`);
    else if (!safeLockedPath(scene.files.audio)) problems.push(`scene ${scene.sceneId} audio path must be relative`);
    if (!hash(scene.alignmentHash)) problems.push(`scene ${scene.sceneId} alignment hash is required`);
    if (!Array.isArray(scene.assetRefs)) problems.push(`scene ${scene.sceneId} assetRefs must be an array`);
    else for (const [index, asset] of scene.assetRefs.entries()) {
      if (!asset || (asset.assetId !== null && (typeof asset.assetId !== 'string' || !asset.assetId.trim()))) problems.push(`scene ${scene.sceneId} asset ref ${index} has an invalid assetId`);
    }
  }
  const audioSceneIds = new Set((Array.isArray(lock.audioScenes) ? lock.audioScenes : []).map((scene) => scene.sceneId));
  for (const scene of Array.isArray(lock.audioScenes) ? lock.audioScenes : []) if (!hash(scene.alignmentHash)) problems.push(`audio scene ${scene.sceneId} alignment hash is required`);
  for (const scene of Array.isArray(lock.scenes) ? lock.scenes : []) if (!audioSceneIds.has(scene.sceneId)) problems.push(`scene ${scene.sceneId} has no matching locked audio artifact`);
  for (const module of lock.modules ?? []) for (const sceneId of module.sceneIds) if (!audioSceneIds.has(sceneId)) problems.push(`module ${module.id} has no locked audio artifact for ${sceneId}`);
  return problems;
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
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return ['lesson.lock.json must contain an object'];
  if (lock.schemaVersion !== LESSON_LOCK_VERSION) problems.push(`schema ${String(lock.schemaVersion)} !== ${LESSON_LOCK_VERSION}`);
  if (!Array.isArray(lock.scenes) || !lock.media || typeof lock.media !== 'object' || !lock.assets || typeof lock.assets !== 'object' || !lock.versions || typeof lock.versions !== 'object') return [...problems, 'lock structure is incomplete'];
  problems.push(...renderableLockProblems(lock));
  const check = async (rel: string | undefined, expected: string | undefined, what: string): Promise<void> => {
    if (expected === undefined) return;
    if (!rel) { problems.push(`${what}: hash recorded without a file`); return; }
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) { problems.push(`${what}: unsafe path ${rel}`); return; }
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
  if (lock.events) await check(lock.events.file, lock.events.hash, 'scene events');
  for (const scene of lock.scenes) {
    await check(scene.files?.spec, scene.fileHashes?.spec, `scene ${scene.sceneId} spec`);
    await check(scene.files?.resolved, scene.fileHashes?.resolved, `scene ${scene.sceneId} resolved`);
    await check(scene.files?.layout, scene.fileHashes?.layout, `scene ${scene.sceneId} layout`);
    await check(scene.files?.timeline, scene.fileHashes?.timeline, `scene ${scene.sceneId} timeline`);
    if (scene.fileHashes?.audio) await check(scene.files?.audio, scene.fileHashes.audio, `scene ${scene.sceneId} audio`);
  }
  for (const scene of lock.audioScenes ?? []) await check(scene.file, scene.hash, `scene ${scene.sceneId} audio`);
  if (lock.media.audioHash) await check(lock.media.audio, lock.media.audioHash, 'media audio');
  if (lock.media.captionsHash) await check(lock.media.captions, lock.media.captionsHash, 'media captions');
  if (lock.versions.kalamSha256 !== KALAM_FONT_SHA256) problems.push('font content hash drift');
  const tools = probeToolVersions();
  for (const name of ['node', 'pipeline', 'resvg', 'roughjs', 'ffmpeg'] as const) {
    if (lock.versions[name] !== 'unknown' && tools[name] !== lock.versions[name]) problems.push(`${name} tool version drift`);
  }
  if (lock.assets.bridgeDigest) {
    try {
      if (bridgeSnapshotDigest() !== lock.assets.bridgeDigest) problems.push('asset bridge snapshot digest drift');
    } catch (error) {
      problems.push(`asset bridge unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (lock.render && (!Number.isInteger(lock.render.fps) || lock.render.fps < 1 || !Number.isFinite(lock.render.durationMs) || lock.render.durationMs <= 0 || lock.scenes.length === 0 || !lock.media.audioHash)) problems.push('render inputs incomplete');
  if (lockContentHash(lock) !== lock.contentHash) problems.push('content hash mismatch: lock was edited after signing');
  return problems;
}

/** Offline S10/S11 path: verify all locked inputs before reading geometry or encoding. */
export interface LockRenderDependencies {
  encodeSingle?: typeof encodeVideoAtomically;
  concatAudio?: typeof concatSceneAudio;
  encodeModules?: typeof encodeModuleVideos;
  assembleModules?: typeof assembleModuleVideos;
}

/** S10 entrypoint. The first renderSVG call occurs after the lock verifies. */
export async function renderLockedFinalFrames(outputDir: string, options: { allowFailedDiagnostic?: boolean } = {}): Promise<{ frames: Record<string, string>; artifacts: Record<string, string> }> {
  const problems = await verifyLessonLock(outputDir);
  if (problems.length) throw new Error(`lesson lock verification failed: ${problems.join('; ')}`);
  const lock = JSON.parse(await readFile(path.join(outputDir, 'lesson.lock.json'), 'utf8')) as LessonLock;
  if (!options.allowFailedDiagnostic && (lock.status !== 'renderable' || lock.blockedScenes?.length)) throw new Error('lesson lock is not renderable');
  if (!lock.scenes.length) throw new Error('lesson lock has no complete scenes to render');
  const frames: Record<string, string> = {};
  const artifacts: Record<string, string> = {};
  for (const scene of lock.scenes) {
    const laidOut = JSON.parse(await readFile(path.join(outputDir, scene.files.layout), 'utf8')) as LaidOutScene;
    const timeline = JSON.parse(await readFile(path.join(outputDir, scene.files.timeline), 'utf8')) as Timeline;
    const svg = rerenderFinalFrame(laidOut, timeline);
    const rel = `final-frame.${scene.sceneId}.svg`;
    await writeFile(path.join(outputDir, rel), svg, 'utf8');
    frames[scene.sceneId] = svg;
    artifacts[`finalFrame:${scene.sceneId}`] = rel;
  }
  return { frames, artifacts };
}

/** Check saved S10 output bytes and their manifest hashes against locked geometry. */
export async function verifyRenderPurity(outputDir: string): Promise<string[]> {
  const problems = await verifyLessonLock(outputDir);
  if (problems.length) return problems;
  const lock = JSON.parse(await readFile(path.join(outputDir, 'lesson.lock.json'), 'utf8')) as LessonLock;
  let manifest: { lockContentHash?: string; artifacts?: Record<string, { file: string; sha256: string }> };
  try { manifest = JSON.parse(await readFile(path.join(outputDir, 'render-artifacts.json'), 'utf8')) as typeof manifest; }
  catch (error) { return [`render-artifacts.json unreadable: ${error instanceof Error ? error.message : String(error)}`]; }
  if (manifest.lockContentHash !== lock.contentHash) problems.push('render artifact manifest belongs to a different lock');
  for (const [name, artifact] of Object.entries(manifest.artifacts ?? {})) {
    if (path.isAbsolute(artifact.file) || artifact.file.split(/[\\/]/).includes('..')) {
      problems.push(`render artifact ${name} has unsafe path ${artifact.file}`);
      continue;
    }
    try {
      const actual = await hashFile(outputDir, artifact.file);
      if (actual !== artifact.sha256) problems.push(`render artifact ${name} hash drift (${actual.slice(0, 12)} !== ${artifact.sha256.slice(0, 12)})`);
    } catch {
      problems.push(`render artifact ${name} missing: ${artifact.file}`);
    }
  }
  for (const scene of lock.scenes) {
    const artifact = manifest.artifacts?.[`finalFrame:${scene.sceneId}`];
    if (!artifact) { problems.push(`scene ${scene.sceneId} final frame artifact missing`); continue; }
    if (artifact.file !== `final-frame.${scene.sceneId}.svg`) { problems.push(`scene ${scene.sceneId} final frame path mismatch`); continue; }
    try {
      const [saved, layoutRaw, timelineRaw] = await Promise.all([
        readFile(path.join(outputDir, artifact.file), 'utf8'),
        readFile(path.join(outputDir, scene.files.layout), 'utf8'),
        readFile(path.join(outputDir, scene.files.timeline), 'utf8'),
      ]);
      const actual = hashText(saved);
      if (actual !== artifact.sha256) problems.push(`scene ${scene.sceneId} final frame output hash drift`);
      const expected = hashText(rerenderFinalFrame(JSON.parse(layoutRaw) as LaidOutScene, JSON.parse(timelineRaw) as Timeline));
      if (actual !== expected) problems.push(`scene ${scene.sceneId} final frame is not a pure function of locked geometry + timeline`);
    } catch (error) {
      problems.push(`scene ${scene.sceneId} final frame purity check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

export async function renderVideoFromLessonLock(outputDir: string, dependencies: LockRenderDependencies = {}): Promise<string> {
  const problems = await verifyLessonLock(outputDir);
  if (problems.length) throw new Error(`lesson lock verification failed: ${problems.join('; ')}`);
  const lock = JSON.parse(await readFile(path.join(outputDir, 'lesson.lock.json'), 'utf8')) as LessonLock;
  if (!lock.render || !lock.media.audio || lock.status !== 'renderable' || lock.blockedScenes?.length) throw new Error('lesson lock is not renderable');
  try {
    await readFile(path.join(outputDir, 'render-artifacts.json'));
    const priorRenderProblems = await verifyRenderPurity(outputDir);
    if (priorRenderProblems.length) throw new Error(`existing render artifacts failed verification: ${priorRenderProblems.join('; ')}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const finalFrames = await renderLockedFinalFrames(outputDir);
  const scenes = await Promise.all(lock.scenes.map(async (scene) => ({
    laidOut: JSON.parse(await readFile(path.join(outputDir, scene.files.layout), 'utf8')) as LaidOutScene,
    timeline: JSON.parse(await readFile(path.join(outputDir, scene.files.timeline), 'utf8')) as Timeline,
    startMs: 0,
    endMs: 0,
  })));
  for (const scene of scenes) { scene.startMs = scene.timeline.sceneStartMs; scene.endMs = scene.timeline.sceneEndMs; }
  const videoPath = path.join(outputDir, 'video.mp4');
  let expectedVideoHash: string | undefined;
  try {
    const previous = JSON.parse(await readFile(path.join(outputDir, 'render-artifacts.json'), 'utf8')) as { lockContentHash?: string; artifacts?: { video?: { sha256?: string } } };
    if (previous.lockContentHash !== lock.contentHash) throw new Error('render artifact manifest belongs to a different lock');
    expectedVideoHash = previous.artifacts?.video?.sha256;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporaryVideoPath = expectedVideoHash ? path.join(outputDir, `video.rerender-${randomUUID()}.mp4`) : videoPath;
  try {
    const moduleResult = lock.modules?.length ? await renderModulesFromLock(outputDir, lock, scenes, temporaryVideoPath, dependencies) : undefined;
    if (!lock.modules?.length) await (dependencies.encodeSingle ?? encodeVideoAtomically)(scenes, lock.render.durationMs, path.join(outputDir, lock.media.audio), temporaryVideoPath, lock.render.fps);
    if (!lock.modules?.length) {
      const alignment = JSON.parse(await readFile(path.join(outputDir, lock.alignment!.file), 'utf8')) as AlignedAudio;
      const captions = buildWebVttForRun(alignment, Boolean(lock.render.diagnosticCaptionlessVideo));
      const captionsPath = path.join(outputDir, 'captions.vtt');
      await rm(captionsPath, { force: true });
      if (captions.vtt) {
        if (lock.media.captionsHash && sha256(captions.vtt) !== lock.media.captionsHash) throw new Error(`regenerated captions hash ${sha256(captions.vtt)} differs from locked captions hash ${lock.media.captionsHash}`);
        await writeFile(captionsPath, captions.vtt, 'utf8');
      }
      else if (captions.failure && !lock.render.diagnosticCaptionlessVideo) throw new Error(`locked alignment cannot produce captions: ${captions.failure}`);
    }
    if (expectedVideoHash) {
      const actual = sha256(await readFile(temporaryVideoPath));
      if (actual !== expectedVideoHash) throw new Error(`rerender video hash mismatch (${actual.slice(0, 12)} !== ${expectedVideoHash.slice(0, 12)})`);
      await rename(temporaryVideoPath, videoPath);
      if (moduleResult?.captionsPath) await rename(moduleResult.captionsPath, path.join(outputDir, 'video.vtt'));
    }
    const captions = await hashFileIfPresent(outputDir, 'captions.vtt');
    const contactSheet = await hashFileIfPresent(outputDir, 'contact-sheet.png');
    await writeRenderArtifactsManifest(outputDir, lock.contentHash, {
      video: 'video.mp4', ...moduleResult?.files,
      ...finalFrames.artifacts,
      ...(moduleResult?.captionsPath ? { moduleCaptions: 'video.vtt' } : {}),
      ...(captions.hash ? { captions: 'captions.vtt' } : {}),
      ...(contactSheet.hash ? { contactSheet: 'contact-sheet.png' } : {}),
    });
    const purityProblems = await verifyRenderPurity(outputDir);
    if (purityProblems.length) throw new Error(`rerender purity failed: ${purityProblems.join('; ')}`);
  } finally {
    if (temporaryVideoPath !== videoPath) await rm(temporaryVideoPath, { force: true });
  }
  return videoPath;
}

async function renderModulesFromLock(outputDir: string, lock: LessonLock, scenes: Array<{ laidOut: LaidOutScene; timeline: Timeline; startMs: number; endMs: number }>, outPath: string, dependencies: LockRenderDependencies): Promise<{ files: Record<string, string>; captionsPath?: string }> {
  const alignment = JSON.parse(await readFile(path.join(outputDir, lock.alignment?.file ?? 'aligned-audio.json'), 'utf8')) as AlignedAudio;
  const byScene = new Map(lock.audioScenes.map((scene) => [scene.sceneId, scene]));
  const sceneLayout = new Map(lock.scenes.map((scene, index) => [scene.sceneId, scenes[index]]));
  const durations = new Map(Object.entries(alignment.sceneBoundsMs).map(([id, bounds]) => [id, bounds.endMs - bounds.startMs]));
  const gapMs = lock.render?.sceneGapMs;
  if (!Number.isFinite(gapMs) || gapMs === undefined || gapMs < 0) throw new Error('module lock is missing its scene gap');
  const moduleInputs: ModuleVideoInput[] = [];
  let captionsFailed = false;
  for (const module of lock.modules ?? []) {
    const boundarySilenceMs = gapMs;
    const clock = buildModuleSceneClock(module.sceneIds, durations, gapMs, boundarySilenceMs);
    const moduleScenes: ModuleVideoInput['scenes'] = [];
    const moduleWords: AlignedAudio['sceneWords'] = {};
    const moduleBounds: AlignedAudio['sceneBoundsMs'] = {};
    const moduleMentions: AlignedAudio['mentions'] = [];
    const sceneAudioFiles: string[] = [];
    for (const interval of clock.intervals) {
      const lockedScene = byScene.get(interval.sceneId);
      const masterBounds = alignment.sceneBoundsMs[interval.sceneId];
      if (!lockedScene?.file || !masterBounds) throw new Error(`module ${module.id} lacks locked scene audio: ${interval.sceneId}`);
      sceneAudioFiles.push(path.join(outputDir, lockedScene.file));
      const shift = interval.startMs - masterBounds.startMs;
      moduleWords[interval.sceneId] = (alignment.sceneWords[interval.sceneId] ?? []).map((word) => ({ ...word, startMs: word.startMs + shift, endMs: word.endMs + shift }));
      moduleBounds[interval.sceneId] = { startMs: interval.startMs, endMs: interval.endMs };
      moduleMentions.push(...alignment.mentions.filter((mention) => mention.sceneId === interval.sceneId).map((mention) => ({ ...mention, startMs: mention.startMs + shift, endMs: mention.endMs + shift })));
      const visual = sceneLayout.get(interval.sceneId);
      if (visual) moduleScenes.push({ laidOut: visual.laidOut, timeline: { ...visual.timeline, sceneStartMs: visual.timeline.sceneStartMs + shift, sceneEndMs: visual.timeline.sceneEndMs + shift, events: visual.timeline.events.map((event) => ({ ...event, t0: event.t0 + shift, t1: event.t1 + shift })) }, startMs: interval.startMs, endMs: Math.max(interval.endMs, visual.timeline.sceneEndMs + shift) });
    }
    const audioPath = path.join(outputDir, 'module-audio', `${module.id}.wav`);
    await (dependencies.concatAudio ?? concatSceneAudio)(sceneAudioFiles, gapMs, boundarySilenceMs, audioPath);
    const localAlignment: AlignedAudio = { ...alignment, wavPath: audioPath, durationMs: clock.durationMs, sceneWords: moduleWords, sceneBoundsMs: moduleBounds, mentions: moduleMentions };
    const localCaptions = buildWebVttForRun(localAlignment, lock.render?.diagnosticCaptionlessVideo ?? false);
    if (localCaptions.failure) captionsFailed = true;
    const captionsPath = path.join(outputDir, 'module-audio', `${module.id}.vtt`);
    if (localCaptions.vtt) await writeFile(captionsPath, localCaptions.vtt, 'utf8');
    moduleInputs.push({ id: module.id, title: module.title, scenes: moduleScenes, durationMs: clock.durationMs, audioPath, ...(localCaptions.vtt ? { captionsPath } : {}) });
  }
  if (captionsFailed) {
    for (const module of moduleInputs) if (module.captionsPath) { await rm(module.captionsPath, { force: true }); delete module.captionsPath; }
  }
  const clips = await (dependencies.encodeModules ?? encodeModuleVideos)(moduleInputs, path.join(outputDir, 'module-clips'), { fps: lock.render!.fps });
  const assembly = await (dependencies.assembleModules ?? assembleModuleVideos)(clips, outPath);
  return { files: Object.fromEntries(clips.map((clip) => [`module:${clip.moduleId}`, path.relative(outputDir, clip.path)])), ...(assembly.captionsPath ? { captionsPath: assembly.captionsPath } : {}) };
}

/** Output hashes are recorded after S11 without mutating the input lock. */
export async function writeRenderArtifactsManifest(outputDir: string, lockContentHashValue: string, files: Record<string, string | undefined>): Promise<void> {
  const artifacts: Record<string, { file: string; sha256: string }> = {};
  for (const [name, file] of Object.entries(files)) if (file) artifacts[name] = { file, sha256: await hashFile(outputDir, file) };
  await writeFile(path.join(outputDir, 'render-artifacts.json'), `${stableJson({ schemaVersion: 'lesson-render-artifacts/v1', lockContentHash: lockContentHashValue, artifacts })}\n`, 'utf8');
}

/** Persist an early terminal run as a non-renderable, hash-pinned diagnostic. */
export async function writeFailureLessonLock(input: Pick<BuildLockInput, 'runId' | 'outputDir' | 'sourceFiles' | 'inputs' | 'execution' | 'modelIds'> & { failure: NonNullable<LessonLock['failure']> }): Promise<void> {
  const lock = await buildLessonLock({ ...input, allowMissingSourceFiles: true, status: 'failed', scenes: [] });
  await writeLessonLockExclusive(input.outputDir, lock);
}

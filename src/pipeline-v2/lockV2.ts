import { createHash, randomUUID } from 'node:crypto';
import { access, link, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import { Resvg } from '@resvg/resvg-js';
import { z } from 'zod';
import { canonicalHash, type ReplayDigest } from '../harness/replayDeterminism.js';
import { alignedWordTimingProblems, tokenizeWords } from '../narration/align.js';
import { probeToolVersions } from '../run/lessonLock.js';
import { KALAM_BOLD_FILE, KALAM_FONT_FAMILY, KALAM_FONT_SHA256 } from '../render/fonts.js';
import { STYLE } from '../render/style.js';
import { RasterPool } from '../export/rasterPool.js';
import { spawnFrameEncoder } from '../export/ffmpeg.js';
import { holdKey, renderSceneSvg } from '../visual-v2/renderer/frame.js';
import type { V2VideoScene } from '../visual-v2/renderer/encode.js';

export const LESSON_LOCK_V2_VERSION = 'lesson.lock/v5-teaching-compiler-v2';
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Ref = z.object({ file: z.string().min(1), hash: Hash }).strict();
const Range = { sceneId: z.string().min(1), firstFrame: z.number().int().nonnegative(), frameCount: z.number().int().positive() };
const Segment = z.discriminatedUnion('kind', [
  z.object({ ...Range, kind: z.literal('hold'), stateHash: Hash, svgHash: Hash }).strict(),
  z.object({ ...Range, kind: z.literal('transition'), fromStateHash: Hash, toStateHash: Hash, fps: z.number().int().positive(), svgHashes: z.array(Hash).min(1) }).strict(),
]);
const SampleSchema = z.object({ sceneId: z.string().min(1), kind: z.enum(['final', 'transition']), svgHash: Hash, pngHash: Hash, sampleTimeMs: z.number().nonnegative(), frame: z.number().int().nonnegative().optional() }).strict();
const LockSchema = z.object({
  schemaVersion: z.literal(LESSON_LOCK_V2_VERSION), lessonId: z.string().min(1),
  context: Ref, alignment: Ref,
  scenes: z.array(z.object({
    sceneId: z.string().regex(/^[a-zA-Z0-9_-]+$/), startMs: z.number().nonnegative(), endMs: z.number().positive(),
    file: z.string().min(1), fileHash: Hash, audioFile: z.string().min(1), audioHash: Hash,
    captured: Ref, timelineHash: Hash, geometryHash: Hash, boardOpsHash: Hash, boardStatesHash: Hash, conceptsHash: Hash,
  }).strict()).min(1),
  media: z.object({ audio: Ref, captions: Ref }).strict(),
  font: z.object({ file: z.string().min(1), hash: Hash, family: z.literal(KALAM_FONT_FAMILY), loadSystemFonts: z.literal(false) }).strict(),
  render: z.object({ fps: z.number().int().positive().max(120), durationMs: z.number().positive(), width: z.number().int().positive(), height: z.number().int().positive(), frames: z.number().int().positive() }).strict(),
  renderPlan: z.array(Segment).min(1), svgAssets: z.array(Ref).min(1),
  samples: z.array(SampleSchema).min(1),
  versions: z.object({ node: z.string().min(1), pipeline: z.string().min(1), resvg: z.string().min(1), roughjs: z.string().min(1), ffmpeg: z.string().min(1), kalamSha256: Hash, renderPlan: z.literal('svg-frame-ranges/v1') }).strict(),
  contentHash: Hash,
}).strict();
export type LessonLockV2 = z.infer<typeof LockSchema>;
export type RenderSegment = LessonLockV2['renderPlan'][number];

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict();
const PlacedRect = z.object({ id: z.string(), rect: Rect }).strict();
const Point = z.object({ x: z.number(), y: z.number() }).strict();
const EdgeRoute = z.object({ id: z.string(), points: z.tuple([Point, Point]), arrowhead: z.tuple([Point, Point, Point]), arrowheadBounds: Rect, label: z.object({ x: z.number(), y: z.number(), text: z.string(), size: z.number(), bounds: Rect }).strict().optional() }).strict();
const CapturedSchema = z.object({
  sceneId: z.string(), title: z.string(), seedBase: z.string(),
  concepts: z.array(z.tuple([z.string(), z.unknown()])),
  geometry: z.object({ contentRect: Rect, regionRects: z.record(z.string(), Rect), allRects: z.array(PlacedRect), states: z.array(z.array(PlacedRect)), kitFrames: z.array(z.tuple([z.string(), z.unknown()])), edgeRoutes: z.array(z.array(EdgeRoute)).optional() }).strict(),
  timeline: z.object({
    ops: z.array(z.object({ index: z.number().int(), op: z.record(z.string(), z.unknown()), effects: z.array(z.unknown()), anchorMs: z.number(), t0: z.number(), t1: z.number(), deadlineMs: z.number(), late: z.boolean() }).strict()),
    states: z.array(z.record(z.string(), z.unknown())).min(1), durationMs: z.number(), lateOps: z.array(z.string()), hash: Hash,
    lifecycleEvents: z.array(z.object({ kind: z.enum(['beat-end', 'scene-end']), beatId: z.string().optional(), atMs: z.number(), state: z.record(z.string(), z.unknown()) }).strict()).optional(),
  }).strict(),
}).strict();
type CapturedScene = z.infer<typeof CapturedSchema>;
const bytesHash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const lockHash = (lock: LessonLockV2): string => { const { contentHash: _ignored, ...body } = lock; return canonicalHash(body); };


const AlignmentSchema = z.object({
  schemaVersion: z.literal('v2-alignment/v1'),
  scenes: z.array(z.object({
    sceneId: z.string().min(1), durationMs: z.number().positive(),
    words: z.array(z.object({ word: z.string().min(1), startMs: z.number(), endMs: z.number() }).strict()).min(1),
    aligner: z.enum(['stable-ts', 'stable-ts-fast-mode', 'torchaudio-wav2vec2-ctc', 'stable-ts+collapsed-repair', 'elevenlabs-timestamps']),
    repairedWordIndexes: z.array(z.number().int().nonnegative()),
    calibration: z.object({ status: z.enum(['measured', 'unmeasured']), medianAbsoluteBoundaryErrorMs: z.number().nonnegative().optional() }).strict()
      .refine((value) => value.status === 'measured' ? value.medianAbsoluteBoundaryErrorMs !== undefined : value.medianAbsoluteBoundaryErrorMs === undefined, 'calibration status must match the recorded boundary error'),
  }).strict()).min(1),
}).strict();

function alignmentProblems(bytes: Buffer, scenes: Array<{ sceneId: string; startMs: number; endMs: number }>, semantic: unknown[]): string[] {
  const problems: string[] = [];
  let record: z.infer<typeof AlignmentSchema>;
  try { record = AlignmentSchema.parse(JSON.parse(bytes.toString('utf8'))); }
  catch (error) { return [`alignment artifact invalid: ${error instanceof Error ? error.message : String(error)}`]; }
  const byId = new Map(record.scenes.map((scene) => [scene.sceneId, scene]));
  if (byId.size !== record.scenes.length || record.scenes.length !== scenes.length || record.scenes.some((scene) => !scenes.some((locked) => locked.sceneId === scene.sceneId))) problems.push('alignment scene set does not match locked scenes');
  scenes.forEach((scene, index) => {
    const aligned = byId.get(scene.sceneId);
    if (!aligned) { problems.push(`alignment missing for scene ${scene.sceneId}`); return; }
    if (aligned.durationMs > scene.endMs - scene.startMs) problems.push(`alignment scene ${scene.sceneId} duration exceeds its placement`);
    problems.push(...alignedWordTimingProblems(aligned.words.map((word) => ({ w: word.word, startMs: word.startMs, endMs: word.endMs })), aligned.durationMs).map((problem) => `alignment scene ${scene.sceneId}: ${problem}`));
    if (new Set(aligned.repairedWordIndexes).size !== aligned.repairedWordIndexes.length || aligned.repairedWordIndexes.some((wordIndex) => wordIndex >= aligned.words.length)) problems.push(`alignment scene ${scene.sceneId} repaired word indexes invalid`);
    const narration = z.object({ narration: z.object({ text: z.string().min(1) }).passthrough() }).passthrough().safeParse(semantic[index]);
    if (!narration.success) { problems.push(`alignment scene ${scene.sceneId} needs locked narration text`); return; }
    const expected = tokenizeWords(narration.data.narration.text);
    const actual = aligned.words.flatMap((word) => tokenizeWords(word.word));
    if (actual.length !== expected.length || actual.some((word, wordIndex) => word !== expected[wordIndex])) problems.push(`alignment scene ${scene.sceneId} words do not match narration token sequence`);
  });
  return problems;
}

/** A completed temp file is linked into place atomically; link never overwrites an existing lock. */
async function publishExclusive(file: string, bytes: string): Promise<void> {
  const partial = `${file}.${randomUUID()}.partial.json`;
  try { await writeFile(partial, bytes, { flag: 'wx' }); await link(partial, file); }
  finally { await rm(partial, { force: true }); }
}

/** Lexical and realpath checks both apply: a hash-matching symlink outside the run is still forbidden. */
async function confinedPath(root: string, rel: string): Promise<string> {
  if (!rel || path.isAbsolute(rel) || rel.includes('\\') || rel.includes('\0') || rel.split('/').some((part) => part === '..' || part === '.' || part === '')) throw new Error(`unsafe locked path ${rel}`);
  const base = await realpath(root);
  const full = await realpath(path.join(base, rel));
  if (!full.startsWith(`${base}${path.sep}`)) throw new Error(`locked path escapes outputDir: ${rel}`);
  return full;
}

/** Read a pinned file, refusing unsafe paths and any byte drift. */
export async function readRef(root: string, ref: { file: string; hash: string }): Promise<Buffer> {
  const bytes = await readFile(await confinedPath(root, ref.file));
  if (bytesHash(bytes) !== ref.hash) throw new Error(`${ref.file} hash drift`);
  return bytes;
}

function captureScene({ scene }: V2VideoScene): CapturedScene {
  const ids = [...new Set(scene.timeline.states.flatMap((state) => Object.keys(state.elements)))].sort();
  return CapturedSchema.parse(JSON.parse(JSON.stringify({
    sceneId: scene.sceneId, title: scene.title, seedBase: scene.seedBase,
    concepts: [...(scene.concepts?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b)),
    timeline: scene.timeline,
    geometry: {
      contentRect: scene.geometry.contentRect, regionRects: scene.geometry.regionRects, allRects: scene.geometry.allRects(),
      states: scene.timeline.states.map((state) => ids.flatMap((id) => { const rect = scene.geometry.rectFor(state, id); return rect ? [{ id, rect }] : []; })),
      kitFrames: ids.flatMap((id) => { const kit = scene.geometry.kitGeometry(id); return kit ? [[id, kit.frame]] : []; }),
      edgeRoutes: scene.timeline.states.map((state) => Object.keys(state.edges).sort().flatMap((id) => { const route = scene.geometry.edgeRouteFor(state, id); return route ? [route] : []; })),
    },
  })));
}

function capturedHashes(captured: CapturedScene) {
  const scheduledHashInput = captured.timeline.ops.map((s) => [s.op.opId, Math.round(s.t0), Math.round(s.t1)]);
  return {
    timelineHash: captured.timeline.lifecycleEvents
      ? canonicalHash([scheduledHashInput, captured.timeline.lifecycleEvents.map((event) => [event.kind, event.beatId, Math.round(event.atMs), event.state])])
      : canonicalHash(scheduledHashInput),
    geometryHash: canonicalHash(captured.geometry), boardOpsHash: canonicalHash(captured.timeline.ops.map((s) => s.op)),
    boardStatesHash: canonicalHash(captured.timeline.states), conceptsHash: canonicalHash(captured.concepts),
  };
}

function raster(svg: string, lock: Pick<LessonLockV2, 'font' | 'render'>, fontFile: string): Buffer {
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: [fontFile], defaultFontFamily: lock.font.family, sansSerifFamily: lock.font.family }, fitTo: { mode: 'width', value: lock.render.width } }).render().asPng());
}

export const SCENE_LOCK_V2_VERSION = 'scene.lock/v2-teaching-compiler';
const SceneLockSchema = z.object({
  schemaVersion: z.literal(SCENE_LOCK_V2_VERSION), lessonId: z.string().min(1),
  sceneId: z.string().regex(/^[a-zA-Z0-9_-]+$/), index: z.number().int().nonnegative(),
  startMs: z.number().nonnegative(), endMs: z.number().positive(), fps: z.number().int().positive().max(120),
  scene: Ref, audio: Ref, captured: Ref,
  timelineHash: Hash, geometryHash: Hash, boardOpsHash: Hash, boardStatesHash: Hash, conceptsHash: Hash,
  firstFrame: z.number().int().nonnegative(), frames: z.number().int().positive(),
  renderPlan: z.array(Segment).min(1), svgAssets: z.array(Ref).min(1), samples: z.array(SampleSchema).min(1),
  contentHash: Hash,
}).strict();
export type SceneLockV2 = z.infer<typeof SceneLockSchema>;
const SCENE_LOCK_DIR = 'v2/locked/scene-locks';
const sceneLockFile = (sceneId: string): string => `${SCENE_LOCK_DIR}/${sceneId}.scene.lock.json`;
const sceneLockHash = (lock: SceneLockV2): string => { const { contentHash: _ignored, ...body } = lock; return canonicalHash(body); };

/** First frame whose timestamp is at or after `ms`; frames belong to the scene whose placement contains their time. */
function firstFrameAtOrAfter(ms: number, fps: number): number {
  let frame = Math.max(0, Math.floor(ms * fps / 1000) - 1);
  while (frame * 1000 / fps < ms) frame++;
  return frame;
}
/** Frame range of a placement. The last scene runs to the lock's rounded frame count, as the single-lock writer always did. */
function sceneFrameRange(startMs: number, endMs: number, fps: number, final: boolean): { firstFrame: number; frames: number } {
  const firstFrame = firstFrameAtOrAfter(startMs, fps);
  const end = final ? Math.max(1, Math.round(endMs * fps / 1000)) : firstFrameAtOrAfter(endMs, fps);
  return { firstFrame, frames: Math.max(1, end - firstFrame) };
}

function svgProblem(hash: string, svg: string): string | undefined {
  if (!/^<svg[\s>]/.test(svg) || /<(?:script|foreignObject)\b/i.test(svg) || /(?:href\s*=\s*["'](?!#)|url\(\s*["']?(?!#))[^\s)]*(?:https?:|file:|\/\/)/i.test(svg)) return `SVG ${hash} contains external or executable content`;
  return undefined;
}

/** Content-addressed and idempotent: an existing file must already hold exactly these bytes. */
async function persistAddressed(outputDir: string, file: string, bytes: Buffer | string): Promise<{ file: string; hash: string }> {
  const hash = bytesHash(bytes);
  try { await writeFile(path.join(outputDir, file), bytes, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (bytesHash(await readFile(path.join(outputDir, file))) !== hash) throw new Error(`${file} exists with different bytes`);
  }
  return { file, hash };
}

async function sceneLockExists(outputDir: string, sceneId: string): Promise<boolean> {
  try { await access(path.join(outputDir, sceneLockFile(sceneId))); return true; } catch { return false; }
}

/**
 * Freeze one scene as soon as it compiles: its captured state, every SVG frame it needs, its render-plan segments and raster
 * pins. A scene lock is immutable and verifiable alone, so playback of the finished prefix can start while later scenes are
 * still being planned. The lesson lock later aggregates these files without re-rendering.
 */
export async function publishSceneLockV2(input: { outputDir: string; lessonId: string; index: number; item: V2VideoScene; fps: number; final?: boolean }): Promise<SceneLockV2> {
  const { outputDir, lessonId, index, item, fps } = input;
  const sceneId = item.scene.sceneId;
  if (!/^[a-zA-Z0-9_-]+$/.test(sceneId)) throw new Error('invalid V2 sceneId');
  if (!Number.isInteger(fps) || fps < 1 || fps > 120 || !Number.isInteger(index) || index < 0) throw new Error('scene lock needs a non-negative index and FPS from 1 to 120');
  if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs) throw new Error('V2 scene placement must be a positive interval');
  if (await sceneLockExists(outputDir, sceneId)) throw new Error(`scene lock already published: ${sceneId}`);
  const fontBytes = await readFile(KALAM_BOLD_FILE);
  if (bytesHash(fontBytes) !== KALAM_FONT_SHA256) throw new Error('bundled font content hash drift');
  for (const dir of ['svg', 'scenes']) await mkdir(path.join(outputDir, 'v2', 'locked', dir), { recursive: true });
  await mkdir(path.join(outputDir, SCENE_LOCK_DIR), { recursive: true });

  const captured = captureScene(item);
  const capturedRef = await persistAddressed(outputDir, `v2/locked/scenes/${sceneId}.json`, jsonBytes(captured));
  const readRefFile = async (file: string) => ({ file, hash: bytesHash(await readFile(await confinedPath(outputDir, file))) });
  const sceneRef = await readRefFile(`v2/scene.${sceneId}.json`);
  const audioRef = await readRefFile(`scene-audio/${sceneId}.wav`);

  const { firstFrame, frames } = sceneFrameRange(item.startMs, item.endMs, fps, input.final === true);
  const svgBytes = new Map<string, string>();
  const svgAssets: SceneLockV2['svgAssets'] = [];
  const storeSvg = async (svg: string): Promise<string> => {
    const hash = bytesHash(svg);
    if (!svgBytes.has(hash)) { svgBytes.set(hash, svg); svgAssets.push(await persistAddressed(outputDir, `v2/locked/svg/${hash}.svg`, svg)); }
    return hash;
  };
  const renderPlan: RenderSegment[] = [];
  const transitions: Array<{ frame: number; svgHash: string; sampleTimeMs: number }> = [];
  const holds = new Map<string, string>();
  const stateHash = (index: number) => canonicalHash([captured.geometry, captured.timeline.states[index]]);
  for (let frame = firstFrame; frame < firstFrame + frames; frame++) {
    const local = Math.max(0, frame * 1000 / fps - item.startMs);
    const key = holdKey(item.scene, local);
    let svgHash = key === undefined ? undefined : holds.get(key);
    if (!svgHash) { svgHash = await storeSvg(renderSceneSvg(item.scene, local)); if (key !== undefined) holds.set(key, svgHash); }
    const done = captured.timeline.ops.filter((s) => s.t1 <= local).length;
    const previous = renderPlan.at(-1);
    if (key !== undefined) {
      if (previous?.kind === 'hold' && previous.svgHash === svgHash) previous.frameCount++;
      else renderPlan.push({ kind: 'hold', sceneId, firstFrame: frame, frameCount: 1, stateHash: stateHash(done), svgHash });
    } else {
      const flightEnd = captured.timeline.ops.filter((s) => s.t0 < local).length;
      const fromStateHash = stateHash(done); const toStateHash = stateHash(Math.max(done, flightEnd));
      if (previous?.kind === 'transition' && previous.fromStateHash === fromStateHash && previous.toStateHash === toStateHash) { previous.frameCount++; previous.svgHashes.push(svgHash); }
      else renderPlan.push({ kind: 'transition', sceneId, firstFrame: frame, frameCount: 1, fromStateHash, toStateHash, fps, svgHashes: [svgHash] });
      transitions.push({ frame, svgHash, sampleTimeMs: local });
    }
  }
  const samples: SceneLockV2['samples'] = [];
  const pinFont = { family: KALAM_FONT_FAMILY } as const;
  const rasterHash = (svgHash: string): string => bytesHash(raster(svgBytes.get(svgHash)!, { font: { ...pinFont, file: '', hash: KALAM_FONT_SHA256, loadSystemFonts: false }, render: { fps, durationMs: 1, width: STYLE.canvas.w, height: STYLE.canvas.h, frames: 1 } }, KALAM_BOLD_FILE));
  // Representative evidence: first, middle and last sampled transition frame, plus the completed scene. Not every video frame.
  for (const at of new Set([0, Math.floor(transitions.length / 2), transitions.length - 1])) {
    const selected = transitions[at]; if (selected) samples.push({ sceneId, kind: 'transition', svgHash: selected.svgHash, sampleTimeMs: selected.sampleTimeMs, frame: selected.frame, pngHash: rasterHash(selected.svgHash) });
  }
  const finalTime = Math.max(700, item.scene.timeline.durationMs);
  const finalHash = await storeSvg(renderSceneSvg(item.scene, finalTime));
  samples.push({ sceneId, kind: 'final', svgHash: finalHash, sampleTimeMs: finalTime, pngHash: rasterHash(finalHash) });

  const lock = SceneLockSchema.parse({
    schemaVersion: SCENE_LOCK_V2_VERSION, lessonId, sceneId, index, startMs: item.startMs, endMs: item.endMs, fps,
    scene: sceneRef, audio: audioRef, captured: capturedRef, ...capturedHashes(captured), firstFrame, frames, renderPlan, svgAssets, samples, contentHash: '0'.repeat(64),
  });
  lock.contentHash = sceneLockHash(lock);
  await publishExclusive(path.join(outputDir, sceneLockFile(sceneId)), jsonBytes(lock));
  return lock;
}

/** Everything a scene lock pins must still hold: bytes, hashes, safe paths, SVG content and a gapless frame range. */
export async function verifySceneLockV2(outputDir: string, sceneId: string): Promise<string[]> {
  const problems: string[] = [];
  let lock: SceneLockV2;
  try {
    const parsed = SceneLockSchema.safeParse(JSON.parse((await readFile(await confinedPath(outputDir, sceneLockFile(sceneId)))).toString('utf8')));
    if (!parsed.success) return [`scene lock ${sceneId} structure invalid: ${parsed.error.message}`];
    lock = parsed.data;
  } catch (error) { return [`scene lock ${sceneId} unreadable: ${error instanceof Error ? error.message : String(error)}`]; }
  if (lock.sceneId !== sceneId) problems.push(`scene lock ${sceneId} names scene ${lock.sceneId}`);
  if (sceneLockHash(lock) !== lock.contentHash) problems.push(`scene lock ${sceneId} content hash mismatch`);
  const load = async (ref: { file: string; hash: string }, label: string): Promise<Buffer | undefined> => {
    try { return await readRef(outputDir, ref); } catch (error) { problems.push(`scene ${sceneId} ${label}: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
  };
  await load(lock.scene, 'semantic data');
  await load(lock.audio, 'audio');
  const capturedBytes = await load(lock.captured, 'captured state');
  if (capturedBytes) {
    try {
      const data = CapturedSchema.parse(JSON.parse(capturedBytes.toString('utf8')));
      const hashes = capturedHashes(data);
      for (const [key, actual] of Object.entries(hashes)) if (actual !== lock[key as keyof typeof hashes]) problems.push(`scene ${sceneId} ${key} hash drift`);
    } catch { problems.push(`scene ${sceneId} captured JSON invalid`); }
  }
  const svgs = new Set<string>();
  for (const ref of lock.svgAssets) {
    const bytes = await load(ref, 'SVG');
    if (bytes) { const problem = svgProblem(ref.hash, bytes.toString('utf8')); if (problem) problems.push(problem); svgs.add(ref.hash); }
  }
  let cursor = lock.firstFrame;
  for (const segment of lock.renderPlan) {
    if (segment.sceneId !== sceneId || segment.firstFrame !== cursor) problems.push(`scene ${sceneId} render plan frame range invalid`);
    cursor += segment.frameCount;
    const hashes = segment.kind === 'hold' ? [segment.svgHash] : segment.svgHashes;
    if (segment.kind === 'transition' && (segment.fps !== lock.fps || hashes.length !== segment.frameCount)) problems.push(`scene ${sceneId} transition frame range or FPS invalid`);
    if (hashes.some((hash) => !svgs.has(hash))) problems.push(`scene ${sceneId} render plan references missing SVG bytes`);
  }
  if (cursor !== lock.firstFrame + lock.frames) problems.push(`scene ${sceneId} render plan does not cover its frames`);
  if (!lock.samples.some((sample) => sample.kind === 'final')) problems.push(`scene ${sceneId} requires a final raster sample`);
  for (const sample of lock.samples) if (sample.sceneId !== sceneId || !svgs.has(sample.svgHash)) problems.push(`scene ${sceneId} raster sample reference invalid`);
  return problems;
}

export interface ReadyPrefixV2 { scenes: SceneLockV2[]; readyThroughMs: number; stoppedBecause?: string }

/** The playable prefix: scene locks 0..k that are all present, verified, and placed edge to edge on the audio clock. */
export async function readyPrefixV2(outputDir: string): Promise<ReadyPrefixV2> {
  let names: string[];
  try { names = (await readdir(path.join(outputDir, SCENE_LOCK_DIR))).filter((name) => name.endsWith('.scene.lock.json')); }
  catch { return { scenes: [], readyThroughMs: 0 }; }
  const byIndex = new Map<number, string>();
  for (const name of names) {
    const sceneId = name.slice(0, -'.scene.lock.json'.length);
    try {
      const parsed = SceneLockSchema.safeParse(JSON.parse(await readFile(path.join(outputDir, SCENE_LOCK_DIR, name), 'utf8')));
      if (parsed.success && !byIndex.has(parsed.data.index)) byIndex.set(parsed.data.index, sceneId);
    } catch { /* unreadable locks simply are not ready */ }
  }
  const ready: SceneLockV2[] = [];
  let endMs = 0;
  for (let index = 0; byIndex.has(index); index++) {
    const sceneId = byIndex.get(index)!;
    const problems = await verifySceneLockV2(outputDir, sceneId);
    if (problems.length) return { scenes: ready, readyThroughMs: endMs, stoppedBecause: problems[0]! };
    const lock = SceneLockSchema.parse(JSON.parse(await readFile(path.join(outputDir, sceneLockFile(sceneId)), 'utf8')));
    if (lock.startMs !== endMs) return { scenes: ready, readyThroughMs: endMs, stoppedBecause: `scene ${sceneId} does not start where the previous scene ends` };
    ready.push(lock); endMs = lock.endMs;
  }
  return { scenes: ready, readyThroughMs: endMs };
}

/** Wall-clock publication log. Deliberately outside every pinned file so locks stay byte-deterministic. */
export async function recordSceneProgressV2(outputDir: string, event: { sceneId: string; index: number; sinceRequestMs: number; sinceStartMs: number }): Promise<void> {
  const file = path.join(outputDir, 'v2', 'progress.json');
  let events: unknown[] = [];
  try { events = (JSON.parse(await readFile(file, 'utf8')) as { events: unknown[] }).events; } catch { /* first event */ }
  const next = { schemaVersion: 'v2-progress/v1', events: [...events, { ...event, sinceRequestMs: Math.round(event.sinceRequestMs), sinceStartMs: Math.round(event.sinceStartMs) }] };
  const partial = `${file}.${randomUUID()}.partial.json`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(partial, jsonBytes(next), { flag: 'wx' });
  await rename(partial, file);
}

/** Aggregate the published scene locks into the lesson lock. Missing scene locks are published here; none are re-rendered if present. */
export async function writeLessonLockV2(input: { outputDir: string; lessonId: string; scenes: readonly V2VideoScene[]; durationMs: number; audioPath: string; fps: number }): Promise<LessonLockV2> {
  const { outputDir, lessonId, fps, durationMs } = input;
  for (const name of ['lesson.lock.json', 'lesson.lock.v2.json']) {
    try { await access(path.join(outputDir, name)); } catch { continue; }
    throw new Error(`lesson lock already published: ${name}`);
  }
  if (!input.scenes.length || !Number.isInteger(fps) || fps < 1 || fps > 120 || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error('V2 lock needs scenes, a positive duration and FPS from 1 to 120');
  const scenes = [...input.scenes].sort((a, b) => a.startMs - b.startMs);
  const ids = new Set<string>();
  for (const [i, item] of scenes.entries()) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.scene.sceneId) || ids.has(item.scene.sceneId)) throw new Error('invalid or duplicate V2 sceneId');
    ids.add(item.scene.sceneId);
    if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.endMs <= item.startMs || item.startMs < 0 || (i === 0 && item.startMs !== 0) || (i > 0 && item.startMs !== scenes[i - 1]!.endMs)) throw new Error('V2 scene placements must cover a continuous audio clock');
  }
  if (scenes.at(-1)!.endMs !== durationMs) throw new Error('V2 scene placements must end at durationMs');
  const versions = { ...probeToolVersions(), kalamSha256: KALAM_FONT_SHA256, renderPlan: 'svg-frame-ranges/v1' as const };
  for (const [tool, version] of Object.entries(versions)) if (!version || version === 'unknown') throw new Error(`V2 lock requires a known ${tool} version`);
  const fontBytes = await readFile(KALAM_BOLD_FILE);
  if (bytesHash(fontBytes) !== KALAM_FONT_SHA256) throw new Error('bundled font content hash drift');
  const lockedDir = path.join(outputDir, 'v2', 'locked');
  await mkdir(path.join(lockedDir, 'fonts'), { recursive: true });
  await mkdir(path.join(lockedDir, 'audio'), { recursive: true });
  const persist = async (file: string, bytes: Buffer | string) => {
    await writeFile(path.join(outputDir, file), bytes, { flag: 'wx' });
    return { file, hash: bytesHash(bytes) };
  };
  const ref = async (file: string) => ({ file, hash: bytesHash(await readFile(await confinedPath(outputDir, file))) });
  const font: LessonLockV2['font'] = { ...await persist('v2/locked/fonts/Kalam-Bold.ttf', fontBytes), family: KALAM_FONT_FAMILY, loadSystemFonts: false as const };
  // Audio input must itself belong to this run; export reads the captured copy.
  const sourceAudio = path.relative(outputDir, input.audioPath).split(path.sep).join('/');
  const audio = await persist('v2/locked/audio/master.wav', await readFile(await confinedPath(outputDir, sourceAudio)));
  const context = await ref('v2/lesson-context.json');
  const alignment = await ref('v2/alignment.json');
  const alignmentBytes = await readRef(outputDir, alignment);
  const semantic: unknown[] = [];
  const captions = await ref('captions.vtt');
  const records: LessonLockV2['scenes'] = [];
  const renderPlan: RenderSegment[] = [];
  const svgAssets: LessonLockV2['svgAssets'] = [];
  const seenSvg = new Set<string>();
  const samples: LessonLockV2['samples'] = [];
  let frameCursor = 0;
  for (const [index, item] of scenes.entries()) {
    const sceneId = item.scene.sceneId;
    const final = index === scenes.length - 1;
    const expected = sceneFrameRange(item.startMs, item.endMs, fps, final);
    let sceneLock: SceneLockV2;
    if (await sceneLockExists(outputDir, sceneId)) {
      const problems = await verifySceneLockV2(outputDir, sceneId);
      if (problems.length) throw new Error(`scene lock ${sceneId} failed verification: ${problems.join('; ')}`);
      sceneLock = SceneLockSchema.parse(JSON.parse(await readFile(path.join(outputDir, sceneLockFile(sceneId)), 'utf8')));
      const captured = capturedHashes(captureScene(item));
      const differs = sceneLock.index !== index || sceneLock.lessonId !== lessonId || sceneLock.fps !== fps || sceneLock.startMs !== item.startMs || sceneLock.endMs !== item.endMs
        || sceneLock.firstFrame !== expected.firstFrame || sceneLock.frames !== expected.frames
        || (Object.keys(captured) as Array<keyof typeof captured>).some((key) => sceneLock[key] !== captured[key]);
      if (differs) throw new Error(`scene lock ${sceneId} differs from the compiled scene (placement, frame range or captured state)`);
    } else {
      sceneLock = await publishSceneLockV2({ outputDir, lessonId, index, item, fps, final });
    }
    if (sceneLock.firstFrame !== frameCursor) throw new Error('scene lock frame ranges must be contiguous');
    frameCursor += sceneLock.frames;
    semantic.push(JSON.parse((await readRef(outputDir, sceneLock.scene)).toString('utf8')));
    records.push({ sceneId, startMs: item.startMs, endMs: item.endMs, file: sceneLock.scene.file, fileHash: sceneLock.scene.hash, audioFile: sceneLock.audio.file, audioHash: sceneLock.audio.hash, captured: sceneLock.captured,
      timelineHash: sceneLock.timelineHash, geometryHash: sceneLock.geometryHash, boardOpsHash: sceneLock.boardOpsHash, boardStatesHash: sceneLock.boardStatesHash, conceptsHash: sceneLock.conceptsHash });
    renderPlan.push(...sceneLock.renderPlan);
    for (const asset of sceneLock.svgAssets) if (!seenSvg.has(asset.hash)) { seenSvg.add(asset.hash); svgAssets.push(asset); }
    samples.push(...sceneLock.samples);
  }
  const frames = Math.max(1, Math.round(durationMs * fps / 1000));
  if (frameCursor !== frames) throw new Error(`scene locks cover ${frameCursor} frames, the lesson needs ${frames}`);
  const invalidAlignment = alignmentProblems(alignmentBytes, records, semantic);
  if (invalidAlignment.length) throw new Error(`V2 lock alignment validation failed: ${invalidAlignment.join('; ')}`);
  const render = { fps, durationMs, width: STYLE.canvas.w, height: STYLE.canvas.h, frames };
  const lock = LockSchema.parse({ schemaVersion: LESSON_LOCK_V2_VERSION, lessonId, context, alignment, scenes: records, media: { audio, captions }, font, render, renderPlan, svgAssets, samples, versions, contentHash: '0'.repeat(64) });
  lock.contentHash = lockHash(lock);
  // Publish only after all inputs and representative PNG pins exist. Exclusive writes preserve previously published locks.
  const bytes = jsonBytes(lock);
  await publishExclusive(path.join(outputDir, 'lesson.lock.json'), bytes);
  await publishExclusive(path.join(outputDir, 'lesson.lock.v2.json'), bytes);
  return lock;
}

interface VerifiedLock { lock: LessonLockV2; captured: CapturedScene[]; semantic: unknown[]; context: Buffer; alignment: Buffer; audio: Buffer[]; svgs: Map<string, string>; fontPath: string }
async function inspectLock(outputDir: string): Promise<{ problems: string[]; verified?: VerifiedLock }> {
  const problems: string[] = [];
  let lock: LessonLockV2;
  try {
    const primary = await readFile(await confinedPath(outputDir, 'lesson.lock.json'));
    let aliasPresent = false;
    try { await lstat(path.join(outputDir, 'lesson.lock.v2.json')); aliasPresent = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problems.push('V2 compatibility alias cannot be inspected'); }
    if (aliasPresent) {
      try {
        const alias = await readFile(await confinedPath(outputDir, 'lesson.lock.v2.json'));
        if (!primary.equals(alias)) problems.push('canonical lesson.lock.json and V2 compatibility alias differ');
      } catch (error) { problems.push(`V2 compatibility alias unreadable: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const parsed = LockSchema.safeParse(JSON.parse(primary.toString('utf8')));
    if (!parsed.success) return { problems: [...problems, `V2 lock structure invalid: ${parsed.error.message}`] };
    lock = parsed.data;
  } catch (error) { return { problems: [`V2 lesson lock unreadable: ${error instanceof Error ? error.message : String(error)}`] }; }
  if (lockHash(lock) !== lock.contentHash) problems.push('lock content hash mismatch');
  const current = probeToolVersions();
  for (const tool of ['node', 'pipeline', 'resvg', 'roughjs', 'ffmpeg'] as const) {
    if (lock.versions[tool] === 'unknown' || current[tool] === 'unknown' || lock.versions[tool] !== current[tool]) problems.push(`${tool} tool version drift or unknown pin`);
  }
  if (lock.versions.kalamSha256 !== KALAM_FONT_SHA256 || lock.font.hash !== KALAM_FONT_SHA256) problems.push('font content hash drift');
  try { if (bytesHash(await readFile(KALAM_BOLD_FILE)) !== lock.font.hash) problems.push('bundled font content hash drift'); } catch { problems.push('bundled font missing'); }
  const load = async (ref: { file: string; hash: string }, label: string): Promise<Buffer | undefined> => {
    try { return await readRef(outputDir, ref); } catch (error) { problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
  };
  const context = await load(lock.context, 'lesson context');
  const alignment = await load(lock.alignment, 'alignment');
  try { if (context) JSON.parse(context.toString('utf8')); } catch { problems.push('lesson context JSON invalid'); }
  const captions = await load(lock.media.captions, 'captions');
  if (captions && !captions.toString('utf8').startsWith('WEBVTT')) problems.push('captions must be WEBVTT');
  const master = await load(lock.media.audio, 'master audio');
  await load(lock.font, 'font');
  const captured: CapturedScene[] = []; const semantic: unknown[] = []; const audio: Buffer[] = master ? [master] : [];
  const sceneIds = new Set<string>();
  let endMs = 0;
  for (const scene of lock.scenes) {
    if (sceneIds.has(scene.sceneId)) problems.push(`duplicate scene ${scene.sceneId}`); sceneIds.add(scene.sceneId);
    if (scene.startMs !== endMs || scene.endMs <= scene.startMs) problems.push(`scene ${scene.sceneId} audio placement invalid`); endMs = scene.endMs;
    const raw = await load({ file: scene.file, hash: scene.fileHash }, `scene ${scene.sceneId}`);
    const sceneAudio = await load({ file: scene.audioFile, hash: scene.audioHash }, `scene ${scene.sceneId} audio`); if (sceneAudio) audio.push(sceneAudio);
    try { semantic.push(raw ? JSON.parse(raw.toString('utf8')) : undefined); } catch { semantic.push(undefined); problems.push(`scene ${scene.sceneId} semantic JSON invalid`); }
    const bytes = await load(scene.captured, `scene ${scene.sceneId} captured`);
    if (bytes) {
      try {
        const data = CapturedSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (data.sceneId !== scene.sceneId || data.timeline.states.length !== data.timeline.ops.length + 1 || data.geometry.states.length !== data.timeline.states.length) problems.push(`scene ${scene.sceneId} captured state structure invalid`);
        if (data.geometry.edgeRoutes) {
          if (data.geometry.edgeRoutes.length !== data.timeline.states.length) problems.push(`scene ${scene.sceneId} captured edge route state count invalid`);
          data.geometry.edgeRoutes.forEach((routes, index) => {
            const state = data.timeline.states[index] as { edges?: Record<string, { lifecycle?: { removedAtBeat?: string } }> } | undefined;
            const expected = Object.entries(state?.edges ?? {}).filter(([, edge]) => edge.lifecycle?.removedAtBeat === undefined).map(([id]) => id).sort();
            if (routes.map((route) => route.id).join('\0') !== expected.join('\0')) problems.push(`scene ${scene.sceneId} captured edge route ids invalid at state ${index}`);
          });
        }
        const hashes = capturedHashes(data);
        for (const [key, actual] of Object.entries(hashes)) if (actual !== scene[key as keyof typeof hashes]) problems.push(`scene ${scene.sceneId} ${key} hash drift`);
        if (data.timeline.hash !== hashes.timelineHash) problems.push(`scene ${scene.sceneId} timeline content hash drift`);
        captured.push(data);
      } catch { problems.push(`scene ${scene.sceneId} captured JSON invalid`); }
    }
  }
  if (alignment) problems.push(...alignmentProblems(alignment, lock.scenes, semantic));
  if (endMs !== lock.render.durationMs || lock.render.frames !== Math.max(1, Math.round(lock.render.durationMs * lock.render.fps / 1000))) problems.push('render duration or frame count invalid');
  if (lock.render.width !== STYLE.canvas.w || lock.render.height !== STYLE.canvas.h) problems.push('render canvas version drift');
  const svgs = new Map<string, string>();
  for (const ref of lock.svgAssets) {
    if (svgs.has(ref.hash)) problems.push('duplicate SVG asset hash');
    const bytes = await load(ref, 'SVG');
    if (bytes) {
      const svg = bytes.toString('utf8');
      const problem = svgProblem(ref.hash, svg);
      if (problem) problems.push(problem);
      svgs.set(ref.hash, svg);
    }
  }
  let frameCursor = 0;
  for (const segment of lock.renderPlan) {
    if (!sceneIds.has(segment.sceneId) || segment.firstFrame !== frameCursor) problems.push('render plan frame range invalid');
    frameCursor += segment.frameCount;
    const hashes = segment.kind === 'hold' ? [segment.svgHash] : segment.svgHashes;
    if (segment.kind === 'transition' && (segment.fps !== lock.render.fps || hashes.length !== segment.frameCount)) problems.push('transition frame range or FPS invalid');
    if (hashes.some((hash) => !svgs.has(hash))) problems.push('render plan references missing SVG bytes');
  }
  if (frameCursor !== lock.render.frames) problems.push('render plan does not cover every frame');
  for (const sample of lock.samples) if (!sceneIds.has(sample.sceneId) || !svgs.has(sample.svgHash) || (sample.frame !== undefined && sample.frame >= lock.render.frames)) problems.push('raster sample reference invalid');
  for (const sceneId of sceneIds) {
    if (!lock.samples.some((sample) => sample.sceneId === sceneId && sample.kind === 'final')) problems.push(`scene ${sceneId} requires a final raster sample`);
    if (lock.renderPlan.some((segment) => segment.sceneId === sceneId && segment.kind === 'transition') && !lock.samples.some((sample) => sample.sceneId === sceneId && sample.kind === 'transition')) problems.push(`scene ${sceneId} requires a transition raster sample`);
  }
  if (problems.length || !context || !alignment) return { problems };
  return { problems, verified: { lock, captured, semantic, context, alignment, audio, svgs, fontPath: await confinedPath(outputDir, lock.font.file) } };
}

/** Fail closed on byte drift, unknown tool/font pins, incomplete frame ranges or unsafe references. */
export async function verifyLessonLockV2(outputDir: string): Promise<string[]> { return (await inspectLock(outputDir)).problems; }
export async function verifiedInputs(outputDir: string): Promise<VerifiedLock> {
  const { problems, verified } = await inspectLock(outputDir);
  if (problems.length || !verified) throw new Error(`V2 lesson lock verification failed: ${problems.join('; ')}`);
  return verified;
}

/** Recompute digests from captured bytes; fresh Resvg runs check representative PNG pins on every replay. This is sample evidence, not full decoded-video equality. */
export async function replayLessonV2(outputDir: string): Promise<ReplayDigest> {
  const { lock, captured, semantic, context, alignment, audio, svgs, fontPath } = await verifiedInputs(outputDir);
  const frames = lock.samples.map((sample) => {
    const actual = bytesHash(raster(svgs.get(sample.svgHash)!, lock, fontPath));
    if (actual !== sample.pngHash) throw new Error(`V2 raster sample PNG hash drift: ${sample.sceneId} ${sample.kind}`);
    return [sample.sceneId, sample.kind, sample.frame ?? null, sample.sampleTimeMs, actual];
  });
  return {
    geometry: canonicalHash(captured.map((scene) => [scene.sceneId, scene.geometry, scene.timeline.states])),
    events: canonicalHash([JSON.parse(context.toString('utf8')), alignment.toString('base64'), semantic, captured.map((scene) => [scene.sceneId, scene.timeline])]),
    assets: canonicalHash([captured.map((scene) => [scene.sceneId, scene.concepts]), [...svgs].map(([hash, svg]) => [hash, bytesHash(svg)]), bytesHash(await readFile(fontPath))]),
    audio: canonicalHash(audio.map(bytesHash)), frames: canonicalHash(frames),
  };
}

export interface EncodeLockedLessonV2Deps {
  createRasterPool?: (workers: number) => Pick<RasterPool, 'render' | 'close'>;
  spawnEncoder?: typeof spawnFrameEncoder;
}

/** Export consumes only verified locked bytes, including a private snapshot of verified audio. */
export async function encodeLockedLessonV2(outputDir: string, outPath: string, deps: EncodeLockedLessonV2Deps = {}): Promise<{ frames: number; rendered: number; reused: number }> {
  const { lock, audio, svgs } = await verifiedInputs(outputDir);
  await mkdir(path.dirname(outPath), { recursive: true });
  const nonce = randomUUID();
  const partial = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${nonce}.partial.mp4`);
  const audioSnapshot = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${nonce}.audio.wav`);
  const workers = Math.max(1, Math.min(4, availableParallelism() - 1));
  let pool: Pick<RasterPool, 'render' | 'close'> | undefined;
  let encoder: ReturnType<typeof spawnFrameEncoder> | undefined;
  const pending = new Map<number, Promise<Buffer>>();
  let segmentIndex = 0; let scheduled = 0; let written = 0; let rendered = 0; let reused = 0;
  let lastHash: string | undefined; let lastPng: Promise<Buffer> | undefined;
  try {
    // ffmpeg must not reopen the mutable locked file after verification. This WAV is exactly the verified Buffer.
    await writeFile(audioSnapshot, audio[0]!, { flag: 'wx' });
    pool = (deps.createRasterPool ?? ((size) => new RasterPool(size)))(workers);
    encoder = (deps.spawnEncoder ?? spawnFrameEncoder)(partial, lock.render.fps, audioSnapshot);
    void encoder.done.catch(() => undefined);
    while (written < lock.render.frames) {
      while (scheduled < lock.render.frames && pending.size < workers * 2) {
        const frame = scheduled++;
        while (frame >= lock.renderPlan[segmentIndex]!.firstFrame + lock.renderPlan[segmentIndex]!.frameCount) segmentIndex++;
        const segment = lock.renderPlan[segmentIndex]!;
        const hash = segment.kind === 'hold' ? segment.svgHash : segment.svgHashes[frame - segment.firstFrame]!;
        let png: Promise<Buffer>;
        if (hash === lastHash && lastPng) { png = lastPng; reused++; }
        else { png = pool.render(svgs.get(hash)!, lock.render.width); rendered++; }
        lastHash = hash; lastPng = png; pending.set(frame, png);
      }
      const png = await pending.get(written)!; pending.delete(written++); await encoder.write(png);
    }
    encoder.end(); await encoder.done; await rename(partial, outPath);
  } catch (error) {
    encoder?.abort(); await encoder?.done.catch(() => undefined); await rm(partial, { force: true }); throw error;
  } finally {
    try { await pool?.close(); } finally { await rm(audioSnapshot, { force: true }); }
  }
  return { frames: lock.render.frames, rendered, reused };
}

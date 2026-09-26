import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stableJson } from '../../shared/artifacts.js';
import { withHostResourcePermit, type HostResourcePoolOptions } from '../../shared/hostResourcePool.js';
import { STYLE } from '../style.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { VISUAL_STAGE_VERSIONS } from '../pipeline/versions.js';
import { encodeVideoAtomically } from './videoEncode.js';
import type { VideoScene } from './frame.js';
import { probeMediaDurationMs, runFfmpeg } from './ffmpeg.js';

export interface ModuleVideoInput {
  id: string;
  title: string;
  /** Scenes and timeline bounds use a module-local clock starting at zero. */
  scenes: VideoScene[];
  durationMs: number;
  audioPath: string;
  /** Optional module-local WebVTT cues, shifted and muxed into the assembled lesson. */
  captionsPath?: string;
}

export interface ModuleVideoArtifact {
  moduleId: string;
  title: string;
  path: string;
  durationMs: number;
  inputHash: string;
  contentHash: string;
  bytes: number;
  cacheHit: boolean;
  captionsPath?: string;
  captionsHash?: string;
}

export interface ModuleVideoOptions {
  fps?: number;
  workerCount?: number;
  /** Per-process override for the shared host raster limit (default 2). */
  rasterLimit?: number;
  resourcePoolOptions?: HostResourcePoolOptions;
  encode?: typeof encodeVideoAtomically;
  probeDuration?: typeof probeMediaDurationMs;
}

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const digest = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

function assertModule(module: ModuleVideoInput): void {
  if (!ID.test(module.id)) throw new Error(`Unsafe module identifier: ${module.id}`);
  if (!module.title.trim()) throw new Error(`Module ${module.id} needs a chapter title`);
  if (!Number.isFinite(module.durationMs) || module.durationMs <= 0) throw new Error(`Module ${module.id} needs a positive duration`);
  if (!module.scenes.length) throw new Error(`Module ${module.id} has no scenes`);
  const ordered = [...module.scenes].sort((a, b) => a.startMs - b.startMs);
  if (ordered[0]!.startMs < 0 || ordered.at(-1)!.endMs > module.durationMs + 1) throw new Error(`Module ${module.id} scenes must fit its local duration`);
  if (ordered.some((scene) => scene.endMs <= scene.startMs)) throw new Error(`Module ${module.id} has an invalid scene interval`);
}

async function validCachedArtifact(filePath: string, manifestPath: string, inputHash: string): Promise<{ contentHash: string; bytes: number; durationMs: number } | undefined> {
  try {
    const [rawManifest, bytes] = await Promise.all([readFile(manifestPath, 'utf8'), readFile(filePath)]);
    const manifest = JSON.parse(rawManifest) as { schemaVersion?: string; inputHash?: string; contentHash?: string; bytes?: number; frames?: number; fps?: number; durationMs?: number };
    if (manifest.schemaVersion !== 'hypothesis-module-video/v1' || manifest.inputHash !== inputHash || manifest.bytes !== bytes.length || manifest.contentHash !== digest(bytes) || !Number.isInteger(manifest.frames) || !Number.isInteger(manifest.fps) || !Number.isFinite(manifest.durationMs) || manifest.durationMs! <= 0) return undefined;
    return { contentHash: manifest.contentHash!, bytes: bytes.length, durationMs: manifest.durationMs! };
  } catch {
    return undefined;
  }
}

/** Encode module-local clips with an input-addressed path and verified resume manifest. */
export async function encodeModuleVideos(modules: ModuleVideoInput[], outputDir: string, options: ModuleVideoOptions = {}): Promise<ModuleVideoArtifact[]> {
  if (!modules.length) throw new Error('encodeModuleVideos requires at least one module');
  if (new Set(modules.map((module) => module.id)).size !== modules.length) throw new Error('Module identifiers must be unique');
  const fps = options.fps ?? 30;
  const workerCount = options.workerCount;
  const configuredRasterLimit = Number(process.env.HYPOTHESIS_RASTER_CONCURRENCY);
  const rasterLimit = options.rasterLimit ?? (Number.isInteger(configuredRasterLimit) && configuredRasterLimit >= 1 ? Math.min(8, configuredRasterLimit) : 2);
  const encode = options.encode ?? encodeVideoAtomically;
  const probeDuration = options.probeDuration ?? probeMediaDurationMs;
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error('fps must be an integer from 1 to 120');
  if (!Number.isInteger(rasterLimit) || rasterLimit < 1 || rasterLimit > 8) throw new Error('rasterLimit must be an integer from 1 to 8');
  await mkdir(outputDir, { recursive: true });

  const artifacts: ModuleVideoArtifact[] = [];
  for (const module of modules) {
    assertModule(module);
    const audioBytes = await readFile(module.audioPath);
    const captionsHash = module.captionsPath ? digest(await readFile(module.captionsPath)) : undefined;
    const renderSettings = { schemaVersion: 'hypothesis-render-settings/v1', canvas: STYLE.canvas, fps, fontSha256: KALAM_FONT_SHA256, visualStageVersions: VISUAL_STAGE_VERSIONS, rasterizer: 'resvg-width-fit-v1', encoder: 'h264-crf20-aac-v1' };
    const inputHash = digest(stableJson({ schemaVersion: 'hypothesis-module-video-input/v1', id: module.id, title: module.title, scenes: module.scenes, durationMs: module.durationMs, audioHash: digest(audioBytes), captionsHash, renderSettings }));
    const filePath = path.join(outputDir, `module-${module.id}-${inputHash.slice(0, 20)}.mp4`);
    const manifestPath = `${filePath}.json`;
    const cached = await validCachedArtifact(filePath, manifestPath, inputHash);
    if (cached) {
      const probedDuration = await probeDuration(filePath).catch(() => undefined);
      if (probedDuration !== undefined && Math.abs(probedDuration - cached.durationMs) <= 1) {
        artifacts.push({ moduleId: module.id, title: module.title, path: filePath, inputHash, ...cached, cacheHit: true, ...(module.captionsPath ? { captionsPath: module.captionsPath, captionsHash } : {}) });
        continue;
      }
    }

    const encoded = await withHostResourcePermit('raster', rasterLimit, () => encode(module.scenes, module.durationMs, module.audioPath, filePath, fps, workerCount), options.resourcePoolOptions);
    const bytes = await readFile(filePath);
    const contentHash = digest(bytes);
    const durationMs = await probeDuration(filePath);
    const metadata = JSON.stringify({ schemaVersion: 'hypothesis-module-video/v1', moduleId: module.id, title: module.title, durationMs, fps, inputHash, contentHash, bytes: bytes.length, frames: encoded.frames }, null, 2) + '\n';
    const temporaryManifest = `${manifestPath}.${process.pid}.${randomUUID()}.partial`;
    await writeFile(temporaryManifest, metadata, 'utf8');
    await rename(temporaryManifest, manifestPath);
    artifacts.push({ moduleId: module.id, title: module.title, path: filePath, durationMs, inputHash, contentHash, bytes: bytes.length, cacheHit: false, ...(module.captionsPath ? { captionsPath: module.captionsPath, captionsHash } : {}) });
  }
  return artifacts;
}

export interface ModuleChapter {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
}

function ffmetadataEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/;/g, '\\;').replace(/#/g, '\\#').replace(/\n/g, '\\n');
}

/** The concat demuxer resolves entries relative to its list file, so use absolute clip paths. */
export function buildModuleConcatList(modules: Pick<ModuleVideoArtifact, 'path'>[]): string {
  return modules.map((module) => `file '${path.resolve(module.path).replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

function parseVttTimestamp(value: string): number {
  const match = /^(\d{2,}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match) throw new Error(`Invalid WebVTT timestamp: ${value}`);
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
}

function formatVttTimestamp(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  const hours = Math.floor(whole / 3_600_000);
  const minutes = Math.floor(whole / 60_000) % 60;
  const seconds = Math.floor(whole / 1000) % 60;
  const millis = whole % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Combine module-local WebVTT files on the same ordered clock used by chapters. */
export async function combineModuleCaptions(modules: Pick<ModuleVideoArtifact, 'moduleId' | 'durationMs' | 'captionsPath'>[]): Promise<string | undefined> {
  if (!modules.some((module) => module.captionsPath)) return undefined;
  let offsetMs = 0;
  const cues: string[] = [];
  for (const module of modules) {
    if (module.captionsPath) {
      const source = await readFile(module.captionsPath, 'utf8');
      if (!/^WEBVTT(?:\s|$)/.test(source)) throw new Error(`Module ${module.moduleId} captions are not WebVTT`);
      const body = source.replace(/^WEBVTT[^\n]*(?:\r?\n|$)/, '').trim();
      const shifted = body.split(/\r?\n/).map((line) => {
        const match = /^(\d{2,}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2}\.\d{3})(.*)$/.exec(line);
        if (!match) return line;
        const start = parseVttTimestamp(match[1]);
        const end = parseVttTimestamp(match[2]);
        if (end <= start || start >= module.durationMs) throw new Error(`Module ${module.moduleId} has an invalid caption interval`);
        return `${formatVttTimestamp(start + offsetMs)} --> ${formatVttTimestamp(Math.min(end, module.durationMs) + offsetMs)}${match[3]}`;
      }).join('\n');
      if (shifted) cues.push(shifted);
    }
    offsetMs += Math.round(module.durationMs);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function buildAssemblyFfmpegArgs(listPath: string, metadataPath: string, captionsPath: string | undefined, outputPath: string): string[] {
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-i', metadataPath];
  if (captionsPath) args.push('-i', captionsPath);
  args.push('-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy');
  if (captionsPath) args.push('-map', '2:0', '-c:s', 'mov_text');
  args.push('-movflags', '+faststart', outputPath);
  return args;
}

/** Build ffmetadata chapters with contiguous millisecond ranges in module order. */
export function buildChapterMetadata(modules: Pick<ModuleVideoArtifact, 'moduleId' | 'title' | 'durationMs'>[]): { text: string; chapters: ModuleChapter[] } {
  if (!modules.length) throw new Error('At least one module is required for chapter metadata');
  if (new Set(modules.map((module) => module.moduleId)).size !== modules.length) throw new Error('Module identifiers must be unique');
  let cursor = 0;
  const chapters = modules.map((module) => {
    if (!Number.isFinite(module.durationMs) || module.durationMs <= 0) throw new Error(`Module ${module.moduleId} has invalid duration`);
    const chapter = { id: module.moduleId, title: module.title, startMs: cursor, endMs: cursor + Math.round(module.durationMs) };
    cursor = chapter.endMs;
    return chapter;
  });
  const text = [
    ';FFMETADATA1',
    ...chapters.flatMap((chapter) => [
      '[CHAPTER]', 'TIMEBASE=1/1000', `START=${chapter.startMs}`, `END=${chapter.endMs}`,
      `title=${ffmetadataEscape(chapter.title)}`,
    ]),
    '',
  ].join('\n');
  return { text, chapters };
}

/** Concatenate compatible H.264/AAC module clips and attach chapter markers atomically. */
export async function assembleModuleVideos(modules: ModuleVideoArtifact[], outputPath: string): Promise<{ path: string; chapters: ModuleChapter[]; captionsPath?: string }> {
  if (!modules.length) throw new Error('assembleModuleVideos requires at least one module');
  if (new Set(modules.map((module) => module.moduleId)).size !== modules.length) throw new Error('Module identifiers must be unique');
  for (const module of modules) {
    const bytes = await readFile(module.path);
    if (digest(bytes) !== module.contentHash || bytes.length !== module.bytes) throw new Error(`Module clip changed after export: ${module.moduleId}`);
    if (module.captionsPath && module.captionsHash && digest(await readFile(module.captionsPath)) !== module.captionsHash) throw new Error(`Module captions changed after export: ${module.moduleId}`);
  }
  const { text: metadata, chapters } = buildChapterMetadata(modules);
  const captions = await combineModuleCaptions(modules);
  const directory = path.dirname(outputPath);
  await mkdir(directory, { recursive: true });
  const nonce = `${process.pid}.${randomUUID()}`;
  const listPath = path.join(directory, `.module-list.${nonce}.txt`);
  const metadataPath = path.join(directory, `.chapters.${nonce}.ffmeta`);
  const captionsTempPath = path.join(directory, `.captions.${nonce}.vtt`);
  const captionsPath = captions ? `${outputPath.replace(/\.mp4$/i, '')}.vtt` : undefined;
  const partialPath = `${outputPath}.${nonce}.partial.mp4`;
  const concatList = buildModuleConcatList(modules);
  try {
    await Promise.all([writeFile(listPath, concatList, 'utf8'), writeFile(metadataPath, metadata, 'utf8'), ...(captions ? [writeFile(captionsTempPath, captions, 'utf8')] : [])]);
    await runFfmpeg(buildAssemblyFfmpegArgs(listPath, metadataPath, captions ? captionsTempPath : undefined, partialPath));
    await rename(partialPath, outputPath);
    if (captionsPath && captions) await writeFile(captionsPath, captions, 'utf8');
    return { path: outputPath, chapters, ...(captionsPath ? { captionsPath } : {}) };
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await Promise.all([rm(listPath, { force: true }), rm(metadataPath, { force: true }), rm(captionsTempPath, { force: true })]);
  }
}

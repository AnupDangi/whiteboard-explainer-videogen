import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { STYLE } from '../render/style.js';
import { spawnFrameEncoder } from './ffmpeg.js';
import { RasterPool } from './rasterPool.js';
import { frameSvgAt, type VideoScene } from './frame.js';
import { RESVG_FONT_OPTIONS } from '../render/fonts.js';
import { KALAM_BOLD_FILE, KALAM_FONT_FAMILY } from '../render/fonts.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { VISUAL_STAGE_VERSIONS } from '../run/versions.js';
import { stableJson } from '../shared/artifacts.js';
import { readdir, stat } from 'node:fs/promises';
import { withHostResourcePermit, type HostResourcePoolOptions } from '../shared/hostResourcePool.js';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');

export interface RasterFrameCacheOptions {
  cacheDir: string;
  width: number;
  fontSha256?: string;
  rendererVersion?: string;
  rasterLimit?: number;
  maxCacheBytes?: number;
  resourcePoolOptions?: HostResourcePoolOptions;
}

const rasterFrameInFlight = new Map<string, Promise<{ png: Buffer; cacheHit: boolean; key: string }>>();
const cacheWriteCounts = new Map<string, number>();

/** Hashes the exact SVG bytes plus every renderer setting that can change raster pixels. */
export function rasterFrameCacheKey(svg: string, options: Omit<RasterFrameCacheOptions, 'cacheDir' | 'resourcePoolOptions'>): string {
  const renderSettings = {
    schemaVersion: 'resvg-frame-settings/v1',
    width: options.width,
    fitTo: { mode: 'width', value: options.width },
    loadSystemFonts: false,
    defaultFontFamily: 'Kalam',
    sansSerifFamily: 'Kalam',
    fontSha256: options.fontSha256 ?? KALAM_FONT_SHA256,
    rendererVersion: options.rendererVersion ?? VISUAL_STAGE_VERSIONS.render,
    resvgOptions: RESVG_FONT_OPTIONS,
  };
  return sha256(stableJson({ svgSha256: sha256(svg), renderSettings }));
}

/** Render (or reuse) an exact SVG frame from an integrity-checked, content-addressed PNG cache. */
export async function rasterizeCachedFrame(
  svg: string,
  options: RasterFrameCacheOptions,
  render: (svg: string, width: number) => Promise<Buffer> = async (source, width) => rasterizePng(source, width),
): Promise<{ png: Buffer; cacheHit: boolean; key: string }> {
  if (!Number.isInteger(options.width) || options.width < 1) throw new Error('Raster frame width must be a positive integer');
  const key = rasterFrameCacheKey(svg, options);
  const inFlightKey = `${options.cacheDir}\0${key}`;
  const inFlight = rasterFrameInFlight.get(inFlightKey);
  if (inFlight) {
    const result = await inFlight;
    return { ...result, cacheHit: true };
  }
  const operation = rasterizeCachedFrameExclusive(svg, key, options, render);
  rasterFrameInFlight.set(inFlightKey, operation);
  try { return await operation; }
  finally { if (rasterFrameInFlight.get(inFlightKey) === operation) rasterFrameInFlight.delete(inFlightKey); }
}

async function rasterizeCachedFrameExclusive(
  svg: string,
  key: string,
  options: RasterFrameCacheOptions,
  render: (svg: string, width: number) => Promise<Buffer>,
): Promise<{ png: Buffer; cacheHit: boolean; key: string }> {
  await mkdir(options.cacheDir, { recursive: true });
  const pngPath = join(options.cacheDir, `${key}.png`);
  const manifestPath = `${pngPath}.json`;
  try {
    const [png, manifestRaw] = await Promise.all([readFile(pngPath), readFile(manifestPath, 'utf8')]);
    const manifest = JSON.parse(manifestRaw) as { schemaVersion?: string; key?: string; contentHash?: string; bytes?: number };
    if (manifest.schemaVersion === 'hypothesis-raster-frame/v1' && manifest.key === key && manifest.bytes === png.length && manifest.contentHash === sha256(png) && png.subarray(0, 8).equals(pngSignature)) {
      return { png, cacheHit: true, key };
    }
  } catch { /* Missing or damaged entries are regenerated below. */ }

  const configuredLimit = Number(process.env.HYPOTHESIS_RASTER_CONCURRENCY);
  const rasterLimit = options.rasterLimit ?? (Number.isInteger(configuredLimit) && configuredLimit >= 1 ? Math.min(8, configuredLimit) : 2);
  if (!Number.isInteger(rasterLimit) || rasterLimit < 1 || rasterLimit > 8) throw new Error('Raster frame concurrency must be an integer from 1 to 8');
  const png = await withHostResourcePermit('raster-work', rasterLimit, () => render(svg, options.width), options.resourcePoolOptions);
  if (!png.subarray(0, 8).equals(pngSignature)) throw new Error('Raster renderer returned invalid PNG data');
  const nonce = `${process.pid}.${randomUUID()}`;
  const temporaryPng = `${pngPath}.${nonce}.partial`;
  const temporaryManifest = `${manifestPath}.${nonce}.partial`;
  try {
    await writeFile(temporaryPng, png);
    await rename(temporaryPng, pngPath);
    await writeFile(temporaryManifest, JSON.stringify({ schemaVersion: 'hypothesis-raster-frame/v1', key, contentHash: sha256(png), bytes: png.length }) + '\n', 'utf8');
    await rename(temporaryManifest, manifestPath);
  } finally {
    await Promise.all([rm(temporaryPng, { force: true }), rm(temporaryManifest, { force: true })]);
  }
  const count = (cacheWriteCounts.get(options.cacheDir) ?? 0) + 1;
  cacheWriteCounts.set(options.cacheDir, count);
  if (count % 64 === 0) await pruneRasterFrameCache(options.cacheDir, options.maxCacheBytes);
  return { png, cacheHit: false, key };
}

async function pruneRasterFrameCache(cacheDir: string, configuredLimit?: number): Promise<void> {
  const envLimit = Number(process.env.HYPOTHESIS_RASTER_CACHE_MAX_BYTES);
  const maxBytes = configuredLimit ?? (Number.isFinite(envLimit) && envLimit > 0 ? Math.min(envLimit, 20 * 1024 ** 3) : 256 * 1024 ** 2);
  const files = (await readdir(cacheDir)).filter((name) => name.endsWith('.png')).map((name) => join(cacheDir, name));
  const records = await Promise.all(files.map(async (file) => ({ file, bytes: await stat(file).then((info) => info.size, () => 0), mtimeMs: await stat(file).then((info) => info.mtimeMs, () => 0) })));
  let total = records.reduce((sum, record) => sum + record.bytes, 0);
  for (const record of records.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= maxBytes) break;
    await Promise.all([rm(record.file, { force: true }), rm(`${record.file}.json`, { force: true })]);
    total -= record.bytes;
  }
}

export { ERASE_MS, frameSvgAt, type VideoScene } from './frame.js';

/**
 * S10 export mode + S11 encode (claude_pipeline.md §16/§28): rasterize
 * `renderSVG(scene, timeline, t)` at `fps` via @resvg/resvg-js and pipe PNG
 * frames into ffmpeg (image2pipe), muxing in the real master WAV produced by
 * audioStitch.ts. `renderSVG` itself stays untouched and pure — this module
 * only calls it at successive timestamps and rasterizes each result.
 */
export async function encodeVideo(scenes: VideoScene[], totalDurationMs: number, audioWavPath: string, outPath: string, fps = 30, workerCount = Math.max(1, Math.min(4, availableParallelism() - 1)), frameCacheDir = join(dirname(outPath), '.raster-frame-cache')): Promise<{ frames: number; ffmpegArgs: string[] }> {
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
        pending.set(frame, rasterizeCachedFrame(svg, { cacheDir: frameCacheDir, width: STYLE.canvas.w }, (source, width) => pool.render(source, width)).then(({ png }) => ({ png }), (error: unknown) => ({ error })));
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
  frameCacheDir?: string,
): Promise<{ frames: number; ffmpegArgs: string[] }> {
  const partialPath = `${outPath}.${process.pid}.${randomUUID()}.partial.mp4`;
  try {
    const result = await encode(scenes, totalDurationMs, audioWavPath, partialPath, fps, workerCount, frameCacheDir);
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

/**
 * Contact-sheet rasterize isolated in a CHILD PROCESS.
 *
 * Worker threads share the host process, so a resvg native abort
 * (`failed to initiate panic`) kills the whole run: contact-sheet.svg
 * exists, .png absent, no summary written (one-shot `no-summary`), and the
 * try/catch in runLive.ts cannot catch it. A child process turns that abort
 * into a detectable exit code / signal, which surfaces here as an ordinary
 * catchable Error -> soft `contact-sheet-png-failed`, and the run continues
 * to summary/manifest/provenance writes. Contact-sheet-only; the frame
 * pipeline keeps its worker pool.
 *
 * The child is an inline ESM script (bare `@resvg/resvg-js` import resolves
 * from cwd; the absolute bundled font path travels as argv) reading SVG from
 * stdin and writing PNG to stdout, so arbitrarily large sheets never touch
 * argv/env limits.
 */
const CONTACT_SHEET_CHILD_SCRIPT = `import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const width = Number(process.argv[1]);
const fontFile = process.argv[2];
const svg = fs.readFileSync(0, 'utf8');
const png = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: [fontFile], defaultFontFamily: ${JSON.stringify(KALAM_FONT_FAMILY)}, sansSerifFamily: ${JSON.stringify(KALAM_FONT_FAMILY)} }, fitTo: { mode: 'width', value: width } }).render().asPng();
fs.writeFileSync(1, png);
`;

export type ContactSheetSpawner = (
  command: string,
  args: string[],
  options: { input: string; maxBuffer: number; timeout: number },
) => Pick<SpawnSyncReturns<Buffer>, 'status' | 'signal' | 'stdout' | 'stderr' | 'error'>;

export function rasterizeContactSheetPng(svg: string, width: number, spawn: ContactSheetSpawner = spawnSync): Buffer {
  if (!Number.isInteger(width) || width < 1) throw new Error('Contact-sheet raster width must be a positive integer');
  // No `encoding` option: stdout/stderr stay Buffers (binary-safe PNG on stdout).
  const child = spawn(process.execPath, ['--input-type=module', '-e', CONTACT_SHEET_CHILD_SCRIPT, String(width), KALAM_BOLD_FILE], {
    input: svg,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  if (child.error) throw new Error(`contact-sheet child raster failed to spawn: ${child.error instanceof Error ? child.error.message : String(child.error)}`);
  const stdout = child.stdout as Buffer | undefined;
  if (child.status !== 0 || !stdout || stdout.length === 0) {
    const stderr = Buffer.isBuffer(child.stderr) ? child.stderr.toString('utf8').slice(-500) : String(child.stderr ?? '');
    throw new Error(`contact-sheet child raster failed${child.signal ? ` (signal ${child.signal})` : ''}: exit ${String(child.status)}${stderr ? `: ${stderr}` : ''}`);
  }
  if (!stdout.subarray(0, 8).equals(pngSignature)) throw new Error('contact-sheet child raster returned invalid PNG data');
  return stdout;
}

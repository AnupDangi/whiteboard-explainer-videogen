import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AlignedAudio, LaidOutScene, Timeline } from '../types.js';
import type { VideoScene } from '../export/frame.js';
import type { EvaluationBundle } from '../../shared/contracts.js';

export interface BrowserPreviewPayload {
  schemaVersion: 'hypothesis-browser-preview/v1';
  status: EvaluationBundle['status'];
  runClass: EvaluationBundle['runClass'];
  durationMs: number;
  scenes: VideoScene[];
  alignedWords: AlignedAudio['sceneWords'][string];
  audioUrl?: string;
  captionsUrl?: string;
}

const ID = /^[a-zA-Z0-9_-]{1,100}$/;

/** Load renderer outputs only; do not accept source code, arbitrary SVG, or model-produced paths. */
export async function loadBrowserPreview(runDir: string): Promise<BrowserPreviewPayload> {
  const dir = path.resolve(runDir);
  const [manifestRaw, evaluationRaw, audioRaw, names] = await Promise.all([
    readFile(path.join(dir, 'run-manifest.json'), 'utf8'),
    readFile(path.join(dir, 'evaluation-bundle.json'), 'utf8'),
    readFile(path.join(dir, 'aligned-audio.json'), 'utf8'),
    readdir(dir),
  ]);
  const manifest = JSON.parse(manifestRaw) as { schemaVersion?: string; status?: EvaluationBundle['status']; runClass?: EvaluationBundle['runClass'] };
  const evaluation = JSON.parse(evaluationRaw) as EvaluationBundle;
  const audio = JSON.parse(audioRaw) as AlignedAudio;
  if (manifest.schemaVersion !== 'hypothesis-run/v1' || !['evaluation-bundle/v1', 'evaluation-bundle/v2'].includes(evaluation.schemaVersion)) throw new Error('Unsupported hypothesis run artifact version');
  if (!['draft', 'failed', 'passed'].includes(evaluation.status) || evaluation.status !== manifest.status || evaluation.runClass !== manifest.runClass) throw new Error('Run manifest and evaluation status do not agree');
  if (!Number.isFinite(audio.durationMs) || audio.durationMs <= 0 || !audio.sceneWords || typeof audio.sceneWords !== 'object') throw new Error('Aligned audio clock is invalid');

  const sceneIds = names.flatMap((name) => {
    const match = /^layout\.([a-zA-Z0-9_-]{1,100})\.json$/.exec(name);
    return match ? [match[1]] : [];
  });
  if (sceneIds.length === 0) throw new Error('No laid-out scenes found in run directory');
  const scenes = await Promise.all(sceneIds.map(async (sceneId): Promise<VideoScene> => {
    if (!ID.test(sceneId)) throw new Error(`Unsafe scene identifier: ${sceneId}`);
    const [layoutRaw, timelineRaw] = await Promise.all([
      readFile(path.join(dir, `layout.${sceneId}.json`), 'utf8'),
      readFile(path.join(dir, `timeline.${sceneId}.json`), 'utf8'),
    ]);
    const laidOut = JSON.parse(layoutRaw) as LaidOutScene;
    const timeline = JSON.parse(timelineRaw) as Timeline;
    if (laidOut.sceneId !== sceneId || timeline.sceneId !== sceneId || !Array.isArray(laidOut.elements) || !Array.isArray(timeline.events)) throw new Error(`Malformed scene artifacts for ${sceneId}`);
    if (!Number.isFinite(timeline.sceneStartMs) || !Number.isFinite(timeline.sceneEndMs) || timeline.sceneEndMs <= timeline.sceneStartMs) throw new Error(`Invalid timeline bounds for ${sceneId}`);
    return { laidOut, timeline, startMs: timeline.sceneStartMs, endMs: timeline.sceneEndMs };
  }));
  scenes.sort((a, b) => a.startMs - b.startMs);
  const audioUrl = await stat(path.join(dir, 'audio.wav')).then(() => '/audio.wav', () => undefined);
  const captionsUrl = await stat(path.join(dir, 'captions.vtt')).then(() => '/captions.vtt', () => undefined);
  const alignedWords = Object.values(audio.sceneWords).flat().sort((a, b) => a.startMs - b.startMs);
  return {
    schemaVersion: 'hypothesis-browser-preview/v1',
    status: evaluation.status,
    runClass: evaluation.runClass,
    durationMs: audio.durationMs,
    scenes,
    alignedWords,
    ...(audioUrl ? { audioUrl } : {}),
    ...(captionsUrl ? { captionsUrl } : {}),
  };
}

function send(res: import('node:http').ServerResponse, code: number, type: string, body: string | Buffer): void {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'" });
  res.end(body);
}

export async function createBrowserPreviewServer(runDir: string, repoRoot = process.cwd()): Promise<Server> {
  const payload = await loadBrowserPreview(runDir);
  const htmlPath = path.resolve(repoRoot, 'src/experimental/hypothesis/v1_claude/player/index.html');
  const html = await readFile(htmlPath);
  const runPath = path.resolve(runDir);
  const distRoot = path.resolve(repoRoot, 'dist');
  const fontPath = path.resolve(repoRoot, 'src/experimental/hypothesis/v1_claude/assets/fonts/Kalam-Bold.ttf');
  return createServer(createBrowserPreviewHandler(payload, runPath, distRoot, html, fontPath));
}

/** Request handler is exported separately so route/security behavior can be tested without opening a socket. */
export function createBrowserPreviewHandler(payload: BrowserPreviewPayload, runPath: string, distRoot: string, html: Buffer, fontPath = path.resolve(process.cwd(), 'src/experimental/hypothesis/v1_claude/assets/fonts/Kalam-Bold.ttf')) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
      if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', html);
      if (url.pathname === '/run.json') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(payload));
      if (url.pathname === '/fonts/Kalam-Bold.ttf') return send(res, 200, 'font/ttf', await readFile(fontPath));
      if (url.pathname === '/audio.wav' || url.pathname === '/captions.vtt') {
        const file = path.join(runPath, url.pathname.slice(1));
        if (!await stat(file).then(() => true, () => false)) return send(res, 404, 'text/plain; charset=utf-8', 'Artifact not found');
        return send(res, 200, url.pathname.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : 'audio/wav', await readFile(file));
      }
      if (url.pathname.startsWith('/dist/')) {
        const relative = decodeURIComponent(url.pathname.slice('/dist/'.length));
        if (!relative.startsWith('src/experimental/hypothesis/v1_claude/') && !relative.startsWith('src/experimental/hypothesis/shared/')) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        const file = path.resolve(distRoot, relative);
        const allowedRoots = [
          path.resolve(distRoot, 'src/experimental/hypothesis/v1_claude'),
          path.resolve(distRoot, 'src/experimental/hypothesis/shared'),
        ];
        if (!allowedRoots.some((root) => file.startsWith(root + path.sep))) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        return send(res, 200, 'text/javascript; charset=utf-8', await readFile(file));
      }
      return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    } catch (error) {
      send(res, 500, 'text/plain; charset=utf-8', error instanceof Error ? error.message : String(error));
    }
  };
}

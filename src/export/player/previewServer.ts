import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AlignedAudio, LaidOutScene, Timeline } from '../../shared/types.js';
import type { VideoScene } from '../frame.js';
import type { EvaluationBundle } from '../../shared/contracts.js';
import { LESSON_LOCK_V2_VERSION, readRef, readyPrefixV2, verifiedInputs, type LessonLockV2 } from '../../pipeline-v2/lockV2.js';
import { joinPaddedScenes } from './wavPrefix.js';
import { KALAM_BOLD_FILE } from '../../render/fonts.js';
import { FIRST_AUDIO_PLAYBACK_VERSION, isFirstAudioPlaybackEvent, type InitialPlaybackIdentity, type PlaybackTelemetrySession } from './playbackTelemetry.js';

export interface LockedV2Preview {
  fps: number;
  frames: number;
  renderPlan: LessonLockV2['renderPlan'];
  audioUrl: string;
  /** Set while later scenes are still being planned: frames and audio cover only the verified ready prefix. */
  live?: true;
}

/** The verified, still-growing prefix of a V2 run that has no final lock yet. */
async function loadLivePrefix(dir: string, requestAcceptedAtEpochMs?: number): Promise<BrowserPreviewPayload | undefined> {
  const ready = await readyPrefixV2(dir);
  if (!ready.scenes.length) return undefined;
  const fps = ready.scenes[0]!.fps;
  const frames = ready.scenes.reduce((sum, scene) => sum + scene.frames, 0);
  const alignmentRaw = await readFile(path.join(dir, 'v2', 'alignment.json'), 'utf8').catch(() => undefined);
  const alignment = alignmentRaw ? JSON.parse(alignmentRaw) as { scenes?: Array<{ sceneId: string; words: Array<{ word: string; startMs: number; endMs: number }> }> } : undefined;
  const starts = new Map(ready.scenes.map((scene) => [scene.sceneId, scene.startMs]));
  const alignedWords = (alignment?.scenes ?? []).flatMap((scene) => starts.has(scene.sceneId) ? scene.words.map((word) => ({ w: word.word, startMs: starts.get(scene.sceneId)! + word.startMs, endMs: starts.get(scene.sceneId)! + word.endMs })) : []);
  return {
    schemaVersion: 'hypothesis-browser-preview/v1', status: 'draft', runClass: 'generated-lesson', durationMs: ready.readyThroughMs,
    scenes: [], alignedWords, events: [], sceneAudio: [], streaming: true, eventUrl: '/scene-events.jsonl',
    ...(requestAcceptedAtEpochMs !== undefined ? { requestAcceptedAtEpochMs } : {}),
    lockedV2: { fps, frames, renderPlan: ready.scenes.flatMap((scene) => scene.renderPlan), audioUrl: `/locked/prefix.wav?through=${ready.readyThroughMs}`, live: true },
  };
}

/** The lock itself is the only source of frame and audio locations. */
export function lockedFrameHashAt(lock: Pick<LessonLockV2, 'render' | 'renderPlan'>, timeMs: number): string {
  const frame = Math.max(0, Math.min(lock.render.frames - 1, Math.floor(Math.max(0, timeMs) * lock.render.fps / 1000)));
  const segment = lock.renderPlan.find((item) => item.firstFrame <= frame && frame < item.firstFrame + item.frameCount);
  if (!segment) throw new Error(`Locked frame ${frame} has no render segment`);
  return segment.kind === 'hold' ? segment.svgHash : segment.svgHashes[frame - segment.firstFrame]!;
}

export interface BrowserPreviewPayload {
  schemaVersion: 'hypothesis-browser-preview/v1';
  status: EvaluationBundle['status'];
  runClass: EvaluationBundle['runClass'];
  durationMs: number;
  scenes: VideoScene[];
  alignedWords: AlignedAudio['sceneWords'][string];
  events: ScenePlayableEvent[];
  sceneAudio: SceneAudioReference[];
  streaming: boolean;
  eventUrl: string;
  audioUrl?: string;
  captionsUrl?: string;
  lockedV2?: LockedV2Preview;
  telemetry?: PlaybackTelemetrySession;
  requestAcceptedAtEpochMs?: number;
}

export interface SceneAudioReference {
  sceneId: string;
  path: string;
  contentHash: string;
  startMs: number;
  endMs: number;
}

export interface ScenePlayableEvent {
  type: 'scene.playable';
  schemaVersion: 'hypothesis-scene-event/v1';
  runId: string;
  moduleId: string;
  sceneId: string;
  sequence: number;
  durationMs: number;
  artifactHash: string;
  previewLocation: string;
}

const ID = /^[a-zA-Z0-9_-]{1,100}$/;

function isSafeRunRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

async function readSceneEvents(dir: string): Promise<ScenePlayableEvent[]> {
  const raw = await readFile(path.join(dir, 'scene-events.jsonl'), 'utf8').catch(() => '');
  const events: ScenePlayableEvent[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event: ScenePlayableEvent;
    try { event = JSON.parse(line) as ScenePlayableEvent; }
    catch { throw new Error(`Malformed scene event on line ${index + 1}`); }
    if (event.type !== 'scene.playable' || event.schemaVersion !== 'hypothesis-scene-event/v1' || !ID.test(event.runId) || !ID.test(event.moduleId) || !ID.test(event.sceneId) || !Number.isSafeInteger(event.sequence) || event.sequence !== events.length || !Number.isFinite(event.durationMs) || event.durationMs <= 0 || !/^[a-f0-9]{64}$/i.test(event.artifactHash) || !isSafeRunRelativePath(event.previewLocation)) {
      throw new Error(`Invalid scene event on line ${index + 1}`);
    }
    events.push(event);
  }
  return events;
}

/** Load renderer outputs only; do not accept source code, arbitrary SVG, or model-produced paths. */
export async function loadBrowserPreview(runDir: string): Promise<BrowserPreviewPayload> {
  const dir = path.resolve(runDir);
  const runStartRaw = await readFile(path.join(dir, 'run-start.json'), 'utf8').catch(() => undefined);
  const runStart = runStartRaw ? JSON.parse(runStartRaw) as { schemaVersion?: string; runId?: string; acceptedAtEpochMs?: number } : undefined;
  if (runStart && (runStart.schemaVersion !== 'hypothesis-run-start/v1' || runStart.runId !== path.basename(dir) || !Number.isFinite(runStart.acceptedAtEpochMs) || runStart.acceptedAtEpochMs! < 0)) throw new Error('Run acceptance record is invalid or belongs to another run');
  const requestAcceptedAtEpochMs = runStart?.acceptedAtEpochMs;
  const primary = await readFile(path.join(dir, 'lesson.lock.json'), 'utf8').catch(() => undefined);
  if (primary) {
    let candidate: { schemaVersion?: string };
    try { candidate = JSON.parse(primary) as { schemaVersion?: string }; }
    catch { throw new Error('Lesson lock JSON is invalid'); }
    if (candidate.schemaVersion === LESSON_LOCK_V2_VERSION) {
      const { lock, alignment } = await verifiedInputs(dir);
      const evaluationRaw = await readFile(path.join(dir, 'evaluation-bundle.json'), 'utf8').catch(() => undefined);
      const evaluation = evaluationRaw ? JSON.parse(evaluationRaw) as EvaluationBundle : undefined;
      const alignmentRecord = JSON.parse(alignment.toString('utf8')) as { scenes: Array<{ sceneId: string; words: Array<{ word: string; startMs: number; endMs: number }> }> };
      const starts = new Map(lock.scenes.map((scene) => [scene.sceneId, scene.startMs]));
      const alignedWords = alignmentRecord.scenes.flatMap((scene) => scene.words.map((word) => ({ w: word.word, startMs: (starts.get(scene.sceneId) ?? 0) + word.startMs, endMs: (starts.get(scene.sceneId) ?? 0) + word.endMs })));
      return {
        schemaVersion: 'hypothesis-browser-preview/v1', status: evaluation?.status ?? 'draft', runClass: evaluation?.runClass ?? 'generated-lesson',
        durationMs: lock.render.durationMs, scenes: [], alignedWords, events: [], sceneAudio: [], streaming: false, eventUrl: '/scene-events.jsonl',
        ...(requestAcceptedAtEpochMs !== undefined ? { requestAcceptedAtEpochMs } : {}),
        lockedV2: { fps: lock.render.fps, frames: lock.render.frames, renderPlan: lock.renderPlan, audioUrl: '/locked/audio.wav' },
      };
    }
  }
  if (!primary) {
    const live = await loadLivePrefix(dir, requestAcceptedAtEpochMs);
    if (live) return live;
  }
  const [manifestRaw, evaluationRaw, audioRaw, names, events] = await Promise.all([
    readFile(path.join(dir, 'run-manifest.json'), 'utf8').catch(() => undefined),
    readFile(path.join(dir, 'evaluation-bundle.json'), 'utf8').catch(() => undefined),
    readFile(path.join(dir, 'aligned-audio.json'), 'utf8').catch(() => undefined),
    readdir(dir),
    readSceneEvents(dir),
  ]);
  const eventStreamPresent = await stat(path.join(dir, 'scene-events.jsonl')).then(() => true, () => false);
  const manifest = manifestRaw ? JSON.parse(manifestRaw) as { schemaVersion?: string; status?: EvaluationBundle['status']; runClass?: EvaluationBundle['runClass'] } : undefined;
  const evaluation = evaluationRaw ? JSON.parse(evaluationRaw) as EvaluationBundle : undefined;
  const audio = audioRaw ? JSON.parse(audioRaw) as AlignedAudio : undefined;
  if (manifest && manifest.schemaVersion !== 'hypothesis-run/v1') throw new Error('Unsupported run manifest artifact version');
  if (evaluation && !['evaluation-bundle/v1', 'evaluation-bundle/v2'].includes(evaluation.schemaVersion)) throw new Error('Unsupported evaluation bundle artifact version');
  if (manifest && evaluation && (!['draft', 'failed', 'passed'].includes(evaluation.status) || evaluation.status !== manifest.status || evaluation.runClass !== manifest.runClass)) throw new Error('Run manifest and evaluation status do not agree');
  if (audio && (!Number.isFinite(audio.durationMs) || audio.durationMs <= 0 || !audio.sceneWords || typeof audio.sceneWords !== 'object')) throw new Error('Aligned audio clock is invalid');

  const sceneIds = names.flatMap((name) => {
    const match = /^layout\.([a-zA-Z0-9_-]{1,100})\.json$/.exec(name);
    return match ? [match[1]] : [];
  });
  if (sceneIds.length === 0 && events.length === 0 && !eventStreamPresent) throw new Error('No laid-out scenes or playable scene event stream found in run directory');
  const staticScenes = await Promise.all(sceneIds.map(async (sceneId): Promise<VideoScene> => {
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
  const eventScenes = await Promise.all(events.map(async (event): Promise<VideoScene> => {
    const filePath = path.resolve(dir, event.previewLocation);
    if (!filePath.startsWith(dir + path.sep)) throw new Error(`Scene event path escapes the run directory: ${event.previewLocation}`);
    const [actualPath, rawBytes] = await Promise.all([realpath(filePath), readFile(filePath)]);
    if (!actualPath.startsWith(`${await realpath(dir)}${path.sep}`)) throw new Error(`Scene event path resolves outside the run directory: ${event.previewLocation}`);
    if (createHash('sha256').update(rawBytes).digest('hex') !== event.artifactHash.toLowerCase()) throw new Error(`Scene preview descriptor hash does not match event ${event.sceneId}`);
    const descriptor = JSON.parse(rawBytes.toString('utf8')) as { schemaVersion?: string; runId?: string; moduleId?: string; sceneId?: string; sequence?: number; durationMs?: number; laidOut?: LaidOutScene; timeline?: Timeline; audio?: { startMs?: number; endMs?: number; scenePath?: string; sceneContentHash?: string }; alignment?: { words?: AlignedAudio['sceneWords'][string] } };
    const sceneAudio = descriptor.audio;
    if (descriptor.schemaVersion !== 'hypothesis-scene-preview/v1' || descriptor.runId !== event.runId || descriptor.moduleId !== event.moduleId || descriptor.sceneId !== event.sceneId || descriptor.sequence !== event.sequence || descriptor.durationMs !== event.durationMs || descriptor.laidOut?.sceneId !== event.sceneId || descriptor.timeline?.sceneId !== event.sceneId || !sceneAudio || !Number.isFinite(sceneAudio.startMs) || !Number.isFinite(sceneAudio.endMs) || !sceneAudio.scenePath || !isSafeRunRelativePath(sceneAudio.scenePath) || !/^[a-f0-9]{64}$/i.test(sceneAudio.sceneContentHash ?? '')) throw new Error(`Scene preview descriptor does not match event ${event.sceneId}`);
    const startMs = sceneAudio.startMs!;
    const endMs = sceneAudio.endMs!;
    if (endMs <= startMs) throw new Error(`Scene event has invalid audio bounds: ${event.sceneId}`);
    const audioPath = path.resolve(dir, sceneAudio.scenePath!);
    if (!audioPath.startsWith(dir + path.sep)) throw new Error(`Scene audio path escapes the run directory: ${event.sceneId}`);
    const [actualAudioPath, audioBytes] = await Promise.all([realpath(audioPath), readFile(audioPath)]);
    if (!actualAudioPath.startsWith(`${await realpath(dir)}${path.sep}`) || createHash('sha256').update(audioBytes).digest('hex') !== sceneAudio.sceneContentHash!.toLowerCase()) throw new Error(`Scene audio artifact is missing or has an invalid hash: ${event.sceneId}`);
    return { laidOut: descriptor.laidOut!, timeline: descriptor.timeline!, startMs, endMs };
  }));
  const scenesById = new Map<string, VideoScene>();
  for (const scene of staticScenes) scenesById.set(scene.laidOut.sceneId, scene);
  for (const scene of eventScenes) scenesById.set(scene.laidOut.sceneId, scene);
  const scenes = [...scenesById.values()].sort((a, b) => a.startMs - b.startMs);
  const audioUrl = manifest ? await stat(path.join(dir, 'audio.wav')).then(() => '/audio.wav', () => undefined) : undefined;
  const captionsUrl = await stat(path.join(dir, 'captions.vtt')).then(() => '/captions.vtt', () => undefined);
  const alignedWords = audio ? Object.values(audio.sceneWords).flat().sort((a, b) => a.startMs - b.startMs) : [];
  const sceneAudio = await Promise.all(events.map(async (event): Promise<SceneAudioReference> => {
    const descriptor = JSON.parse(await readFile(path.join(dir, event.previewLocation), 'utf8')) as { audio: { scenePath: string; sceneContentHash: string; startMs: number; endMs: number } };
    return { sceneId: event.sceneId, path: descriptor.audio.scenePath, contentHash: descriptor.audio.sceneContentHash, startMs: descriptor.audio.startMs, endMs: descriptor.audio.endMs };
  }));
  if (!alignedWords.length && events.length) {
    for (const event of events) {
      const descriptor = JSON.parse(await readFile(path.join(dir, event.previewLocation), 'utf8')) as { audio: { startMs: number }; alignment?: { words?: AlignedAudio['sceneWords'][string] } };
      for (const word of descriptor.alignment?.words ?? []) alignedWords.push({ ...word, startMs: word.startMs + descriptor.audio.startMs, endMs: word.endMs + descriptor.audio.startMs });
    }
    alignedWords.sort((a, b) => a.startMs - b.startMs);
  }
  const status = evaluation?.status ?? manifest?.status ?? 'draft';
  const runClass = evaluation?.runClass ?? manifest?.runClass ?? 'generated-lesson';
  const durationMs = audio?.durationMs ?? Math.max(0, ...scenes.map((scene) => scene.endMs));
  return {
    schemaVersion: 'hypothesis-browser-preview/v1',
    status,
    runClass,
    durationMs,
    scenes,
    alignedWords,
    events,
    sceneAudio,
    streaming: !manifest,
    eventUrl: '/scene-events.jsonl',
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
  const htmlPath = path.resolve(repoRoot, 'src/export/player/index.html');
  const html = await readFile(htmlPath);
  const runPath = path.resolve(runDir);
  const distRoot = path.resolve(repoRoot, 'dist');
  const fontPath = KALAM_BOLD_FILE;
  return createServer(createBrowserPreviewHandler(payload, runPath, distRoot, html, fontPath, () => loadBrowserPreview(runPath)));
}

/** Start the preview as soon as the run has something verified to play (the first scene lock), waiting up to `timeoutMs`. */
export async function createBrowserPreviewServerWhenReady(runDir: string, options: { timeoutMs: number; pollMs?: number }, repoRoot = process.cwd()): Promise<Server> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    try { return await createBrowserPreviewServer(runDir, repoRoot); }
    catch (error) {
      if (!/No laid-out scenes|playable scene event|ENOENT/.test(error instanceof Error ? error.message : String(error)) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 500));
    }
  }
}

/** Request handler is exported separately so route/security behavior can be tested without opening a socket. */
export function createBrowserPreviewHandler(payload: BrowserPreviewPayload, runPath: string, distRoot: string, html: Buffer, fontPath = KALAM_BOLD_FILE, refresh?: () => Promise<BrowserPreviewPayload>) {
  // Verifying the whole ready prefix re-reads every pinned file; do it at most a few times a second, not once per frame request.
  // Every served file is still hash-checked when read, so a stale prefix can never serve changed bytes.
  let cachedPrefix: { at: number; value: Promise<Awaited<ReturnType<typeof readyPrefixV2>>> } | undefined;
  const freshPrefix = (): Promise<Awaited<ReturnType<typeof readyPrefixV2>>> => {
    if (!cachedPrefix || Date.now() - cachedPrefix.at > 250) cachedPrefix = { at: Date.now(), value: readyPrefixV2(runPath) };
    return cachedPrefix.value;
  };
  const sessions = new Map<string, PlaybackTelemetrySession>();
  const acceptedEvents = new Map<string, { bytes: string; append: Promise<void> }>();
  const runId = path.basename(runPath);
  const currentInitial = async (view: BrowserPreviewPayload): Promise<InitialPlaybackIdentity | undefined> => {
    if (!view.lockedV2 || !ID.test(runId)) return undefined;
    if (view.lockedV2.live) {
      const first = (await freshPrefix()).scenes[0];
      if (!first) return undefined;
      const segment = first.renderPlan.find((item) => item.firstFrame === 0);
      const frameHash = segment?.kind === 'hold' ? segment.svgHash : segment?.svgHashes[0];
      return frameHash ? { sceneId: first.sceneId, frame: 0, frameHash, sceneAudioHash: first.audio.hash } : undefined;
    }
    const { lock } = await verifiedInputs(runPath);
    const first = lock.scenes[0];
    return first ? { sceneId: first.sceneId, frame: 0, frameHash: lockedFrameHashAt(lock, 0), sceneAudioHash: first.audioHash } : undefined;
  };
  const telemetrySession = async (view: BrowserPreviewPayload, existingId: string | null): Promise<PlaybackTelemetrySession | undefined> => {
    const existing = existingId ? sessions.get(existingId) : undefined;
    if (existing) return existing;
    const initial = await currentInitial(view);
    if (!initial) return undefined;
    const session: PlaybackTelemetrySession = {
      schemaVersion: FIRST_AUDIO_PLAYBACK_VERSION,
      runId,
      sessionId: randomUUID(),
      eventUrl: '/telemetry/first-audio-playback',
      ...(view.requestAcceptedAtEpochMs !== undefined ? { requestAcceptedAtEpochMs: view.requestAcceptedAtEpochMs } : {}),
      issuedAudioUrl: view.lockedV2!.audioUrl,
      initial,
    };
    sessions.set(session.sessionId, session);
    return session;
  };
  const appendTelemetry = async (bytes: string): Promise<void> => {
    const handle = await open(path.join(runPath, 'player-telemetry.jsonl'), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${bytes}\n`); }
    finally { await handle.close(); }
  };
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/telemetry/first-audio-playback') {
        if (req.method !== 'POST' || !payload.lockedV2) return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
        if (!String(req.headers?.['content-type'] ?? '').startsWith('application/json')) return send(res, 415, 'text/plain; charset=utf-8', 'JSON required');
        const origin = req.headers?.origin;
        if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, 'text/plain; charset=utf-8', 'Origin mismatch');
        let raw = '';
        for await (const chunk of req) {
          raw += Buffer.from(chunk).toString('utf8');
          if (raw.length > 8192) return send(res, 413, 'text/plain; charset=utf-8', 'Event too large');
        }
        let event: unknown;
        try { event = JSON.parse(raw); } catch { return send(res, 400, 'text/plain; charset=utf-8', 'Invalid JSON'); }
        if (!isFirstAudioPlaybackEvent(event)) return send(res, 422, 'text/plain; charset=utf-8', 'Invalid playback event');
        const session = sessions.get(event.sessionId);
        if (!session || event.runId !== runId || event.runId !== session.runId) return send(res, 403, 'text/plain; charset=utf-8', 'Unknown run or session');
        if (event.requestAcceptedAtEpochMs !== (session.requestAcceptedAtEpochMs ?? null)) return send(res, 422, 'text/plain; charset=utf-8', 'Request acceptance epoch does not match the run');
        if (JSON.stringify(event.initial) !== JSON.stringify(session.initial)) return send(res, 422, 'text/plain; charset=utf-8', 'Initial media identity mismatch');
        const current = refresh ? await refresh() : payload;
        const now = await currentInitial(current);
        if (!now || now.sceneId !== session.initial.sceneId || now.frameHash !== session.initial.frameHash || now.sceneAudioHash !== session.initial.sceneAudioHash) return send(res, 409, 'text/plain; charset=utf-8', 'Initial media is no longer verified');
        if (event.audioUrl !== current.lockedV2?.audioUrl && event.audioUrl !== session.issuedAudioUrl) return send(res, 422, 'text/plain; charset=utf-8', 'Audio URL does not match verified preview');
        const segments = current.lockedV2?.live ? (await freshPrefix()).scenes[0]?.renderPlan : (await verifiedInputs(runPath)).lock.renderPlan;
        const segment = segments?.find((item) => item.firstFrame <= event.observedFrame && event.observedFrame < item.firstFrame + item.frameCount);
        const observedHash = segment?.kind === 'hold' ? segment.svgHash : segment?.svgHashes[event.observedFrame - (segment?.firstFrame ?? 0)];
        if (segment?.sceneId !== session.initial.sceneId || observedHash !== event.observedFrameHash) return send(res, 422, 'text/plain; charset=utf-8', 'Observed frame is not in the verified first scene');
        const bytes = JSON.stringify(event);
        const prior = acceptedEvents.get(event.eventId);
        if (prior) {
          if (prior.bytes !== bytes) return send(res, 409, 'text/plain; charset=utf-8', 'Conflicting playback event');
          await prior.append;
          return send(res, 200, 'application/json; charset=utf-8', '{"accepted":true,"duplicate":true}');
        }
        const append = appendTelemetry(bytes);
        acceptedEvents.set(event.eventId, { bytes, append });
        try { await append; }
        catch (error) { acceptedEvents.delete(event.eventId); throw error; }
        return send(res, 201, 'application/json; charset=utf-8', '{"accepted":true,"duplicate":false}');
      }
      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
      if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', html);
      if (url.pathname === '/run.json') {
        const view = refresh ? await refresh() : payload;
        const telemetry = await telemetrySession(view, url.searchParams.get('session'));
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ...view, ...(telemetry ? { telemetry } : {}) }));
      }
      if (url.pathname.startsWith('/locked/') && payload.lockedV2?.live) {
        // Live session: every request re-verifies the ready prefix; nothing outside it is ever served.
        const ready = await freshPrefix();
        if (url.pathname === '/locked/prefix.wav') {
          const through = Number(url.searchParams.get('through'));
          const scenes = ready.scenes.filter((scene) => scene.endMs <= through);
          if (!Number.isFinite(through) || !scenes.length || scenes.at(-1)!.endMs !== through) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
          const wavs = await Promise.all(scenes.map(async (scene) => ({ wav: await readRef(runPath, scene.audio), placementMs: scene.endMs - scene.startMs })));
          return send(res, 200, 'audio/wav', joinPaddedScenes(wavs));
        }
        const live = /^\/locked\/svg\/([a-f0-9]{64})\.svg$/.exec(url.pathname)?.[1];
        const asset = live ? ready.scenes.flatMap((scene) => scene.svgAssets).find((item) => item.hash === live) : undefined;
        return asset ? send(res, 200, 'image/svg+xml; charset=utf-8', await readRef(runPath, asset)) : send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      }
      if (url.pathname.startsWith('/locked/')) {
        if (!payload.lockedV2) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        // Inspect again for every request; use only the buffers returned by verification.
        const { lock, svgs, audio } = await verifiedInputs(runPath);
        if (url.pathname === '/locked/audio.wav') return send(res, 200, 'audio/wav', audio[0]!);
        const match = /^\/locked\/svg\/([a-f0-9]{64})\.svg$/.exec(url.pathname);
        const hash = match?.[1];
        if (!hash || !lock.renderPlan.some((segment) => segment.kind === 'hold' ? segment.svgHash === hash : segment.svgHashes.includes(hash))) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        const svg = svgs.get(hash);
        return svg ? send(res, 200, 'image/svg+xml; charset=utf-8', svg) : send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      }
      if (url.pathname === '/scene-events.jsonl') return send(res, 200, 'application/x-ndjson; charset=utf-8', await readFile(path.join(runPath, 'scene-events.jsonl'), 'utf8').catch(() => ''));
      if (url.pathname.startsWith('/artifact/')) {
        const relative = decodeURIComponent(url.pathname.slice('/artifact/'.length));
        if (!isSafeRunRelativePath(relative)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        const file = path.resolve(runPath, relative);
        if (!file.startsWith(path.resolve(runPath) + path.sep)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        const [actualPath, rootPath] = await Promise.all([realpath(file), realpath(runPath)]);
        if (!actualPath.startsWith(`${rootPath}${path.sep}`)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        const content = await readFile(actualPath);
        const events = await readSceneEvents(runPath);
        let expectedHash: string | undefined;
        for (const event of events) {
          if (event.previewLocation === relative) {
            expectedHash = event.artifactHash;
            break;
          }
          const descriptorPath = path.resolve(runPath, event.previewLocation);
          const descriptorBytes = await readFile(descriptorPath).catch(() => undefined);
          if (!descriptorBytes || createHash('sha256').update(descriptorBytes).digest('hex') !== event.artifactHash.toLowerCase()) continue;
          const descriptor = JSON.parse(descriptorBytes.toString('utf8')) as { audio?: { scenePath?: string; sceneContentHash?: string } };
          if (descriptor.audio?.scenePath === relative) {
            expectedHash = descriptor.audio.sceneContentHash;
            break;
          }
        }
        if (!expectedHash || createHash('sha256').update(content).digest('hex') !== expectedHash.toLowerCase()) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        return send(res, 200, relative.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream', content);
      }
      if (url.pathname === '/fonts/Kalam-Bold.ttf') return send(res, 200, 'font/ttf', await readFile(fontPath));
      if (url.pathname === '/audio.wav' || url.pathname === '/captions.vtt') {
        const file = path.join(runPath, url.pathname.slice(1));
        if (!await stat(file).then(() => true, () => false)) return send(res, 404, 'text/plain; charset=utf-8', 'Artifact not found');
        return send(res, 200, url.pathname.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : 'audio/wav', await readFile(file));
      }
      if (url.pathname.startsWith('/dist/')) {
        const relative = decodeURIComponent(url.pathname.slice('/dist/'.length));
        if (!relative.startsWith('src/')) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        const file = path.resolve(distRoot, relative);
        if (!file.startsWith(distRoot + path.sep)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        if (!await stat(file).then((st) => st.isFile(), () => false)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        return send(res, 200, 'text/javascript; charset=utf-8', await readFile(file));
      }
      return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    } catch (error) {
      send(res, 500, 'text/plain; charset=utf-8', error instanceof Error ? error.message : String(error));
    }
  };
}

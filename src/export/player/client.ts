import type { VideoScene } from '../frame.js';
import { clampSeekToReadyPrefix, readyFramePrefixLength, readyPrefixEndMs, shouldAdoptLockedUpdate } from './readiness.js';

interface PreviewRun {
  schemaVersion: 'hypothesis-browser-preview/v1';
  status: 'draft' | 'failed' | 'passed';
  runClass: string;
  durationMs: number;
  scenes: VideoScene[];
  alignedWords: Array<{ w: string; startMs: number; endMs: number }>;
  events: ScenePlayableEvent[];
  sceneAudio: SceneAudioReference[];
  streaming: boolean;
  eventUrl: string;
  audioUrl?: string;
  captionsUrl?: string;
  lockedV2?: { fps: number; frames: number; renderPlan: Array<{ kind: 'hold' | 'transition'; firstFrame: number; frameCount: number; svgHash?: string; svgHashes?: string[] }>; audioUrl: string; live?: true };
}

interface SceneAudioReference { sceneId: string; path: string; contentHash: string; startMs: number; endMs: number }

interface ScenePlayableEvent {
  type: 'scene.playable'; schemaVersion: 'hypothesis-scene-event/v1'; runId: string; moduleId: string; sceneId: string;
  sequence: number; durationMs: number; artifactHash: string; previewLocation: string;
}

interface ScenePreviewDescriptor {
  schemaVersion: 'hypothesis-scene-preview/v1'; runId: string; moduleId: string; sceneId: string; sequence: number;
  durationMs: number; laidOut: VideoScene['laidOut']; timeline: VideoScene['timeline']; audio: { startMs: number; endMs: number; scenePath: string; sceneContentHash: string };
}

const $ = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing player UI element: ${id}`);
  return node as T;
};

const board = $<HTMLDivElement>('board');
const message = $<HTMLParagraphElement>('message');
const playButton = $<HTMLButtonElement>('play');
const seek = $<HTMLInputElement>('seek');
const clock = $<HTMLOutputElement>('clock');
const speed = $<HTMLSelectElement>('speed');
const audio = $<HTMLAudioElement>('audio');
const caption = $<HTMLParagraphElement>('caption');
const fmt = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

let run: PreviewRun | undefined;
let timeMs = 0;
let playing = false;
let lastTick = 0;
let raf = 0;
let durationMs = 0;
let lastEventSequence = 0;
let activeProgressiveAudio: SceneAudioReference | undefined;
const lockedSvgCache = new Map<string, string>();
const lockedFrameHashes: string[] = [];
const lockedFrameLoads = new Map<number, Promise<void>>();
let lockedFailure: string | undefined;
let requestedHash: string | undefined;

function lockedHashAt(t: number): string {
  const locked = run?.lockedV2;
  if (!locked) throw new Error('No locked V2 frame plan');
  const frame = Math.max(0, Math.min(locked.frames - 1, Math.floor(Math.max(0, t) * locked.fps / 1000)));
  const segment = locked.renderPlan.find((item) => item.firstFrame <= frame && frame < item.firstFrame + item.frameCount);
  const hash = segment?.kind === 'hold' ? segment.svgHash : segment?.svgHashes?.[frame - (segment?.firstFrame ?? 0)];
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Locked frame ${frame} is unavailable`);
  return hash;
}

function lockedFrameAt(t: number): number {
  const locked = run?.lockedV2;
  if (!locked) return 0;
  return Math.max(0, Math.min(locked.frames - 1, Math.floor(Math.max(0, t) * locked.fps / 1000)));
}

function readyLockedFrames(): number {
  return readyFramePrefixLength(lockedFrameHashes.length, (frame) => lockedSvgCache.has(lockedFrameHashes[frame]!));
}

function updateLockedSeekRange(): void {
  if (!run?.lockedV2) return;
  const frames = readyLockedFrames();
  seek.max = String(readyPrefixEndMs(frames, run.lockedV2.fps, durationMs));
  seek.disabled = frames === 0;
}

function failLockedPlayback(reason: string): void {
  if (lockedFailure) return;
  lockedFailure = reason;
  message.textContent = `Playback failed: ${reason}`;
  message.dataset.state = 'failed';
  playButton.disabled = true;
  seek.disabled = true;
  if (!audio.paused) audio.pause();
  setPlaying(false);
}

function requestLockedFrame(frame: number): Promise<void> {
  const hash = lockedFrameHashes[frame];
  if (!hash) return Promise.reject(new Error(`Locked frame ${frame} is unavailable`));
  if (lockedSvgCache.has(hash)) return Promise.resolve();
  const existing = lockedFrameLoads.get(frame);
  if (existing) return existing;
  const loaded = fetch(`/locked/svg/${hash}.svg`, { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error(`Verified frame ${frame} request failed (${response.status})`);
    const bytes = await response.arrayBuffer();
    const svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!svg.startsWith('<svg')) throw new Error(`Verified frame ${frame} content is invalid`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const actualHash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actualHash !== hash) throw new Error(`Verified frame ${frame} hash does not match its lock`);
    lockedSvgCache.set(hash, svg);
    updateLockedSeekRange();
    if (playing && lockedFrameAt(timeMs) === frame) {
      board.innerHTML = svg;
      requestedHash = hash;
      void audio.play().catch((error: unknown) => failLockedPlayback(error instanceof Error ? error.message : String(error)));
    }
  });
  const task = loaded.then((value) => {
    lockedFrameLoads.delete(frame);
    return value;
  }, (error: unknown) => {
    lockedFrameLoads.delete(frame);
    failLockedPlayback(error instanceof Error ? error.message : String(error));
    throw error;
  });
  lockedFrameLoads.set(frame, task);
  return task;
}

let preloadCursor = 0;
const LOCKED_PREFETCH_SECONDS = 2;
const LOCKED_PREFETCH_WORKERS = 2;
function prefetchLockedPrefix(fromTimeMs = timeMs): void {
  if (!run?.lockedV2 || lockedFailure) return;
  const targetEnd = Math.min(run.lockedV2.frames, lockedFrameAt(fromTimeMs) + Math.max(1, Math.ceil(run.lockedV2.fps * LOCKED_PREFETCH_SECONDS)));
  while (preloadCursor < targetEnd && lockedFrameLoads.size < LOCKED_PREFETCH_WORKERS) {
    const frame = preloadCursor++;
    void requestLockedFrame(frame).catch(() => undefined).finally(() => {
      lockedFrameLoads.delete(frame);
      prefetchLockedPrefix(timeMs);
    });
  }
}

function drawLockedFrame(t: number): void {
  const hash = lockedHashAt(t);
  if (hash === requestedHash) return;
  requestedHash = hash;
  const cached = lockedSvgCache.get(hash);
  if (cached) { board.innerHTML = cached; prefetchLockedPrefix(t); return; }
  message.textContent = `BUFFERING · verified frame ${lockedFrameAt(t) + 1} is loading`;
  if (playing && !audio.paused) audio.pause();
  void requestLockedFrame(lockedFrameAt(t)).catch(() => undefined);
  prefetchLockedPrefix(t);
}

/**
 * The V1 scene composer pulls in the Node-only text measurer (resvg). It is imported only for V1 runs, so the verified locked
 * V2 player, which draws frozen SVG bytes, never loads Node-only modules in the browser.
 */
let sceneComposer: ((scenes: VideoScene[], t: number) => string) | undefined;
async function loadSceneComposer(): Promise<void> {
  if (!sceneComposer) sceneComposer = (await import('../frame.js')).frameSvgAt;
}

function draw(t: number): void {
  timeMs = Math.max(0, Math.min(durationMs, t));
  // This is the same pure scene/timeline frame composer sampled by encodeVideo.
  // Only renderer-produced markup is inserted; the loaded data is validated run output.
  if (run!.lockedV2) drawLockedFrame(timeMs);
  else if (sceneComposer) board.innerHTML = sceneComposer(run!.scenes, timeMs);
  seek.value = String(timeMs);
  clock.value = `${fmt(timeMs)} / ${fmt(durationMs)}`;
  const word = run!.alignedWords.find((x) => x.startMs <= timeMs && timeMs < x.endMs);
  caption.textContent = word?.w ?? '';
}

function setPlaying(value: boolean): void {
  playing = value;
  playButton.textContent = value ? 'Pause' : 'Play';
  playButton.setAttribute('aria-label', value ? 'Pause explanation' : 'Play explanation');
  if (!playing) {
    if (audio.src && !audio.paused) audio.pause();
    cancelAnimationFrame(raf);
  } else {
    lastTick = performance.now();
    if (run?.lockedV2) prefetchLockedPrefix(timeMs);
    if ((run?.audioUrl || run?.lockedV2) && audio.paused && (!run.lockedV2 || lockedSvgCache.has(lockedHashAt(timeMs)))) void audio.play().catch((error: unknown) => {
      if (run?.lockedV2) failLockedPlayback(error instanceof Error ? error.message : String(error));
      else message.textContent = `Audio could not start: ${error instanceof Error ? error.message : String(error)}. Visual playback continues.`;
    });
    else if (!run?.audioUrl) void playProgressiveAudio(timeMs);
    raf = requestAnimationFrame(tick);
  }
}

function tick(now: number): void {
  if (!playing || !run) return;
  const rate = Number(speed.value) || 1;
  if (run.lockedV2 && audio.paused && !audio.ended) {
    if (!lockedFailure) message.textContent = lockedSvgCache.has(lockedHashAt(timeMs)) ? 'BUFFERING · waiting for verified audio' : `BUFFERING · verified frame ${lockedFrameAt(timeMs) + 1} is loading`;
    raf = requestAnimationFrame(tick);
    return;
  }
  if (activeProgressiveAudio && audio.src) {
    timeMs = Math.min(activeProgressiveAudio.endMs, activeProgressiveAudio.startMs + audio.currentTime * 1000);
  } else if ((run.audioUrl || run.lockedV2) && audio.src) {
    timeMs = Math.min(durationMs, audio.currentTime * 1000);
  } else {
    timeMs = Math.min(durationMs, timeMs + (now - lastTick) * rate);
  }
  lastTick = now;
  draw(timeMs);
  if (timeMs >= durationMs) {
    if (run.streaming) {
      cancelAnimationFrame(raf);
      return;
    }
    setPlaying(false);
    return;
  }
  raf = requestAnimationFrame(tick);
}

async function start(): Promise<void> {
  const fontFaces = await document.fonts.load('700 32px Kalam');
  if (fontFaces.length === 0) throw new Error('Bundled Kalam display font did not load');
  const response = await fetch('/run.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load run data (${response.status})`);
  const payload = await response.json() as PreviewRun;
  if (payload.schemaVersion !== 'hypothesis-browser-preview/v1' || !Array.isArray(payload.scenes) || !Number.isFinite(payload.durationMs) || payload.durationMs < 0 || !Array.isArray(payload.events)) {
    throw new Error('Run data does not match the browser-player schema');
  }
  run = payload;
  if (!payload.lockedV2) await loadSceneComposer();
  if (payload.lockedV2) {
    if (!Number.isSafeInteger(payload.lockedV2.frames) || payload.lockedV2.frames < 1 || !Number.isSafeInteger(payload.lockedV2.fps) || payload.lockedV2.fps < 1 || !Array.isArray(payload.lockedV2.renderPlan)) throw new Error('Locked V2 preview has an invalid frame plan');
    for (let frame = 0; frame < payload.lockedV2.frames; frame++) lockedFrameHashes.push(lockedHashAt(frame * 1000 / payload.lockedV2.fps));
  }
  durationMs = payload.durationMs;
  lastEventSequence = payload.events.length;
  if (payload.scenes.length) durationMs = Math.max(durationMs, ...payload.scenes.map((scene) => scene.endMs));
  seek.max = String(payload.lockedV2 ? 0 : durationMs);
  seek.disabled = durationMs <= 0;
  if (payload.audioUrl || payload.lockedV2) {
    audio.src = payload.lockedV2?.audioUrl ?? payload.audioUrl!;
    audio.playbackRate = Number(speed.value) || 1;
    audio.hidden = false;
  }
  if (payload.captionsUrl) $<HTMLTrackElement>('captions').src = payload.captionsUrl;
  message.textContent = payload.lockedV2 ? `${payload.status.toUpperCase()} · ${payload.runClass} · verified locked playback` : `${payload.status.toUpperCase()} · ${payload.runClass} · ${payload.scenes.length} scenes`;
  if (payload.status !== 'passed') message.dataset.state = payload.status;
  if (payload.lockedV2) {
    seek.disabled = true;
    playButton.disabled = true;
    try {
      await requestLockedFrame(0);
      playButton.disabled = false;
      message.textContent = `${payload.status.toUpperCase()} · ${payload.runClass} · verified first frame ready`;
      updateLockedSeekRange();
      prefetchLockedPrefix(0);
      draw(0);
    } catch { return; }
  } else draw(0);
  if (payload.streaming) scheduleRefresh();
}

function progressiveAudioUrl(reference: SceneAudioReference): string {
  return `/artifact/${reference.path.split('/').map(encodeURIComponent).join('/')}`;
}

async function playProgressiveAudio(atMs: number, autoplay = true): Promise<void> {
  if (!run || run.audioUrl) return;
  const reference = [...run.sceneAudio].sort((a, b) => a.startMs - b.startMs).find((item) => item.startMs <= atMs && atMs < item.endMs)
    ?? [...run.sceneAudio].sort((a, b) => a.startMs - b.startMs).find((item) => item.startMs >= atMs);
  if (!reference) {
    cancelAnimationFrame(raf);
    if (run.streaming) message.textContent = `GENERATING · ${run.scenes.length} scenes ready · waiting for the next scene`;
    return;
  }
  const expectedUrl = progressiveAudioUrl(reference);
  const needsSource = activeProgressiveAudio?.sceneId !== reference.sceneId || !audio.src.endsWith(encodeURI(reference.path));
  if (needsSource) {
    activeProgressiveAudio = reference;
    audio.src = expectedUrl;
  }
  const localTime = Math.max(0, atMs - reference.startMs) / 1000;
  if (needsSource || Math.abs(audio.currentTime - localTime) > 0.25) audio.currentTime = localTime;
  audio.hidden = false;
  if (!autoplay) { audio.pause(); return; }
  try { await audio.play(); }
  catch (error) { message.textContent = `Scene audio could not start: ${error instanceof Error ? error.message : String(error)}. Visual playback continues.`; }
}

function safeRelativePath(value: string): boolean {
  return Boolean(value) && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0') && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

async function consumeSceneEvents(): Promise<void> {
  if (!run?.eventUrl) return;
  const response = await fetch(run.eventUrl, { cache: 'no-store' });
  if (!response.ok) return;
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const event = JSON.parse(line) as ScenePlayableEvent;
    if (event.type !== 'scene.playable' || event.schemaVersion !== 'hypothesis-scene-event/v1' || event.sequence !== index || event.sequence < lastEventSequence) continue;
    if (event.sequence > lastEventSequence) break;
    if (!safeRelativePath(event.previewLocation) || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.runId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.sceneId) || !Number.isFinite(event.durationMs) || event.durationMs <= 0) continue;
    if (run.scenes.some((scene) => scene.laidOut.sceneId === event.sceneId)) { lastEventSequence++; continue; }
    const artifactUrl = `/artifact/${event.previewLocation.split('/').map(encodeURIComponent).join('/')}`;
    const descriptorResponse = await fetch(artifactUrl, { cache: 'no-store' });
    if (!descriptorResponse.ok) break;
    let descriptor: ScenePreviewDescriptor;
    try { descriptor = await descriptorResponse.json() as ScenePreviewDescriptor; }
    catch { break; }
    if (descriptor.schemaVersion !== 'hypothesis-scene-preview/v1' || descriptor.runId !== event.runId || descriptor.moduleId !== event.moduleId || descriptor.sceneId !== event.sceneId || descriptor.sequence !== event.sequence || descriptor.durationMs !== event.durationMs || !safeRelativePath(descriptor.audio?.scenePath ?? '') || !/^[a-f0-9]{64}$/i.test(descriptor.audio?.sceneContentHash ?? '') || !Number.isFinite(descriptor.audio?.startMs) || !Number.isFinite(descriptor.audio?.endMs) || descriptor.audio.endMs <= descriptor.audio.startMs) break;
    lastEventSequence++;
    run.scenes.push({ laidOut: descriptor.laidOut, timeline: descriptor.timeline, startMs: descriptor.audio.startMs, endMs: descriptor.audio.endMs });
    run.sceneAudio.push({ sceneId: event.sceneId, path: descriptor.audio.scenePath, contentHash: descriptor.audio.sceneContentHash, startMs: descriptor.audio.startMs, endMs: descriptor.audio.endMs });
    run.scenes.sort((a, b) => a.startMs - b.startMs);
    durationMs = Math.max(durationMs, descriptor.audio.endMs);
    seek.max = String(durationMs);
    seek.disabled = false;
    draw(timeMs);
    message.textContent = `GENERATING · ${run.runClass} · ${run.scenes.length} scenes ready`;
  }
}

/** More scenes became verified (or the final lock was published): extend the frame plan and swap to the longer audio at the same position. */
function adoptLockedUpdate(latest: PreviewRun): void {
  if (!run?.lockedV2 || !latest.lockedV2) return;
  const wasEnded = timeMs >= durationMs - 1;
  run.lockedV2 = latest.lockedV2;
  for (let frame = lockedFrameHashes.length; frame < latest.lockedV2.frames; frame++) lockedFrameHashes.push(lockedHashAt(frame * 1000 / latest.lockedV2.fps));
  durationMs = Math.max(durationMs, latest.durationMs);
  const resumeAt = timeMs / 1000;
  audio.src = latest.lockedV2.audioUrl;
  audio.playbackRate = Number(speed.value) || 1;
  audio.currentTime = resumeAt;
  if (playing) {
    void audio.play().catch((error: unknown) => failLockedPlayback(error instanceof Error ? error.message : String(error)));
    if (wasEnded) { cancelAnimationFrame(raf); lastTick = performance.now(); raf = requestAnimationFrame(tick); }
  }
  prefetchLockedPrefix(timeMs);
}

async function refreshRunState(): Promise<boolean> {
  if (!run) return false;
  await consumeSceneEvents();
  const response = await fetch('/run.json', { cache: 'no-store' });
  if (!response.ok) return true;
  const latest = await response.json() as PreviewRun;
  if (latest.schemaVersion !== 'hypothesis-browser-preview/v1') return true;
  run.status = latest.status;
  run.runClass = latest.runClass;
  run.streaming = latest.streaming;
  run.alignedWords = latest.alignedWords;
  if (run.lockedV2 && shouldAdoptLockedUpdate(run.lockedV2, latest.lockedV2)) adoptLockedUpdate(latest);
  if (latest.durationMs > 0) durationMs = Math.max(durationMs, latest.durationMs);
  if (latest.audioUrl && !audio.src) {
    activeProgressiveAudio = undefined;
    run.audioUrl = latest.audioUrl;
    audio.src = latest.audioUrl;
    audio.playbackRate = Number(speed.value) || 1;
    audio.hidden = false;
    audio.currentTime = timeMs / 1000;
    if (playing) void audio.play().catch(() => undefined);
  } else if (latest.audioUrl && !run.audioUrl) {
    activeProgressiveAudio = undefined;
    run.audioUrl = latest.audioUrl;
    audio.src = latest.audioUrl;
    audio.currentTime = timeMs / 1000;
    if (playing) void audio.play().catch(() => undefined);
  }
  if (playing && !run.audioUrl && !activeProgressiveAudio && run.sceneAudio.length) void playProgressiveAudio(timeMs);
  if (latest.captionsUrl) $<HTMLTrackElement>('captions').src = latest.captionsUrl;
  if (run.lockedV2) updateLockedSeekRange(); else seek.max = String(durationMs);
  draw(timeMs);
  if (!run.streaming) {
    message.textContent = `${run.status.toUpperCase()} · ${run.runClass} · ${run.scenes.length} scenes`;
    if (run.status !== 'passed') message.dataset.state = run.status;
    return false;
  }
  return true;
}

function scheduleRefresh(): void {
  window.setTimeout(() => {
    void refreshRunState().then((keepGoing) => { if (keepGoing) scheduleRefresh(); }).catch(() => scheduleRefresh());
  }, 750);
}

playButton.addEventListener('click', () => setPlaying(!playing));
seek.addEventListener('input', () => {
  const requested = Number(seek.value);
  const t = run?.lockedV2 ? clampSeekToReadyPrefix(requested, readyLockedFrames(), run.lockedV2.fps, durationMs) : requested;
  if (run?.lockedV2 && t !== requested) message.textContent = 'SEEK LIMITED · only the verified ready prefix is seekable';
  if ((run?.audioUrl || run?.lockedV2) && audio.src) audio.currentTime = Math.max(0, Math.min(durationMs, t)) / 1000;
  else void playProgressiveAudio(t, playing);
  draw(t);
  if (run?.lockedV2) prefetchLockedPrefix(t);
});
speed.addEventListener('change', () => {
  audio.playbackRate = Number(speed.value) || 1;
});
audio.addEventListener('ended', () => {
  if (activeProgressiveAudio) {
    timeMs = activeProgressiveAudio.endMs;
    activeProgressiveAudio = undefined;
    void playProgressiveAudio(timeMs);
  } else setPlaying(false);
});
audio.addEventListener('waiting', () => { if (run?.lockedV2 && !lockedFailure) message.textContent = 'BUFFERING · waiting for verified audio'; });
audio.addEventListener('playing', () => { if (run?.lockedV2 && !lockedFailure) message.textContent = `${run.status.toUpperCase()} · ${run.runClass} · verified locked playback`; });
audio.addEventListener('error', () => {
  if (run?.lockedV2) failLockedPlayback('verified audio failed to load');
  else message.textContent = 'Audio failed to load; visual preview remains available.';
});
void start().catch((error: unknown) => {
  message.textContent = `Preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
  message.dataset.state = 'failed';
  playButton.disabled = true;
  seek.disabled = true;
});

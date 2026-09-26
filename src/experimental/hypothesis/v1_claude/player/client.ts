import { frameSvgAt, type VideoScene } from '../export/frame.js';

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
let refreshTimer = 0;
let activeProgressiveAudio: SceneAudioReference | undefined;

function draw(t: number): void {
  timeMs = Math.max(0, Math.min(durationMs, t));
  // This is the same pure scene/timeline frame composer sampled by encodeVideo.
  // Only renderer-produced markup is inserted; the loaded data is validated run output.
  board.innerHTML = frameSvgAt(run!.scenes, timeMs);
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
    if (run?.audioUrl && audio.paused) void audio.play().catch((error: unknown) => {
      message.textContent = `Audio could not start: ${error instanceof Error ? error.message : String(error)}. Visual playback continues.`;
    });
    else if (!run?.audioUrl) void playProgressiveAudio(timeMs);
    raf = requestAnimationFrame(tick);
  }
}

function tick(now: number): void {
  if (!playing || !run) return;
  const rate = Number(speed.value) || 1;
  if (activeProgressiveAudio && audio.src) {
    timeMs = Math.min(activeProgressiveAudio.endMs, activeProgressiveAudio.startMs + audio.currentTime * 1000);
  } else if (run.audioUrl && audio.src) {
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
  durationMs = payload.durationMs;
  lastEventSequence = payload.events.length;
  if (payload.scenes.length) durationMs = Math.max(durationMs, ...payload.scenes.map((scene) => scene.endMs));
  seek.max = String(durationMs);
  seek.disabled = durationMs <= 0;
  if (payload.audioUrl) {
    audio.src = payload.audioUrl;
    audio.playbackRate = Number(speed.value) || 1;
    audio.hidden = false;
  }
  if (payload.captionsUrl) $<HTMLTrackElement>('captions').src = payload.captionsUrl;
  message.textContent = `${payload.status.toUpperCase()} · ${payload.runClass} · ${payload.scenes.length} scenes`;
  if (payload.status !== 'passed') message.dataset.state = payload.status;
  draw(0);
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
  seek.max = String(durationMs);
  draw(timeMs);
  if (!run.streaming) {
    message.textContent = `${run.status.toUpperCase()} · ${run.runClass} · ${run.scenes.length} scenes`;
    if (run.status !== 'passed') message.dataset.state = run.status;
    return false;
  }
  return true;
}

function scheduleRefresh(): void {
  refreshTimer = window.setTimeout(() => {
    void refreshRunState().then((keepGoing) => { if (keepGoing) scheduleRefresh(); }).catch(() => scheduleRefresh());
  }, 750);
}

playButton.addEventListener('click', () => setPlaying(!playing));
seek.addEventListener('input', () => {
  const t = Number(seek.value);
  if (run?.audioUrl && audio.src) audio.currentTime = t / 1000;
  else void playProgressiveAudio(t, playing);
  draw(t);
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
audio.addEventListener('error', () => { message.textContent = 'Audio failed to load; visual preview remains available.'; });
void start().catch((error: unknown) => {
  message.textContent = `Preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
  playButton.disabled = true;
  seek.disabled = true;
});

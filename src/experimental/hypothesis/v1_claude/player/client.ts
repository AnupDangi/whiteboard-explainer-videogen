import { frameSvgAt, type VideoScene } from '../export/frame.js';

interface PreviewRun {
  schemaVersion: 'hypothesis-browser-preview/v1';
  status: 'draft' | 'failed' | 'passed';
  runClass: string;
  durationMs: number;
  scenes: VideoScene[];
  alignedWords: Array<{ w: string; startMs: number; endMs: number }>;
  audioUrl?: string;
  captionsUrl?: string;
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
    if (audio.src && audio.paused) void audio.play().catch((error: unknown) => {
      message.textContent = `Audio could not start: ${error instanceof Error ? error.message : String(error)}. Visual playback continues.`;
    });
    raf = requestAnimationFrame(tick);
  }
}

function tick(now: number): void {
  if (!playing || !run) return;
  const rate = Number(speed.value) || 1;
  if (audio.src) {
    timeMs = Math.min(durationMs, audio.currentTime * 1000);
  } else {
    timeMs = Math.min(durationMs, timeMs + (now - lastTick) * rate);
  }
  lastTick = now;
  draw(timeMs);
  if (timeMs >= durationMs) {
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
  if (payload.schemaVersion !== 'hypothesis-browser-preview/v1' || !Array.isArray(payload.scenes) || !Number.isFinite(payload.durationMs) || payload.durationMs <= 0) {
    throw new Error('Run data does not match the browser-player schema');
  }
  run = payload;
  durationMs = payload.durationMs;
  seek.max = String(durationMs);
  seek.disabled = false;
  if (payload.audioUrl) {
    audio.src = payload.audioUrl;
    audio.playbackRate = Number(speed.value) || 1;
    audio.hidden = false;
  }
  if (payload.captionsUrl) $<HTMLTrackElement>('captions').src = payload.captionsUrl;
  message.textContent = `${payload.status.toUpperCase()} · ${payload.runClass} · ${payload.scenes.length} scenes`;
  if (payload.status !== 'passed') message.dataset.state = payload.status;
  draw(0);
}

playButton.addEventListener('click', () => setPlaying(!playing));
seek.addEventListener('input', () => {
  const t = Number(seek.value);
  if (audio.src) audio.currentTime = t / 1000;
  draw(t);
});
speed.addEventListener('change', () => {
  audio.playbackRate = Number(speed.value) || 1;
});
audio.addEventListener('ended', () => setPlaying(false));
audio.addEventListener('error', () => { message.textContent = 'Audio failed to load; visual preview remains available.'; });
void start().catch((error: unknown) => {
  message.textContent = `Preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
  playButton.disabled = true;
  seek.disabled = true;
});

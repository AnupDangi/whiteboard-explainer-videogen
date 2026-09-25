#!/usr/bin/env node
// Builds the SIMI-REF reference pack (hypothesis/v1_claude/03 §1) from the
// reference Lamina videos: detects scene boundaries, then tiles each scene's
// progression (how the board builds up) into one composite PNG.
//
// Whiteboard scenes are mostly white, so ffmpeg's `scene` score misses cuts.
// A cut is detected instead as a sharp drop in "ink mass" (dark-pixel count
// on a 96x54 grayscale proxy): the board is cleared when a new scene starts.
//
// Usage: node scripts/lamina-reference.mjs <videoDir> <outDir>
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [videoDir = '../lamina-labs-video', outDir = 'harness/reference/lamina'] = process.argv.slice(2);
const SAMPLE_FPS = 2;
const W = 96, H = 54;
const INK_THRESHOLD = 170; // gray value below this counts as ink
const DROP_RATIO = 0.45; // a new scene starts when ink falls below 45% of the recent peak
const MIN_SCENE_S = 3;
const FRAMES_PER_SCENE = 6;

function run(args) {
  const r = spawnSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-800)}`);
  return r.stdout;
}

function inkSeries(video) {
  const raw = run(['-v', 'error', '-i', video, '-vf', `fps=${SAMPLE_FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-']);
  const n = Math.floor(raw.length / (W * H));
  const ink = [];
  for (let f = 0; f < n; f++) {
    let c = 0;
    // Skip the top/bottom 8% (watermark/footer bands) so they don't mask a cleared board.
    for (let y = Math.floor(H * 0.08); y < Math.floor(H * 0.92); y++) for (let x = 0; x < W; x++) if (raw[f * W * H + y * W + x] < INK_THRESHOLD) c++;
    ink.push(c);
  }
  return ink;
}

function detectScenes(ink) {
  const cuts = [0];
  let peak = ink[0] ?? 0;
  for (let i = 1; i < ink.length; i++) {
    const sinceCut = (i - cuts[cuts.length - 1]) / SAMPLE_FPS;
    if (sinceCut >= MIN_SCENE_S && peak > 40 && ink[i] < peak * DROP_RATIO) {
      cuts.push(i);
      peak = ink[i];
    } else {
      peak = Math.max(peak, ink[i]);
    }
  }
  const scenes = [];
  for (let k = 0; k < cuts.length; k++) {
    const start = cuts[k] / SAMPLE_FPS;
    const end = (k + 1 < cuts.length ? cuts[k + 1] : ink.length) / SAMPLE_FPS;
    scenes.push({ startS: start, endS: end });
  }
  return scenes;
}

mkdirSync(outDir, { recursive: true });
const index = [];
for (const file of readdirSync(videoDir).filter((f) => f.endsWith('.mp4')).sort()) {
  const video = join(videoDir, file);
  const stem = basename(file, '.mp4').replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '');
  const scenes = detectScenes(inkSeries(video));
  scenes.forEach((s, i) => {
    const dur = s.endS - s.startS;
    // Sample the progression inside the scene; the last sample sits just before the cut (fully built board).
    const times = Array.from({ length: FRAMES_PER_SCENE }, (_, k) => s.startS + (dur * (k + 1)) / (FRAMES_PER_SCENE + 0.3));
    const out = join(outDir, `${stem}-scene${String(i + 1).padStart(2, '0')}.png`);
    const inputs = times.flatMap((t) => ['-ss', t.toFixed(2), '-i', video]);
    const scaled = times.map((_, k) => `[${k}:v]scale=640:-2,trim=end_frame=1[f${k}]`).join(';');
    const tile = `${times.map((_, k) => `[f${k}]`).join('')}xstack=inputs=${times.length}:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0[out]`;
    run(['-v', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${tile}`, '-map', '[out]', '-frames:v', '1', out]);
    index.push({ video: file, scene: i + 1, startS: +s.startS.toFixed(2), endS: +s.endS.toFixed(2), composite: basename(out), sampleTimesS: times.map((t) => +t.toFixed(2)) });
  });
  console.log(`${file}: ${scenes.length} scenes`);
}
writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${index.length} composites to ${outDir}`);

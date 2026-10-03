#!/usr/bin/env node
// One domain video end-to-end: run the V2 lesson CLI cold, then collect the
// gallery artifacts (video.mp4, scenes.png, captions, scorecard, log snippet)
// into output/stcc-proof/<name>/ with meta.json, and regenerate index.html.
// Usage: node scripts/stcc-domain.mjs <name> [--attempt=n]
// Names (8-domain set): biology-osmosis, math-squares, physics-rc,
//   cs-lru, systems-tcp, chemistry-halflife, bio-vaccine, general-spaced.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CATALOG = {
  'biology-osmosis': { source: 'bench/sources/osmosis.md', id: 'osmosis-en', domain: 'Biology', title: 'Osmosis across a membrane', description: 'Water spreads from the crowded side to the open side until both sides match — no energy spent.', duration: 60 },
  'math-squares': { source: 'bench/benchmark-v2/sources/completing-the-square.md', id: 'squares-en', domain: 'Mathematics', title: 'Completing the square', description: 'Reshaping an equation into a perfect square to reveal its turning point.', duration: 75 },
  'physics-rc': { source: 'bench/benchmark-v2/sources/rc-circuit-charging.md', id: 'rc-en', domain: 'Physics', title: 'RC circuit charging', description: 'Charge builds on the capacitor while the current fades — cause, quantity, and plot together.', duration: 90 },
  'cs-lru': { source: 'bench/benchmark-v2/sources/lru-cache.md', id: 'lru-en', domain: 'Computer science', title: 'LRU cache eviction', description: 'The least recently used entry leaves first: order, capacity, and eviction traced live.', duration: 90 },
  'systems-tcp': { source: 'bench/benchmark-v2/sources/tcp-congestion-window.md', id: 'tcp-en', domain: 'Systems', title: 'TCP congestion window', description: 'Senders probe for capacity and back off on loss — a feedback loop drawn as it happens.', duration: 90 },
  'chemistry-halflife': { source: 'bench/sources/half-life.md', id: 'halflife-en', domain: 'Chemistry', title: 'Half-life decay', description: 'Half the atoms decay every half-life: quantity shrinking on a fixed clock.', duration: 60 },
  'bio-vaccine': { source: 'bench/sources/vaccination.md', id: 'vaccine-en', domain: 'Biology', title: 'How vaccines train immunity', description: 'A safe preview teaches the immune system to recognize the real threat.', duration: 60 },
  'general-spaced': { source: 'bench/sources/spaced-repetition.md', id: 'spaced-en', domain: 'Learning science', title: 'Spaced repetition', description: 'Reviews timed just before forgetting lock memory in with less total effort.', duration: 60 },
};

const [name, ...rest] = process.argv.slice(2);
const attempt = Number(((rest.find((a) => a.startsWith('--attempt=')) ?? '--attempt=1').split('=')[1]));
const item = CATALOG[name];
if (!item) { console.error(`unknown domain name. choose: ${Object.keys(CATALOG).join(', ')}`); process.exit(2); }
const lang = 'en';
const workdir = path.join(ROOT, '.data', 'stcc-proof', `${name}-a${attempt}`);
const env = { ...process.env, TEACHING_COMPILER_VERSION: 'v2', TEACHING_BEATS_V2: '1', BOARD_OPS_V2: '1', PERSISTENT_BOARD_V2: '1', TYPE_RESOLVER_V2: '1', LAYOUT_V2: '1', RENDER_PLAN_V2: '1' };

console.log(`== ${name} attempt ${attempt}: ${item.source} (${item.duration}s)`);
const run = spawnSync('node', ['dist/src/run/lessonCli.js', `--source=${item.source}`, '--instruction=Teach the main idea of this source to a beginner.', `--duration=${item.duration}`, `--id=${item.id}`, '--cache=cold', '--tts=local', `--language=${lang}`, '--diagnostic-video', `--out=${workdir}`], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
writeFileSync(path.join(workdir + '.log'), (run.stdout ?? '') + '\n' + (run.stderr ?? ''));
console.log((run.stdout ?? '').split('\n').filter((l) => /status=|\[HARD\]/.test(l)).map((l) => l.slice(0, 300)).join('\n'));

// Locate the completed run dir (newest) and collect artifacts.
const lessonDir = path.join(workdir, item.id);
let runDir = null;
if (existsSync(path.join(lessonDir, 'runs'))) {
  const runs = readdirSync(path.join(lessonDir, 'runs')).sort();
  runDir = runs.length ? path.join(lessonDir, 'runs', runs[runs.length - 1]) : null;
}
const outDir = path.join(ROOT, 'output', 'stcc-proof', name);
mkdirSync(outDir, { recursive: true });
const video = runDir && existsSync(path.join(runDir, 'video.mp4')) ? path.join(runDir, 'video.mp4') : null;
if (!video) {
  const hard = (run.stdout ?? '').split('\n').filter((l) => l.includes('[HARD]')).map((l) => l.slice(0, 300)).join('\n');
  writeFileSync(path.join(outDir, 'MISSING.txt'), `no video on attempt ${attempt}.\n${hard}\nsee .data/stcc-proof/${name}-a${attempt}.log\n`);
  console.log(`no video; wrote MISSING.txt`);
  process.exit(3);
}
copyFileSync(video, path.join(outDir, 'video.mp4'));
if (runDir && existsSync(path.join(runDir, 'captions.vtt'))) copyFileSync(path.join(runDir, 'captions.vtt'), path.join(outDir, 'captions.vtt'));
if (runDir && existsSync(path.join(runDir, 'scorecard.json'))) copyFileSync(path.join(runDir, 'scorecard.json'), path.join(outDir, 'scorecard.json'));
const scenes = spawnSync('node', ['scripts/stcc-scenes-png.mjs', runDir, path.join(outDir, 'scenes.png')], { cwd: ROOT, encoding: 'utf8' });
console.log(scenes.stdout ?? '', scenes.stderr ?? '');
let durationS = item.duration, costUsd = 'unknown', scenes_ = 0;
try {
  const score = JSON.parse(readFileSync(path.join(outDir, 'scorecard.json'), 'utf8'));
  durationS = Math.round(score.durationMs / 1000) || item.duration;
  costUsd = '$' + (score.costUsd ?? score.cost ?? '?');
  scenes_ = score.scenes ?? 0;
} catch { /* keep estimates */ }
const hardCount = (run.stdout ?? '').split('\n').filter((l) => l.includes('[HARD]')).length;
writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ domain: item.domain, title: item.title, description: item.description, durationS, costUsd: String(costUsd), scenes: scenes_, status: hardCount === 0 ? 'complete' : 'diagnostic', hardFailures: hardCount, attempt, source: item.source }, null, 2) + '\n');
spawnSync('node', ['scripts/stcc-gallery.mjs'], { cwd: ROOT, encoding: 'utf8' });
console.log(`done: ${outDir}/video.mp4`);

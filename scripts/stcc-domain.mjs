#!/usr/bin/env node
// One domain video end-to-end: run the V2 lesson CLI cold, then collect the
// gallery artifacts (video.mp4, scenes.png, captions, scorecard, log snippet)
// into output/stcc-proof/<name>/ with meta.json, and regenerate index.html.
// Usage: node scripts/stcc-domain.mjs <name> [--attempt=n]
// Names (8-domain set): biology-osmosis, math-squares, physics-rc,
//   cs-lru, systems-tcp, chemistry-halflife, bio-vaccine, general-spaced.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CATALOG = {
  'biology-osmosis': { source: 'bench/sources/osmosis.md', id: 'osmosis-en', domain: 'Biology', title: 'Osmosis across a membrane', description: 'Water spreads from the crowded side to the open side until both sides match — no energy spent.', duration: 60 },
  'simi-math': { source: 'bench/simi-smoke/MATH-01.md', id: 'math-en', domain: 'Mathematics', title: 'Equivalent fractions, same quantity', description: 'Changing numerator and denominator together preserves the amount: re-cut pieces cover the same area.', duration: 75 },
  'simi-phys': { source: 'bench/simi-smoke/PHYS-01.md', id: 'phys-en', domain: 'Physics', title: 'Newton second law', description: 'Force and mass decide acceleration: predict motion from what pushes and what resists.', duration: 90 },
  'simi-bio': { source: 'bench/simi-smoke/BIO-01.md', id: 'bio-en', domain: 'Biology', title: 'Osmosis across a membrane', description: 'Water moves across a semipermeable membrane from dilute to concentrated sides.', duration: 110 },
  'simi-chem': { source: 'bench/simi-smoke/CHEM-01.md', id: 'chem-en', domain: 'Chemistry', title: 'Ionic versus covalent bonding', description: 'Electron transfer versus electron sharing: what holds atoms together and why it matters.', duration: 105 },
  'simi-cs': { source: 'bench/simi-smoke/CS-01.md', id: 'cs-en', domain: 'Computer science', title: 'Binary search', description: 'Sorted order lets every comparison throw away half the search space.', duration: 100 },
  'simi-sys': { source: 'bench/simi-smoke/SYS-01.md', id: 'sys-en', domain: 'Systems', title: 'DNS lookup, name to address', description: 'Follow a domain name across resolvers until it becomes an IP address.', duration: 120 },
  'simi-aiml': { source: 'bench/simi-smoke/AIML-01.md', id: 'aiml-en', domain: 'AI and ML', title: 'Gradient descent', description: 'Step opposite the gradient and the loss falls: learning as downhill walking.', duration: 120 },
  'simi-stat': { source: 'bench/simi-smoke/STAT-01.md', id: 'stat-en', domain: 'Statistics', title: 'Mean versus median under an outlier', description: 'One extreme value drags the mean but barely moves the median.', duration: 85 },
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
const genStartedAt = Date.now();
const run = spawnSync('node', ['dist/src/run/lessonCli.js', `--source=${item.source}`, '--instruction=Teach the main idea of this source to a beginner.', `--duration=${item.duration}`, `--id=${item.id}`, '--cache=cold', '--tts=local', `--language=${lang}`, '--diagnostic-video', '--audio-concurrency=2', `--out=${workdir}`], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const genWallS = Math.round((Date.now() - genStartedAt) / 1000);
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
  if (existsSync(path.join(outDir, 'video.mp4'))) {
    console.log(`no new video; keeping existing video.mp4`);
    process.exit(4);
  }
  const hard = (run.stdout ?? '').split('\n').filter((l) => l.includes('[HARD]')).map((l) => l.slice(0, 300)).join('\n');
  writeFileSync(path.join(outDir, 'MISSING.txt'), `no video on attempt ${attempt}.\n${hard}\nsee .data/stcc-proof/${name}-a${attempt}.log\n`);
  console.log(`no video; wrote MISSING.txt`);
  process.exit(3);
}
copyFileSync(video, path.join(outDir, 'video.mp4'));
if (runDir && existsSync(path.join(runDir, 'captions.vtt'))) copyFileSync(path.join(runDir, 'captions.vtt'), path.join(outDir, 'captions.vtt'));
if (runDir && existsSync(path.join(runDir, 'scorecard.json'))) copyFileSync(path.join(runDir, 'scorecard.json'), path.join(outDir, 'scorecard.json'));
if (existsSync(path.join(outDir, 'MISSING.txt'))) {
  rmSync(path.join(outDir, 'MISSING.txt'));
}
// One image of complete scenes: final rendered frame of each scene from the
// lesson lock's scene boundaries, tiled. Falls back to locked-SVG tiling.
let sceneEnds = [];
try {
  const lock = JSON.parse(readFileSync(path.join(runDir, 'lesson.lock.json'), 'utf8'));
  sceneEnds = lock.scenes.map((s) => ({ id: s.sceneId, t: Math.max(0, (s.endMs - 500) / 1000) }));
} catch { /* fallback below */ }
if (sceneEnds.length) {
  const tmp = path.join(ROOT, '.data', 'stcc-proof', `frames-${name}-a${attempt}`);
  mkdirSync(tmp, { recursive: true });
  const thumbs = [];
  sceneEnds.forEach((s, i) => {
    // Top row of 3 at 640px, bottom rows of 2 at 960px: no black bars.
    const row = Math.floor(i / 3);
    const scale = row === 0 ? '640:360' : '960:540';
    const out = path.join(tmp, `f${i}.png`);
    spawnSync('ffmpeg', ['-v', 'error', '-ss', String(s.t), '-i', path.join(outDir, 'video.mp4'), '-frames:v', '1', '-vf', `scale=${scale}`, out, '-y'], { encoding: 'utf8' });
    thumbs.push(out);
  });
  const top = thumbs.slice(0, 3);
  const bottom = thumbs.slice(3);
  const inputs = [...top, ...bottom].flatMap((t) => ['-i', t]);
  let filter, maps;
  if (bottom.length === 0) {
    filter = `xstack=inputs=${top.length}:layout=${top.map((_, i) => `${i * 640}_0`).join('|')}`;
    spawnSync('ffmpeg', ['-v', 'error', ...inputs, '-filter_complex', filter, path.join(outDir, 'scenes.png'), '-y'], { encoding: 'utf8' });
  } else {
    const topLayout = top.map((_, i) => `${i * 640}_0`).join('|');
    const botLayout = bottom.map((_, i) => `${i * 960}_0`).join('|');
    spawnSync('ffmpeg', ['-v', 'error', ...inputs, '-filter_complex', `${top.slice(0).map((_, i) => `[${i}]`).join('')}xstack=inputs=${top.length}:layout=${topLayout}[top];${bottom.map((_, i) => `[${i + top.length}]`).join('')}xstack=inputs=${bottom.length}:layout=${botLayout}[bot];[top][bot]xstack=inputs=2:layout=0_0|0_360`, path.join(outDir, 'scenes.png'), '-y'], { encoding: 'utf8' });
  }
  console.log(`wrote scenes.png (${thumbs.length} scene frames)`);
} else {
  const scenes = spawnSync('node', ['scripts/stcc-scenes-png.mjs', runDir, path.join(outDir, 'scenes.png')], { cwd: ROOT, encoding: 'utf8' });
  console.log(scenes.stdout ?? '', scenes.stderr ?? '');
}
let durationS = item.duration, costUsd = 'unknown', scenes_ = sceneEnds.length;
const statusLine = (run.stdout ?? '').split('\n').find((l) => l.startsWith('status=')) ?? '';
const costMatch = /cost=\$([0-9.]+)/.exec(statusLine);
const durMatch = /encodedDuration=([0-9.]+)/.exec(statusLine);
if (costMatch) costUsd = '$' + costMatch[1];
if (durMatch) durationS = Math.round(Number(durMatch[1]) / 1000);
const hardCount = (run.stdout ?? '').split('\n').filter((l) => l.includes('[HARD]')).length;
writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ domain: item.domain, title: item.title, description: item.description, durationS, costUsd: String(costUsd), scenes: scenes_, status: hardCount === 0 ? 'complete' : 'diagnostic', hardFailures: hardCount, attempt, source: item.source, genStartedAt: new Date(genStartedAt).toISOString(), genWallS }, null, 2) + '\n');
spawnSync('node', ['scripts/stcc-gallery.mjs'], { cwd: ROOT, encoding: 'utf8' });
console.log(`done: ${outDir}/video.mp4`);

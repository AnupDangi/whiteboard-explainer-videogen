#!/usr/bin/env node
// Contact sheet of every scene's final frame for one retained, source-generated V2 run, drawn by the same renderer the
// video uses. Each scene is rasterized on its own (no clip-id collisions) and tiled 2 per row at 960x540. Offline.
// Usage: pnpm run build && node scripts/v2-contact-sheet.mjs <run-dir> <out.png> [--composition=labels|icon-cards]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(import.meta.dirname, '..', 'dist', 'src');
const load = (rel) => import(pathToFileURL(path.join(dist, rel)).href);
const args = process.argv.slice(2);
const composition = args.find((a) => a.startsWith('--composition='))?.slice('--composition='.length) ?? 'labels';
const [runDir, out] = args.filter((a) => !a.startsWith('--'));
if (!runDir || !out || !['labels', 'icon-cards'].includes(composition)) { console.error('usage: node scripts/v2-contact-sheet.mjs <run-dir> <out.png> [--composition=labels|icon-cards]'); process.exit(2); }

const [{ loadRetainedV2Run }, { renderSceneSvg }, { rasterizePng }] = await Promise.all([load('harness/retainedV2Run.js'), load('visual-v2/renderer/frame.js'), load('export/videoEncode.js')]);
const run = await loadRetainedV2Run(runDir, { composition });
if (run.status !== 'loaded') { console.error(`run not replayable: ${run.reason}`); process.exit(1); }
const tiles = run.scenes.map(({ scene }, i) => {
  const png = rasterizePng(renderSceneSvg(scene, scene.timeline.durationMs), 960).toString('base64');
  return `<image x="${(i % 2) * 960}" y="${Math.floor(i / 2) * 540}" width="960" height="540" href="data:image/png;base64,${png}"/>`;
});
const rows = Math.max(1, Math.ceil(tiles.length / 2));
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="${rows * 540}" viewBox="0 0 1920 ${rows * 540}"><rect width="1920" height="${rows * 540}" fill="#FDFDFB"/>${tiles.join('')}</svg>`;
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, rasterizePng(sheet, 1920));
console.log(`wrote ${out} (${run.lessonId}, ${run.scenes.length} scenes, ${composition}${run.complete ? '' : ', NO video.mp4: not for visual review'})`);

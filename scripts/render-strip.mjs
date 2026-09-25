#!/usr/bin/env node
// Dev tool: render one fixture scene at N evenly spaced timestamps and tile the
// frames into a single PNG, the same way the Lamina reference composites are
// built (harness/reference/lamina), for side-by-side review.
// Usage: node scripts/render-strip.mjs <sceneId> <out.png> [frames=6]
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { ATTENTION_SCENES } from '../dist/src/experimental/hypothesis/v1_claude/fixtures/attentionScenes.js';
import { buildNarrationScene } from '../dist/src/experimental/hypothesis/v1_claude/narration/markers.js';
import { alignFixture } from '../dist/src/experimental/hypothesis/v1_claude/narration/align.js';
import { resolveMentions } from '../dist/src/experimental/hypothesis/v1_claude/narration/resolveMentions.js';
import { resolveScene } from '../dist/src/experimental/hypothesis/v1_claude/resolveScene.js';
import { layoutScene } from '../dist/src/experimental/hypothesis/v1_claude/layout/solver.js';
import { compileTimelineFull } from '../dist/src/experimental/hypothesis/v1_claude/timeline/compile.js';
import { renderSceneBody } from '../dist/src/experimental/hypothesis/v1_claude/render/renderScene.js';

const [sceneId, out, n = '6'] = process.argv.slice(2);
const math = await import('../dist/src/experimental/hypothesis/v1_claude/fixtures/mathScenes.js').then((m) => m.MATH_SCENES).catch(() => []);
const all = [...ATTENTION_SCENES, ...math];
const scene = all.find((s) => s.sceneId === sceneId);
if (!scene) throw new Error(`unknown scene ${sceneId}; known: ${all.map((s) => s.sceneId).join(', ')}`);
const script = { schemaVersion: 'claude-narration-script/v1', scenes: [buildNarrationScene(scene.sceneId, scene.sceneId, scene.raw)] };
const audio = alignFixture(script, scene.durationMs ?? 18000);
const { mentions } = resolveMentions(script, audio);
const laidOut = layoutScene(resolveScene(scene.spec));
const bounds = audio.sceneBoundsMs[scene.sceneId];
const timeline = compileTimelineFull(laidOut, mentions, bounds.startMs, bounds.endMs);
const frames = Number(n);
const cols = 3, rows = Math.ceil(frames / cols), W = 1920, H = 1080;
let body = '';
for (let i = 0; i < frames; i++) {
  const t = bounds.startMs + ((bounds.endMs - bounds.startMs) * (i + 1)) / (frames + 0.3);
  body += `<g transform="translate(${(i % cols) * W},${Math.floor(i / cols) * H})"><rect width="${W}" height="${H}" fill="#FDFDFB" stroke="#ccc" stroke-width="4"/>${renderSceneBody(laidOut, timeline, t)}</g>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * W}" height="${rows * H}">${body}</svg>`;
writeFileSync(out, new Resvg(svg, { fitTo: { mode: 'width', value: 1920 } }).render().asPng());
console.log(`wrote ${out}`);

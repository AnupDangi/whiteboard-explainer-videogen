#!/usr/bin/env node
// Dev tool: tile N evenly spaced frames of one scene from a generated run into
// a single PNG for review. It reads the scene descriptor a live run wrote
// (<run>/preview-scenes/NNNN.json: laidOut + timeline on the master clock) and
// draws it with the same deterministic renderer the video uses; nothing is
// re-planned or re-laid-out. Hand-authored fixture scenes are not accepted
// (CLAUDE.md: fixtures cannot establish visual quality).
// Usage: npm run build && node scripts/render-strip.mjs <preview-scene.json> <out.png> [frames=6]
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { renderSceneBody } from '../dist/src/experimental/hypothesis/v1_claude/render/renderScene.js';

const [descriptorPath, out, n = '6'] = process.argv.slice(2);
if (!descriptorPath || !out) throw new Error('usage: node scripts/render-strip.mjs <run>/preview-scenes/NNNN.json <out.png> [frames=6]');
const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
if (descriptor.schemaVersion !== 'hypothesis-scene-preview/v1' || !descriptor.laidOut || !descriptor.timeline) throw new Error(`${descriptorPath} is not a hypothesis-scene-preview/v1 descriptor from a live run`);
const { startMs, endMs } = descriptor.audio;
const frames = Number(n);
const cols = 3, rows = Math.ceil(frames / cols), W = 1920, H = 1080;
let body = '';
for (let i = 0; i < frames; i++) {
  const t = startMs + ((endMs - startMs) * (i + 1)) / (frames + 0.3);
  body += `<g transform="translate(${(i % cols) * W},${Math.floor(i / cols) * H})"><rect width="${W}" height="${H}" fill="#FDFDFB" stroke="#ccc" stroke-width="4"/>${renderSceneBody(descriptor.laidOut, descriptor.timeline, t)}</g>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * W}" height="${rows * H}">${body}</svg>`;
writeFileSync(out, new Resvg(svg, { fitTo: { mode: 'width', value: 1920 } }).render().asPng());
console.log(`wrote ${out} (${descriptor.sceneId}, run ${descriptor.runId})`);

#!/usr/bin/env node
// One image of complete scenes: tile every scene's final board SVG from a
// completed V2 run into a single PNG. Reads only locked artifacts
// (<run>/v2/locked/svg/*.svg via the lesson lock); nothing is re-planned.
// Usage: node scripts/stcc-scenes-png.mjs <run-dir> <out.png>
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const [runDir, out] = process.argv.slice(2);
if (!runDir || !out) { console.error('usage: stcc-scenes-png.mjs <run-dir> <out.png>'); process.exit(2); }
const svgDir = path.join(runDir, 'v2', 'locked', 'svg');
if (!existsSync(svgDir)) { console.error(`no locked svg dir in ${runDir}`); process.exit(1); }
const files = readdirSync(svgDir).filter((f) => f.endsWith('.svg')).sort();
if (!files.length) { console.error('no scene svgs'); process.exit(1); }
const W = 1280, H = 720, cols = 2, rows = Math.ceil(files.length / cols);
let body = '';
files.forEach((f, i) => {
  const svg = readFileSync(path.join(svgDir, f), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const label = f.replace(/\.svg$/, '');
  body += `<g transform="translate(${(i % cols) * W},${Math.floor(i / cols) * H})"><rect width="${W}" height="${H}" fill="#FDFDFB" stroke="#ccc" stroke-width="3"/>${inner}<text x="16" y="${H - 16}" font-size="28" font-family="sans-serif" fill="#888">${label}</text></g>`;
});
const page = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * W}" height="${rows * H}">${body}</svg>`;
const png = new Resvg(page, { fitTo: { mode: 'width', value: 1280 } }).render().asPng();
writeFileSync(out, png);
console.log(`wrote ${out} (${files.length} scenes)`);

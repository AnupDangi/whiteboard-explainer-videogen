#!/usr/bin/env node
// Gallery generator: scans output/stcc-proof/*/meta.json and writes a single
// offline index.html — YouTube-thumbnail view, videos by domain. No prompts,
// no traces, no logs in the page; details live in meta.json per folder.
// Usage: node scripts/stcc-gallery.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'output', 'stcc-proof');
const cards = [];
if (existsSync(ROOT)) {
  for (const dir of readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const metaPath = path.join(ROOT, dir, 'meta.json');
    if (!existsSync(metaPath)) continue;
    cards.push({ dir, ...JSON.parse(readFileSync(metaPath, 'utf8')) });
  }
}
const card = (c) => `
    <article class="card">
      <span class="domain">${c.domain}</span>
      <video src="${c.dir}/video.mp4" poster="${c.dir}/scenes.png" preload="metadata" controls></video>
      <h2>${c.title}</h2>
      <p class="desc">${c.description}</p>
      <p class="meta">${c.durationS}s video · ${c.scenes} scenes · ${c.costUsd} · generated in ${c.genWallS ? Math.round(c.genWallS / 60) + ' min' : '?'} · ${c.status}</p>
      <img class="strip" src="${c.dir}/scenes.png" alt="Complete scene boards for ${c.title}" loading="lazy">
    </article>`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simi proof videos by domain</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #f1f1f1; margin: 0; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #aaa; margin: 0 0 20px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; }
  .card { background: #212121; border-radius: 12px; padding: 12px; }
  .card video { width: 100%; border-radius: 8px; aspect-ratio: 16/9; background: #000; }
  .domain { display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #0f0f0f; background: #ffd60a; border-radius: 4px; padding: 2px 8px; margin-bottom: 8px; }
  .card h2 { font-size: 16px; margin: 8px 0 4px; }
  .desc { font-size: 14px; color: #ddd; margin: 0 0 6px; }
  .meta { font-size: 12px; color: #aaa; margin: 0 0 8px; }
  .strip { width: 100%; border-radius: 8px; }
</style>
</head>
<body>
  <h1>Simi proof videos by domain</h1>
  <p class="sub">${cards.length} videos · generated end-to-end by the Teaching Compiler V2 pipeline · no prompts shown</p>
  <div class="grid">
${cards.map(card).join('\n')}
  </div>
</body>
</html>`;
writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`wrote index.html (${cards.length} cards)`);

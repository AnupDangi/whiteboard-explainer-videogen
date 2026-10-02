#!/usr/bin/env node
// Offline catalog ingestion (hypothesis/v1_claude/01 §4.1-4.2, plan Phase 2).
//
// Reads Streamline's free duotone color sets from a local @iconify/json copy
// (zero network at build or run time) and writes a normalized catalog:
//   - each icon split into INK strokes (the dark outline, drawn on first) and
//     FILL shapes tagged by role: 'main' (the pastel body, recolored per element
//     to a palette token), 'white' (highlights), 'ink' (small solid dark details)
//   - path lengths precomputed (svg-path-properties) for stroke-dash reveal timing
//   - names from the icon id, tags from Iconify categories
//   - licence CC-BY-4.0 recorded per entry (attribution is written next to every video)
// Rejected: '-flat' variants (no outline to draw), icons using <use>/<defs>,
// icons with no ink stroke, and icons over the 40-path budget.
//
// Usage: node scripts/build-catalog.mjs <iconify-json-dir> <out.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { svgPathProperties } from 'svg-path-properties';

const [jsonDir = '../experiments/visual-system-benchmark/node_modules/@iconify/json/json', out = 'src/assets/data/streamline.json'] = process.argv.slice(2);
// Preference order: plump (chunky rounded marker look, closest to the reference) first.
const SETS = ['streamline-plump-color', 'streamline-flex-color', 'streamline-color'];
const INK = new Set(['#2859c5', '#4147d5']);
const MAIN = new Set(['#8fbffa', '#d7e0ff']);
const WHITE = new Set(['#fff', '#ffffff']);
const MAX_PATHS = 40;

const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** Flatten an icon body into styled paths, resolving <g> attribute inheritance. */
function flatten(body) {
  const stack = [{}];
  const paths = [];
  for (const m of body.matchAll(/<(\/?)(g|path)((?:\s[^>]*?)?)(\/?)>/g)) {
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) { stack.pop(); continue; }
    const attrs = { ...stack[stack.length - 1], ...attrsOf(rawAttrs) };
    if (tag === 'g') { if (!selfClosing) stack.push(attrs); continue; }
    paths.push(attrs);
  }
  return paths;
}

const lengthOf = (d) => { try { return new svgPathProperties(d).getTotalLength(); } catch { return 0; } };

const entries = [];
const rejected = { flat: 0, useDefs: 0, noInk: 0, tooMany: 0, unknownColor: 0 };
for (const set of SETS) {
  const json = JSON.parse(readFileSync(join(jsonDir, `${set}.json`), 'utf8'));
  const license = json.info.license.spdx;
  const categoryOf = new Map();
  for (const [cat, names] of Object.entries(json.categories ?? {})) for (const n of names) categoryOf.set(n, cat);
  for (const [name, icon] of Object.entries(json.icons)) {
    if (name.endsWith('-flat')) { rejected.flat++; continue; }
    if (/<use|<defs/.test(icon.body)) { rejected.useDefs++; continue; }
    const vb = { w: icon.width ?? json.width ?? 16, h: icon.height ?? json.height ?? 16 };
    const strokes = [];
    const fills = [];
    let bad = false;
    for (const p of flatten(icon.body)) {
      if (!p.d) continue;
      const stroke = p.stroke?.toLowerCase();
      const fill = p.fill?.toLowerCase();
      if (fill && fill !== 'none') {
        const role = MAIN.has(fill) ? 'main' : WHITE.has(fill) ? 'white' : INK.has(fill) ? 'ink' : null;
        if (!role) { bad = true; break; }
        fills.push({ d: p.d, role, ...(p['fill-rule'] === 'evenodd' ? { rule: 'evenodd' } : {}) });
      }
      if (stroke && stroke !== 'none' && INK.has(stroke)) {
        strokes.push({ d: p.d, len: +lengthOf(p.d).toFixed(2), w: Number(p['stroke-width'] ?? 1) });
      }
    }
    if (bad) { rejected.unknownColor++; continue; }
    if (strokes.length === 0) { rejected.noInk++; continue; }
    if (strokes.length + fills.length > MAX_PATHS) { rejected.tooMany++; continue; }
    const words = name.replace(/-\d+$/, '').split('-');
    const cat = categoryOf.get(name);
    entries.push({
      id: `${set}:${name}`,
      set,
      name: words.join(' '),
      tags: [...new Set([...words, ...(cat ? cat.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ') : [])])],
      category: cat ?? null,
      vb,
      strokes,
      fills,
      license,
    });
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ schemaVersion: 'claude-catalog/v1', source: 'streamline via @iconify/json', sets: SETS, attribution: 'Icons: Streamline (https://www.streamlinehq.com), CC BY 4.0 — free sets via Iconify.', entries }));
console.log(`catalog: ${entries.length} icons written to ${out}`, rejected);

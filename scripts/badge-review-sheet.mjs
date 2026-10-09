#!/usr/bin/env node
// Human review sheet of distinct (icon, referent) pairs drawn in retained runs and/or proposed by the gold fixture.
// It never records a verdict. The reviewer replies in chat; verdicts go into src/assets/data/badge-review.v1.json.
// Usage: pnpm run build && node scripts/badge-review-sheet.mjs --out=<dir> [--gold=src/__tests__/fixtures/icon-gold.v1.json] [<run-dir>...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(import.meta.dirname, '..', 'dist', 'src');
const load = (rel) => import(pathToFileURL(path.join(dist, rel)).href);
const args = process.argv.slice(2);
const flag = (key) => args.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const out = flag('out');
const goldPath = flag('gold');
const runDirs = args.filter((a) => !a.startsWith('--'));
if (!out || (!goldPath && !runDirs.length)) { console.error('usage: node scripts/badge-review-sheet.mjs --out=<dir> [--gold=<file>] [<run-dir>...]'); process.exit(2); }

const [{ richnessReport }, { planSceneBadges }, { allCatalogEntries }, { loadBadgeReview, reviewKey }, render, { rasterizePng }] = await Promise.all([
  load('harness/v2RichnessReport.js'), load('visual-v2/resolver/referentBadge.js'), load('assets/semantic.js'), load('assets/badgeReview.js'), load('render/renderScene.js'), load('export/videoEncode.js'),
]);
const catalog = new Map(allCatalogEntries().map((entry) => [entry.id, entry]));
const review = loadBadgeReview();
const pairs = new Map();
const add = (assetId, referent, seenIn) => { const key = reviewKey(assetId, referent); const pair = pairs.get(key) ?? { key, assetId, referent, seenIn: [] }; pair.seenIn.push(seenIn); pairs.set(key, pair); };
if (runDirs.length) {
  const report = await richnessReport(runDirs, { composition: 'icon-cards' });
  for (const run of report.runs) {
    for (const icon of run.icons) add(icon.assetId, icon.referent, `${run.lessonId}/${icon.sceneId}/${icon.kind}`);
    for (const pending of run.pendingReview ?? []) add(pending.assetId, pending.referent, `${run.lessonId}/${pending.sceneId}/pending-review`);
  }
}
if (goldPath) {
  const gold = JSON.parse(readFileSync(goldPath, 'utf8'));
  for (const label of gold.reviewCandidates) for (const badge of planSceneBadges([{ elementId: 'gold', label }]).badges) add(badge.assetId, badge.referent, 'gold-candidate');
}
const list = [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key)).map((pair, index) => ({
  number: index + 1, ...pair, license: catalog.get(pair.assetId)?.license ?? null, houseFamily: catalog.get(pair.assetId)?.houseFamily ?? null,
  verdict: review.accepted.has(pair.key) ? 'accept' : review.rejected.has(pair.key) ? 'reject' : null,
}));
const cols = 4, W = 480, H = 320, rows = Math.max(1, Math.ceil(list.length / cols));
const cells = list.map((pair, i) => {
  const entry = catalog.get(pair.assetId);
  if (!entry) return '';
  const visual = entry.render({ w: 200, h: 200 });
  const icon = [...visual.fills.map((f) => render.fillSvg(f, 1)), ...render.sequentialStrokes(visual.paths, 1), ...visual.texts.map(render.textSvg), ...(visual.embeds ?? []).map(render.embedSvg)].join('');
  const caption = render.textSvg({ x: W / 2, y: 260, text: `#${pair.number} ${pair.referent}`, size: 30, anchor: 'middle' });
  const status = render.textSvg({ x: W / 2, y: 298, text: pair.verdict ?? 'unreviewed', size: 22, anchor: 'middle' });
  return `<g transform="translate(${(i % cols) * W},${Math.floor(i / cols) * H})"><rect width="${W}" height="${H}" fill="#FDFDFB" stroke="#cccccc" stroke-width="2"/><g transform="translate(140,20)">${icon}</g>${caption}${status}</g>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * W}" height="${rows * H}" viewBox="0 0 ${cols * W} ${rows * H}"><rect width="${cols * W}" height="${rows * H}" fill="#FDFDFB"/>${cells.join('')}</svg>`;
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'sheet.png'), rasterizePng(svg, Math.min(cols * W, 1920)));
writeFileSync(path.join(out, 'candidates.json'), `${JSON.stringify({ schemaVersion: 'badge-review-candidates/v1', pairs: list }, null, 2)}\n`);
console.log(`wrote ${path.join(out, 'sheet.png')} and candidates.json (${list.length} pairs, ${list.filter((p) => !p.verdict).length} unreviewed)`);

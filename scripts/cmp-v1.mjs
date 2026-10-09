#!/usr/bin/env node
// Reproducible comparison of the three cmp lessons across v0.3.0, v1.0.0 and V2. Offline; never calls a provider.
//   node scripts/cmp-v1.mjs extract --cmp-root=<dir>                          write bench/cmp-v1/{manifest.json,sources/*.md}
//   node scripts/cmp-v1.mjs sheets  --cmp-root=<dir> [--v2=<caseId>=<mp4>]...  write output/cmp-v1/<case>/<version>.png
// <dir> is the folder holding the v0.3.0/ and v1.0.0/ comparison worktrees (on the 2026-10-08 host:
// /Users/anupdangi/Desktop/AnupAI/Research/lamina-labs-clone/cmp-worktrees).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
// Where each retained case lives inside the comparison worktrees (evidence paths, not topic logic).
const CASES = [
  { id: 'cmp-bio01', v100: 'v1.0.0/.data/cmp/cmp-bio01/runs', v030: 'v0.3.0/output/cmp-BIO-01' },
  { id: 'cmp-cs01', v100: 'v1.0.0/.data/cmp-CS-01/cmp-cs01/runs', v030: 'v0.3.0/output/cmp-CS-01' },
  { id: 'cmp-math01', v100: 'v1.0.0/.data/cmp-MATH-01/cmp-math01/runs', v030: 'v0.3.0/output/cmp-MATH-01' },
];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function caseFromPrep(prep) {
  const request = prep?.request;
  if (typeof request?.id !== 'string' || typeof request.source !== 'string') throw new Error('lesson-prep.json has no request.id/source');
  return {
    id: request.id,
    instruction: typeof request.instruction === 'string' ? request.instruction : null,
    durationSec: request.targetDurationSec ?? 60,
    source: request.source,
    sourceSha256: sha256(request.source),
    sourceMatchesSourceDoc: typeof request.sourceDoc?.text === 'string' && request.sourceDoc.text === request.source && sha256(request.sourceDoc.text) === request.sourceDoc.contentSha256,
  };
}

export function v030Matches(sourceText, fileName) {
  const slug = sourceText.replace(/^\s*\[S1\]\s*/, '').replace(/[^A-Za-z0-9]+/g, '-');
  const stem = fileName.replace(/^S1-/, '').replace(/-*1min\.mp4$/, '');
  return stem.length > 10 && slug.startsWith(stem);
}

export function sheetArgs(input, output, durationSec, frames = 10) {
  const cols = 5;
  const rows = Math.ceil(frames / cols);
  return ['-v', 'error', '-y', '-i', input, '-vf', `fps=${frames * 1000}/${Math.round(durationSec * 1000)},scale=384:-2,tile=${cols}x${rows}`, '-frames:v', '1', output];
}

function durationOf(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${file}: ${probe.stderr}`);
  return Number(probe.stdout.trim());
}

function extract(cmpRoot) {
  const cases = CASES.map((item) => {
    const runsDir = path.join(cmpRoot, item.v100);
    const runs = readdirSync(runsDir).sort();
    const prepRun = runs.findLast((run) => existsSync(path.join(runsDir, run, 'lesson-prep.json')));
    if (!prepRun) throw new Error(`${item.id}: no v1.0.0 lesson-prep.json under ${runsDir}`);
    const found = caseFromPrep(JSON.parse(readFileSync(path.join(runsDir, prepRun, 'lesson-prep.json'), 'utf8')));
    if (found.id !== item.id || !found.sourceMatchesSourceDoc) throw new Error(`${item.id}: recorded source does not verify`);
    const v100Video = runs.map((run) => path.join(item.v100, run, 'video.mp4')).findLast((rel) => existsSync(path.join(cmpRoot, rel))) ?? null;
    const v030Dir = path.join(cmpRoot, item.v030);
    const v030Video = readdirSync(v030Dir).find((name) => name.endsWith('.mp4') && v030Matches(found.source, name));
    const sourceRel = `bench/cmp-v1/sources/${item.id}.md`;
    mkdirSync(path.join(ROOT, 'bench/cmp-v1/sources'), { recursive: true });
    writeFileSync(path.join(ROOT, sourceRel), found.source);
    return {
      id: item.id, instruction: found.instruction, durationSec: found.durationSec, source: sourceRel, sourceSha256: found.sourceSha256,
      retained: {
        'v0.3.0': { video: v030Video ? path.join(item.v030, v030Video) : null, sourceEvidence: 'output file name matches the first-sentence slug' },
        'v1.0.0': { run: path.join(item.v100, prepRun), video: v100Video, sourceEvidence: 'lesson-prep.json request.source sha256 == sourceDoc.contentSha256' },
      },
    };
  });
  writeFileSync(path.join(ROOT, 'bench/cmp-v1/manifest.json'), `${JSON.stringify({ schemaVersion: 'cmp-v1/v1', note: 'Paths under retained are relative to --cmp-root. Videos are evidence only and never committed.', cases }, null, 2)}\n`);
  for (const c of cases) console.log(`${c.id}\tv0.3.0=${c.retained['v0.3.0'].video ?? 'none'}\tv1.0.0=${c.retained['v1.0.0'].video ?? 'none'}`);
}

function sheets(cmpRoot, v2Videos) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'bench/cmp-v1/manifest.json'), 'utf8'));
  for (const c of manifest.cases) {
    const versions = { 'v0.3.0': c.retained['v0.3.0'].video && path.join(cmpRoot, c.retained['v0.3.0'].video), 'v1.0.0': c.retained['v1.0.0'].video && path.join(cmpRoot, c.retained['v1.0.0'].video), v2: v2Videos.get(c.id) };
    for (const [version, video] of Object.entries(versions)) {
      if (!video) { console.log(`${c.id}\t${version}\tno video`); continue; }
      const out = path.join(ROOT, 'output/cmp-v1', c.id, `${version}.png`);
      mkdirSync(path.dirname(out), { recursive: true });
      const run = spawnSync('ffmpeg', sheetArgs(video, out, durationOf(video)), { encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`ffmpeg failed for ${video}: ${run.stderr}`);
      console.log(`${c.id}\t${version}\t${out}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [command, ...rest] = process.argv.slice(2);
  const cmpRoot = rest.find((a) => a.startsWith('--cmp-root='))?.slice('--cmp-root='.length);
  const v2Videos = new Map(rest.filter((a) => a.startsWith('--v2=')).map((a) => { const [id, ...file] = a.slice('--v2='.length).split('='); return [id, path.resolve(file.join('='))]; }));
  if (!cmpRoot || !['extract', 'sheets'].includes(command)) { console.error('usage: node scripts/cmp-v1.mjs extract|sheets --cmp-root=<dir> [--v2=<caseId>=<video.mp4>]...'); process.exit(2); }
  if (command === 'extract') extract(path.resolve(cmpRoot)); else sheets(path.resolve(cmpRoot), v2Videos);
}

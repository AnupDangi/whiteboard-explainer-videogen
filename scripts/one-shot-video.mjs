#!/usr/bin/env node
// One prompt + one source -> one whiteboard lesson video, with no code edits
// once the first provider call can happen.
//
//   pnpm run video:one-shot -- --prompt="Explain ..." --source=paper.pdf [--duration=60|300|600|1800] [--id=name]
//   pnpm run video:one-shot -- --prompt="Explain ..." --url=https://.../paper.pdf
//
// Guarantees (recorded in output/<id>/provenance.json):
// - Refuses to start unless every tracked file matches HEAD, then builds dist/
//   from that commit and hashes it BEFORE the pipeline (and any API call) runs.
// - Runs lessonCli exactly once with --cache=cold. No retries, no repair runs,
//   no hand edits: whatever status the pipeline reports (passed, draft, failed)
//   is the result.
// - After the run, re-checks HEAD, the tracked tree and the dist/ hash. Any
//   change marks the run `tampered` and exits non-zero.
// - Copies video.mp4 byte-for-byte to output/<id>/video.mp4 and records its hash.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const fail = (message) => { console.error(`one-shot: ${message}`); process.exit(2); };

let prompt = arg('prompt');
let source = arg('source');
const url = arg('url');
let duration = arg('duration') ?? '60';
let id = arg('id');
const benchmarkAttemptId = arg('benchmark-attempt');
if (benchmarkAttemptId) {
  const sourceArgs = args.filter((a) => a.startsWith('--source='));
  const urlArgs = args.filter((a) => a.startsWith('--url='));
  if (url || urlArgs.length) fail('frozen development attempts only accept their pinned local source');
  if (sourceArgs.length > 1) fail('frozen development attempts accept at most one explicit source');
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'bench/manifests/teaching-compiler-v1-dev-set.v1.json'), 'utf8'));
  if (manifest.schemaVersion !== 'teaching-compiler-v1-development-set/v1' || manifest.setId !== 'teaching-compiler-v1-dev-set-v1') fail('unsupported development benchmark manifest');
  for (const topic of manifest.topics ?? []) {
    const bytes = readFileSync(path.join(ROOT, topic.sourcePath));
    if (sha256(bytes) !== topic.sourceSha256) fail(`frozen development source drift: ${topic.topicId}`);
  }
  const attempt = (manifest.plannedAttempts ?? []).find((candidate) => candidate.attemptId === benchmarkAttemptId);
  const topic = attempt && manifest.topics.find((candidate) => candidate.topicId === attempt.topicId);
  if (!attempt || !topic || attempt.cache !== 'cold') fail(`unknown or invalid development attempt: ${benchmarkAttemptId}`);
  const pinnedSource = path.join(ROOT, topic.sourcePath);
  if (source && path.resolve(source) !== pinnedSource) fail('source differs from the frozen development topic');
  if (prompt && prompt !== manifest.instruction) fail('prompt differs from the frozen development instruction');
  if (duration !== '60' && Number(duration) !== manifest.targetDurationSec) fail('duration differs from the frozen development target');
  if (id && id !== topic.topicId) fail('run ID differs from the frozen development topic');
  source = topic.sourcePath;
  prompt = manifest.instruction;
  duration = String(manifest.targetDurationSec);
  id = topic.topicId;
}
if (!prompt?.trim()) fail('--prompt="..." is required (the single learner prompt)');
if (Boolean(source) === Boolean(url)) fail('pass exactly one data source: --source=<file> or --url=<url>');
if (args.filter((a) => a.startsWith('--source=') || a.startsWith('--url=')).length !== (benchmarkAttemptId ? (arg('source') ? 1 : 0) : 1)) fail('pass exactly the frozen source for a benchmark attempt, or exactly one data source for a regular run');
if (source && !existsSync(source)) fail(`source not found: ${source}`);
id ??= (source ? path.basename(source, path.extname(source)) : new URL(url).hostname).replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const git = (...a) => {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) fail(`git ${a.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
function hashTree(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(path.relative(dir, p)).update('\0').update(readFileSync(p)).update('\0');
    }
  };
  walk(dir);
  return h.digest('hex');
}
const codeState = () => ({ commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: git('status', '--porcelain', '--untracked-files=no') });

// 1. Lock: tracked code must equal HEAD before anything runs.
const before = codeState();
if (before.dirty) fail(`tracked files differ from HEAD; commit or stash first:\n${before.dirty}`);
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) fail('ffmpeg is not on PATH (needed for MP4 export)');

// 2. Build from the locked commit and hash the compiled pipeline.
const build = spawnSync('pnpm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
if (build.status !== 0) fail('pnpm run build failed; no API call was made');
const distHashBefore = hashTree(path.join(ROOT, 'dist'));

// 3. Single cold run. This is the first point where a provider call can happen.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outBase = path.join('.data', 'one-shot', `${stamp}-${id}`);
const cliArgs = [
  'dist/src/run/lessonCli.js',
  source ? `--source=${source}` : `--url=${url}`,
  `--instruction=${prompt}`,
  `--duration=${duration}`,
  `--id=${id}`,
  '--cache=cold',
  ...(benchmarkAttemptId ? [`--benchmark-attempt=${benchmarkAttemptId}`] : []),
  `--out=${outBase}`,
];
const startedAt = new Date().toISOString();
const run = spawnSync(process.execPath, cliArgs, { cwd: ROOT, stdio: 'inherit' });
const completedAt = new Date().toISOString();

// 4. Verify nothing changed while the pipeline ran.
const after = codeState();
const distHashAfter = hashTree(path.join(ROOT, 'dist'));
const tampered = after.commit !== before.commit || after.tree !== before.tree || Boolean(after.dirty) || distHashAfter !== distHashBefore;

// 5. Collect the pipeline's own result without modifying it.
const absOut = path.join(ROOT, outBase);
const summaryFile = existsSync(absOut) ? readdirSync(absOut).filter((f) => /^summary-.*\.json$/.test(f)).sort().pop() : undefined;
const summary = summaryFile ? JSON.parse(readFileSync(path.join(absOut, summaryFile), 'utf8')) : [];
const entry = summary.find((e) => e.lesson === id) ?? summary[0];
const exportDir = path.join(ROOT, 'output', `${stamp}-${id}`);
mkdirSync(exportDir, { recursive: true });
let video = null;
if (entry?.video && existsSync(path.resolve(ROOT, entry.video))) {
  const target = path.join(exportDir, 'video.mp4');
  copyFileSync(path.resolve(ROOT, entry.video), target);
  video = { path: path.relative(ROOT, target), sha256: sha256(readFileSync(target)), pipelineCopy: entry.video };
}
const provenance = {
  schemaVersion: 'one-shot-video/v1',
  prompt,
  source: source ? { kind: 'file', path: source, sha256: sha256(readFileSync(source)) } : { kind: 'url', url },
  requestedDurationSec: Number(duration),
  code: { commit: before.commit, tree: before.tree, distSha256: distHashBefore },
  codeAfterRun: { commit: after.commit, tree: after.tree, dirty: after.dirty || null, distSha256: distHashAfter },
  tampered,
  command: ['node', ...cliArgs],
  startedAt,
  completedAt,
  pipelineExitCode: run.status,
  pipelineStatus: entry?.status ?? 'no-summary',
  hardFailures: entry?.hardFailures ?? null,
  failureDetails: entry?.failureDetails ?? null,
  metrics: entry?.metrics ?? null,
  costUsd: entry?.costUsd ?? null,
  plannedDurationSec: entry?.plannedDurationSec ?? null,
  coverageReason: entry?.coverageReason ?? null,
  actualNarratedDurationSec: entry?.actualNarratedDurationSec ?? null,
  finalVideoDurationSec: entry?.finalVideoDurationSec ?? null,
  videoScenes: entry?.scenes ?? null,
  plannedScenes: entry?.planned ?? null,
  runOutputDir: entry?.outputDir ?? outBase,
  summaryFile: summaryFile ? path.join(outBase, summaryFile) : null,
  error: entry?.error ?? null,
  video,
};
writeFileSync(path.join(exportDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`\none-shot: status=${provenance.pipelineStatus} tampered=${tampered} video=${video?.path ?? 'NONE'}\none-shot: provenance=${path.relative(ROOT, path.join(exportDir, 'provenance.json'))}`);
process.exit(tampered ? 3 : run.status ?? 1);

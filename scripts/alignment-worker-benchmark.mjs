#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { alignAudio, closeAlignmentWorkers } from '../dist/src/shared/alignment/align.js';
import { alignedWordTimingProblems, tokenizeWords } from '../dist/src/narration/align.js';

function args(argv) {
  const parsed = new Map();
  for (const item of argv) {
    if (!item.startsWith('--') || !item.includes('=')) continue;
    const index = item.indexOf('=');
    const key = item.slice(2, index);
    const values = parsed.get(key) ?? [];
    values.push(item.slice(index + 1));
    parsed.set(key, values);
  }
  return parsed;
}

const options = args(process.argv.slice(2));
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/alignment-worker-benchmark.mjs --run-dir=<generated-run> [--run-dir=<generated-run> ...] [--model=base] [--workers=1,2] [--scenes-per-run=3] [--repeats=3] [--out=.data/alignment-review/worker-benchmark.json]');
  console.log('Diagnostic only; does not create human ground truth or update alignment calibration.');
  process.exit(0);
}

const runDirs = options.get('run-dir') ?? [];
if (!runDirs.length) throw new Error('at least one --run-dir=<source-generated-run> is required');
const model = options.get('model')?.at(-1) ?? 'base';
const workerSizes = (options.get('workers')?.at(-1) ?? '1,2').split(',').map(Number);
const scenesPerRun = Number(options.get('scenes-per-run')?.at(-1) ?? 3);
const repeats = Number(options.get('repeats')?.at(-1) ?? 1);
if (!workerSizes.length || workerSizes.some((size) => !Number.isInteger(size) || size < 1 || size > 8)) throw new Error('--workers must be comma-separated integers from 1 to 8');
if (!Number.isInteger(scenesPerRun) || scenesPerRun < 1) throw new Error('--scenes-per-run must be a positive integer');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeats must be an integer from 1 to 10');

const samples = [];
const seenSources = new Set();
for (const rawDir of runDirs) {
  const runDir = path.resolve(rawDir);
  const manifest = JSON.parse(await readFile(path.join(runDir, 'run-manifest.json'), 'utf8'));
  const evaluation = JSON.parse(await readFile(path.join(runDir, 'evaluation-bundle.json'), 'utf8'));
  if (manifest.runClass !== 'generated-lesson' || evaluation.runClass !== 'generated-lesson' || manifest.runId !== evaluation.runId) {
    throw new Error(`refusing non-generated or mismatched run: ${runDir}`);
  }
  const sourceHash = manifest.stages?.sourceDoc;
  if (typeof sourceHash !== 'string' || !sourceHash) throw new Error(`generated run has no source hash: ${runDir}`);
  if (seenSources.has(sourceHash)) throw new Error(`duplicate SourceDoc hash; choose independent source runs: ${runDir}`);
  seenSources.add(sourceHash);
  const narration = JSON.parse(await readFile(path.join(runDir, 'narration.json'), 'utf8'));
  for (const scene of narration.scenes.slice(0, scenesPerRun)) {
    samples.push({
      runId: manifest.runId,
      sourceHash,
      runDir,
      sceneId: scene.sceneId,
      audioPath: path.join(runDir, 'scene-audio', `${scene.sceneId}.wav`),
      text: scene.plainText,
    });
  }
}

const report = {
  schemaVersion: 'alignment-worker-benchmark/v1',
  evidenceClass: 'diagnostic-only-not-human-calibration',
  createdAt: new Date().toISOString(),
  model: `stable-ts/faster-whisper-${model}`,
  workerTrials: [],
  workerSummaries: [],
  inputRuns: [...new Map(samples.map(({ runId, sourceHash, runDir }) => [runId, { runId, sourceHash, runDir }])).values()],
};

for (const workerPoolSize of workerSizes) {
  const repeatWallMs = [];
  let invalidIntervalCount = 0;
  let tokenSequenceMatchCount = 0;
  for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex++) {
  const totalStarted = performance.now();
  const scenes = await Promise.all(samples.map(async (sample) => {
    const started = performance.now();
    const aligned = await alignAudio(sample.audioPath, sample.text, { language: 'en', model, workerPoolSize });
    const wallMs = Math.round(performance.now() - started);
    const intervalProblems = alignedWordTimingProblems(
      aligned.words.map(({ word, startMs, endMs }) => ({ w: word, startMs, endMs })),
      aligned.durationMs,
    );
    const expectedTokens = tokenizeWords(sample.text);
    const actualTokens = aligned.words.flatMap(({ word }) => tokenizeWords(word));
    return {
      runId: sample.runId,
      sourceHash: sample.sourceHash,
      sceneId: sample.sceneId,
      wallMs,
      audioDurationMs: aligned.durationMs,
      expectedTokenCount: expectedTokens.length,
      alignedTokenCount: actualTokens.length,
      tokenSequenceMatches: expectedTokens.join('\u0000') === actualTokens.join('\u0000'),
      invalidIntervalCount: intervalProblems.length,
      intervalProblems,
    };
  }));
  const totalWallMs = Math.round(performance.now() - totalStarted);
  repeatWallMs.push(totalWallMs);
  invalidIntervalCount += scenes.reduce((sum, scene) => sum + scene.invalidIntervalCount, 0);
  tokenSequenceMatchCount += scenes.filter((scene) => scene.tokenSequenceMatches).length;
  report.workerTrials.push({
    workerPoolSize,
    repeatIndex: repeatIndex + 1,
    totalWallMs,
    sceneCount: scenes.length,
    tokenSequenceMatchCount: scenes.filter((scene) => scene.tokenSequenceMatches).length,
    invalidIntervalCount: scenes.reduce((sum, scene) => sum + scene.invalidIntervalCount, 0),
    scenes,
  });
  await closeAlignmentWorkers();
  }
  const sorted = [...repeatWallMs].sort((a, b) => a - b);
  report.workerSummaries.push({
    workerPoolSize,
    repeats,
    p50WallMs: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95WallMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
    invalidIntervalCount,
    tokenSequenceMatchCount,
    tokenSequenceSampleCount: samples.length * repeats,
  });
}

const outputPath = path.resolve(options.get('out')?.at(-1) ?? `.data/alignment-review/alignment-worker-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report: outputPath, model: report.model, sceneCount: samples.length, workerSummaries: report.workerSummaries }, null, 2));

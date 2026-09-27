#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compareBoardMetrics, type BoardMetricsSummary, type SimiReferenceV1 } from './boardMetrics.js';

/**
 * Numeric board-metrics CLI (Task 11, structural only).
 *
 * --reference [--ref <path>] prints the frozen reference band.
 * --check [--ref <path> --index <path>] verifies the frozen reference matches
 *   index.json scene count and duration stats; exits non-zero on mismatch.
 * --compare --summary <ours-summary.json> [--ref <path>] prints ours-vs-reference
 *   deltas for the determinant report. No video decoding, no pixel similarity.
 */

const args = process.argv.slice(2);
const flag = (key: string): string | undefined =>
  args.find((v) => v.startsWith(`--${key}=`))?.slice(key.length + 3);
const has = (key: string): boolean => args.includes(`--${key}`);

const resolveRef = (): string => path.resolve(flag('ref') ?? 'harness/reference/lamina/metrics.v1.json');

async function printReference(): Promise<void> {
  process.stdout.write(`${await readFile(resolveRef(), 'utf8')}`);
}

async function checkReference(): Promise<void> {
  const ref = JSON.parse(await readFile(resolveRef(), 'utf8')) as SimiReferenceV1;
  const indexPath = path.resolve(flag('index') ?? 'harness/reference/lamina/index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as Array<{ startS: number; endS: number; sampleTimesS: number[] }>;
  const durations = index.map((s) => s.endS - s.startS).sort((a, b) => a - b);
  const median = durations.length % 2
    ? durations[Math.floor(durations.length / 2)]!
    : (durations[durations.length / 2 - 1]! + durations[durations.length / 2]!) / 2;
  const problems: string[] = [];
  if (ref.sceneCount !== index.length) problems.push(`sceneCount ${ref.sceneCount} !== index entries ${index.length}`);
  if (ref.sceneDurationSec.median !== median) problems.push(`median ${ref.sceneDurationSec.median} !== index median ${median}`);
  if (ref.sceneDurationSec.min !== durations[0]) problems.push('min mismatch');
  if (ref.sceneDurationSec.max !== durations[durations.length - 1]) problems.push('max mismatch');
  if (!index.every((s) => s.sampleTimesS.length === 6)) problems.push('sample cadence changed');
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`reference ok: ${index.length} scenes, median ${median}s\n`);
}

async function compareSummary(): Promise<void> {
  const summaryPath = flag('summary');
  if (!summaryPath) throw new Error('--summary=<ours-summary.json> is required with --compare');
  const ours = JSON.parse(await readFile(path.resolve(summaryPath), 'utf8')) as BoardMetricsSummary;
  const ref = JSON.parse(await readFile(resolveRef(), 'utf8')) as SimiReferenceV1;
  process.stdout.write(`${JSON.stringify(compareBoardMetrics(ours, ref), null, 2)}\n`);
}

async function main(): Promise<void> {
  if (has('check')) {
    await checkReference();
    return;
  }
  if (has('compare')) {
    await compareSummary();
    return;
  }
  await printReference();
}

await main();

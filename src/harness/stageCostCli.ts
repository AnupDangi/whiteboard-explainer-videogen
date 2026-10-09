#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { StructuredCallReport } from '../llm/structuredCall.js';
import { computeStructuredMetrics } from './structuredMetrics.js';
import { stageCostRows, v2RemainderUsd, type StageRunRecord } from './stageCost.js';

/** Usage: node dist/src/harness/stageCostCli.js <run-dir>...  (offline; reads retained run files only) */
const runDirs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const json = async <T>(file: string): Promise<T | undefined> => { try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return undefined; } };

async function structuredReports(run: string): Promise<StructuredCallReport[]> {
  const root = path.join(run, 'structured');
  const out: StructuredCallReport[] = [];
  for (const stage of await readdir(root).catch(() => [] as string[])) {
    for (const call of await readdir(path.join(root, stage)).catch(() => [] as string[])) {
      const report = await json<StructuredCallReport>(path.join(root, stage, call, 'report.json'));
      if (report) out.push(report);
    }
  }
  return out;
}

async function main(): Promise<void> {
  if (!runDirs.length) { process.stderr.write('usage: stageCostCli.js <run-dir>...\n'); process.exitCode = 2; return; }
  const perRun: StageRunRecord[][] = [];
  const reports: StructuredCallReport[] = [];
  let remainder = 0; let total = 0;
  for (const run of runDirs) {
    const prep = await json<{ stageRuns?: StageRunRecord[] }>(path.join(run, 'lesson-prep.json'));
    const bundle = await json<{ usage?: { costUsd?: number } }>(path.join(run, 'evaluation-bundle.json'));
    const stageRuns = prep?.stageRuns ?? [];
    perRun.push(stageRuns);
    reports.push(...await structuredReports(run));
    const runTotal = bundle?.usage?.costUsd ?? 0;
    total += runTotal; remainder += v2RemainderUsd(runTotal, stageRuns);
  }
  process.stdout.write('stage\tmodels\truns\tfailed\tcostUsd\tmeanDurationMs\n');
  for (const row of stageCostRows(perRun)) process.stdout.write(`${row.stage}\t${row.models.join(',') || '-'}\t${row.runs}\t${row.failed}\t${row.costUsd.toFixed(6)}\t${Math.round(row.meanDurationMs)}\n`);
  process.stdout.write(`S4+S6 (derived: evaluation total - prep stages)\t-\t${runDirs.length}\t-\t${remainder.toFixed(6)}\t-\n`);
  process.stdout.write(`TOTAL\t-\t${runDirs.length}\t-\t${total.toFixed(6)}\t-\n`);
  const metrics = computeStructuredMetrics(reports);
  for (const [cls, rate] of Object.entries(metrics.firstTryValid)) process.stdout.write(`firstTryValid.${cls}\t${rate.valid}/${rate.calls}\n`);
}

main().catch((error: unknown) => { process.stderr.write(`stage cost failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });

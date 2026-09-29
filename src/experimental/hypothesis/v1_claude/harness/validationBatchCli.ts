#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildBatchPlan,
  parseBatchArgs,
  provenanceRowFor,
  renderBatchSummaryMarkdown,
  requireLiveConfirmation,
  summarizeBatchRuns,
  type BatchProvenanceRow,
  type ParsedBatchArgs,
} from './validationBatch.js';

/**
 * Live validation batch runner (Task 12).
 *
 * NEVER auto-runs: refuses without an explicit --confirm-live flag and
 * refuses on a dirty tracked tree. Each combo shells out to
 * scripts/one-shot-video.mjs, which re-applies its own locked-commit
 * guards (clean tree before/after, dist hash, tampered flag).
 *
 * Usage: validate:batch --prompt="..." --source=<file> [--source=...]
 *   [--duration=60[,300]] [--report-dir=<dir>] [--id-prefix=<p>] --confirm-live
 *
 * Report dir receives batch-report.json + SUMMARY.md with one row per run
 * (status/hard/cost/tampered). This command spends provider budget.
 */

const fail = (message: string, code = 2): never => {
  console.error(`validate:batch: ${message}`);
  process.exit(code);
};

const git = (root: string, ...args: string[]): string => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', '..');
  const parsed = ((): ParsedBatchArgs => {
    try {
      const value = parseBatchArgs(process.argv.slice(2));
      requireLiveConfirmation(value);
      return value;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  })();
  for (const source of parsed.sources) {
    if (!existsSync(path.resolve(root, source)) && !existsSync(source)) fail(`source not found: ${source}`);
  }
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no');
  if (dirty) fail(`tracked files differ from HEAD; commit or stash first:\n${dirty}`);
  const commit = git(root, 'rev-parse', 'HEAD');

  const plan = buildBatchPlan(parsed);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.resolve(root, parsed.reportDir ?? path.join('output', `validation-batch-${stamp}`));
  mkdirSync(reportDir, { recursive: true });

  const rows: BatchProvenanceRow[] = [];
  let infraFailures = 0;
  for (const spec of plan) {
    const run = spawnSync(
      process.execPath,
      [
        path.join(root, 'scripts', 'one-shot-video.mjs'),
        `--prompt=${parsed.prompt}`,
        `--source=${spec.source}`,
        `--duration=${String(spec.durationSec)}`,
        `--id=${spec.id}`,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    process.stdout.write(run.stdout ?? '');
    process.stderr.write(run.stderr ?? '');
    const combined = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    const match = combined.match(/one-shot: provenance=(\S+)/);
    const provenancePath = match ? path.resolve(root, match[1]) : null;
    let provenance: Record<string, unknown> | null = null;
    if (provenancePath && existsSync(provenancePath)) {
      provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as Record<string, unknown>;
    } else {
      infraFailures += 1;
    }
    const row = provenanceRowFor(spec, provenance, run.status ?? 1, provenancePath);
    rows.push(row);
    if (row.tampered) infraFailures += 1;
    console.log(`validate:batch: ${spec.id} status=${row.status} tampered=${row.tampered} cost=${row.costUsd ?? 'n/a'}`);
  }

  const summary = summarizeBatchRuns(rows);
  writeFileSync(path.join(reportDir, 'batch-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(
    path.join(reportDir, 'SUMMARY.md'),
    renderBatchSummaryMarkdown(summary, { commit, modelNote: 'per-run costUsd from one-shot provenance.json' }),
  );
  console.log(`validate:batch: report=${path.relative(root, reportDir)} runs=${rows.length} tampered=${summary.totals.tamperedCount}`);
  if (summary.totals.tamperedCount > 0) fail('one or more runs report tampered code state', 3);
  if (infraFailures > 0) fail(`${infraFailures} run(s) missing provenance or tampered`, 1);
}

await main();

#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadOpenRouterEnv } from '../planner/env.js';
import { PLAN_PROMPT_VARIANTS, type PlanPromptVariant } from '../plan/stages.js';
import { pickWinningVariant, runPlanCalibration, type CalibrationSourceSpec } from './planCalibration.js';
import { argValue } from '../cli/args.js';

/**
 * Measure S3 prompt variants against real cold OpenRouter calls on a small, fixed, non-golden
 * held-out source set, and report a per-variant pass rate and failure-code breakdown.
 * Usage: node planCalibrationCli.js [--repeats=3] [--variants=v3-baseline,v4-explicit-concepts] [--model=<id>] [--out=harness/reports]
 */
const HELD_OUT_SOURCES: CalibrationSourceSpec[] = [
  { id: 'ocean-tides', path: '.data/sources/ocean-tides.md', targetDurationSec: 60 },
  { id: 'bicycle-balance', path: '.data/sources/bicycle-balance.md', targetDurationSec: 60 },
  { id: 'composting', path: '.data/sources/composting.md', targetDurationSec: 60 },
  { id: 'rainbow-formation', path: '.data/sources/rainbow-formation.md', targetDurationSec: 60 },
  { id: 'mirror-images', path: '.data/sources/mirror-images.md', targetDurationSec: 60 },
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (key: string) => argValue(args, key);
  const env = await loadOpenRouterEnv();
  const model = arg('model') ?? env.contentModel;
  const repeats = Number(arg('repeats') ?? '3');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeats must be an integer from 1 to 10');
  const variantNames = (arg('variants') ?? Object.keys(PLAN_PROMPT_VARIANTS).join(',')).split(',').map((v) => v.trim());
  for (const name of variantNames) if (!(name in PLAN_PROMPT_VARIANTS)) throw new Error(`unknown plan prompt variant: ${name}`);
  const variants = variantNames as PlanPromptVariant[];
  const outDir = arg('out') ?? 'harness/reports';

  const report = await runPlanCalibration({ sources: HELD_OUT_SOURCES, variants, repeatsPerSource: repeats, model, apiKey: env.apiKey });
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `${stamp}-plan-calibration.json`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines: string[] = [
    `# S3 plan calibration — ${stamp}`,
    '',
    `Model: ${report.model}`,
    `Sources (${report.sources.length}, held-out, non-G-10): ${report.sources.join(', ')}`,
    `Repeats per source: ${report.repeatsPerSource}`,
    '',
  ];
  if (report.skippedSources.length > 0) {
    lines.push('## Skipped sources (S2 failed twice — no S3 data)', '');
    for (const skipped of report.skippedSources) lines.push(`- ${skipped.sourceId}: ${skipped.reason}`);
    lines.push('');
  }
  for (const summary of report.variants) {
    lines.push(`## ${summary.variant}`, `Pass rate: ${summary.passed}/${summary.attempts} (${(summary.passRate * 100).toFixed(0)}%)`, `Total cost: $${summary.totalCostUsd.toFixed(4)}`, 'Failure codes:');
    const sortedCodes = Object.entries(summary.failureCodeCounts).sort((a, b) => b[1] - a[1]);
    if (sortedCodes.length === 0) lines.push('- (none)');
    for (const [code, count] of sortedCodes) lines.push(`- ${code}: ${count}`);
    lines.push('');
  }
  const winner = pickWinningVariant(report);
  lines.push(`**Winning variant (highest measured pass rate, ties broken by fewest failure-code occurrences): ${winner}**`);
  const mdPath = path.join(outDir, `${stamp}-plan-calibration.md`);
  await writeFile(mdPath, `${lines.join('\n')}\n`);

  console.log(JSON.stringify({ report: jsonPath, summary: mdPath, winner }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadOpenRouterEnv } from '../planner/env.js';
import { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { runReliability } from './reliability.js';
import { argValue } from '../cli/args.js';

const DEFAULT_SOURCES = [
  'ocean-tides', 'bicycle-balance', 'composting', 'rainbow-formation', 'mirror-images',
].map((id) => ({ id, path: `.data/sources/${id}.md` }));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (key: string) => argValue(args, key);
  const sourceArg = arg('sources');
  const sources = sourceArg
    ? sourceArg.split(',').map((value) => {
      const separator = value.indexOf(':');
      if (separator < 1 || separator === value.length - 1) throw new Error(`invalid source spec ${value}; expected id:path`);
      return { id: value.slice(0, separator), path: value.slice(separator + 1) };
    })
    : DEFAULT_SOURCES;
  const durationsSec = (arg('durations') ?? '60').split(',').map(Number);
  if (!durationsSec.length || durationsSec.some((duration) => !Number.isFinite(duration) || duration <= 0)) throw new Error('--durations must be positive finite seconds');
  const repeats = Number(arg('repeats') ?? '3');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeats must be an integer from 1 to 10');
  const budgetUsd = Number(arg('budget') ?? '1.00');
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > 1) throw new Error('--budget must be a finite amount from $0 to $1.00');

  const env = await loadOpenRouterEnv();
  const model = arg('model') ?? env.contentModel;
  const stamp = new Date().toISOString().slice(0, 10);
  const ledgerPath = path.join('.data', 'reliability', stamp, 'budget-ledger.json');
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const budgetLedger = new PersistentBudgetLedger(ledgerPath, budgetUsd);
  const report = await runReliability({ sources, durationsSec, repeats, model, apiKey: env.apiKey, budgetUsd, budgetLedger });

  const outputDir = 'harness/reports';
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${stamp}-reliability.json`);
  const mdPath = path.join(outputDir, `${stamp}-reliability.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    `# S1–S4 reliability — ${stamp}`,
    '',
    `Model: ${report.model}`,
    `Sources: ${sources.map((source) => source.id).join(', ')}`,
    `Durations (seconds): ${durationsSec.join(', ')}`,
    ...(durationsSec.some((duration) => duration > 60) ? ['Durations above 60 seconds are unimplemented long-form diagnostics.'] : []),
    `Repeats per source and duration: ${repeats}`,
    `Total cost: $${report.totalCostUsd.toFixed(4)}`,
    '',
    '| stage | pass rate |',
    '| --- | ---: |',
    `| S2 | ${report.byStage.s2PassRate.toFixed(3)} |`,
    `| S3, conditional on reaching S3 | ${report.byStage.s3PassRate.toFixed(3)} |`,
    `| S4, conditional on reaching S4 | ${report.byStage.s4PassRate.toFixed(3)} |`,
    `| End to end | ${report.byStage.endToEndPassRate.toFixed(3)} |`,
    '',
    '## Failure codes',
    '',
  ];
  const failureCodes = Object.entries(report.failureCodeCounts).sort(([leftCode, leftCount], [rightCode, rightCount]) => rightCount - leftCount || leftCode.localeCompare(rightCode));
  if (!failureCodes.length) lines.push('- (none)');
  else for (const [code, count] of failureCodes) lines.push(`- ${code}: ${count}`);
  lines.push('');
  await writeFile(mdPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ report: jsonPath, summary: mdPath, ledger: ledgerPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

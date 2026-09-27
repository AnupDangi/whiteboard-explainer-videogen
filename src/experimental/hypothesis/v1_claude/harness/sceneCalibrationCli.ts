#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadOpenRouterEnv } from '../planner/env.js';
import type { PromptArm } from '../planner/exemplars.js';
import { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { loadSceneCalibrationItems, runSceneCalibration } from './sceneCalibration.js';
import { argValue } from '../cli/args.js';

const VALID_ARMS: PromptArm[] = ['zero', 'text', 'mechanism', 'diverse'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (key: string) => argValue(args, key);
  const runDirs = (arg('runs') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!runDirs.length) throw new Error('--runs=<dir1,dir2,...> is required');

  const armNames = (arg('arms') ?? 'zero,mechanism').split(',').map((value) => value.trim()).filter(Boolean);
  for (const arm of armNames) if (!VALID_ARMS.includes(arm as PromptArm)) throw new Error(`unknown prompt arm: ${arm}`);
  const arms = armNames as PromptArm[];
  if (!arms.length) throw new Error('--arms must include at least one prompt arm');

  const repeats = Number(arg('repeats') ?? '2');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeats must be an integer from 1 to 10');
  const budgetUsd = Number(arg('budget') ?? '1.00');
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > 1) throw new Error('--budget must be a finite amount from $0 to $1.00');

  const env = await loadOpenRouterEnv();
  const model = arg('model') ?? env.sceneModel;
  const stamp = new Date().toISOString().slice(0, 10);
  const ledgerPath = path.join('.data', 'scene-calibration', stamp, 'budget-ledger.json');
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const budgetLedger = new PersistentBudgetLedger(ledgerPath, budgetUsd);
  const items = await loadSceneCalibrationItems(runDirs.map((dir) => path.resolve(dir)));
  if (!items.length) throw new Error('no calibration scenes found in the supplied run directories');

  const report = await runSceneCalibration({ items, arms, repeats, model, apiKey: env.apiKey, budgetLedger });
  await mkdir('harness/reports', { recursive: true });
  const jsonPath = path.join('harness/reports', `${stamp}-scene-calibration.json`);
  const mdPath = path.join('harness/reports', `${stamp}-scene-calibration.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    'Result class: diagnostic-calibration — not E5 evidence; S5 is uncalibrated and no video was reviewed.',
    '',
    `Model: ${report.model}`,
    `Runs: ${runDirs.join(', ')}`,
    `Repeats: ${repeats}`,
    '',
    '| arm | attempts | valid | validRate | listSceneRate | meanObjectShare | meanEdges | templateDiversity | cost |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.arms.map((summary) => `| ${summary.arm} | ${summary.attempts} | ${summary.valid} | ${summary.validRate.toFixed(3)} | ${summary.richness.listSceneRate.toFixed(3)} | ${summary.richness.meanObjectShare.toFixed(3)} | ${summary.richness.meanEdges.toFixed(3)} | ${summary.richness.templateDiversity} | $${summary.totalCostUsd.toFixed(4)} |`),
    '',
  ];
  await writeFile(mdPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ report: jsonPath, summary: mdPath, ledger: ledgerPath, scenes: items.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { calibrateE4Thresholds } from './e4Calibration.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const inputPath = arg('input');
  if (!inputPath) throw new Error('Usage: e4CalibrationCli.js --input=<e4-labeled-pairs.json> [--out=<report.json>]');
  const input = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  const report = calibrateE4Thresholds(input);
  const output = path.resolve(arg('out') ?? 'harness/reports/e4-calibration.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`E4 calibration: ${report.status}; pairs=${report.sampleSize}; humanChecks=${report.humanChecked}; threshold=${report.selectedThreshold ?? 'none'}; report=${output}`);
  for (const reason of report.reasons) console.log(`  ${reason}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

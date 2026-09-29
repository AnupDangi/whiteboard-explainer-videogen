#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluateE1HumanVotes } from './humanReview.js';
import { argValue } from '../cli/args.js';

function parseInput(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch (error) { return { __parseError: error instanceof Error ? error.message : String(error) }; }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (key: string) => argValue(args, key);
  const keyPath = arg('key');
  const votePaths = (arg('votes') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const outPath = arg('out') ?? 'harness/reports/e1-human-report.json';
  if (!keyPath || votePaths.length !== 2) throw new Error('Usage: humanReviewCli.js --key=<sealed-answer-key.json> --votes=<judge-1.json,judge-2.json> [--out=<report.json>]');
  const [keyText, ...voteTexts] = await Promise.all([keyPath, ...votePaths].map((file) => readFile(file, 'utf8')));
  const report = evaluateE1HumanVotes(parseInput(keyText), voteTexts.map(parseInput));
  const output = path.resolve(outPath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`E1 human review: ${report.status} (${report.judges.length}/2 valid judges); report=${output}`);
  for (const reason of report.reasons) console.log(`  ${reason}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

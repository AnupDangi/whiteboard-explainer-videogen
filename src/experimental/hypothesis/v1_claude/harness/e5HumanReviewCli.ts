#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluateE5HumanVotes } from './e5HumanReview.js';
import { auditE5Organizer } from './e5HumanReviewAudit.js';

function parseInput(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch (error) { return { __parseError: error instanceof Error ? error.message : String(error) }; }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const keyPath = arg('key');
  const organizerPath = arg('organizer');
  const votePaths = (arg('votes') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const outPath = arg('out') ?? 'harness/reports/e5-human-report.json';
  if (!keyPath || !organizerPath || votePaths.length !== 2) throw new Error('Usage: e5HumanReviewCli.js --key=<sealed-e5-key.json> --organizer=<organizer-record.json> --votes=<judge-1.json,judge-2.json> [--out=<report.json>]');
  const [keyText, organizerText, ...voteTexts] = await Promise.all([keyPath, organizerPath, ...votePaths].map((file) => readFile(file, 'utf8')));
  const audit = auditE5Organizer(parseInput(keyText), parseInput(organizerText), keyText, organizerText);
  const scored = evaluateE5HumanVotes(parseInput(keyText), voteTexts.map(parseInput));
  const report = audit.status === 'verified'
    ? { ...scored, organizerAudit: audit }
    : { ...scored, status: 'unmeasured' as const, aggregateByTreatment: [], judges: [], organizerAudit: audit, reasons: [...new Set([...scored.reasons, ...audit.reasons])] };
  const output = path.resolve(outPath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`E5 human review: ${report.status} (${report.judges.length}/2 valid judges); cases=${report.distinctCases}; report=${output}`);
  for (const reason of report.reasons) console.log(`  ${reason}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

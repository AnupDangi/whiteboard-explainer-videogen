#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateReleaseEvidence, RELEASE_GATE_VERSION, type ReleaseEvidence, type ReleaseGateReport } from './releaseGate.js';
import { collectReleaseArtifactEvidence } from './releaseArtifactVerifier.js';

export interface ReleaseGateCliReport extends ReleaseGateReport {
  artifactVerification: { status: 'unverified'; inputSha256: string; reasons: string[] };
  calculatedPreview: ReleaseGateReport;
}

/** Caller-supplied metrics are useful for threshold unit tests, never release proof. */
export function unverifiedArtifactReport(report: ReleaseGateReport, inputSha256: string): ReleaseGateCliReport {
  const reason = 'evidence was supplied as JSON and was not derived from hash-verified run, lock, render, benchmark, and reviewer artifacts';
  const gates = Object.fromEntries(Object.entries(report.gates).map(([name]) => [name, {
    status: 'unmeasured' as const,
    reasons: [reason],
  }])) as ReleaseGateReport['gates'];
  return {
    ...report,
    status: 'unmeasured',
    gates,
    artifactVerification: { status: 'unverified', inputSha256, reasons: [reason] },
    calculatedPreview: report,
  };
}

function option(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = option(args, 'input');
  const output = option(args, 'output');
  const runs = option(args, 'runs');
  const projectRoot = option(args, 'project-root');
  if (args.some((arg) => !arg.startsWith('--input=') && !arg.startsWith('--output=') && !arg.startsWith('--runs=') && !arg.startsWith('--project-root='))
      || Boolean(input) === Boolean(runs) || (runs && !projectRoot) || (input && projectRoot)) {
    throw new Error('usage: release:gates (--input=<unverified-evidence.json> | --runs=<dir1,dir2,...> --project-root=<repo>) [--output=<report.json>]');
  }
  const outputPath = path.resolve(output ?? path.join(path.dirname(path.resolve(input ?? projectRoot!)), 'release-gate-report.json'));
  mkdirSync(path.dirname(outputPath), { recursive: true });
  if (runs) {
    const directories = runs.split(',').map((item) => item.trim()).filter(Boolean);
    if (!directories.length) throw new Error('--runs must name at least one run directory');
    const collection = await collectReleaseArtifactEvidence(directories, path.resolve(projectRoot!));
    const evidence: ReleaseEvidence = { topicIds: collection.topicIds, attempts: collection.attempts.map(({ attempt }) => attempt) };
    const calculated = evaluateReleaseEvidence(evidence);
    const overall = collection.status === 'failed' || calculated.status === 'failed'
      ? 'failed'
      : collection.status === 'unmeasured' || calculated.status === 'unmeasured' ? 'unmeasured' : 'passed';
    const report = {
      ...calculated,
      status: overall,
      artifactVerification: { status: collection.status, reasons: collection.reasons, integrity: collection.attempts.map(({ directory, integrity, reasons }) => ({ directory, integrity, reasons })) },
      unmeasuredEvidence: { humanReview: collection.humanReview, heldOut: collection.heldOut, assetRights: collection.assetRights, limitations: collection.limitations },
    };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`release:gates: status=${report.status} report=${outputPath}`);
    for (const [name, gate] of Object.entries(report.gates)) console.log(`  ${gate.status.padEnd(10)} ${name}: ${gate.reasons.join('; ')}`);
    process.exitCode = report.status === 'passed' ? 0 : 2;
    return;
  }
  if (!input) throw new Error('release:gates needs an input evidence file or verified run directories');
  const inputPath = path.resolve(input);
  const envelope: unknown = JSON.parse(readFileSync(inputPath, 'utf8'));
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('evidence file must contain a JSON object');
  }
  const raw = envelope as Record<string, unknown>;
  if (raw['schemaVersion'] !== RELEASE_GATE_VERSION || !raw['evidence'] || typeof raw['evidence'] !== 'object' || Array.isArray(raw['evidence'])) {
    throw new Error(`evidence file must use schemaVersion ${RELEASE_GATE_VERSION} and include an evidence object`);
  }
  const calculated = evaluateReleaseEvidence(raw['evidence'] as ReleaseEvidence);
  const report = unverifiedArtifactReport(calculated, createHash('sha256').update(readFileSync(inputPath)).digest('hex'));
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`release:gates: status=${report.status} report=${outputPath}`);
  for (const [name, gate] of Object.entries(report.gates)) {
    console.log(`  ${gate.status.padEnd(10)} ${name}: ${gate.reasons.join('; ')}`);
  }
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

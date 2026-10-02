#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LaidOutScene, ResolvedScene, Timeline } from '../shared/types.js';
import { allCatalogEntries } from '../assets/semantic.js';
import { auditResolvedScenes } from './iconAudit.js';
import { scoreSimiRubric } from './simiRubric.js';
import { buildTimingReport, type TimedStage } from './timingReport.js';

/** usage: node dist/.../harness/auditCli.js <runDir>  — prints icon audit and the automated Simi rubric subset. */
async function main(runDir: string): Promise<void> {
  const files = await readdir(runDir);
  const sorted = (prefix: string) => files.filter((file) => file.startsWith(prefix) && file.endsWith('.json')).sort();
  const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(runDir, file), 'utf8')) as T;
  const resolved = await Promise.all(sorted('resolved-scene.').map((file) => read<ResolvedScene>(file)));
  const laidOut = await Promise.all(sorted('layout.').map((file) => read<LaidOutScene>(file)));
  const timelines = await Promise.all(sorted('timeline.').map((file) => read<Timeline>(file)));
  const bundle = await read<{ metrics?: Record<string, number>; stageRuns?: TimedStage[] }>('evaluation-bundle.json');
  const manifest = await read<{ executionTiming?: { wallMs?: number; preparationMs?: number } }>('run-manifest.json').catch(() => undefined);
  const concurrent = Number(process.env.AUDIT_CONCURRENT_RUNS) || undefined;
  const audit = auditResolvedScenes(resolved, allCatalogEntries());
  const rubric = scoreSimiRubric({
    scenes: laidOut.map((scene, index) => ({ laidOut: scene, timeline: timelines[index]! })),
    audit,
    metrics: { majorClaimVisualCoverage: bundle.metrics?.['semantic.majorClaimVisualCoverage'] ?? 0, relationCoverage: bundle.metrics?.['semantic.relationEncodingCoverage'] ?? bundle.metrics?.['semantic.majorClaimVisualCoverage'] ?? 0 },
  });
  const timing = manifest?.executionTiming?.wallMs && bundle.stageRuns ? buildTimingReport({ stageRuns: bundle.stageRuns, wallMs: manifest.executionTiming.wallMs, ...(manifest.executionTiming.preparationMs !== undefined ? { preparationMs: manifest.executionTiming.preparationMs } : {}), mediaMs: (bundle.metrics?.['realNarratedMs'] ?? 0) + (bundle.metrics?.['trailingPadMs'] ?? 0), ...(concurrent ? { concurrentRuns: concurrent } : {}) }) : undefined;
  process.stdout.write(`${JSON.stringify({ runDir, iconAudit: audit.summary, rubric, ...(timing ? { timing } : {}) }, null, 2)}\n`);
}

const runDir = process.argv[2];
if (!runDir) { process.stderr.write('usage: auditCli <runDir>\n'); process.exit(2); }
main(path.resolve(runDir)).catch((error: unknown) => { process.stderr.write(`audit failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });

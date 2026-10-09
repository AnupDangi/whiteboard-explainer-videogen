#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { richnessReport } from './v2RichnessReport.js';
import { readFile } from 'node:fs/promises';
import { loadBadgeReview } from '../assets/badgeReview.js';
import { scoreWrongIcons } from './wrongIcon.js';
import { evaluateRichnessAcceptance } from './richnessAcceptance.js';
import type { RichnessReport } from './v2RichnessReport.js';
import type { V2RichnessSummary } from './v2Richness.js';

/** Offline V2 board richness. Usage: node dist/src/harness/v2RichnessCli.js [--composition=labels|icon-cards] [--json=<out.json>] <run-dir>... */
const args = process.argv.slice(2);
const flag = (key: string): string | undefined => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const runDirs = args.filter((arg) => !arg.startsWith('--'));
const fmt = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(3));
const line = (name: string, s: V2RichnessSummary, extra = ''): string =>
  `${name}\tscenes=${s.scenes}\ticonShare=${fmt(s.iconBearingShare)}\tlabelOnlyEntities=${fmt(s.labelOnlyEntityRatio)}\tassets=${s.distinctAssetIds}\tfamilyMixScenes=${s.familyMixScenes}\tconflicts=${s.assetReuseConflicts}\tminIconPx=${s.minIconSidePx ?? 'n/a'}\ttextChars=${s.meanTextChars.toFixed(1)}\twords=${s.meanWordsOnBoard.toFixed(1)}\tvariety=${s.meanElementVariety.toFixed(2)}${extra}\n`;

async function main(): Promise<void> {
  if (!runDirs.length) { process.stderr.write('usage: v2RichnessCli.js [--composition=labels|icon-cards] [--json=<out.json>] [--review] [--accept --baseline=<json> --projection=<json>] <run-dir>...\n'); process.exitCode = 2; return; }
  const composition = flag('composition') ?? 'labels';
  if (composition !== 'labels' && composition !== 'icon-cards') { process.stderr.write('--composition must be labels or icon-cards\n'); process.exitCode = 2; return; }
  const report = await richnessReport(runDirs, { composition });
  for (const run of report.runs) {
    const note = `${run.complete ? '' : '\t(no video.mp4: excluded from POOLED)'}${run.reason ? `\treason=${run.reason}` : ''}\thardFailures=${run.hardFailures ?? 'n/a'}\treplayHashMismatches=${run.timelineReplayMismatches}`;
    process.stdout.write(line(`${run.lessonId}[${run.status}]`, run.summary, note));
  }
  process.stdout.write(line(`POOLED(${report.composition})`, report.pooled));
  const out = flag('json');
  if (out) { await mkdir(path.dirname(path.resolve(out)), { recursive: true }); await writeFile(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`); }
  const completeIcons = report.runs.filter((run) => run.complete).flatMap((run) => run.icons);
  if (args.includes('--review') || args.includes('--accept')) {
    const score = scoreWrongIcons(completeIcons, loadBadgeReview());
    process.stdout.write(`WRONG-ICON\tuses=${score.uses}\treviewed=${score.reviewed}\twrong=${score.wrong}\tcoverage=${fmt(score.coverage)}\trate=${fmt(score.wrongIconRate)}\tunreviewed=${score.unreviewedKeys.join(',') || '-'}\n`);
    if (args.includes('--accept')) {
      const baselinePath = flag('baseline'); const projectionPath = flag('projection');
      if (!baselinePath || !projectionPath) { process.stderr.write('--accept needs --baseline=<labels.json> and --projection=<icon-cards.json>\n'); process.exitCode = 2; return; }
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as RichnessReport;
      const projection = JSON.parse(await readFile(projectionPath, 'utf8')) as RichnessReport;
      const result = evaluateRichnessAcceptance({ baseline: baseline.pooled, projection: projection.pooled, live: report, wrongIcons: score });
      for (const check of result.checks) process.stdout.write(`${check.pass ? 'PASS' : 'FAIL'}\t${check.name}\t${check.value}\t${check.threshold}\n`);
      process.stdout.write(`ACCEPTANCE ${result.passed ? 'PASSED' : 'FAILED'}\n`);
      if (!result.passed) process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => { process.stderr.write(`v2 richness failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });

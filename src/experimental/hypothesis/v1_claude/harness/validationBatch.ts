import path from 'node:path';

/**
 * Domain-general live validation batch (Task 12, structural only).
 *
 * This module never names lesson topics and never triggers provider calls.
 * It parses CLI arguments, expands N sources x M durations into one-shot
 * specs, and aggregates per-run provenance files into a summary table.
 * The live orchestration lives in validationBatchCli.ts, which refuses to
 * run without an explicit --confirm-live flag and shells out to
 * scripts/one-shot-video.mjs (reusing its clean-tree guards) per combo.
 */

export interface ParsedBatchArgs {
  sources: string[];
  durations: number[];
  prompt: string;
  reportDir?: string;
  confirmLive: boolean;
  idPrefix?: string;
}

export interface BatchRunSpec {
  source: string;
  durationSec: number;
  id: string;
}

export interface BatchProvenanceRow {
  source: string;
  durationSec: number;
  id: string;
  exitCode: number;
  status: string;
  hardFailures: number | null;
  costUsd: number | null;
  tampered: boolean | null;
  finalVideoDurationSec: number | null;
  provenancePath: string | null;
}

export interface BatchSummary {
  runs: BatchProvenanceRow[];
  totals: {
    attempted: number;
    withProvenance: number;
    byStatus: Record<string, number>;
    totalCostUsd: number;
    tamperedCount: number;
  };
}

const usage = (): string =>
  'usage: validate:batch --prompt="..." --source=<file> [--source=<file>...] '
  + '[--duration=60[,300]] [--report-dir=<dir>] [--id-prefix=<p>] --confirm-live';

export function parseBatchArgs(args: string[]): ParsedBatchArgs {
  const values = (key: string): string[] =>
    args.filter((a) => a.startsWith(`--${key}=`)).map((a) => a.slice(key.length + 3));
  const single = (key: string): string | undefined => values(key).at(-1);
  const has = (key: string): boolean => args.includes(`--${key}`);

  const prompt = single('prompt');
  if (!prompt?.trim()) throw new Error(`refusing: --prompt="..." is required\n${usage()}`);
  const sources = values('source');
  if (sources.length === 0) throw new Error(`refusing: at least one --source=<file> is required\n${usage()}`);
  const rawDurations = values('duration').flatMap((v) => v.split(',').map((s) => s.trim())).filter(Boolean);
  const durations = (rawDurations.length ? rawDurations : ['60']).map((d) => Number(d));
  if (durations.some((d) => !Number.isInteger(d) || d <= 0)) {
    throw new Error(`refusing: --duration values must be positive integers of seconds\n${usage()}`);
  }
  const reportDir = single('report-dir');
  if (reportDir !== undefined && !reportDir.trim()) throw new Error(`refusing: --report-dir must not be empty\n${usage()}`);
  const idPrefix = single('id-prefix');
  return {
    sources,
    durations,
    prompt,
    reportDir: reportDir?.trim() || undefined,
    confirmLive: has('confirm-live'),
    idPrefix: idPrefix?.trim() || undefined,
  };
}

/** Refuses unless the caller passed an explicit --confirm-live flag. Never auto-runs. */
export function requireLiveConfirmation(parsed: ParsedBatchArgs): void {
  if (!parsed.confirmLive) {
    throw new Error(
      'refusing: live provider spend requires an explicit --confirm-live flag; '
      + 're-run with --confirm-live to proceed',
    );
  }
}

const slugify = (value: string): string =>
  value.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'run';

/** One run per source x duration. IDs derive from file basenames only. */
export function buildBatchPlan(parsed: ParsedBatchArgs): BatchRunSpec[] {
  const prefix = parsed.idPrefix ? `${slugify(parsed.idPrefix)}-` : '';
  return parsed.sources.flatMap((source) =>
    parsed.durations.map((durationSec) => ({
      source,
      durationSec,
      id: `${prefix}${slugify(path.basename(source, path.extname(source)))}-${durationSec}s`,
    })),
  );
}

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Aggregate one-shot provenance.json payloads (plus exit codes) into a summary. */
export function summarizeBatchRuns(rows: BatchProvenanceRow[]): BatchSummary {
  const byStatus: Record<string, number> = {};
  let totalCostUsd = 0;
  let tamperedCount = 0;
  let withProvenance = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (typeof row.costUsd === 'number') totalCostUsd += row.costUsd;
    if (row.tampered) tamperedCount += 1;
    if (row.provenancePath) withProvenance += 1;
  }
  return { runs: rows, totals: { attempted: rows.length, withProvenance, byStatus, totalCostUsd, tamperedCount } };
}

/** Build a provenance row from a parsed one-shot provenance.json payload. */
export function provenanceRowFor(
  spec: BatchRunSpec,
  provenance: Record<string, unknown> | null,
  exitCode: number,
  provenancePath: string | null,
): BatchProvenanceRow {
  return {
    source: spec.source,
    durationSec: spec.durationSec,
    id: spec.id,
    exitCode,
    status: typeof provenance?.['pipelineStatus'] === 'string' ? (provenance['pipelineStatus'] as string) : 'no-provenance',
    hardFailures: provenance ? asFiniteNumber(provenance['hardFailures']) : null,
    costUsd: provenance ? asFiniteNumber(provenance['costUsd']) : null,
    tampered: typeof provenance?.['tampered'] === 'boolean' ? (provenance['tampered'] as boolean) : null,
    finalVideoDurationSec: provenance ? asFiniteNumber(provenance['finalVideoDurationSec']) : null,
    provenancePath,
  };
}

const cell = (value: string | number | boolean | null): string => (value === null ? 'n/a' : String(value));

/** Markdown summary table: one row per run (status/hard/cost/tampered) plus totals. */
export function renderBatchSummaryMarkdown(summary: BatchSummary, provenance: { commit: string; modelNote: string }): string {
  const lines: string[] = [
    '# Live validation batch — summary',
    '',
    `- Code commit: ${provenance.commit}`,
    `- Models/cost note: ${provenance.modelNote}`,
    `- Runs with provenance: ${summary.totals.withProvenance}/${summary.totals.attempted}`,
    `- Total measured cost: $${summary.totals.totalCostUsd.toFixed(4)}`,
    `- Tampered runs: ${summary.totals.tamperedCount}`,
    '',
    '| source | duration | id | status | hard | costUsd | tampered | videoSec |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of summary.runs) {
    lines.push(
      `| ${row.source} | ${row.durationSec} | ${row.id} | ${row.status} | ${cell(row.hardFailures)} `
      + `| ${cell(row.costUsd)} | ${cell(row.tampered)} | ${cell(row.finalVideoDurationSec)} |`,
    );
  }
  lines.push('', `Status counts: ${JSON.stringify(summary.totals.byStatus)}`, '');
  return `${lines.join('\n')}\n`;
}

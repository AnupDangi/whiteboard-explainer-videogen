/** S9b live migration-gate matrix: drive real V2 jobs through `SemanticJobStore`
 *  and report job success, compile success, wall/first-playable latency and cost
 *  with ONE command. Failed runs stay in the denominator and their error is
 *  printed; no fixture is ever substituted for a provider failure.
 *
 *  Usage:
 *    npm run build && node --env-file-if-exists=.env dist/scripts/live-matrix.js \
 *      --cases mla_compression,water_cycle --runs 3 --budget 1.5
 *    npm run build && node --env-file-if-exists=.env dist/scripts/live-matrix.js --all
 *
 *  Flags:
 *    --cases a,b,c   case ids from eval/semantic/cases/*.json
 *    --all           every case in that directory
 *    --runs N        repetitions per case (default 1)
 *    --budget USD    aggregate spend ceiling; remaining runs are skipped once hit
 *    --out DIR       report directory (default eval/live/reports)
 *    --narration     enable TTS (default off: faster and cheaper)
 *    --scenes N      maxScenes per job (default 1)
 */
import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SemanticJobStore} from '../src/semantic/jobs.js';
import type {SemanticJobSnapshot} from '../src/semantic/jobs.js';
import {createJsonModel} from '../src/semantic/planning/model-adapter.js';
import {createVoiceEngineSpeech} from '../src/semantic/speech.js';
import {mean, percent, percentile} from '../eval/live/metrics.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.findIndex(a => a === `--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name: string): boolean => args.includes(`--${name}`);

interface MatrixCase {
  id: string;
  prompt?: string;
  category?: string;
  preferredArchetypes?: string[];
  sceneFile?: string;
}

type MatrixRunStatus = SemanticJobSnapshot['status'] | 'create-failed' | 'timeout';

interface MatrixRun {
  caseId: string;
  runIndex: number;
  jobId: string | null;
  status: MatrixRunStatus;
  finalGate: string | null;
  publishable: boolean | null;
  wallMs: number;
  firstPlayableMs: number | null;
  scenes: number;
  calls: number;
  costUsd: number;
  modelRoutes: string[];
  semanticRepairCount: number | null;
  error: string | null;
  errorKind: string | null;
}

interface MatrixSkip {
  caseId: string;
  runIndex: number | null;
  reason: string;
}

interface MatrixGate {
  id: string;
  target: string;
  value: string | number | null;
  pass: boolean | null;
  note?: string;
}

interface MatrixReport {
  generatedAt: string;
  command: string;
  cases: string[];
  runsPerCase: number;
  narration: boolean;
  autoMp4: false;
  maxScenes: number;
  budgetUsd: number | null;
  totalRuns: number;
  jobSuccess: {pass: number; total: number; ratePct: number};
  compileSuccess: {pass: number; total: number; ratePct: number};
  latency: {
    method: string;
    wallMs: {P50: number | null; P95: number | null; mean: number | null; n: number};
    firstPlayableMs: {P50: number | null; P95: number | null; mean: number | null; n: number};
  };
  cost: {totalUsd: number; meanUsd: number; totalCalls: number};
  failureReasons: Array<{reason: string; count: number}>;
  migrationGates: MatrixGate[];
  runs: MatrixRun[];
  skipped: MatrixSkip[];
}

const TERMINAL = new Set<SemanticJobSnapshot['status']>([
  'complete', 'partial', 'error', 'cancelled', 'interrupted'
]);
const POLL_MS = 2000;
const MAX_WAIT_MS = 30 * 60 * 1000;
const DEFAULT_PER_JOB_USD = 0.3;
const MIN_BUDGET_USD = 0.02;
const PERCENTILE_METHOD =
  'nearest-rank on ascending values: idx = ceil(p/100 * n) - 1, clamped to >= 0 (eval/live/metrics.ts percentile)';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const pctOr = (values: number[], p: number): number | null =>
  values.length ? percentile(values, p) : null;
const meanOr = (values: number[]): number | null =>
  values.length ? Math.round(mean(values) * 1000) / 1000 : null;

async function findCaseDir(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'eval', 'semantic', 'cases'),
    join(process.cwd(), 'eval', 'semantic', 'cases')
  ];
  for (const candidate of candidates) {
    try { if ((await stat(candidate)).isDirectory()) return candidate; } catch {/* keep looking */}
  }
  throw new Error(`Case directory not found in ${candidates.join(', ')}`);
}

async function loadCases(): Promise<MatrixCase[]> {
  const dir = await findCaseDir();
  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort();
  const cases: MatrixCase[] = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(join(dir, file), 'utf8')) as MatrixCase;
    if (typeof parsed.id !== 'string' || !parsed.id) throw new Error(`Case ${file} has no id`);
    cases.push(parsed);
  }
  return cases;
}

function buildGates(report: {
  jobRatePct: number;
  compileRatePct: number;
  firstP50: number | null;
  narration: boolean;
  total: number;
}): MatrixGate[] {
  const {jobRatePct, compileRatePct, firstP50, narration, total} = report;
  // Thresholds mirror PLAN_TO_IMPLEMENT.md Phase 10 (lines 191-201) and
  // eval/live/gates.ts. Job-snapshot gates are measurable here; gates that
  // need semantic coverage/continuity or human protocols stay PENDING rather
  // than being scored against fabricated zeros.
  return [
    {id: 'compile_success', target: '>= 99%', value: total ? `${compileRatePct}%` : null, pass: total ? compileRatePct >= 99 : null},
    {id: 'full_job_success', target: '>= 95%', value: total ? `${jobRatePct}%` : null, pass: total ? jobRatePct >= 95 : null},
    {
      id: 'first_av_p50',
      target: '<= 12000 ms',
      value: firstP50,
      pass: narration && firstP50 !== null ? firstP50 <= 12000 : null,
      ...(narration ? {} : {note: 'narration disabled: first-playable is reported, first-AV is not measured'})
    },
    {id: 'critical_coverage', target: '= 100%', value: null, pass: null, note: 'needs semantic coverage metrics; not derivable from job snapshots'},
    {id: 'prerequisite_violations', target: '= 0', value: null, pass: null, note: 'needs harness gate findings; not derivable from job snapshots'},
    {id: 'unexplained_resets', target: '= 0', value: null, pass: null, note: 'needs continuity metrics; not derivable from job snapshots'},
    {id: 'continuity', target: '> 90%', value: null, pass: null, note: 'needs continuity metrics; not derivable from job snapshots'},
    {id: 'representation_degradation', target: '~ 0 fallbacks per complete run', value: null, pass: null, note: 'advisory until a dedicated degradation metric lands'},
    {id: 'browser_export_determinism', target: 'unchanged', value: null, pass: null, note: 'owned by the renderer test suite, asserted per wave'},
    {id: 'blind_human_preference', target: 'V2 >= 70%', value: null, pass: null, note: 'pending blind pairwise protocol'},
    {id: 'comprehension_gain', target: 'positive on factual, mechanism, transfer', value: null, pass: null, note: 'pending real-learner pre/post protocol'}
  ];
}

function matrixToMarkdown(report: MatrixReport): string {
  const lines: string[] = [];
  const row = (v: (string | number | null)[]): string => '| ' + v.map(x => x === null ? '—' : String(x)).join(' | ') + ' |';
  lines.push('# Live migration-gate matrix');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Command: \`${report.command}\``);
  lines.push(`Cases: ${report.cases.length} · Runs/case: ${report.runsPerCase} · Total runs: ${report.totalRuns} · narration: ${report.narration} · autoMp4: off · maxScenes: ${report.maxScenes}`);
  lines.push(`Budget: ${report.budgetUsd === null ? 'none' : `$${report.budgetUsd}`}`);
  lines.push('');
  lines.push('## Success rates');
  lines.push(row(['Metric', 'Pass', 'Total', 'Rate']));
  lines.push(row(['---', '---', '---', '---']));
  lines.push(row(['job success (complete AND finalGate PASS)', report.jobSuccess.pass, report.jobSuccess.total, `${report.jobSuccess.ratePct}%`]));
  lines.push(row(['compile success (scenes produced > 0)', report.compileSuccess.pass, report.compileSuccess.total, `${report.compileSuccess.ratePct}%`]));
  lines.push('');
  lines.push('## Latency');
  lines.push(`Percentile method: ${report.latency.method}`);
  lines.push(row(['Metric', 'P50', 'P95', 'Mean', 'n']));
  lines.push(row(['---', '---', '---', '---', '---']));
  lines.push(row(['wallMs', report.latency.wallMs.P50, report.latency.wallMs.P95, report.latency.wallMs.mean, report.latency.wallMs.n]));
  lines.push(row(['firstPlayableMs', report.latency.firstPlayableMs.P50, report.latency.firstPlayableMs.P95, report.latency.firstPlayableMs.mean, report.latency.firstPlayableMs.n]));
  lines.push('');
  lines.push('## Cost');
  lines.push(row(['Total USD', 'Mean USD', 'Total model calls']));
  lines.push(row(['---', '---', '---']));
  lines.push(row([report.cost.totalUsd, report.cost.meanUsd, report.cost.totalCalls]));
  lines.push('');
  lines.push('## Failure reasons');
  lines.push(row(['Reason', 'Count']));
  lines.push(row(['---', '---']));
  if (!report.failureReasons.length) lines.push(row(['(none)', 0]));
  for (const f of report.failureReasons) lines.push(row([f.reason, f.count]));
  lines.push('');
  lines.push('## Migration gates (job-level)');
  lines.push(row(['Gate', 'Target', 'Value', 'Pass']));
  lines.push(row(['---', '---', '---', '---']));
  for (const gate of report.migrationGates) {
    lines.push(row([gate.id, gate.target, gate.value, gate.pass === null ? 'PENDING' : String(gate.pass)]));
  }
  lines.push('');
  lines.push('## Per run');
  lines.push(row(['Case', 'Run', 'Job', 'Status', 'Gate', 'Publishable', 'Wall ms', 'First playable ms', 'Scenes', 'Calls', 'Cost USD', 'Semantic repairs', 'Error']));
  lines.push(row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
  for (const run of report.runs) {
    lines.push(row([
      run.caseId, run.runIndex, run.jobId ?? '—', run.status, run.finalGate ?? '—', run.publishable === null ? null : String(run.publishable),
      run.wallMs, run.firstPlayableMs, run.scenes, run.calls, run.costUsd, run.semanticRepairCount,
      run.error ?? '—'
    ]));
  }
  lines.push('');
  if (report.skipped.length) {
    lines.push('## Skipped');
    lines.push(row(['Case', 'Run', 'Reason']));
    lines.push(row(['---', '---', '---']));
    for (const skip of report.skipped) lines.push(row([skip.caseId, skip.runIndex ?? '—', skip.reason]));
    lines.push('');
  }
  lines.push('## Honesty notes');
  lines.push('- Every attempted run stays in the denominator; failed runs are never replaced by fixtures.');
  lines.push('- `modelRoutes` are the real routes used; budget exhaustion skips are listed separately and not scored.');
  lines.push('- Gates not measurable from job snapshots are PENDING, not passed.');
  lines.push('');
  return lines.join('\n');
}

function printSummary(report: MatrixReport): void {
  console.log('\n=== live matrix summary ===');
  console.log(`job success      : ${report.jobSuccess.pass}/${report.jobSuccess.total} (${report.jobSuccess.ratePct}%)`);
  console.log(`compile success  : ${report.compileSuccess.pass}/${report.compileSuccess.total} (${report.compileSuccess.ratePct}%)`);
  console.log(`wall ms P50/P95  : ${report.latency.wallMs.P50} / ${report.latency.wallMs.P95}`);
  console.log(`first-playable P50/P95: ${report.latency.firstPlayableMs.P50} / ${report.latency.firstPlayableMs.P95}`);
  console.log(`cost total/mean  : $${report.cost.totalUsd} / $${report.cost.meanUsd} · calls ${report.cost.totalCalls}`);
  console.log('migration gates:');
  for (const gate of report.migrationGates) {
    console.log(`  ${gate.pass === null ? 'PENDING' : gate.pass ? 'PASS' : 'FAIL'}  ${gate.id} (target ${gate.target}, value ${gate.value ?? '—'})`);
  }
}

// --- CLI parsing -----------------------------------------------------------
const caseList = (flag('cases') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const all = has('all');
if (!caseList.length && !all) throw new Error('Select cases with --cases a,b,c or --all');
const runsPerCase = Number(flag('runs', '1'));
if (!Number.isInteger(runsPerCase) || runsPerCase < 1) throw new Error('--runs must be a positive integer');
const maxScenes = Number(flag('scenes', '1'));
if (!Number.isInteger(maxScenes) || maxScenes < 1 || maxScenes > 120) throw new Error('--scenes must be 1–120');
const narration = has('narration');
const budgetFlag = flag('budget');
const budgetUsd = budgetFlag === undefined ? null : Number(budgetFlag);
if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd <= 0)) throw new Error('--budget must be a positive number');
const reportDir = resolve(flag('out') ?? 'eval/live/reports');
const jobRoot = resolve('.data/eval/live-matrix/jobs');

// --- case selection --------------------------------------------------------
const allCases = await loadCases();
const selected = all ? allCases : allCases.filter(c => caseList.includes(c.id));
const missing = caseList.filter(id => !allCases.some(c => c.id === id));
if (missing.length) throw new Error(`Unknown case id(s): ${missing.join(', ')}`);
if (!selected.length) throw new Error('No cases selected');

const store = new SemanticJobStore(jobRoot, {
  model: (env, options) => createJsonModel({env, maxCostUsd: options?.maxCostUsd, signal: options?.signal}),
  speech: (language, signal) => createVoiceEngineSpeech({env: process.env, language, signal})
});

// --- run -------------------------------------------------------------------
const startedAt = new Date();
const runs: MatrixRun[] = [];
const skipped: MatrixSkip[] = [];
let spentUsd = 0;
let budgetExhausted = false;
const total = selected.length * runsPerCase;
let attempted = 0;

for (const c of selected) {
  if (typeof c.prompt !== 'string' || !c.prompt.trim()) {
    skipped.push({caseId: c.id, runIndex: null, reason: 'case has no prompt (fixture-only; not runnable live)'});
    console.log(`[skip] ${c.id}: no prompt`);
    continue;
  }
  const archetypes = c.preferredArchetypes?.length ? c.preferredArchetypes : ['flow', 'structural_diagram'];
  for (let i = 0; i < runsPerCase; i++) {
    if (budgetExhausted) { skipped.push({caseId: c.id, runIndex: i, reason: 'budget exhausted'}); continue; }
    if (budgetUsd !== null && budgetUsd - spentUsd < MIN_BUDGET_USD) {
      budgetExhausted = true;
      skipped.push({caseId: c.id, runIndex: i, reason: `budget exhausted (spent $${spentUsd.toFixed(4)} of $${budgetUsd})`});
      console.log(`[skip] ${c.id} run ${i}: budget exhausted`);
      continue;
    }
    attempted++;
    const t0 = Date.now();
    const perJobUsd = budgetUsd === null ? DEFAULT_PER_JOB_USD : Math.min(budgetUsd - spentUsd, DEFAULT_PER_JOB_USD);
    let jobId: string | null = null;
    let snapshot: SemanticJobSnapshot | null = null;
    let status: MatrixRunStatus = 'error';
    let error: string | null = null;
    let errorKind: string | null = null;
    try {
      const created = await store.create({
        prompt: c.prompt,
        allowedArchetypes: archetypes,
        narration,
        autoMp4: false,
        maxScenes,
        language: 'en',
        groundingPolicy: 'source-only',
        maxCostUsd: perJobUsd
      });
      jobId = created.id;
      snapshot = await store.get(jobId);
      while (snapshot && !TERMINAL.has(snapshot.status) && Date.now() - t0 < MAX_WAIT_MS) {
        await sleep(POLL_MS);
        snapshot = await store.get(jobId);
      }
      if (!snapshot) {
        status = 'error';
        error = 'job snapshot disappeared before terminal status';
      } else if (TERMINAL.has(snapshot.status)) {
        status = snapshot.status;
        error = snapshot.error ?? null;
        errorKind = snapshot.errorKind ?? null;
      } else {
        status = 'timeout';
        error = `job did not reach terminal status within ${MAX_WAIT_MS} ms`;
        void store.cancel(jobId).catch(() => undefined);
      }
    } catch (e) {
      status = 'create-failed';
      error = e instanceof Error ? e.message : String(e);
      errorKind = 'create-failed';
    }
    const wallMs = Date.now() - t0;
    const costUsd = snapshot ? Number((snapshot.costUsd ?? 0).toFixed(6)) : 0;
    spentUsd += costUsd;
    const run: MatrixRun = {
      caseId: c.id,
      runIndex: i,
      jobId,
      status,
      finalGate: snapshot?.finalGate ?? null,
      publishable: snapshot?.publishable ?? null,
      wallMs,
      firstPlayableMs: snapshot?.firstPlayableMs ?? null,
      scenes: snapshot?.scenes.length ?? 0,
      calls: snapshot?.calls ?? 0,
      costUsd,
      modelRoutes: snapshot?.modelRoutes ?? [],
      semanticRepairCount: snapshot?.semanticRepairCount ?? null,
      error,
      errorKind
    };
    runs.push(run);
    const verdict = run.status === 'complete' && run.finalGate === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`[${attempted}/${total}] ${c.id} run ${i}: ${run.status} gate=${run.finalGate} ${verdict} wall=${wallMs}ms scenes=${run.scenes} cost=$${costUsd}${run.error ? ` error="${run.error}"` : ''}`);
  }
}
await store.close();

// --- aggregate -------------------------------------------------------------
const totalRuns = runs.length;
const jobPass = runs.filter(r => r.status === 'complete' && r.finalGate === 'PASS').length;
const compilePass = runs.filter(r => r.scenes > 0).length;
const jobRatePct = percent(jobPass, totalRuns);
const compileRatePct = percent(compilePass, totalRuns);
const walls = runs.map(r => r.wallMs);
const firsts = runs.map(r => r.firstPlayableMs).filter((x): x is number => x !== null);
const failureCounts = new Map<string, number>();
for (const r of runs) {
  if (r.status === 'complete' && r.finalGate === 'PASS') continue;
  const reason = r.errorKind ?? r.error ?? r.status;
  failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
}
const failureReasons = [...failureCounts.entries()].map(([reason, count]) => ({reason, count})).sort((a, b) => b.count - a.count);
const totalCostUsd = Number(runs.reduce((n, r) => n + r.costUsd, 0).toFixed(6));
const totalCalls = runs.reduce((n, r) => n + r.calls, 0);
const firstP50 = pctOr(firsts, 50);

const report: MatrixReport = {
  generatedAt: new Date().toISOString(),
  command: ['node', 'dist/scripts/live-matrix.js', ...args].join(' '),
  cases: selected.map(c => c.id),
  runsPerCase,
  narration,
  autoMp4: false,
  maxScenes,
  budgetUsd,
  totalRuns,
  jobSuccess: {pass: jobPass, total: totalRuns, ratePct: jobRatePct},
  compileSuccess: {pass: compilePass, total: totalRuns, ratePct: compileRatePct},
  latency: {
    method: PERCENTILE_METHOD,
    wallMs: {P50: pctOr(walls, 50), P95: pctOr(walls, 95), mean: meanOr(walls), n: walls.length},
    firstPlayableMs: {P50: firstP50, P95: pctOr(firsts, 95), mean: meanOr(firsts), n: firsts.length}
  },
  cost: {totalUsd: totalCostUsd, meanUsd: totalRuns ? Number((totalCostUsd / totalRuns).toFixed(6)) : 0, totalCalls},
  failureReasons,
  migrationGates: buildGates({jobRatePct, compileRatePct, firstP50, narration, total: totalRuns}),
  runs,
  skipped
};

await mkdir(reportDir, {recursive: true});
const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const jsonPath = join(reportDir, `matrix-${stamp}.json`);
const mdPath = join(reportDir, `matrix-${stamp}.md`);
await writeFile(jsonPath, JSON.stringify(report, null, 2));
await writeFile(mdPath, matrixToMarkdown(report));

printSummary(report);
console.log(`\nreport: ${jsonPath}`);
console.log(`summary: ${mdPath}`);

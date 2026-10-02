#!/usr/bin/env node
// V2 benchmark driver (plan §4.2/§7). Usage:
//   node scripts/v2-benchmark.mjs freeze <set>            write <set>.sha256.json beside the manifest
//   node scripts/v2-benchmark.mjs verify <set>            fail if a source changed since it was frozen
//   node scripts/v2-benchmark.mjs run <set> [--cases=a,b] [--trials=n]   cold, paid; each trial is a fresh lessonCli process
//   node scripts/v2-benchmark.mjs report <set>            Stage A gates from recorded trials
// <set> is cold-v1 or heldout-v1. Run `npm run build` first. Provider keys come from .env; nothing here edits sources or code.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'bench/benchmark-v2');
const harness = await import(path.join(ROOT, 'dist/src/harness/benchmarkV2.js'));
const [command, setName, ...rest] = process.argv.slice(2);
if (!command || !setName) { console.error('usage: v2-benchmark.mjs freeze|verify|run|report <set> [--cases=a,b] [--trials=n]'); process.exit(2); }
const flag = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const manifestPath = path.join(DIR, `${setName}.json`);
const frozenPath = path.join(DIR, `${setName}.sha256.json`);
const manifest = { ...JSON.parse(readFileSync(manifestPath, 'utf8')) };
const { instruction, durationSec } = manifest;
const parsed = harness.BenchmarkManifestSchema.parse({ schemaVersion: manifest.schemaVersion, name: manifest.name, trialsPerCase: manifest.trialsPerCase, cases: manifest.cases });
const runRoot = path.join(ROOT, '.data/benchmark-v2', setName);

if (command === 'freeze') {
  if (existsSync(frozenPath)) { console.error('already frozen; a frozen set is never rewritten (version a new set instead)'); process.exit(2); }
  writeFileSync(frozenPath, `${JSON.stringify(await harness.freezeBenchmarkSources(DIR, parsed), null, 2)}\n`, { flag: 'wx' });
  console.log(`frozen ${parsed.cases.length} sources -> ${path.relative(ROOT, frozenPath)}`);
} else if (command === 'verify' || command === 'run' || command === 'report') {
  const problems = await harness.verifyFrozenBenchmark(DIR, parsed, JSON.parse(readFileSync(frozenPath, 'utf8')));
  if (problems.length) { console.error(`benchmark integrity failed:\n- ${problems.join('\n- ')}`); process.exit(1); }
  if (command === 'verify') console.log('benchmark intact');
  if (command === 'run') {
    const only = flag('cases')?.split(',');
    const trials = Number(flag('trials') ?? parsed.trialsPerCase);
    mkdirSync(runRoot, { recursive: true });
    for (const item of parsed.cases.filter((c) => !only || only.includes(c.id))) {
      for (let trial = 1; trial <= trials; trial++) {
        const out = path.join(runRoot, `${item.id}-t${trial}`);
        if (existsSync(out)) { console.log(`skip ${item.id} t${trial}: already recorded`); continue; }
        console.log(`run ${item.id} t${trial}`);
        const env = { ...process.env, TEACHING_COMPILER_VERSION: 'v2', TEACHING_BEATS_V2: '1', BOARD_OPS_V2: '1', PERSISTENT_BOARD_V2: '1', TYPE_RESOLVER_V2: '1', LAYOUT_V2: '1', RENDER_PLAN_V2: '1' };
        const r = spawnSync('node', ['dist/src/run/lessonCli.js', `--source=${path.join(DIR, item.sourceFile)}`, `--instruction=${instruction}`, `--duration=${durationSec}`, `--id=${item.id}`, '--cache=cold', `--out=${out}`], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        writeFileSync(path.join(runRoot, `${item.id}-t${trial}.log`), `${r.stdout}\n${r.stderr}`);
        console.log(`  exit=${r.status}`);
      }
    }
  }
  if (command === 'report' || command === 'run') {
    const trials = [];
    for (const item of parsed.cases) {
      for (let trial = 1; trial <= parsed.trialsPerCase; trial++) {
        const out = path.join(runRoot, `${item.id}-t${trial}`);
        if (!existsSync(out)) continue;
        const summaryFile = readdirSync(out).find((f) => f.startsWith('summary-'));
        if (!summaryFile) continue;
        const [entry] = JSON.parse(readFileSync(path.join(out, summaryFile), 'utf8'));
        trials.push({ caseId: item.id, trial, status: entry.status, metrics: { ...entry.metrics, 'v2.totalMs': entry.metrics?.['v2.totalMs'] ?? entry.wallMs }, hardFailures: entry.hardFailures ?? 0, cost: entry.costUsd ?? 0 });
      }
    }
    const gates = harness.evaluateStageA(trials, { cases: parsed.cases.length, trialsPerCase: parsed.trialsPerCase });
    const report = { set: setName, trials: trials.length, costUsd: trials.reduce((n, t) => n + t.cost, 0), accepted: harness.stageAccepted(gates), gates, perTrial: trials.map(({ caseId, trial, status, hardFailures, cost, metrics }) => ({ caseId, trial, status, hardFailures, cost, firstClipMs: metrics['v2.timeToFirstClipMs'], totalMs: metrics['v2.totalMs'], encodeMs: metrics['v2.encodeMs'], lateOps: metrics['v2.lateOps'], retainedMoved: metrics['v2.retainedMoved'], labelled: metrics['v2.labelledEntities'], pictorial: metrics['v2.pictorialEntities'] })) };
    writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, perTrial: undefined }, null, 2));
  }
} else { console.error(`unknown command ${command}`); process.exit(2); }

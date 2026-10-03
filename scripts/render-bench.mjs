#!/usr/bin/env node
// P13: measure raster throughput against worker count on hash-verified V2 assets instead of assuming "all cores".
//   node scripts/render-bench.mjs <run-dir> [--sizes=1,2,3,4] [--frames=120] [--repeats=3] [--out=<file>]
// Reads only hash-verified locked SVG bytes (no model, no layout). Reports median frames/s, wall time, process CPU, peak RSS,
// host load, and available thermal status per pool size. Run `pnpm run build` first.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { availableParallelism, loadavg, totalmem } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { verifiedRasterInputs } = await import(path.join(root, 'dist/src/pipeline-v2/lockV2.js'));
const { RasterPool } = await import(path.join(root, 'dist/src/export/rasterPool.js'));
const args = process.argv.slice(2);
const runDir = args.find((arg) => !arg.startsWith('--'));
const flag = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (!runDir) { console.error('usage: render-bench.mjs <run-dir> [--sizes=1,2,3,4] [--frames=120] [--repeats=3] [--out=file]'); process.exit(2); }
const sizes = flag('sizes', '1,2,3,4').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8);
const wanted = Number(flag('frames', '120'));
const repeats = Number(flag('repeats', '3'));
if (!sizes.length) throw new Error('at least one worker size from 1 to 8 is required');
if (!Number.isInteger(wanted) || wanted < 1) throw new Error('--frames must be a positive integer');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeats must be an integer from 1 to 10');

const { lock, svgs, toleratedToolDrift } = await verifiedRasterInputs(path.resolve(runDir));
// Distinct frames only: identical holds are rendered once by the real encoder, so they are not part of the workload.
const distinct = [...svgs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, svg]) => svg);
const workload = Array.from({ length: wanted }, (_, i) => distinct[i % distinct.length]);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const thermalStatus = () => {
  if (process.platform !== 'darwin') return { available: false, source: 'pmset -g therm (macOS only)', detail: 'not available on this platform' };
  const result = spawnSync('/usr/bin/pmset', ['-g', 'therm'], { encoding: 'utf8', timeout: 2_000 });
  const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const available = result.status === 0 && !/failed|no cpu power status/i.test(detail);
  return { available, source: 'pmset -g therm', detail: detail || (result.error ? String(result.error) : `exit ${result.status}`) };
};
const singleTrialSize = Number(flag('single-trial', '0'));
if (singleTrialSize > 0) {
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  const pool = new RasterPool(singleTrialSize);
  try {
    await Promise.all(Array.from({ length: singleTrialSize }, (_, i) => pool.render(workload[i % workload.length], lock.render.width)));
    const loadBefore = loadavg();
    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    await Promise.all(workload.map((svg) => pool.render(svg, lock.render.width)));
    const wallMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    const loadAfter = loadavg();
    const processCpuMs = (cpu.user + cpu.system) / 1000;
    clearInterval(sampler);
    await pool.close();
    console.log(JSON.stringify({
      frames: workload.length, wallMs: Number(wallMs.toFixed(1)),
      framesPerSecond: Number((workload.length / (wallMs / 1000)).toFixed(2)),
      processCpuMs: Number(processCpuMs.toFixed(1)), processCpuCores: Number((processCpuMs / wallMs).toFixed(2)),
      baselineRssMb: Math.round(baselineRss / 1048576), peakRssMb: Math.round(peakRss / 1048576),
      incrementalPeakRssMb: Math.max(0, Math.round((peakRss - baselineRss) / 1048576)),
      hostLoadBefore: loadBefore, hostLoadAfter: loadAfter,
    }));
  } finally {
    clearInterval(sampler);
    await pool.close();
  }
  process.exit(0);
}
const trials = new Map(sizes.map((size) => [size, []]));
const thermalBefore = thermalStatus();
for (let round = 0; round < repeats; round++) {
  // Rotate order so each size is not always measured first or last as host load changes.
  const offset = round % sizes.length;
  const order = [...sizes.slice(offset), ...sizes.slice(0, offset)];
  for (const size of order) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), path.resolve(runDir), `--single-trial=${size}`, `--frames=${wanted}`], { encoding: 'utf8', timeout: 300_000, maxBuffer: 10_000_000 });
    if (child.error || child.status !== 0) throw new Error(`P13 trial failed (workers=${size}, round=${round + 1}): ${child.error?.message ?? child.stderr ?? `exit ${child.status}`}`);
    const trial = JSON.parse(child.stdout.trim());
    trials.get(size).push({ round: round + 1, ...trial });
  }
}
const results = sizes.map((workers) => {
  const runs = trials.get(workers);
  return {
    workers, repeats: runs.length, framesPerTrial: workload.length,
    medianFramesPerSecond: Number(median(runs.map((run) => run.framesPerSecond)).toFixed(2)),
    medianWallMs: Number(median(runs.map((run) => run.wallMs)).toFixed(1)),
    medianIncrementalPeakRssMb: Number(median(runs.map((run) => run.incrementalPeakRssMb)).toFixed(1)),
    maxPeakRssMb: Math.max(...runs.map((run) => run.peakRssMb)),
    medianProcessCpuCores: Number(median(runs.map((run) => run.processCpuCores)).toFixed(2)),
    trials: runs,
  };
});
const best = Math.max(...results.map((r) => r.medianFramesPerSecond));
const recommended = results.filter((r) => r.medianFramesPerSecond >= best * 0.9).sort((a, b) => a.workers - b.workers)[0];
const report = {
  schemaVersion: 'v2-render-bench/v1', runDir: path.resolve(runDir), lockContentHash: lock.contentHash,
  host: { cpus: availableParallelism(), memoryGb: Number((totalmem() / 1073741824).toFixed(1)), node: process.version },
  distinctFramesAvailable: distinct.length, requestedFramesPerTrial: wanted, repeats, thermalStatus: { before: thermalBefore, after: thermalStatus() },
  results, recommendedWorkers: recommended?.workers ?? null,
  toleratedToolDrift,
  note: 'Raster-only throughput from hash-verified locked SVGs. Only known Node/pipeline version drift is tolerated; renderer libraries, font, canvas, SVG hashes, and other lock checks stay strict. Process CPU utilization and host load are reported as contention indicators. Thermal throttling is measured only when the host exposes a thermal sensor. This is not evidence that the full lesson lock is current. Encode time and end-to-end latency are reported by the lesson run itself.',
};
const out = flag('out', path.join(path.resolve(runDir), 'v2', 'render-bench.json'));
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

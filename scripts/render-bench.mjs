#!/usr/bin/env node
// P13: measure raster throughput against worker count on a verified V2 lock instead of assuming "all cores".
//   node scripts/render-bench.mjs <run-dir> [--sizes=1,2,3,4] [--frames=40] [--out=<file>]
// Reads only hash-verified locked SVG bytes (no model, no layout). Reports frames/s, wall time, and peak RSS per pool size, plus the
// smallest size within 10% of the best throughput (the recommended default). Run `pnpm run build` first.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { availableParallelism, totalmem } from 'node:os';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { verifiedInputs } = await import(path.join(root, 'dist/src/pipeline-v2/lockV2.js'));
const { RasterPool } = await import(path.join(root, 'dist/src/export/rasterPool.js'));
const args = process.argv.slice(2);
const runDir = args.find((arg) => !arg.startsWith('--'));
const flag = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (!runDir) { console.error('usage: render-bench.mjs <run-dir> [--sizes=1,2,3,4] [--frames=40] [--out=file]'); process.exit(2); }
const sizes = flag('sizes', '1,2,3,4').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8);
const wanted = Math.max(1, Number(flag('frames', '40')));

const { lock, svgs } = await verifiedInputs(path.resolve(runDir));
// Distinct frames only: identical holds are rendered once by the real encoder, so they are not part of the workload.
const distinct = [...svgs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, svg]) => svg);
const workload = Array.from({ length: wanted }, (_, i) => distinct[i % distinct.length]);

const results = [];
for (const size of sizes) {
  const pool = new RasterPool(size);
  await Promise.all(Array.from({ length: size }, (_, i) => pool.render(workload[i % workload.length], lock.render.width))); // warm fonts and parsers
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
  const started = performance.now();
  await Promise.all(workload.map((svg) => pool.render(svg, lock.render.width)));
  const ms = performance.now() - started;
  clearInterval(sampler);
  await pool.close();
  results.push({ workers: size, frames: workload.length, wallMs: Math.round(ms), framesPerSecond: Number((workload.length / (ms / 1000)).toFixed(2)), peakRssMb: Math.round(peak / 1048576) });
}
const best = Math.max(...results.map((r) => r.framesPerSecond));
const recommended = results.filter((r) => r.framesPerSecond >= best * 0.9).sort((a, b) => a.workers - b.workers)[0];
const report = {
  schemaVersion: 'v2-render-bench/v1', runDir: path.resolve(runDir), lockContentHash: lock.contentHash,
  host: { cpus: availableParallelism(), memoryGb: Number((totalmem() / 1073741824).toFixed(1)), node: process.version },
  distinctFramesAvailable: distinct.length, results, recommendedWorkers: recommended?.workers ?? null,
  note: 'Throughput of the raster stage only. Encode time and end-to-end latency are reported by the lesson run itself.',
};
const out = flag('out', path.join(path.resolve(runDir), 'v2', 'render-bench.json'));
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

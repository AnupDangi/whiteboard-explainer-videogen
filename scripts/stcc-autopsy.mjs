#!/usr/bin/env node
// Failure autopsy: where did a run fail, at which scene, at which stage,
// with what input and what output. Read-only over the run directory.
// Usage: node scripts/stcc-autopsy.mjs <run-dir>
// Prints: run identity, per-scene stage outcomes, and for every failed
// scene-stage: prompt sha (when recorded), defect class, validator messages,
// repair count, and the exact artifact paths to inspect.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const [runDir] = process.argv.slice(2);
if (!runDir || !existsSync(runDir)) { console.error('usage: stcc-autopsy.mjs <run-dir>'); process.exit(2); }
const rd = (p, dflt = null) => { try { return JSON.parse(readFileSync(path.join(runDir, p), 'utf8')); } catch { return dflt; } };
const manifest = rd('run-manifest.json', {});
console.log(`run: ${manifest.runId ?? runDir} case=${manifest.caseId ?? '?'} started=${manifest.startedAt ?? '?'}`);
const structured = existsSync(path.join(runDir, 'structured')) ? readdirSync(path.join(runDir, 'structured')) : [];
for (const stage of structured.sort()) {
  const stageDir = path.join(runDir, 'structured', stage);
  for (const scene of readdirSync(stageDir).sort()) {
    const dir = path.join(stageDir, scene);
    let report = null;
    try { report = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8')); } catch { console.log(`  ${stage}/${scene}: NO REPORT`); continue; }
    const prompt = (() => { try { const raw = JSON.parse(readFileSync(path.join(dir, 'raw-model-output.json'), 'utf8')); return raw.promptSha ? { sha256: raw.promptSha, systemChars: raw.promptChars?.system, userChars: raw.promptChars?.user } : null; } catch { return null; } })();
    const state = report.succeeded ? 'OK ' : 'FAIL';
    console.log(`  ${state} ${stage}/${scene} attempts=${report.attempts ?? '?'} repairs=${report.repairs ?? '?'} firstTryValid=${report.firstTryValid ?? '?'}`);
    if (!report.succeeded) {
      console.log(`    prompt: ${prompt ? `sha=${prompt.sha256} system=${prompt.systemChars}ch user=${prompt.userChars}ch` : 'NOT RECORDED (pre prompt.json recorder)'}`);
      for (const f of (report.failures ?? []).filter((x) => x.hard)) console.log(`    hard ${f.code}: ${String(f.message).slice(0, 400)}`);
      console.log(`    inspect: ${dir}/raw-model-output.json (prompt+responses) ${dir}/validation-errors.json ${dir}/repair-patches.json`);
    }
  }
}

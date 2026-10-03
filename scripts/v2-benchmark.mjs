#!/usr/bin/env node
// V2 benchmark driver (plan §4.2/§7). Usage:
//   node scripts/v2-benchmark.mjs freeze <set>            write <set>.sha256.json beside the manifest
//   node scripts/v2-benchmark.mjs verify <set>            fail if a source changed since it was frozen
//   node scripts/v2-benchmark.mjs run <set> [--cases=a,b] [--trials=n]   cold, paid; each trial is a fresh lessonCli process
//   node scripts/v2-benchmark.mjs report <set>            Stage A gates from recorded trials
// Set V2_BENCH_PLANNER=<openrouter model id> to override the S6 board planner for every trial (recorded in the run provenance).
// <set> is cold-v1 or heldout-v1. Run `pnpm run build` first. Provider keys come from .env; nothing here edits sources or code.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'bench/benchmark-v2');
const harness = await import(path.join(ROOT, 'dist/src/harness/benchmarkV2.js'));
const v2LockVerifier = await import(path.join(ROOT, 'dist/src/pipeline-v2/lockV2.js'));
const [command, setName, ...rest] = process.argv.slice(2);
if (!command || !setName) { console.error('usage: v2-benchmark.mjs freeze|verify|run|report <set> [--cases=a,b] [--trials=n]'); process.exit(2); }
const flag = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const manifestPath = path.join(DIR, `${setName}.json`);
const frozenPath = path.join(DIR, `${setName}.sha256.json`);
const manifest = { ...JSON.parse(readFileSync(manifestPath, 'utf8')) };
const { instruction, durationSec } = manifest;
const parsed = harness.BenchmarkManifestSchema.parse({ schemaVersion: manifest.schemaVersion, name: manifest.name, trialsPerCase: manifest.trialsPerCase, cases: manifest.cases });
const batch = flag('batch');
if ((command === 'run' || command === 'report') && (!batch || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(batch))) { console.error(`${command} requires the explicit --batch=<name> used for that run; interrupted output is never reused`); process.exit(2); }
const runRoot = path.join(ROOT, '.data/benchmark-v2', setName, batch ?? 'default');
const hashFile = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const RUNNER_EVIDENCE_SCHEMA = 'v2-benchmark-runner-evidence/v1';
function runnerEvidenceBody(record) {
  const { integritySha256: _integritySha256, ...body } = record;
  return body;
}
function sealRunnerEvidence(body) {
  return { ...body, integritySha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
function readRunnerEvidence(file, logFile, expectedCaseId, expectedTrial) {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'));
    const body = runnerEvidenceBody(record);
    if (record.schemaVersion !== RUNNER_EVIDENCE_SCHEMA || record.caseId !== expectedCaseId || record.trial !== expectedTrial ||
        !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.completedAt)) ||
        (record.exitCode !== null && !Number.isInteger(record.exitCode)) ||
        (record.signal !== null && typeof record.signal !== 'string') ||
        (record.spawnError !== null && typeof record.spawnError !== 'string') ||
        !/^[a-f0-9]{64}$/.test(record.logSha256 ?? '') ||
        !/^[a-f0-9]{64}$/.test(record.integritySha256 ?? '') ||
        hashFile(logFile) !== record.logSha256 ||
        createHash('sha256').update(JSON.stringify(body)).digest('hex') !== record.integritySha256) return undefined;
    return record;
  } catch { return undefined; }
}

function deriveInfrastructureCrash(evidence, terminalStatus) {
  if (!evidence) return undefined;
  if (evidence.spawnError || evidence.signal) return true;
  if (terminalStatus === 'passed' || terminalStatus === 'draft' || terminalStatus === 'failed') return false;
  if (evidence.exitCode !== null && evidence.exitCode !== 0) return true;
  return undefined;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256Json(value) { return createHash('sha256').update(stableJson(value)).digest('hex'); }

// Current V2 runs do not yet emit candidate-vs-accepted operation audit data.
// If present, compare proposed operations to the hash-verified frozen lock and
// require each changed/inserted/deleted operation to have a matching repair record.
function deriveSilentRepairs(evaluation, lock, manifest, runDir) {
  const audit = evaluation?.silentRepairEvidence;
  if (!audit || audit.schemaVersion !== 'v2-silent-repair-evidence/v1' || audit.caseId !== manifest?.caseId || audit.runId !== manifest?.runId || !Array.isArray(audit.scenes) || audit.scenes.length !== lock?.scenes?.length) return undefined;
  let silent = 0;
  const seenScenes = new Set();
  for (const sceneAudit of audit.scenes) {
    if (!sceneAudit || typeof sceneAudit.sceneId !== 'string' || seenScenes.has(sceneAudit.sceneId) || !Array.isArray(sceneAudit.proposedOps) || !Array.isArray(sceneAudit.repairs)) return undefined;
    seenScenes.add(sceneAudit.sceneId);
    const lockedScene = lock.scenes.find((scene) => scene.sceneId === sceneAudit.sceneId);
    if (!lockedScene) return undefined;
    let captured;
    try { captured = JSON.parse(readFileSync(path.join(runDir, lockedScene.captured.file), 'utf8')); }
    catch { return undefined; }
    const acceptedOps = captured?.timeline?.ops?.map((event) => event.op);
    if (!Array.isArray(acceptedOps) || sha256Json(acceptedOps) !== lockedScene.boardOpsHash) return undefined;
    const byId = (ops) => {
      const map = new Map();
      for (const op of ops) {
        if (!op || typeof op.opId !== 'string' || map.has(op.opId)) return undefined;
        map.set(op.opId, op);
      }
      return map;
    };
    const proposed = byId(sceneAudit.proposedOps);
    const accepted = byId(acceptedOps);
    if (!proposed || !accepted) return undefined;
    const repairs = new Map();
    for (const repair of sceneAudit.repairs) {
      if (!repair || typeof repair.opId !== 'string' || repairs.has(repair.opId) ||
          (repair.beforeSha256 !== null && !/^[a-f0-9]{64}$/.test(repair.beforeSha256)) ||
          (repair.afterSha256 !== null && !/^[a-f0-9]{64}$/.test(repair.afterSha256))) return undefined;
      repairs.set(repair.opId, repair);
    }
    for (const opId of new Set([...proposed.keys(), ...accepted.keys()])) {
      const before = proposed.get(opId);
      const after = accepted.get(opId);
      const beforeHash = before ? sha256Json(before) : null;
      const afterHash = after ? sha256Json(after) : null;
      if (beforeHash === afterHash) {
        if (repairs.has(opId)) return undefined;
        continue;
      }
      const recorded = repairs.get(opId);
      if (!recorded || recorded.beforeSha256 !== beforeHash || recorded.afterSha256 !== afterHash) silent++;
      repairs.delete(opId);
    }
    if (repairs.size) return undefined;
  }
  if (seenScenes.size !== lock.scenes.length || lock.scenes.some((scene) => !seenScenes.has(scene.sceneId))) return undefined;
  return silent;
}

function readVerifiedTerminalStatus(out, expectedCaseId) {
  try {
    const summaryName = readdirSync(out).find((name) => name.startsWith('summary-') && name.endsWith('.json'));
    if (!summaryName) return undefined;
    const summary = JSON.parse(readFileSync(path.join(out, summaryName), 'utf8'));
    if (!Array.isArray(summary) || summary.length !== 1 || summary[0]?.lesson !== expectedCaseId) return undefined;
    const runDir = path.resolve(summary[0].outputDir);
    const relativeRunDir = path.relative(path.resolve(out), runDir);
    if (!relativeRunDir || relativeRunDir.startsWith('..') || path.isAbsolute(relativeRunDir)) return undefined;
    const manifest = JSON.parse(readFileSync(path.join(runDir, 'run-manifest.json'), 'utf8'));
    const evaluationFile = path.join(runDir, 'evaluation-bundle.json');
    const evaluation = JSON.parse(readFileSync(evaluationFile, 'utf8'));
    if (!manifest.artifactSha256 || manifest.artifactSha256['evaluation-bundle.json'] !== hashFile(evaluationFile) ||
        manifest.runId !== evaluation.runId || manifest.caseId !== expectedCaseId || evaluation.caseId !== expectedCaseId ||
        manifest.status !== evaluation.status || !['passed', 'draft', 'failed'].includes(manifest.status)) return undefined;
    return manifest.status;
  } catch { return undefined; }
}

function probeMedia(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,sample_rate,channels', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path.basename(file)}: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  const durationMs = Number(data.format?.duration) * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Array.isArray(data.streams)) throw new Error(`ffprobe returned invalid media properties for ${path.basename(file)}`);
  return { durationMs, streams: data.streams };
}

async function inspectTrial(out, expectedCaseId) {
  if (!existsSync(out)) return undefined;
  try {
    const summaryName = readdirSync(out).find((name) => name.startsWith('summary-') && name.endsWith('.json'));
    if (!summaryName) throw new Error('summary artifact is missing');
    const summary = JSON.parse(readFileSync(path.join(out, summaryName), 'utf8'));
    if (!Array.isArray(summary) || summary.length !== 1 || summary[0]?.lesson !== expectedCaseId) throw new Error('summary must contain exactly the requested case');
    const entry = summary[0];
    const runDir = path.resolve(entry.outputDir);
    const relativeRunDir = path.relative(path.resolve(out), runDir);
    if (!relativeRunDir || relativeRunDir.startsWith('..') || path.isAbsolute(relativeRunDir)) throw new Error('summary run directory escapes its trial output directory');
    const manifest = JSON.parse(readFileSync(path.join(runDir, 'run-manifest.json'), 'utf8'));
    const evaluation = JSON.parse(readFileSync(path.join(runDir, 'evaluation-bundle.json'), 'utf8'));
    const hashes = manifest.artifactSha256;
    if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) throw new Error('manifest has no artifact hash index');
    for (const [relative, expected] of Object.entries(hashes)) {
      const file = path.resolve(runDir, relative);
      if (!file.startsWith(`${runDir}${path.sep}`) || hashFile(file) !== expected) throw new Error(`artifact hash mismatch: ${relative}`);
    }
    if (manifest.runId !== evaluation.runId || manifest.caseId !== expectedCaseId || evaluation.caseId !== expectedCaseId || manifest.status !== evaluation.status) throw new Error('manifest/evaluation identity or status mismatch');
    if (!manifest.artifactSha256['lesson.lock.v2.json'] || !manifest.artifactSha256['video.mp4'] || !manifest.artifactSha256['audio.wav']) throw new Error('V2 lock, video and audio must all be hash-pinned');
    if (!statSync(path.join(runDir, 'video.mp4')).size || !statSync(path.join(runDir, 'audio.wav')).size) throw new Error('video or audio is empty');
    const lockProblems = await v2LockVerifier.verifyLessonLockV2(runDir);
    if (lockProblems.length) throw new Error(`V2 lesson lock failed verification: ${lockProblems.join('; ')}`);
    const lock = JSON.parse(readFileSync(path.join(runDir, 'lesson.lock.v2.json'), 'utf8'));
    const video = probeMedia(path.join(runDir, 'video.mp4'));
    const wav = probeMedia(path.join(runDir, 'audio.wav'));
    const videoStream = video.streams.find((stream) => stream.codec_type === 'video');
    const audioStream = video.streams.find((stream) => stream.codec_type === 'audio');
    const wavStream = wav.streams.find((stream) => stream.codec_type === 'audio');
    const [rateNum, rateDen] = String(videoStream?.r_frame_rate ?? '').split('/').map(Number);
    if (!videoStream || !audioStream || !wavStream || videoStream.width !== lock.render.width || videoStream.height !== lock.render.height || rateNum / rateDen !== lock.render.fps) throw new Error('muxed media streams do not match locked resolution, frame rate, or audio presence');
    if (Math.abs(video.durationMs - lock.render.durationMs) > 200 || Math.abs(wav.durationMs - lock.render.durationMs) > 200) throw new Error('video or master audio duration is outside the locked ±200 ms duration tolerance');
    return { manifest, evaluation, entry, runDir, lock, artifactsComplete: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), artifactsComplete: false };
  }
}

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
        if (existsSync(out)) { console.error(`occupied trial slot ${item.id} t${trial}; use a new --batch to avoid warm/interrupted contamination`); process.exit(1); }
        console.log(`run ${item.id} t${trial}`);
        const env = { ...process.env, TEACHING_COMPILER_VERSION: 'v2', TEACHING_BEATS_V2: '1', BOARD_OPS_V2: '1', PERSISTENT_BOARD_V2: '1', TYPE_RESOLVER_V2: '1', LAYOUT_V2: '1', RENDER_PLAN_V2: '1' };
        const startedAt = new Date().toISOString();
        const r = spawnSync('node', ['dist/src/run/lessonCli.js', `--source=${path.join(DIR, item.sourceFile)}`, `--instruction=${instruction}`, `--duration=${durationSec}`, `--id=${item.id}`, '--cache=cold', `--out=${out}`, ...(process.env.V2_BENCH_PLANNER ? [`--planner=${process.env.V2_BENCH_PLANNER}`] : [])], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const logPath = path.join(runRoot, `${item.id}-t${trial}.log`);
        const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
        writeFileSync(logPath, log, { flag: 'wx' });
        const evidence = sealRunnerEvidence({ schemaVersion: RUNNER_EVIDENCE_SCHEMA, caseId: item.id, trial, startedAt, completedAt: new Date().toISOString(), exitCode: r.status, signal: r.signal, spawnError: r.error?.message ?? null, logSha256: hashFile(logPath) });
        writeFileSync(path.join(runRoot, `${item.id}-t${trial}.runner-evidence.json`), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
        console.log(`  exit=${r.status}`);
      }
    }
  }
  if (command === 'report' || command === 'run') {
    const trials = [];
    for (const item of parsed.cases) {
      for (let trial = 1; trial <= parsed.trialsPerCase; trial++) {
        const out = path.join(runRoot, `${item.id}-t${trial}`);
        const inspected = await inspectTrial(out, item.id);
        const evaluation = inspected?.evaluation;
        const runnerEvidencePath = path.join(runRoot, `${item.id}-t${trial}.runner-evidence.json`);
        const runnerEvidence = readRunnerEvidence(runnerEvidencePath, path.join(runRoot, `${item.id}-t${trial}.log`), item.id, trial);
        const terminalStatus = readVerifiedTerminalStatus(out, item.id);
        const silentRepairs = deriveSilentRepairs(evaluation, inspected?.lock, inspected?.manifest, inspected?.runDir);
        const metrics = evaluation?.metrics && typeof evaluation.metrics === 'object' ? { ...evaluation.metrics } : {};
        const evaluationFailures = Array.isArray(evaluation?.failures) ? evaluation.failures : undefined;
        const hardFailures = evaluationFailures ? evaluationFailures.filter((failure) => failure?.hard === true).length : undefined;
        trials.push({ caseId: item.id, trial, status: evaluation?.status ?? 'failed', metrics, hardFailures, artifactsComplete: inspected?.artifactsComplete === true, infrastructureCrash: deriveInfrastructureCrash(runnerEvidence, terminalStatus), silentRepairs, runnerEvidenceSha256: runnerEvidence ? hashFile(runnerEvidencePath) : undefined, terminalStatus, silentRepairEvidenceStatus: silentRepairs === undefined ? (evaluation?.silentRepairEvidence ? 'invalid' : 'unavailable') : 'verified', requestStarted: Boolean(inspected?.manifest?.executionTiming?.startedAt), cold: inspected?.manifest?.options?.cache === 'cold', majorR10OnlyClaims: metrics['semantic.r10OnlyMajorClaims'], cost: evaluation?.usage?.costUsd, totalCostUsd: evaluation?.usage?.costUsd, ttsUsdKnown: metrics['cost.ttsUsdKnown'] === 1 });
      }
    }
    const gates = harness.evaluateStageA(trials, { cases: parsed.cases.length, trialsPerCase: parsed.trialsPerCase, caseIds: parsed.cases.map((item) => item.id) });
    const valuedCosts = trials.flatMap((trial) => trial.ttsUsdKnown && typeof trial.cost === 'number' && Number.isFinite(trial.cost) ? [trial.cost] : []);
    const report = { set: setName, batch: batch ?? 'default', trials: trials.length, expectedTrials: parsed.cases.length * parsed.trialsPerCase, knownCostUsd: valuedCosts.reduce((n, value) => n + value, 0), unpricedTrials: trials.length - valuedCosts.length, accepted: harness.stageAccepted(gates), gates, perTrial: trials.map(({ caseId, trial, status, hardFailures, cost, ttsUsdKnown, artifactsComplete, infrastructureCrash, silentRepairs, runnerEvidenceSha256, terminalStatus, silentRepairEvidenceStatus, metrics }) => ({ caseId, trial, status, hardFailures, cost, ttsUsdKnown, artifactsComplete, infrastructureCrash: infrastructureCrash ?? null, runnerEvidenceSha256: runnerEvidenceSha256 ?? null, terminalStatus: terminalStatus ?? null, silentRepairs: silentRepairs ?? null, silentRepairEvidenceStatus, firstPlayableMs: metrics['v2.timeToFirstPlayableMs'], requestToCompleteMs: metrics['v2.requestToCompleteMs'], encodeMs: metrics['v2.encodeMs'], lateOps: metrics['v2.lateOps'], retainedMoved: metrics['v2.retainedMoved'], majorR10OnlyClaims: metrics['semantic.r10OnlyMajorClaims'] })) };
    writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, perTrial: undefined }, null, 2));
  }
} else { console.error(`unknown command ${command}`); process.exit(2); }

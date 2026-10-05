#!/usr/bin/env node
// V2 benchmark driver (plan §4.2/§7). Usage:
//   node scripts/v2-benchmark.mjs freeze <set>            write <set>.sha256.json beside the manifest
//   node scripts/v2-benchmark.mjs verify <set>            fail if a source changed since it was frozen
//   node scripts/v2-benchmark.mjs run <set> [--cases=a,b] [--trials=n]   cold, paid; each trial is a fresh lessonCli process
//   node scripts/v2-benchmark.mjs report <set>            Stage A gates from recorded trials
// Set V2_BENCH_PLANNER=<openrouter model id> to override only the S6 BoardOps model for every trial (recorded in run provenance).
// <set> is cold-v1 or heldout-v1. Run `pnpm run build` first. Provider keys come from .env; nothing here edits sources or code.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'bench/benchmark-v2');
// Let diagnostic lessons reach audio/render even when they exceed the Stage A latency target.
// A finite cap still prevents a hung provider/worker from consuming an unbounded slot.
const DEFAULT_TRIAL_TIMEOUT_MS = 15 * 60_000;
const MAX_TRIAL_TIMEOUT_MS = 20 * 60_000;
const harness = await import(path.join(ROOT, 'dist/src/harness/benchmarkV2.js'));
const changeInventory = await import(path.join(ROOT, 'dist/src/harness/benchmarkChangeInventory.js'));
const v2LockVerifier = await import(path.join(ROOT, 'dist/src/pipeline-v2/lockV2.js'));
const artifactStatus = await import(path.join(ROOT, 'dist/src/shared/artifactStatus.js'));
const reviewBundle = await import(path.join(ROOT, 'scripts/v2-review-bundle.mjs'));
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
const selectedCases = flag('cases')?.split(',').filter(Boolean);
if (selectedCases && selectedCases.some((id) => !parsed.cases.some((item) => item.id === id))) { console.error('--cases contains an id outside the frozen manifest'); process.exit(2); }
const requestedTrials = Number(flag('trials') ?? parsed.trialsPerCase);
if ((command === 'run' || command === 'report') && (!Number.isInteger(requestedTrials) || requestedTrials < 1 || requestedTrials > 3)) { console.error(`${command} supports 1–3 trials per case`); process.exit(2); }
const ttsOverride = flag('tts');
if (ttsOverride && !['local', 'elevenlabs'].includes(ttsOverride)) { console.error('--tts must be local or elevenlabs'); process.exit(2); }
const timeoutMs = Number(flag('timeout-ms') ?? DEFAULT_TRIAL_TIMEOUT_MS);
if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > MAX_TRIAL_TIMEOUT_MS) { console.error(`--timeout-ms must be between 30000 and ${MAX_TRIAL_TIMEOUT_MS}`); process.exit(2); }
const runRoot = path.join(ROOT, '.data/benchmark-v2', setName, batch ?? 'default');
const hashFile = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const LEGACY_RUNNER_EVIDENCE_SCHEMA = 'v2-benchmark-runner-evidence/v1';
const RUNNER_EVIDENCE_SCHEMA = 'v2-benchmark-runner-evidence/v2';
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
    const inventoryValid = record.schemaVersion === LEGACY_RUNNER_EVIDENCE_SCHEMA
      || (record.schemaVersion === RUNNER_EVIDENCE_SCHEMA && record.changeInventoryStatus === 'verified'
        && record.changeInventoryError === null && changeInventory.isBenchmarkTrialChangeEvidence(record.changeInventory))
      || (record.schemaVersion === RUNNER_EVIDENCE_SCHEMA && record.changeInventoryStatus === 'unavailable'
        && record.changeInventory === null && typeof record.changeInventoryError === 'string');
    if (!inventoryValid || ![LEGACY_RUNNER_EVIDENCE_SCHEMA, RUNNER_EVIDENCE_SCHEMA].includes(record.schemaVersion) || record.caseId !== expectedCaseId || record.trial !== expectedTrial ||
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256Json(value) { return createHash('sha256').update(stableJson(value)).digest('hex'); }

function changedFilesAcrossTrial(evidence, field) {
  if (!evidence) return undefined;
  const before = new Map(evidence.before[field].map((record) => [record.path, record]));
  const after = new Map(evidence.after[field].map((record) => [record.path, record]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().map((file) => ({
    path: file,
    before: before.get(file) ?? null,
    after: after.get(file) ?? null,
  }));
}

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
    const certification = manifest.artifactCertification;
    const reviewReportHash = manifest.artifactSha256?.['human-review-report.json'];
    const reviewReportPath = path.join(runDir, 'human-review-report.json');
    const reviewReportBytes = reviewReportHash && existsSync(reviewReportPath) ? readFileSync(reviewReportPath, 'utf8') : undefined;
    if (reviewReportHash && (!reviewReportBytes || hashFile(reviewReportPath) !== reviewReportHash)) return undefined;
    if (certification?.artifactStatusVersion !== 'artifact-status/v1' || !harness.isArtifactStatus(certification?.artifactStatus) ||
        JSON.stringify(certification) !== JSON.stringify(evaluation.artifactCertification) ||
        !artifactStatus.verifyArtifactCertification(certification, { artifactSha256: manifest.artifactSha256?.['video.mp4'], ...(reviewReportBytes === undefined ? {} : { humanReviewReportBytes: reviewReportBytes }) }) ||
        typeof manifest.configHash !== 'string' || manifest.configHash !== evaluation.configHash || !manifest.configIdentity ||
        JSON.stringify(manifest.configIdentity) !== JSON.stringify(evaluation.configIdentity) ||
        createHash('sha256').update(JSON.stringify(manifest.configIdentity)).digest('hex') !== manifest.configHash) return undefined;
    return certification.artifactStatus;
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
    if (manifest.runId !== evaluation.runId || manifest.caseId !== expectedCaseId || evaluation.caseId !== expectedCaseId || manifest.status !== evaluation.status) throw new Error('manifest/evaluation identity or legacy status mismatch');
    const certification = manifest.artifactCertification;
    const reviewReportHash = hashes['human-review-report.json'];
    const reviewReportPath = path.join(runDir, 'human-review-report.json');
    const reviewReportBytes = reviewReportHash && existsSync(reviewReportPath) ? readFileSync(reviewReportPath, 'utf8') : undefined;
    if (reviewReportHash && (!reviewReportBytes || hashFile(reviewReportPath) !== reviewReportHash)) throw new Error('human review report hash is missing or inconsistent');
    if (certification?.artifactStatusVersion !== 'artifact-status/v1' || !harness.isArtifactStatus(certification?.artifactStatus) || JSON.stringify(certification) !== JSON.stringify(evaluation.artifactCertification) ||
        !artifactStatus.verifyArtifactCertification(certification, { artifactSha256: hashes['video.mp4'], ...(reviewReportBytes === undefined ? {} : { humanReviewReportBytes: reviewReportBytes }) })) throw new Error('manifest/evaluation artifact certification is missing, inconsistent, or contradicts its gates');
    if (!manifest.configIdentity || JSON.stringify(manifest.configIdentity) !== JSON.stringify(evaluation.configIdentity) || typeof manifest.configHash !== 'string' || manifest.configHash !== evaluation.configHash || createHash('sha256').update(JSON.stringify(manifest.configIdentity)).digest('hex') !== manifest.configHash) throw new Error('manifest/evaluation effective run configuration identity is missing or inconsistent');
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
    const only = selectedCases;
    const trials = requestedTrials;
    mkdirSync(runRoot, { recursive: true });
    runTrials: for (const item of parsed.cases.filter((c) => !only || only.includes(c.id))) {
      for (let trial = 1; trial <= trials; trial++) {
        const out = path.join(runRoot, `${item.id}-t${trial}`);
        if (existsSync(out)) { console.error(`occupied trial slot ${item.id} t${trial}; use a new --batch to avoid warm/interrupted contamination`); process.exit(1); }
        console.log(`run ${item.id} t${trial}`);
        const env = { ...process.env, TEACHING_COMPILER_VERSION: 'v2', TEACHING_BEATS_V2: '1', BOARD_OPS_V2: '1', PERSISTENT_BOARD_V2: '1', TYPE_RESOLVER_V2: '1', LAYOUT_V2: '1', RENDER_PLAN_V2: '1', ...(ttsOverride === 'local' ? { HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1', HYPOTHESIS_TTS_ALIGNMENT_CONCURRENCY: '2' } : {}) };
        // Refuse to dispatch a benchmark trial if its pre-run test/baseline state cannot be inventoried.
        const inventoryBefore = changeInventory.captureBenchmarkChangeInventory(ROOT);
        const startedAt = new Date().toISOString();
        const r = spawnSync('node', ['dist/src/run/lessonCli.js', `--source=${path.join(DIR, item.sourceFile)}`, `--instruction=${instruction}`, `--duration=${durationSec}`, `--id=${item.id}`, '--cache=cold', `--out=${out}`, ...(ttsOverride ? [`--tts=${ttsOverride}`] : []), ...(process.env.V2_BENCH_PLANNER ? [`--s6-planner=${process.env.V2_BENCH_PLANNER}`] : [])], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, detached: true });
        if (r.error?.code === 'ETIMEDOUT' && r.pid) {
          try { process.kill(-r.pid, 'SIGTERM'); } catch { /* The process group may already have exited. */ }
        }
        const logPath = path.join(runRoot, `${item.id}-t${trial}.log`);
        const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
        writeFileSync(logPath, log, { flag: 'wx' });
        let changeInventoryEvidence = null;
        let changeInventoryStatus = 'verified';
        let changeInventoryError = null;
        try {
          const inventoryAfter = changeInventory.captureBenchmarkChangeInventory(ROOT);
          changeInventoryEvidence = changeInventory.createBenchmarkTrialChangeEvidence(inventoryBefore, inventoryAfter);
        } catch (error) {
          changeInventoryStatus = 'unavailable';
          changeInventoryError = error instanceof Error ? error.message : String(error);
        }
        const evidence = sealRunnerEvidence({ schemaVersion: RUNNER_EVIDENCE_SCHEMA, caseId: item.id, trial, startedAt, completedAt: new Date().toISOString(), exitCode: r.status, signal: r.signal, spawnError: r.error?.message ?? null, logSha256: hashFile(logPath), changeInventoryStatus, changeInventory: changeInventoryEvidence, changeInventoryError });
        writeFileSync(path.join(runRoot, `${item.id}-t${trial}.runner-evidence.json`), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
        console.log(`  exit=${r.status}`);
        const terminalStatus = readVerifiedTerminalStatus(out, item.id);
        const inspection = await inspectTrial(out, item.id);
        if (r.status !== 0 || !['DRAFT', 'PASSED_AUTOMATED', 'PASSED_REVIEW'].includes(terminalStatus) || inspection?.artifactsComplete !== true) {
          const reason = r.status !== 0 ? `runner exit ${r.status}` : terminalStatus ? `verified artifact status ${terminalStatus}` : 'versioned artifact status is missing or unverifiable';
          console.error(`stop after ${item.id} t${trial}: ${reason}${inspection?.error ? `; artifact inspection: ${inspection.error}` : ''}; inspect its inputs and artifacts before another trial`);
          break runTrials;
        }
      }
    }
  }
  if (command === 'report' || command === 'run') {
    const trials = [];
    const reportCases = selectedCases ? parsed.cases.filter((item) => selectedCases.includes(item.id)) : parsed.cases;
    const reportTrialCount = requestedTrials;
    for (const item of reportCases) {
      for (let trial = 1; trial <= reportTrialCount; trial++) {
        const out = path.join(runRoot, `${item.id}-t${trial}`);
        const inspected = await inspectTrial(out, item.id);
        const evaluation = inspected?.evaluation;
        const runnerEvidencePath = path.join(runRoot, `${item.id}-t${trial}.runner-evidence.json`);
        const runnerEvidence = readRunnerEvidence(runnerEvidencePath, path.join(runRoot, `${item.id}-t${trial}.log`), item.id, trial);
        const changeEvidence = runnerEvidence?.changeInventoryStatus === 'verified' ? runnerEvidence.changeInventory : undefined;
        const testBaselineInventoryStatus = runnerEvidence?.schemaVersion === LEGACY_RUNNER_EVIDENCE_SCHEMA
          ? 'unavailable: legacy runner evidence predates test/baseline inventory'
          : runnerEvidence?.changeInventoryStatus ?? 'unavailable: runner evidence invalid or absent';
        const changedTestFiles = changedFilesAcrossTrial(changeEvidence, 'changedTestFiles');
        const changedBaselineFiles = changedFilesAcrossTrial(changeEvidence, 'changedBaselineFiles');
        const terminalStatus = readVerifiedTerminalStatus(out, item.id);
        const silentRepairs = deriveSilentRepairs(evaluation, inspected?.lock, inspected?.manifest, inspected?.runDir);
        const metrics = evaluation?.metrics && typeof evaluation.metrics === 'object' ? { ...evaluation.metrics } : {};
        let firstAudiblePlayableMs;
        let playerTelemetrySha256;
        let playerTelemetryStatus = 'unmeasured: no player-boundary playback event is recorded';
        const playerTelemetryPath = inspected?.runDir ? path.join(inspected.runDir, 'player-telemetry.jsonl') : undefined;
        if (playerTelemetryPath && existsSync(playerTelemetryPath)) {
          try {
            const events = reviewBundle.readPlayerTelemetry(inspected.runDir, inspected.manifest, inspected.lock);
            const comparable = events.map((event) => event.requestToFirstAudioMs).filter(Number.isFinite);
            playerTelemetrySha256 = hashFile(playerTelemetryPath);
            if (comparable.length) {
              firstAudiblePlayableMs = Math.min(...comparable);
              metrics['v2.firstAudiblePlayableMs'] = firstAudiblePlayableMs;
              playerTelemetryStatus = 'measured: validated browser-player event bound to this run and request epoch';
            } else {
              playerTelemetryStatus = events.length ? 'observed without a comparable request-acceptance clock' : 'unmeasured: telemetry file contains no playback events';
            }
          } catch (error) {
            playerTelemetryStatus = `invalid: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        const evaluationFailures = Array.isArray(evaluation?.failures) ? evaluation.failures : undefined;
        const hardFailures = evaluationFailures ? evaluationFailures.filter((failure) => failure?.hard === true).length : undefined;
        trials.push({ caseId: item.id, trial, status: evaluation?.artifactCertification?.artifactStatus ?? 'DRAFT', metrics, firstAudiblePlayableMs, playerTelemetrySha256, playerTelemetryStatus, hardFailures, artifactsComplete: inspected?.artifactsComplete === true, infrastructureCrash: harness.deriveInfrastructureCrash(runnerEvidence, terminalStatus), silentRepairs, runnerEvidenceSha256: runnerEvidence ? hashFile(runnerEvidencePath) : undefined, terminalStatus, silentRepairEvidenceStatus: silentRepairs === undefined ? (evaluation?.silentRepairEvidence ? 'invalid' : 'unavailable') : 'verified', requestStarted: Boolean(inspected?.manifest?.executionTiming?.startedAt), cold: inspected?.manifest?.options?.cache === 'cold', pipelineDigest: inspected?.lock?.versions?.pipeline, configHash: inspected?.manifest?.configHash, testBaselineInventorySha256: changeEvidence?.inventorySha256, testBaselineInventoryStable: changeEvidence?.stableDuringTrial, testBaselineInventoryBaseCommit: changeEvidence?.before.head, testBaselineInventoryStatus, changedTestFiles, changedBaselineFiles, fallbackCount: Number(metrics['v2.fallbackScenes'] ?? 0) + Number(metrics['v2.ttsFallbackScenes'] ?? 0), majorR10OnlyClaims: metrics['semantic.r10OnlyMajorClaims'], cost: evaluation?.usage?.costUsd, totalCostUsd: evaluation?.usage?.costUsd, ttsUsdKnown: metrics['cost.ttsUsdKnown'] === 1 });
      }
    }
    const gates = harness.evaluateStageA(trials, { cases: reportCases.length, trialsPerCase: reportTrialCount, caseIds: reportCases.map((item) => item.id) });
    const valuedCosts = trials.flatMap((trial) => trial.ttsUsdKnown && typeof trial.cost === 'number' && Number.isFinite(trial.cost) ? [trial.cost] : []);
    const accepted = harness.stageAccepted(gates);
    const artifactStatus = !trials.length || trials.every((trial) => trial.artifactsComplete !== true) ? 'FAILED' : accepted ? 'PASSED_AUTOMATED' : 'DRAFT';
    const report = { schemaVersion: 'v2-benchmark-report/v4', artifactStatusVersion: 'artifact-status/v1', artifactStatus, set: setName, batch: batch ?? 'default', ttsOverride: ttsOverride ?? null, trials: trials.length, expectedTrials: reportCases.length * reportTrialCount, knownCostUsd: valuedCosts.reduce((n, value) => n + value, 0), unpricedTrials: trials.length - valuedCosts.length, accepted, gates, perTrial: trials.map(({ caseId, trial, status, hardFailures, cost, ttsUsdKnown, artifactsComplete, infrastructureCrash, silentRepairs, runnerEvidenceSha256, terminalStatus, silentRepairEvidenceStatus, pipelineDigest, configHash, testBaselineInventorySha256, testBaselineInventoryStable, testBaselineInventoryBaseCommit, testBaselineInventoryStatus, changedTestFiles, changedBaselineFiles, fallbackCount, firstAudiblePlayableMs, playerTelemetrySha256, playerTelemetryStatus, metrics }) => ({ caseId, trial, status, hardFailures, cost, ttsUsdKnown, artifactsComplete, infrastructureCrash: infrastructureCrash ?? null, runnerEvidenceSha256: runnerEvidenceSha256 ?? null, terminalStatus: terminalStatus ?? null, silentRepairs: silentRepairs ?? null, silentRepairEvidenceStatus, pipelineDigest: pipelineDigest ?? null, configHash: configHash ?? null, testBaselineInventorySha256: testBaselineInventorySha256 ?? null, testBaselineInventoryStable: testBaselineInventoryStable ?? null, testBaselineInventoryBaseCommit: testBaselineInventoryBaseCommit ?? null, testBaselineInventoryStatus, changedTestFiles: changedTestFiles ?? null, changedBaselineFiles: changedBaselineFiles ?? null, fallbackCount: fallbackCount ?? null, sceneReadyMs: metrics['v2.timeToFirstPlayableMs'], firstAudiblePlayableMs: firstAudiblePlayableMs ?? null, playerTelemetrySha256: playerTelemetrySha256 ?? null, playerTelemetryStatus, requestToCompleteMs: metrics['v2.requestToCompleteMs'], encodeMs: metrics['v2.encodeMs'], lateOps: metrics['v2.lateOps'], retainedMoved: metrics['v2.retainedMoved'], majorR10OnlyClaims: metrics['semantic.r10OnlyMajorClaims'] })) };
    writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, perTrial: undefined }, null, 2));
  }
} else { console.error(`unknown command ${command}`); process.exit(2); }

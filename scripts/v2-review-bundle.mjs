#!/usr/bin/env node
// Export and verify a portable, hash-indexed bundle from one V2 run directory.
// Usage: node scripts/v2-review-bundle.mjs create <run-dir> <new-bundle-dir>
//        node scripts/v2-review-bundle.mjs verify <bundle-dir>
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_INDEX = 'review-bundle.json';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function hashFile(file) { return sha256(readFileSync(file)); }
function canonicalJson(value) { return JSON.stringify(value, null, 2) + '\n'; }

function safeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error(`unsafe artifact path: ${relative}`);
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, relative);
  if (!file.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`artifact path escapes its root: ${relative}`);
  const rootStat = lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`artifact root is not a regular directory: ${resolvedRoot}`);
  let cursor = resolvedRoot;
  const parts = relative.split(/[\\/]/);
  for (const [index, part] of parts.entries()) {
    if (!part || part === '.' || part === '..') throw new Error(`unsafe artifact path: ${relative}`);
    cursor = path.join(cursor, part);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`symlinks are not allowed in artifact paths: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`artifact parent is not a directory: ${relative}`);
    if (index === parts.length - 1 && !stat.isFile()) throw new Error(`artifact is not a regular file: ${relative}`);
  }
  return file;
}

function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }

function verifyRunIndex(runDir, manifest) {
  const index = manifest?.artifactSha256;
  if (!index || typeof index !== 'object' || Array.isArray(index) || Object.keys(index).length === 0) throw new Error('run manifest has no artifact hash index');
  for (const [relative, expected] of Object.entries(index)) {
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`invalid run artifact hash: ${relative}`);
    if (hashFile(safeFile(runDir, relative)) !== expected) throw new Error(`run artifact hash mismatch: ${relative}`);
  }
  for (const required of ['evaluation-bundle.json', 'lesson.lock.v2.json', 'video.mp4', 'audio.wav']) {
    if (!index[required]) throw new Error(`run manifest does not pin required artifact ${required}`);
  }
  if (manifest.artifactSha256['evaluation-bundle.json'] !== hashFile(safeFile(runDir, 'evaluation-bundle.json'))) throw new Error('evaluation-bundle.json hash mismatch');
}

function probeMedia(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path.basename(file)}: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  const durationMs = Number(data.format?.duration) * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Array.isArray(data.streams)) throw new Error(`ffprobe returned invalid media properties for ${path.basename(file)}`);
  return { durationMs, streamTypes: data.streams.map((stream) => stream.codec_type) };
}

function walkFiles(root, relative = '') {
  const found = [];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`symlinks are not allowed in a review bundle: ${child}`);
    if (entry.isDirectory()) found.push(...walkFiles(root, child));
    else if (entry.isFile()) {
      if (child !== BUNDLE_INDEX) found.push(child);
    }
    else throw new Error(`unsupported bundle entry: ${child}`);
  }
  return found.sort();
}

function readPlayerTelemetry(runDir, manifest, lock) {
  const telemetryPath = path.join(runDir, 'player-telemetry.jsonl');
  if (!existsSync(telemetryPath)) return [];
  const telemetryFile = safeFile(runDir, 'player-telemetry.jsonl');
  const runStartPath = path.join(runDir, 'run-start.json');
  const runStart = existsSync(runStartPath) ? readJson(safeFile(runDir, 'run-start.json')) : undefined;
  if (runStart && (runStart.schemaVersion !== 'hypothesis-run-start/v1' || runStart.runId !== manifest.runId || !Number.isFinite(runStart.acceptedAtEpochMs) || runStart.acceptedAtEpochMs < 0)) throw new Error('run-start.json is invalid or belongs to another run');
  const acceptedAt = runStart?.acceptedAtEpochMs;
  const firstScene = lock.scenes?.[0];
  const firstSegment = lock.renderPlan?.find((segment) => segment.firstFrame === 0);
  const firstFrameHash = firstSegment?.kind === 'hold' ? firstSegment.svgHash : firstSegment?.svgHashes?.[0];
  if (!firstScene || !firstFrameHash) throw new Error('player telemetry cannot be tied to the verified first scene');
  const events = [];
  for (const [index, line] of readFileSync(telemetryFile, 'utf8').split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error(`invalid player telemetry on line ${index + 1}`); }
    const HASH = /^[a-f0-9]{64}$/u;
    const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (event.schemaVersion !== 'hypothesis-first-audio-playback/v2' || event.type !== 'player.first-audio-playback'
      || event.measurementSource !== 'browser-player' || event.runId !== manifest.runId
      || event.eventId !== `${event.sessionId}:first-audio-playback/v2` || event.initial?.sceneId !== firstScene.sceneId
      || event.initial?.frame !== 0 || event.initial?.frameHash !== firstFrameHash
      || event.initial?.sceneAudioHash !== firstScene.audioHash || !Number.isSafeInteger(event.observedFrame) || event.observedFrame < 0
      || !HASH.test(event.observedFrameHash ?? '') || !finite(event.browserTimeOriginMs) || !finite(event.firstAudioPlaybackMonoMs)) {
      throw new Error(`player telemetry does not match the verified run on line ${index + 1}`);
    }
    if (event.requestAcceptedAtEpochMs !== (acceptedAt ?? null)) throw new Error('player telemetry request epoch differs from run-start.json');
    const segment = lock.renderPlan.find((item) => item.firstFrame <= event.observedFrame && event.observedFrame < item.firstFrame + item.frameCount);
    const frameHash = segment?.kind === 'hold' ? segment.svgHash : segment?.svgHashes?.[event.observedFrame - (segment?.firstFrame ?? 0)];
    if (segment?.sceneId !== firstScene.sceneId || frameHash !== event.observedFrameHash) throw new Error(`player telemetry frame is not in the verified first scene on line ${index + 1}`);
    if (event.requestAcceptedAtEpochMs === null) {
      if (event.requestToFirstAudioMs !== null) throw new Error(`player telemetry has an unbound request timing on line ${index + 1}`);
    } else {
      if (!finite(event.requestAcceptedAtEpochMs)) throw new Error(`player telemetry request epoch is invalid on line ${index + 1}`);
      const elapsed = event.browserTimeOriginMs + event.firstAudioPlaybackMonoMs - event.requestAcceptedAtEpochMs;
      if (elapsed < 0 ? event.requestToFirstAudioMs !== null : !finite(event.requestToFirstAudioMs) || Math.abs(elapsed - event.requestToFirstAudioMs) > 2) throw new Error(`player telemetry request timing is inconsistent on line ${index + 1}`);
    }
    events.push(event);
  }
  return events;
}

function buildTimingSummary(manifest, evaluation, runDir, lock) {
  let progressEvents = [];
  const progressPath = path.join(runDir, 'v2/progress.json');
  if (existsSync(progressPath)) {
    const progress = readJson(progressPath);
    if (Array.isArray(progress.events)) progressEvents = progress.events;
  }
  const metrics = evaluation.metrics ?? {};
  const playerTelemetry = readPlayerTelemetry(runDir, manifest, lock);
  const measuredRequestToAudio = playerTelemetry.map((event) => event.requestToFirstAudioMs).filter((value) => Number.isFinite(value));
  return {
    schemaVersion: 'v2-timings/v1',
    executionTiming: manifest.executionTiming ?? null,
    stageRuns: evaluation.stageRuns ?? manifest.stages?.preparationStages ?? [],
    metrics: Object.fromEntries(Object.entries(metrics).filter(([key]) => /(^timing\.|^v2\.(requestTo|timeTo|first|encode|total))/.test(key))),
    sceneReadyEvents: progressEvents,
    playerTelemetry,
    firstAudiblePlayableMs: measuredRequestToAudio.length ? Math.min(...measuredRequestToAudio) : null,
    firstAudiblePlayableStatus: measuredRequestToAudio.length
      ? 'measured at browser-player boundary; confirms an advancing unmuted media clock with a verified first-scene frame, not physical speaker output'
      : playerTelemetry.length
        ? 'browser playback observed, but request-acceptance epoch is unavailable or not comparable'
        : 'unmeasured: no player-boundary playback event is recorded',
    fullRequestToCompleteMs: metrics['v2.requestToCompleteMs'] ?? manifest.executionTiming?.requestToCompleteMs ?? null,
  };
}

function buildRepairTrace(manifest, evaluation, runDir) {
  const evidence = [];
  for (const relative of Object.keys(manifest.artifactSha256 ?? {}).sort()) {
    if (!/^structured\/.*\/(coercions|repair-patches)\.json$/.test(relative)) continue;
    const file = safeFile(runDir, relative);
    evidence.push({ path: relative, sha256: hashFile(file), data: readJson(file) });
  }
  return {
    schemaVersion: 'v2-repair-trace/v1',
    failures: evaluation.failures ?? [],
    repairs: evidence,
    repairEvidenceIndexed: evidence.length > 0,
    repairsComplete: false,
    limitations: [
      ...(evidence.length ? [] : ['No structured coercion or repair-patch artifacts were hash-indexed in this run.']),
      'The indexed structured artifacts and failure ledger are preserved; this derived trace is not a completeness proof for every planner salvage or repair path.',
    ],
  };
}

async function verifyLock(runDir) {
  const verifier = await import(path.join(ROOT, 'dist/src/pipeline-v2/lockV2.js'));
  const problems = await verifier.verifyLessonLockV2(runDir);
  const toolchainDriftOnly = problems.length > 0 && problems.every((problem) => /tool version drift or unknown pin/.test(problem));
  if (problems.length && !toolchainDriftOnly) throw new Error(`V2 lock failed verification: ${problems.join('; ')}`);
  return { lock: readJson(safeFile(runDir, 'lesson.lock.v2.json')), replayVerified: problems.length === 0, replayProblems: problems };
}

export async function createReviewBundle(runDirInput, bundleDirInput) {
  const runDir = path.resolve(runDirInput);
  const bundleDir = path.resolve(bundleDirInput);
  if (!existsSync(runDir) || !lstatSync(runDir).isDirectory()) throw new Error(`run directory does not exist: ${runDir}`);
  if (existsSync(bundleDir)) throw new Error(`bundle destination already exists: ${bundleDir}`);
  if (bundleDir.startsWith(`${runDir}${path.sep}`) || runDir.startsWith(`${bundleDir}${path.sep}`)) throw new Error('run and bundle directories may not contain one another');

  const runManifestPath = safeFile(runDir, 'run-manifest.json');
  const evaluationPath = safeFile(runDir, 'evaluation-bundle.json');
  const manifest = readJson(runManifestPath);
  const evaluation = readJson(evaluationPath);
  if (manifest.runId !== evaluation.runId || manifest.caseId !== evaluation.caseId || manifest.status !== evaluation.status) throw new Error('run manifest and evaluation identity/status differ');
  verifyRunIndex(runDir, manifest);
  const lockVerification = await verifyLock(runDir);
  const lock = lockVerification.lock;
  const video = probeMedia(safeFile(runDir, 'video.mp4'));
  const audio = probeMedia(safeFile(runDir, 'audio.wav'));
  if (!video.streamTypes.includes('video') || !video.streamTypes.includes('audio') || !audio.streamTypes.includes('audio')) throw new Error('video/audio bundle is missing a required media stream');

  mkdirSync(bundleDir, { recursive: false });
  try {
    const postRunTelemetry = existsSync(path.join(runDir, 'player-telemetry.jsonl')) ? ['player-telemetry.jsonl'] : [];
    for (const relative of [...Object.keys(manifest.artifactSha256).sort(), ...postRunTelemetry, 'run-manifest.json']) {
      const source = safeFile(runDir, relative);
      const destination = path.join(bundleDir, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    const timing = buildTimingSummary(manifest, evaluation, runDir, lock);
    writeFileSync(path.join(bundleDir, 'timings.json'), canonicalJson(timing), { flag: 'wx' });
    const repairTrace = buildRepairTrace(manifest, evaluation, runDir);
    writeFileSync(path.join(bundleDir, 'repair-trace.json'), canonicalJson(repairTrace), { flag: 'wx' });
    const files = walkFiles(bundleDir);
    const fileHashes = Object.fromEntries(files.map((relative) => [relative, hashFile(safeFile(bundleDir, relative))]));
    const index = {
      schemaVersion: 'v2-review-bundle/v1',
      runId: manifest.runId,
      caseId: manifest.caseId,
      legacyRunStatus: manifest.status,
      artifactStatusVersion: evaluation.artifactCertification?.artifactStatusVersion ?? null,
      artifactStatus: evaluation.artifactCertification?.artifactStatus ?? null,
      sourceHash: manifest.stages?.sourceDoc?.sha256 ?? manifest.sourceDocSha256 ?? null,
      pipelineDigest: lock.versions?.pipeline ?? null,
      toolVersions: lock.versions ?? {},
      lockReplayVerification: { status: lockVerification.replayVerified ? 'verified' : 'unverified-toolchain-drift', problems: lockVerification.replayProblems },
      configHash: manifest.configHash ?? null,
      artifactHashes: manifest.artifactSha256,
      postRunEvidence: postRunTelemetry.map((relative) => ({ path: relative, sha256: hashFile(safeFile(bundleDir, relative)), kind: 'browser-player-telemetry' })),
      fileHashes,
      limitations: [
        'The bundle index is a hash inventory, not a digital signature; preserve its SHA-256 in a separately trusted benchmark report.',
        ...(timing.firstAudiblePlayableMs === null ? ['Request-to-first-audio remains unmeasured unless a validated player-boundary event and comparable request timestamp are present.'] : ['Browser player telemetry does not prove sound reached physical speakers.']),
        ...(lockVerification.replayVerified ? [] : ['The lock could not be replay-verified with this checkout because its pinned tool versions are unavailable; its pinned bytes and media integrity are still checked.']),
      ],
    };
    writeFileSync(path.join(bundleDir, BUNDLE_INDEX), canonicalJson(index), { flag: 'wx' });
    return await verifyReviewBundle(bundleDir);
  } catch (error) {
    // This directory was confirmed absent above and created by this invocation.
    // Remove a partial export so callers never mistake it for a complete bundle.
    const { rmSync } = await import('node:fs');
    rmSync(bundleDir, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyReviewBundle(bundleDirInput) {
  const bundleDir = path.resolve(bundleDirInput);
  if (!existsSync(bundleDir) || !lstatSync(bundleDir).isDirectory()) throw new Error(`bundle directory does not exist: ${bundleDir}`);
  const index = readJson(safeFile(bundleDir, BUNDLE_INDEX));
  if (index.schemaVersion !== 'v2-review-bundle/v1' || !index.fileHashes || typeof index.fileHashes !== 'object' || Array.isArray(index.fileHashes)) throw new Error('invalid V2 review-bundle index');
  const actualFiles = walkFiles(bundleDir);
  const expectedFiles = Object.keys(index.fileHashes).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('bundle file inventory differs from the indexed inventory');
  for (const [relative, expected] of Object.entries(index.fileHashes)) {
    if (!/^[a-f0-9]{64}$/.test(expected) || hashFile(safeFile(bundleDir, relative)) !== expected) throw new Error(`bundle hash mismatch: ${relative}`);
  }
  const manifest = readJson(safeFile(bundleDir, 'run-manifest.json'));
  const evaluation = readJson(safeFile(bundleDir, 'evaluation-bundle.json'));
  if (manifest.runId !== index.runId || evaluation.runId !== index.runId || manifest.caseId !== index.caseId || evaluation.caseId !== index.caseId || manifest.status !== evaluation.status || manifest.status !== index.legacyRunStatus) throw new Error('bundle index, manifest and evaluation identities differ');
  if (JSON.stringify(manifest.artifactSha256) !== JSON.stringify(index.artifactHashes)) throw new Error('outer index artifact hashes differ from run manifest');
  if ((evaluation.artifactCertification?.artifactStatusVersion ?? null) !== index.artifactStatusVersion || (evaluation.artifactCertification?.artifactStatus ?? null) !== index.artifactStatus) throw new Error('outer index certification differs from evaluation bundle');
  verifyRunIndex(bundleDir, manifest);
  const lockVerification = await verifyLock(bundleDir);
  const lock = lockVerification.lock;
  if (lock.versions?.pipeline !== index.pipelineDigest || JSON.stringify(lock.versions ?? {}) !== JSON.stringify(index.toolVersions)) throw new Error('bundle lock toolchain differs from the outer index');
  if (JSON.stringify(index.lockReplayVerification) !== JSON.stringify({ status: lockVerification.replayVerified ? 'verified' : 'unverified-toolchain-drift', problems: lockVerification.replayProblems })) throw new Error('bundle lock replay-verification record differs from the verifier result');
  const video = probeMedia(safeFile(bundleDir, 'video.mp4'));
  const audio = probeMedia(safeFile(bundleDir, 'audio.wav'));
  if (!video.streamTypes.includes('video') || !video.streamTypes.includes('audio') || !audio.streamTypes.includes('audio')) throw new Error('bundle media streams are invalid');
  const timing = buildTimingSummary(manifest, evaluation, bundleDir, lock);
  if (JSON.stringify(readJson(safeFile(bundleDir, 'timings.json'))) !== JSON.stringify(timing)) throw new Error('timings.json does not match the hash-pinned run and player telemetry');
  const telemetryPath = path.join(bundleDir, 'player-telemetry.jsonl');
  const expectedPostRunEvidence = existsSync(telemetryPath) ? [{ path: 'player-telemetry.jsonl', sha256: hashFile(telemetryPath), kind: 'browser-player-telemetry' }] : [];
  if (JSON.stringify(index.postRunEvidence ?? []) !== JSON.stringify(expectedPostRunEvidence)) throw new Error('post-run evidence index differs from player telemetry');
  return { verified: true, lockReplayVerified: lockVerification.replayVerified, runId: index.runId, caseId: index.caseId, artifactStatus: index.artifactStatus, pipelineDigest: index.pipelineDigest, bundleIndexSha256: hashFile(path.join(bundleDir, BUNDLE_INDEX)), files: expectedFiles.length };
}

async function main(args) {
  const [command, source, destination] = args;
  if (command === 'create' && source && destination) {
    console.log(JSON.stringify(await createReviewBundle(source, destination), null, 2));
    return;
  }
  if (command === 'verify' && source && !destination) {
    console.log(JSON.stringify(await verifyReviewBundle(source), null, 2));
    return;
  }
  throw new Error('Usage: v2-review-bundle.mjs create <run-dir> <new-bundle-dir> | verify <bundle-dir>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

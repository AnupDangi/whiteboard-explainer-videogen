import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderVideoFromLessonLock, verifyLessonLock } from '../run/lessonLock.js';
import { DEVELOPMENT_SET_RELATIVE_PATH, resolveDevelopmentAttempt, type DevelopmentAttempt } from './developmentBenchmark.js';
import type { ColdAttemptEvidence } from './releaseGate.js';

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/i;

export interface ReleaseArtifactAttempt {
  directory: string;
  attempt: ColdAttemptEvidence;
  integrity: 'verified' | 'failed' | 'unmeasured';
  reasons: string[];
  /** Metrics not derivable from the current machine-generated run artifacts stay explicit. */
  unmeasured: string[];
  expectedAttempt?: DevelopmentAttempt;
}

export interface ReleaseArtifactCollection {
  schemaVersion: 'teaching-compiler-v1-release-artifact-evidence/v1';
  status: 'verified' | 'failed' | 'unmeasured';
  attempts: ReleaseArtifactAttempt[];
  topicIds: string[];
  humanReview: { status: 'unmeasured'; reasons: string[] };
  heldOut: { status: 'unmeasured'; reasons: string[] };
  assetRights: { status: 'unmeasured'; reasons: string[] };
  limitations: string[];
  reasons: string[];
}

interface RunManifest {
  schemaVersion?: unknown;
  pipeline?: unknown;
  status?: unknown;
  runClass?: unknown;
  runId?: unknown;
  caseId?: unknown;
  options?: { cache?: unknown };
  benchmark?: {
    setId?: unknown; attemptId?: unknown; topicId?: unknown; trial?: unknown;
    sourcePath?: unknown; sourceSha256?: unknown; instructionSha256?: unknown;
  };
  artifactSha256?: Record<string, unknown>;
}

interface EvaluationBundle {
  schemaVersion?: unknown;
  pipeline?: unknown;
  runClass?: unknown;
  status?: unknown;
  runId?: unknown;
  caseId?: unknown;
  metrics?: Record<string, unknown>;
  failures?: unknown[];
  gateRecords?: Array<{ gateSet?: unknown; passed?: unknown; failures?: unknown[] }>;
}

function safeRelativeFile(relative: string): boolean {
  return relative.length > 0 && !path.isAbsolute(relative) && !relative.split(/[\\/]/).some((part) => part === '..' || part === '');
}

async function readPinnedArtifact(root: string, relative: string, expected: unknown): Promise<Buffer> {
  if (!safeRelativeFile(relative)) throw new Error(`unsafe artifact path: ${relative}`);
  if (typeof expected !== 'string' || !HASH.test(expected)) throw new Error(`missing or invalid SHA-256 for ${relative}`);
  const rootReal = await realpath(root);
  const file = path.resolve(rootReal, relative);
  const fileReal = await realpath(file);
  if (!fileReal.startsWith(`${rootReal}${path.sep}`)) throw new Error(`artifact escapes run directory: ${relative}`);
  const info = await lstat(fileReal);
  if (!info.isFile()) throw new Error(`artifact is not a regular file: ${relative}`);
  const bytes = await readFile(fileReal);
  const actual = sha256(bytes);
  if (actual !== expected.toLowerCase()) throw new Error(`SHA-256 mismatch for ${relative}: ${actual} != ${expected}`);
  return bytes;
}

function finiteMetric(metrics: Record<string, unknown>, key: string): number | undefined {
  const value = metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Verify one emitted run directory from its run-manifest.json and pinned artifact bytes.
 * The manifest is an integrity index, not a cryptographic signature: this proves that
 * listed bytes match the manifest and are self-consistent, not who authored the run.
 */
export async function verifyReleaseArtifactDirectory(directory: string, projectRoot: string): Promise<ReleaseArtifactAttempt> {
  const root = path.resolve(directory);
  const reasons: string[] = [];
  const unmeasured: string[] = [];
  let artifactUnavailable = false;
  let manifest: RunManifest | undefined;
  let evaluation: EvaluationBundle | undefined;
  let manifestBytes: Buffer | undefined;
  try {
    manifestBytes = await readFile(path.join(root, 'run-manifest.json'));
    manifest = JSON.parse(manifestBytes.toString('utf8')) as RunManifest;
    if (manifest.schemaVersion !== 'hypothesis-run/v1' || manifest.pipeline !== 'claude') reasons.push('unsupported run-manifest schema or pipeline');
    if (!manifest.artifactSha256 || typeof manifest.artifactSha256 !== 'object' || Array.isArray(manifest.artifactSha256)) {
      artifactUnavailable = true;
      unmeasured.push('run-manifest artifactSha256 index is missing');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        directory: root,
        attempt: { completion: 'partial' },
        integrity: 'unmeasured',
        reasons: [],
        unmeasured: ['run-manifest.json is missing'],
      };
    } else reasons.push(`run-manifest.json unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const pinned = new Map<string, Buffer>();
  if (manifest?.artifactSha256 && typeof manifest.artifactSha256 === 'object') {
    for (const [relative, hash] of Object.entries(manifest.artifactSha256)) {
      try { pinned.set(relative, await readPinnedArtifact(root, relative, hash)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          artifactUnavailable = true;
          unmeasured.push(`hash-indexed artifact is missing: ${relative}`);
        } else reasons.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const readJson = <T>(name: string): T | undefined => {
    const bytes = pinned.get(name);
    if (!bytes) return undefined;
    try { return JSON.parse(bytes.toString('utf8')) as T; }
    catch (error) { reasons.push(`${name} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
  };
  evaluation = readJson<EvaluationBundle>('evaluation-bundle.json');
  const lockEvidence = readJson<{
    status?: unknown; schemaVersion?: unknown;
    execution?: { cacheMode?: unknown };
    modelSettings?: { run?: { cache?: unknown } };
    assets?: { usageContext?: unknown };
  }>('lesson.lock.json');
  if (pinned.has('lesson.lock.json')) {
    const lockProblems = await verifyLessonLock(root);
    if (lockProblems.length) reasons.push(...lockProblems.map((problem) => `lesson lock: ${problem}`));
  }
  if (!evaluation) {
    artifactUnavailable = true;
    unmeasured.push('hash-verified evaluation-bundle.json is required');
  }
  else {
    if (!['evaluation-bundle/v1', 'evaluation-bundle/v2'].includes(String(evaluation.schemaVersion))) reasons.push('unsupported evaluation bundle schema');
    if (evaluation.pipeline !== 'claude' || evaluation.runClass !== manifest?.runClass) reasons.push('run manifest and evaluation bundle pipeline/run class do not match');
    if (evaluation.runId !== manifest?.runId || evaluation.caseId !== manifest?.caseId) reasons.push('run manifest and evaluation bundle identity do not match');
    if (evaluation.status !== manifest?.status) reasons.push('run manifest and evaluation bundle status do not match');
  }

  const benchmark = manifest?.benchmark;
  const attemptId = typeof benchmark?.attemptId === 'string' ? benchmark.attemptId : undefined;
  const topicId = typeof benchmark?.topicId === 'string' ? benchmark.topicId : undefined;
  const trial = typeof benchmark?.trial === 'number' ? benchmark.trial : undefined;
  if (!attemptId || !topicId || !Number.isInteger(trial) || trial! < 1 || trial! > 3) reasons.push('run-manifest lacks a valid frozen benchmark attempt identity');
  if (typeof benchmark?.sourceSha256 !== 'string' || !HASH.test(benchmark.sourceSha256)) reasons.push('run-manifest lacks a valid frozen source SHA-256');

  let expectedAttempt: DevelopmentAttempt | undefined;
  if (attemptId) {
    try {
      expectedAttempt = resolveDevelopmentAttempt(projectRoot, attemptId);
      if (benchmark?.setId !== expectedAttempt.setId || benchmark.attemptId !== expectedAttempt.attemptId ||
          benchmark.topicId !== expectedAttempt.topicId || benchmark.trial !== expectedAttempt.trial ||
          benchmark.sourcePath !== expectedAttempt.sourcePath || benchmark.sourceSha256 !== expectedAttempt.sourceSha256 ||
          benchmark.instructionSha256 !== expectedAttempt.instructionSha256) {
        reasons.push(`run-manifest benchmark metadata does not match frozen slot ${attemptId}`);
      }
    } catch (error) {
      reasons.push(`frozen benchmark slot verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const executionCache = lockEvidence?.execution?.cacheMode;
  const modelCache = lockEvidence?.modelSettings?.run?.cache;
  if (executionCache !== undefined && modelCache !== undefined && executionCache !== modelCache) {
    reasons.push('lesson lock execution cache mode does not match model settings cache mode');
  }
  const cache = executionCache ?? modelCache;
  if (!['cold', 'warm', 'replay'].includes(String(cache))) unmeasured.push('hash-verified lesson lock does not record a valid cache mode');
  if (manifest?.options?.cache !== undefined && cache !== undefined && manifest.options.cache !== cache) {
    reasons.push('run-manifest cache mode does not match hash-verified lesson lock');
  }
  if (cache !== undefined && cache !== 'cold') reasons.push(`hash-verified lesson lock used cache mode ${String(cache)}, expected cold`);
  const cold = cache === 'cold' ? true : cache === 'warm' || cache === 'replay' ? false : undefined;

  // Pipeline status is not a publication verdict: live runs are intentionally
  // draft until an independent judge has reviewed them. A renderable draft can
  // still be a mechanically complete cold attempt.
  const claimedRenderable = ['passed', 'draft'].includes(String(manifest?.status)) && manifest?.status === evaluation?.status;
  let lockRerenderPassed: boolean | undefined;
  let rerenderAttempted = false;
  if (claimedRenderable) {
    for (const required of ['lesson.lock.json', 'render-artifacts.json', 'video.mp4']) {
      if (!pinned.has(required)) {
        artifactUnavailable = true;
        unmeasured.push(`passed run requires hash-pinned ${required}`);
      }
    }
    if (pinned.has('lesson.lock.json')) {
      try {
        const lock = JSON.parse(pinned.get('lesson.lock.json')!.toString('utf8')) as { status?: unknown; schemaVersion?: unknown };
        if (lock.schemaVersion !== 'lesson.lock/v4' || lock.status !== 'renderable') reasons.push('passed run lock must be a complete renderable lesson.lock/v4');
        if (pinned.has('render-artifacts.json')) {
          const render = readJson<{ artifacts?: Record<string, { file?: unknown; sha256?: unknown }> }>('render-artifacts.json');
          const videoEntry = render?.artifacts?.['video'];
          const videoBytes = pinned.get('video.mp4');
          if (!videoEntry || videoEntry.file !== 'video.mp4' || !videoBytes || videoEntry.sha256 !== sha256(videoBytes)) reasons.push('render artifact manifest does not hash-pin video.mp4');
          if (reasons.length === 0) {
            const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lesson-lock-release-rerender-'));
            const rerenderRoot = path.join(tempRoot, 'run');
            try {
              await cp(root, rerenderRoot, { recursive: true, dereference: false });
              rerenderAttempted = true;
              const rerenderedVideo = await renderVideoFromLessonLock(rerenderRoot);
              const rerenderedHash = sha256(await readFile(rerenderedVideo));
              const originalVideo = pinned.get('video.mp4');
              if (!originalVideo || rerenderedHash !== sha256(originalVideo)) {
                reasons.push(`lesson.lock rerender differs from hash-pinned video (${rerenderedHash})`);
              }
            } finally { await rm(tempRoot, { recursive: true, force: true }); }
          }
        }
        if (rerenderAttempted) lockRerenderPassed = reasons.length === 0;
      } catch (error) {
        reasons.push(`lock/render verification failed: ${error instanceof Error ? error.message : String(error)}`);
        if (rerenderAttempted) lockRerenderPassed = false;
      }
    }
  }

  const metrics = evaluation?.metrics ?? {};
  const majorVisualCoverage = finiteMetric(metrics, 'semantic.majorClaimVisualCoverage');
  const requiredRelationCoverage = finiteMetric(metrics, 'semantic.requiredRelationCoverage');
  const stateChangeCoverage = finiteMetric(metrics, 'semantic.stateChangeCoverage');
  const lastResortTextRate = finiteMetric(metrics, 'semantic.lastResortTextRate');
  for (const [key, value] of [
    ['semantic.majorClaimVisualCoverage', majorVisualCoverage],
    ['semantic.requiredRelationCoverage', requiredRelationCoverage],
    ['semantic.stateChangeCoverage', stateChangeCoverage],
    ['semantic.lastResortTextRate', lastResortTextRate],
  ] as const) if (value === undefined || value < 0 || value > 1) unmeasured.push(`hashed evaluation metrics omit valid ${key}`);

  // No current machine artifact is an independent semantic or human audit of icon correctness,
  // factual support, geometry meaning, rights compliance, held-out status, or board comprehension.
  unmeasured.push('wrong semantic icon count requires independent semantic review');
  unmeasured.push('unsupported major claim count requires independent factual review');
  unmeasured.push('meaning-changing geometry count requires independent semantic review');
  unmeasured.push('asset rights and provenance need reviewed bridge/license evidence');
  // A run that admitted review-licence assets (ASSET_USAGE_CONTEXT=local-dev) can never satisfy rights compliance.
  const localDevAssets = lockEvidence?.assets?.usageContext === 'local-dev';
  if (localDevAssets) reasons.push('run admitted review-licence assets (asset usage context local-dev); it cannot pass release rights and provenance compliance');
  const completion: ColdAttemptEvidence['completion'] = claimedRenderable && reasons.length === 0 && !artifactUnavailable && lockRerenderPassed === true
    ? 'complete'
    : (evaluation?.status === 'failed' || reasons.length > 0 ? 'failed' : 'partial');
  const attempt: ColdAttemptEvidence = {
    ...(attemptId ? { attemptId } : {}), ...(topicId ? { topicId } : {}), ...(trial ? { trial } : {}),
    ...(cold !== undefined ? { cold } : {}), completion,
    ...(majorVisualCoverage !== undefined && majorVisualCoverage >= 0 && majorVisualCoverage <= 1 ? { majorVisualCoverage } : {}),
    ...(requiredRelationCoverage !== undefined && requiredRelationCoverage >= 0 && requiredRelationCoverage <= 1 ? { requiredRelationCoverage } : {}),
    ...(stateChangeCoverage !== undefined && stateChangeCoverage >= 0 && stateChangeCoverage <= 1 ? { stateChangeCoverage } : {}),
    ...(lastResortTextRate !== undefined && lastResortTextRate >= 0 && lastResortTextRate <= 1 ? { lastResortTextRate } : {}),
    ...(lockRerenderPassed !== undefined ? { lockRerenderPassed } : {}),
    ...(localDevAssets ? { assetRightsAndProvenanceComplete: false } : {}),
  };
  const integrity: ReleaseArtifactAttempt['integrity'] = reasons.length ? 'failed' : artifactUnavailable ? 'unmeasured' : 'verified';
  return { directory: root, attempt, integrity, reasons, unmeasured, ...(expectedAttempt ? { expectedAttempt } : {}) };
}

/** Collect a frozen set of run directories; directory ordering is normalized for reports. */
export async function collectReleaseArtifactEvidence(directories: readonly string[], projectRoot: string): Promise<ReleaseArtifactCollection> {
  const attempts = await Promise.all([...directories].map((directory) => verifyReleaseArtifactDirectory(directory, projectRoot)));
  attempts.sort((a, b) => (a.attempt.attemptId ?? a.directory).localeCompare(b.attempt.attemptId ?? b.directory));
  const collectionReasons: string[] = [];
  let frozenTopicIds: string[] = [];
  try {
    const frozen = JSON.parse(await readFile(path.join(projectRoot, DEVELOPMENT_SET_RELATIVE_PATH), 'utf8')) as {
      schemaVersion?: unknown; setId?: unknown; topics?: Array<{ topicId?: unknown }>;
      plannedAttempts?: Array<{ attemptId?: unknown }>;
    };
    if (frozen.schemaVersion !== 'teaching-compiler-v1-development-set/v1' || frozen.setId !== 'teaching-compiler-v1-dev-set-v1' ||
        frozen.topics?.length !== 5 || frozen.plannedAttempts?.length !== 15) {
      collectionReasons.push('frozen development set must contain the canonical 5 topics and 15 attempt slots');
    } else {
      frozenTopicIds = frozen.topics.map((topic) => String(topic.topicId)).sort();
      const planned = new Map<string, DevelopmentAttempt>();
      for (const slot of frozen.plannedAttempts) {
        if (typeof slot.attemptId !== 'string') { collectionReasons.push('frozen set contains an invalid attempt ID'); continue; }
        try {
          const verified = resolveDevelopmentAttempt(projectRoot, slot.attemptId);
          if (planned.has(verified.attemptId)) collectionReasons.push(`frozen set duplicates attempt ${verified.attemptId}`);
          planned.set(verified.attemptId, verified);
        } catch (error) { collectionReasons.push(`frozen set slot verification failed: ${error instanceof Error ? error.message : String(error)}`); }
      }
      const observed = new Map<string, ReleaseArtifactAttempt[]>();
      for (const item of attempts) {
        const id = item.attempt.attemptId;
        if (id) observed.set(id, [...(observed.get(id) ?? []), item]);
      }
      for (const id of planned.keys()) {
        if (!observed.has(id)) collectionReasons.push(`frozen attempt ${id} is missing`);
        if ((observed.get(id)?.length ?? 0) > 1) collectionReasons.push(`frozen attempt ${id} appears more than once`);
      }
      for (const id of observed.keys()) if (!planned.has(id)) collectionReasons.push(`unplanned attempt ${id} was supplied`);
    }
  } catch (error) {
    collectionReasons.push(`frozen development manifest unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const topicIds = frozenTopicIds.length ? frozenTopicIds : [...new Set(attempts.map(({ attempt }) => attempt.topicId).filter((id): id is string => Boolean(id)))].sort();
  const failed = attempts.some((item) => item.integrity === 'failed');
  const incomplete = attempts.length === 0 || attempts.some((item) => item.integrity !== 'verified') || collectionReasons.length > 0;
  const commonUnmeasured = ['No hash-verifiable held-out benchmark report was provided.', 'No independently reviewed human alignment or muted-board evidence was provided.'];
  return {
    schemaVersion: 'teaching-compiler-v1-release-artifact-evidence/v1',
    status: failed ? 'failed' : incomplete ? 'unmeasured' : 'verified',
    attempts,
    topicIds,
    humanReview: { status: 'unmeasured', reasons: ['alignment calibration and muted-board responses require independently identified reviewers and a frozen review pack'] },
    heldOut: { status: 'unmeasured', reasons: ['a versioned held-out set and complete hashed run report are absent'] },
    assetRights: { status: 'unmeasured', reasons: ['run artifacts do not independently validate asset license terms or reviewed provenance'] },
    reasons: collectionReasons,
    limitations: [...commonUnmeasured, ...(attempts.length ? [] : ['No run artifact directories were supplied.'])],
  };
}

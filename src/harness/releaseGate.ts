/**
 * Pure evaluator for the proposed V1 release and human-evidence gates in final_plan/04.
 * It consumes already-collected evidence only: it has no filesystem, provider,
 * topic-name, or lesson-specific behavior.
 */

export const RELEASE_GATE_VERSION = 'teaching-compiler-v1-release-gates/v1';

export type ReleaseGateStatus = 'passed' | 'failed' | 'unmeasured';

export interface ReleaseGateResult {
  status: ReleaseGateStatus;
  reasons: string[];
}

export interface ColdAttemptEvidence {
  attemptId?: string;
  /** Exact opaque ID from the caller-supplied topicIds list. */
  topicId?: string;
  /** One-based trial ordinal within a topic; all three planned trials count. */
  trial?: number;
  cold?: boolean;
  completion?: 'complete' | 'partial' | 'failed';
  /** Counts and rates use finite numbers; coverage/rate values are fractions in [0, 1]. */
  wrongSemanticIcons?: number;
  unsupportedMajorClaims?: number;
  meaningChangingGeometryFailures?: number;
  majorVisualCoverage?: number;
  requiredRelationCoverage?: number;
  stateChangeCoverage?: number;
  lastResortTextRate?: number;
  lockRerenderPassed?: boolean;
  assetRightsAndProvenanceComplete?: boolean;
}

export interface MutedBoardResponse {
  /** Exact scene identifier from the caller-supplied majorSceneIds list. */
  sceneId?: string;
  /** The protocol's 0=incorrect, 1=partial, 2=substantially correct score. */
  score?: number;
  reviewerId?: string;
  responseId?: string;
}

export interface HeldOutEvidence {
  datasetVersion?: string;
  frozenBeforeFinalTuning?: boolean;
  reportSha256?: string;
  attemptedRuns?: number;
  allFailuresReported?: boolean;
  releaseCriteriaPassed?: boolean;
}

export interface AlignmentCalibrationEvidence {
  calibrationId?: string;
  calibrationSha256?: string;
  status?: 'measured' | 'unmeasured' | 'failed';
  reviewerIds?: string[];
  sourceDocumentCount?: number;
  wordItemCount?: number;
  reviewerAgreementPassed?: boolean;
}

export interface ReleaseEvidence {
  /** Supplied by the evaluator caller; IDs are treated as opaque strings. */
  topicIds?: string[];
  /** Major scenes in the blinded review pack; each needs two independent reviewers. */
  majorSceneIds?: string[];
  /** SHA-256 of the frozen review-pack manifest that enumerates major scene IDs. */
  mutedBoardPackSha256?: string;
  attempts?: ColdAttemptEvidence[];
  heldOut?: HeldOutEvidence;
  alignmentCalibration?: AlignmentCalibrationEvidence;
  mutedBoardResponses?: MutedBoardResponse[];
}

export interface ReleaseGateReport {
  schemaVersion: typeof RELEASE_GATE_VERSION;
  status: ReleaseGateStatus;
  gates: {
    coldAttemptDesign: ReleaseGateResult;
    completeRunCount: ReleaseGateResult;
    perTopicCompletion: ReleaseGateResult;
    wrongSemanticIcons: ReleaseGateResult;
    unsupportedMajorClaims: ReleaseGateResult;
    meaningChangingGeometry: ReleaseGateResult;
    majorVisualCoverage: ReleaseGateResult;
    requiredRelationCoverage: ReleaseGateResult;
    stateChangeCoverage: ReleaseGateResult;
    lastResortTextRate: ReleaseGateResult;
    heldOutBenchmark: ReleaseGateResult;
    alignmentCalibration: ReleaseGateResult;
    lockRerender: ReleaseGateResult;
    assetRightsAndProvenance: ReleaseGateResult;
    mutedBoardInterpretation: ReleaseGateResult;
  };
}

const result = (status: ReleaseGateStatus, ...reasons: string[]): ReleaseGateResult => ({ status, reasons });

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonNegativeInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= 0;

const fraction = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 1;

function combine(results: ReleaseGateResult[]): ReleaseGateResult {
  const reasons = results.flatMap((gate) => gate.reasons);
  if (results.some((gate) => gate.status === 'failed')) return { status: 'failed', reasons };
  if (results.some((gate) => gate.status === 'unmeasured')) return { status: 'unmeasured', reasons };
  return { status: 'passed', reasons };
}

function coldAttemptDesign(topicIds: string[] | undefined, attempts: ColdAttemptEvidence[] | undefined): ReleaseGateResult {
  if (!topicIds || !attempts) return result('unmeasured', 'topic IDs or cold-attempt evidence are missing');
  if (topicIds.length !== 5 || topicIds.some((id) => typeof id !== 'string' || id.trim() === '') || new Set(topicIds).size !== topicIds.length) {
    return result('unmeasured', 'the supplied topic set must contain exactly five distinct nonempty IDs');
  }
  if (attempts.length < 15) return result('unmeasured', `only ${attempts.length}/15 cold attempts are present`);
  if (attempts.length > 15) return result('failed', `expected exactly 15 attempts, received ${attempts.length}`);

  const problems: string[] = [];
  const missing: string[] = [];
  const planned = new Set(topicIds);
  const seen = new Set<string>();
  const attemptIds = new Set<string>();
  const perTopic = new Map(topicIds.map((id) => [id, new Set<number>()]));
  for (const [index, attempt] of attempts.entries()) {
    if (!attempt || !attempt.attemptId || !attempt.topicId || attempt.trial === undefined || attempt.cold === undefined) {
      missing.push(`attempt ${index + 1} is missing attempt ID, topic ID, trial ordinal, or cold-cache evidence`);
      continue;
    }
    if (attemptIds.has(attempt.attemptId)) problems.push(`attempt ID ${attempt.attemptId} is duplicated`);
    attemptIds.add(attempt.attemptId);
    if (!planned.has(attempt.topicId)) {
      problems.push(`attempt ${attempt.attemptId} uses a topic ID outside the supplied topic set`);
      continue;
    }
    if (attempt.cold !== true) problems.push(`attempt ${attempt.attemptId} is not confirmed cold`);
    if (!Number.isInteger(attempt.trial) || attempt.trial < 1 || attempt.trial > 3) {
      problems.push(`attempt ${attempt.attemptId} has a trial ordinal outside 1..3`);
      continue;
    }
    const key = `${attempt.topicId}\u0000${attempt.trial}`;
    if (seen.has(key)) problems.push(`topic ${attempt.topicId} has a duplicate trial ordinal ${attempt.trial}`);
    seen.add(key);
    perTopic.get(attempt.topicId)!.add(attempt.trial);
  }
  for (const topicId of topicIds) {
    if ((perTopic.get(topicId)?.size ?? 0) !== 3) missing.push(`topic ${topicId} does not have three distinct trial results`);
  }
  if (problems.length) return { status: 'failed', reasons: problems };
  if (missing.length) return { status: 'unmeasured', reasons: missing };
  return result('passed', 'exactly three cold trials are present for each of the five supplied topic IDs');
}

function completedRunsGate(attempts: ColdAttemptEvidence[] | undefined, design: ReleaseGateResult): ReleaseGateResult {
  if (design.status !== 'passed') return result('unmeasured', 'the cold-attempt design is incomplete or invalid, so the 15-run score cannot be established');
  const missing = attempts!.filter((attempt) => !attempt?.completion);
  const invalid = attempts!.filter((attempt) => attempt?.completion !== undefined && !['complete', 'partial', 'failed'].includes(attempt.completion));
  if (invalid.length) return result('failed', `${invalid.length} attempt(s) have an invalid completion result`);
  if (missing.length) return result('unmeasured', `${missing.length} attempt completion result(s) are missing`);
  const complete = attempts!.filter((attempt) => attempt.completion === 'complete').length;
  return complete >= 14
    ? result('passed', `${complete}/15 attempts completed; threshold is at least 14`)
    : result('failed', `${complete}/15 attempts completed; threshold is at least 14`);
}

function topicCompletionGate(topicIds: string[] | undefined, attempts: ColdAttemptEvidence[] | undefined, design: ReleaseGateResult): ReleaseGateResult {
  if (design.status !== 'passed') return result('unmeasured', 'the cold-attempt design is incomplete or invalid, so per-topic completion cannot be established');
  const missing = attempts!.filter((attempt) => !attempt?.completion);
  const invalid = attempts!.filter((attempt) => attempt?.completion !== undefined && !['complete', 'partial', 'failed'].includes(attempt.completion));
  if (invalid.length) return result('failed', `${invalid.length} attempt(s) have an invalid completion result`);
  if (missing.length) return result('unmeasured', `${missing.length} attempt completion result(s) are missing`);
  const counts = topicIds!.map((topicId) => ({
    topicId,
    complete: attempts!.filter((attempt) => attempt.topicId === topicId && attempt.completion === 'complete').length,
  }));
  const below = counts.filter(({ complete }) => complete < 2);
  return below.length
    ? { status: 'failed', reasons: below.map(({ topicId, complete }) => `topic ${topicId} has ${complete}/3 complete runs; threshold is at least 2`) }
    : { status: 'passed', reasons: counts.map(({ topicId, complete }) => `topic ${topicId}: ${complete}/3 complete runs`) };
}

type NumericMetric = 'wrongSemanticIcons' | 'unsupportedMajorClaims' | 'meaningChangingGeometryFailures';
type RateMetric = 'majorVisualCoverage' | 'requiredRelationCoverage' | 'stateChangeCoverage' | 'lastResortTextRate';

function countMetricGate(attempts: ColdAttemptEvidence[] | undefined, field: NumericMetric, label: string): ReleaseGateResult {
  const complete = (attempts ?? []).filter((attempt) => attempt?.completion === 'complete');
  if (complete.length === 0) return result('unmeasured', `no complete runs provide ${label} evidence`);
  const missing: string[] = [];
  const failures: string[] = [];
  for (const attempt of complete) {
    const value = attempt[field];
    if (value === undefined || value === null) { missing.push(`${attempt.attemptId ?? 'unnamed attempt'} is missing ${label}`); continue; }
    if (!nonNegativeInteger(value)) { failures.push(`${attempt.attemptId ?? 'unnamed attempt'} has invalid ${label} evidence`); continue; }
    if (value !== 0) failures.push(`${attempt.attemptId ?? 'unnamed attempt'} reports ${value} ${label}`);
  }
  if (failures.length) return { status: 'failed', reasons: failures.concat(missing) };
  if (missing.length) return { status: 'unmeasured', reasons: missing };
  return result('passed', `all ${complete.length} complete runs report zero ${label}`);
}

function rateMetricGate(attempts: ColdAttemptEvidence[] | undefined, field: RateMetric, label: string, threshold: number, comparison: 'min' | 'max'): ReleaseGateResult {
  const complete = (attempts ?? []).filter((attempt) => attempt?.completion === 'complete');
  if (complete.length === 0) return result('unmeasured', `no complete runs provide ${label} evidence`);
  const missing: string[] = [];
  const failures: string[] = [];
  for (const attempt of complete) {
    const value = attempt[field];
    if (value === undefined || value === null) { missing.push(`${attempt.attemptId ?? 'unnamed attempt'} is missing ${label}`); continue; }
    if (!fraction(value)) { failures.push(`${attempt.attemptId ?? 'unnamed attempt'} has invalid ${label}; expected a fraction from 0 to 1`); continue; }
    const passes = comparison === 'min' ? value >= threshold : value <= threshold;
    if (!passes) failures.push(`${attempt.attemptId ?? 'unnamed attempt'} reports ${(value * 100).toFixed(1)}% ${label}; threshold is ${comparison === 'min' ? 'at least' : 'at most'} ${(threshold * 100).toFixed(0)}%`);
  }
  if (failures.length) return { status: 'failed', reasons: failures.concat(missing) };
  if (missing.length) return { status: 'unmeasured', reasons: missing };
  return result('passed', `all ${complete.length} complete runs meet the ${comparison === 'min' ? 'minimum' : 'maximum'} ${label} threshold of ${(threshold * 100).toFixed(0)}%`);
}

function booleanMetricGate(attempts: ColdAttemptEvidence[] | undefined, field: 'lockRerenderPassed' | 'assetRightsAndProvenanceComplete', label: string): ReleaseGateResult {
  const complete = (attempts ?? []).filter((attempt) => attempt?.completion === 'complete');
  if (complete.length === 0) return result('unmeasured', `no complete runs provide ${label} evidence`);
  const missing: string[] = [];
  const failures: string[] = [];
  for (const attempt of complete) {
    const value = attempt[field];
    if (value === undefined || value === null) { missing.push(`${attempt.attemptId ?? 'unnamed attempt'} is missing ${label} result`); continue; }
    if (typeof value !== 'boolean') { failures.push(`${attempt.attemptId ?? 'unnamed attempt'} has invalid ${label} result`); continue; }
    if (!value) failures.push(`${attempt.attemptId ?? 'unnamed attempt'} did not pass ${label}`);
  }
  if (failures.length) return { status: 'failed', reasons: failures.concat(missing) };
  if (missing.length) return { status: 'unmeasured', reasons: missing };
  return result('passed', `all ${complete.length} complete runs pass ${label}`);
}

function mutedBoardGate(sceneIds: string[] | undefined, packSha256: string | undefined, responses: MutedBoardResponse[] | undefined): ReleaseGateResult {
  if (!sceneIds || sceneIds.length === 0 || !responses || responses.length === 0 || !packSha256) {
    return result('unmeasured', 'frozen review-pack manifest, major scene IDs, or muted-board review responses are missing');
  }
  if (!/^[a-f0-9]{64}$/i.test(packSha256)) return result('failed', 'muted-board review-pack manifest SHA-256 is invalid');
  if (sceneIds.some((id) => typeof id !== 'string' || id.trim() === '') || new Set(sceneIds).size !== sceneIds.length) {
    return result('failed', 'major scene IDs must be distinct, nonempty strings');
  }
  const missing: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const perScene = new Map(sceneIds.map((id) => [id, [] as MutedBoardResponse[]]));
  for (const [index, response] of responses.entries()) {
    if (!response?.sceneId?.trim() || !response.reviewerId?.trim() || !response.responseId?.trim() || response.score === undefined || response.score === null) {
      missing.push(`response ${index + 1} is missing scene ID, reviewer ID, response ID, or score`);
      continue;
    }
    if (!sceneIds.includes(response.sceneId)) {
      invalid.push(`response ${response.responseId} uses a scene outside the review pack`);
      continue;
    }
    if (seen.has(`response\u0000${response.responseId}`)) invalid.push(`response ID ${response.responseId} is duplicated`);
    seen.add(`response\u0000${response.responseId}`);
    if (![0, 1, 2].includes(response.score)) invalid.push(`response ${response.responseId} has a score outside the protocol scale 0..2`);
    const key = `${response.sceneId}\u0000${response.reviewerId}`;
    if (seen.has(key)) invalid.push(`scene ${response.sceneId} has duplicate reviewer ${response.reviewerId}`);
    seen.add(key);
    perScene.get(response.sceneId)!.push(response);
  }
  for (const [sceneId, sceneResponses] of perScene) {
    if (sceneResponses.length < 2) missing.push(`scene ${sceneId} has ${sceneResponses.length}/2 independent reviewer responses`);
  }
  if (invalid.length) return { status: 'failed', reasons: invalid.concat(missing) };
  if (missing.length) return { status: 'unmeasured', reasons: missing };
  const sceneRates = sceneIds.map((sceneId) => {
    const sceneResponses = responses.filter((response) => response.sceneId === sceneId);
    return sceneResponses.filter((response) => response.score === 2).length / sceneResponses.length;
  });
  const rate = sceneRates.reduce((sum, sceneRate) => sum + sceneRate, 0) / sceneRates.length;
  return rate >= 0.8
    ? result('passed', `scene-balanced recovery is ${(rate * 100).toFixed(1)}%; every scene in frozen pack ${packSha256} has at least two distinct reviewers`)
    : result('failed', `scene-balanced recovery is ${(rate * 100).toFixed(1)}%; threshold is at least 80%`);
}

function heldOutGate(evidence: HeldOutEvidence | undefined): ReleaseGateResult {
  if (!evidence) return result('unmeasured', 'versioned held-out benchmark evidence is missing');
  const missing: string[] = [];
  if (!evidence.datasetVersion?.trim()) missing.push('held-out dataset version is missing');
  if (!evidence.reportSha256 || !/^[a-f0-9]{64}$/i.test(evidence.reportSha256)) missing.push('held-out report SHA-256 is missing or invalid');
  if (!nonNegativeInteger(evidence.attemptedRuns) || evidence.attemptedRuns === 0) missing.push('held-out attempted-run count is missing or zero');
  if (evidence.frozenBeforeFinalTuning !== true) missing.push('held-out set is not confirmed frozen before final tuning');
  if (evidence.allFailuresReported !== true) missing.push('held-out failure accounting is not confirmed complete');
  if (evidence.releaseCriteriaPassed === false) return result('failed', 'held-out benchmark did not meet release criteria');
  if (evidence.releaseCriteriaPassed !== true) missing.push('held-out release-criteria result is missing');
  return missing.length ? { status: 'unmeasured', reasons: missing } : result('passed', `versioned held-out report ${evidence.reportSha256} is frozen, fully accounted, and meets release criteria`);
}

function alignmentCalibrationGate(evidence: AlignmentCalibrationEvidence | undefined): ReleaseGateResult {
  if (!evidence) return result('unmeasured', 'alignment calibration evidence is missing');
  const reviewers = evidence.reviewerIds;
  if (evidence.status === 'failed') return result('failed', 'alignment calibration failed');
  const missing: string[] = [];
  if (evidence.status !== 'measured') missing.push('alignment calibration is not measured');
  if (!evidence.calibrationId?.trim()) missing.push('alignment calibration ID is missing');
  if (!evidence.calibrationSha256 || !/^[a-f0-9]{64}$/i.test(evidence.calibrationSha256)) missing.push('alignment calibration artifact SHA-256 is missing or invalid');
  if (!reviewers || new Set(reviewers).size < 2 || reviewers.some((id) => typeof id !== 'string' || !id.trim())) missing.push('two distinct alignment reviewers are not recorded');
  if (!nonNegativeInteger(evidence.sourceDocumentCount) || evidence.sourceDocumentCount < 3) missing.push('alignment calibration needs at least three source documents');
  if (!nonNegativeInteger(evidence.wordItemCount) || evidence.wordItemCount < 100) missing.push('alignment calibration needs at least 100 reviewed word items');
  if (evidence.reviewerAgreementPassed === false) return result('failed', 'alignment reviewers did not meet the calibration agreement criteria');
  if (evidence.reviewerAgreementPassed !== true) missing.push('alignment reviewer-agreement result is missing');
  return missing.length ? { status: 'unmeasured', reasons: missing } : result('passed', `measured alignment calibration ${evidence.calibrationId} has two distinct reviewers across ${evidence.sourceDocumentCount} source documents and ${evidence.wordItemCount} word items`);
}

/** Evaluate only the evidence supplied; absent measurements stay unmeasured. */
export function evaluateReleaseEvidence(evidence: ReleaseEvidence): ReleaseGateReport {
  const design = coldAttemptDesign(evidence.topicIds, evidence.attempts);
  const gates: ReleaseGateReport['gates'] = {
    coldAttemptDesign: design,
    completeRunCount: completedRunsGate(evidence.attempts, design),
    perTopicCompletion: topicCompletionGate(evidence.topicIds, evidence.attempts, design),
    wrongSemanticIcons: countMetricGate(evidence.attempts, 'wrongSemanticIcons', 'wrong semantic icons'),
    unsupportedMajorClaims: countMetricGate(evidence.attempts, 'unsupportedMajorClaims', 'unsupported major claims'),
    meaningChangingGeometry: countMetricGate(evidence.attempts, 'meaningChangingGeometryFailures', 'meaning-changing geometry failures'),
    majorVisualCoverage: rateMetricGate(evidence.attempts, 'majorVisualCoverage', 'major visual coverage', 0.9, 'min'),
    requiredRelationCoverage: rateMetricGate(evidence.attempts, 'requiredRelationCoverage', 'required relation coverage', 0.9, 'min'),
    stateChangeCoverage: rateMetricGate(evidence.attempts, 'stateChangeCoverage', 'state-change coverage', 0.9, 'min'),
    lastResortTextRate: rateMetricGate(evidence.attempts, 'lastResortTextRate', 'last-resort text rate', 0.15, 'max'),
    heldOutBenchmark: heldOutGate(evidence.heldOut),
    alignmentCalibration: alignmentCalibrationGate(evidence.alignmentCalibration),
    lockRerender: booleanMetricGate(evidence.attempts, 'lockRerenderPassed', 'deterministic lock rerender'),
    assetRightsAndProvenance: booleanMetricGate(evidence.attempts, 'assetRightsAndProvenanceComplete', 'complete asset-rights and provenance compliance'),
    mutedBoardInterpretation: mutedBoardGate(evidence.majorSceneIds, evidence.mutedBoardPackSha256, evidence.mutedBoardResponses),
  };
  const aggregate = combine(Object.values(gates));
  return { schemaVersion: RELEASE_GATE_VERSION, status: aggregate.status, gates };
}

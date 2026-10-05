/** Versioned release state for generated artifacts. The legacy RunStatus remains separate. */
import { createHash } from 'node:crypto';

export const ARTIFACT_STATUS_VERSION = 'artifact-status/v1' as const;
export const ARTIFACT_STATUSES = ['FAILED', 'DRAFT', 'PASSED_AUTOMATED', 'PASSED_REVIEW'] as const;
export const REQUIRED_ARTIFACT_GATE_IDS = [
  'verified-playable-video', 'no-hard-failures', 'no-fallback', 'required-scorecard-gates', 'complete-semantic-qa-suite',
] as const;
export type ArtifactStatus = typeof ARTIFACT_STATUSES[number];
export type ArtifactGateStatus = 'passed' | 'failed' | 'unmeasured';

export interface ArtifactGate {
  id: string;
  status: ArtifactGateStatus;
  detail?: string;
}

/** A review attestation must bind to the exact artifact and a hash-verified review report. */
export interface ArtifactHumanReview {
  schemaVersion: 'artifact-human-review/v1';
  status: 'passed' | 'failed';
  artifactSha256: string;
  reportSha256: string;
}

export interface ArtifactHumanReviewReport {
  schemaVersion: 'artifact-human-review-report/v1';
  status: 'passed' | 'failed';
  artifactSha256: string;
}

export interface ArtifactCertification {
  artifactStatusVersion: typeof ARTIFACT_STATUS_VERSION;
  artifactStatus: ArtifactStatus;
  artifactGates: ArtifactGate[];
  humanReview?: ArtifactHumanReview;
}

/** Fail closed: missing gates are unmeasured; only a valid artifact can receive any non-failed state. */
export function certifyArtifact(input: {
  artifactValid: boolean;
  gates: readonly ArtifactGate[];
  artifactSha256?: string;
  humanReview?: ArtifactHumanReview;
  /** Exact UTF-8 report bytes whose digest is recorded in humanReview.reportSha256. */
  humanReviewReportBytes?: string;
}): ArtifactCertification {
  const gates = [...input.gates];
  for (const id of REQUIRED_ARTIFACT_GATE_IDS) {
    if (!gates.some((gate) => gate.id === id)) gates.push({ id, status: 'unmeasured', detail: 'required gate evidence was not supplied' });
  }
  if (!input.artifactValid) return { artifactStatusVersion: ARTIFACT_STATUS_VERSION, artifactStatus: 'FAILED', artifactGates: gates };

  const allAutomaticGatesPassed = gates.every((gate) => gate.status === 'passed');
  if (!allAutomaticGatesPassed) {
    return { artifactStatusVersion: ARTIFACT_STATUS_VERSION, artifactStatus: 'DRAFT', artifactGates: gates };
  }

  const review = input.humanReview;
  let reportMatchesAttestation = false;
  if (review && input.humanReviewReportBytes !== undefined) {
    const actualReportSha256 = createHash('sha256').update(input.humanReviewReportBytes, 'utf8').digest('hex');
    try {
      const report = JSON.parse(input.humanReviewReportBytes) as Partial<ArtifactHumanReviewReport>;
      reportMatchesAttestation = actualReportSha256 === review.reportSha256 &&
        report.schemaVersion === 'artifact-human-review-report/v1' &&
        report.status === review.status && report.artifactSha256 === review.artifactSha256;
    } catch {
      reportMatchesAttestation = false;
    }
  }
  const reviewIsVerifiedAndBound = Boolean(
    review && review.schemaVersion === 'artifact-human-review/v1' && review.status === 'passed' &&
    /^[a-f0-9]{64}$/.test(review.reportSha256) && /^[a-f0-9]{64}$/.test(review.artifactSha256) &&
    /^[a-f0-9]{64}$/.test(input.artifactSha256 ?? '') && review.artifactSha256 === input.artifactSha256 &&
    reportMatchesAttestation,
  );
  if (review && !reviewIsVerifiedAndBound) {
    return {
      artifactStatusVersion: ARTIFACT_STATUS_VERSION,
      artifactStatus: 'DRAFT',
      artifactGates: [...gates, {
        id: 'human-review',
        status: review.status === 'failed' ? 'failed' : 'unmeasured',
        detail: review.status === 'failed' ? 'human review did not pass' : 'human review report bytes are missing, invalid, or not bound to this artifact',
      }],
    };
  }
  return {
    artifactStatusVersion: ARTIFACT_STATUS_VERSION,
    artifactStatus: reviewIsVerifiedAndBound ? 'PASSED_REVIEW' : 'PASSED_AUTOMATED',
    artifactGates: gates,
    ...(reviewIsVerifiedAndBound ? { humanReview: review } : {}),
  };
}

/** Validate a persisted certificate before a benchmark or report treats it as passing. */
export function verifyArtifactCertification(
  value: unknown,
  evidence: { artifactSha256?: string; humanReviewReportBytes?: string } = {},
): value is ArtifactCertification {
  if (!value || typeof value !== 'object') return false;
  const certification = value as Partial<ArtifactCertification>;
  if (certification.artifactStatusVersion !== ARTIFACT_STATUS_VERSION || !isArtifactStatus(certification.artifactStatus) ||
      !Array.isArray(certification.artifactGates) || certification.artifactGates.length === 0 ||
      new Set(certification.artifactGates.map((gate) => gate?.id)).size !== certification.artifactGates.length ||
      !REQUIRED_ARTIFACT_GATE_IDS.every((id) => certification.artifactGates!.some((gate) => gate.id === id)) ||
      !certification.artifactGates.every((gate) => Boolean(
        gate && typeof gate.id === 'string' && gate.id.length > 0 &&
        (gate.status === 'passed' || gate.status === 'failed' || gate.status === 'unmeasured'),
      ))) return false;

  if (certification.artifactStatus === 'PASSED_AUTOMATED') {
    return certification.artifactGates.every((gate) => gate.status === 'passed') && certification.humanReview === undefined &&
      /^[a-f0-9]{64}$/.test(evidence.artifactSha256 ?? '');
  }
  if (certification.artifactStatus !== 'PASSED_REVIEW') return true;

  const review = certification.humanReview;
  if (!review || review.schemaVersion !== 'artifact-human-review/v1' || review.status !== 'passed' ||
      !/^[a-f0-9]{64}$/.test(review.reportSha256) || !/^[a-f0-9]{64}$/.test(review.artifactSha256) ||
      review.artifactSha256 !== evidence.artifactSha256 || !/^[a-f0-9]{64}$/.test(evidence.artifactSha256 ?? '') ||
      evidence.humanReviewReportBytes === undefined || !certification.artifactGates.every((gate) => gate.status === 'passed')) return false;
  const reportSha256 = createHash('sha256').update(evidence.humanReviewReportBytes, 'utf8').digest('hex');
  try {
    const report = JSON.parse(evidence.humanReviewReportBytes) as Partial<ArtifactHumanReviewReport>;
    return reportSha256 === review.reportSha256 && report.schemaVersion === 'artifact-human-review-report/v1' &&
      report.status === 'passed' && report.artifactSha256 === evidence.artifactSha256;
  } catch {
    return false;
  }
}

/** Legacy lowercase statuses are deliberately not mapped into certification states. */
export function isArtifactStatus(value: unknown): value is ArtifactStatus {
  return typeof value === 'string' && (ARTIFACT_STATUSES as readonly string[]).includes(value);
}

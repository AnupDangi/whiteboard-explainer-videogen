import type { StageRunRecord } from '../shared/contracts.js';

/** Identity-complete envelope used when a generated lesson fails before S12 evaluation. */
export function failedEvaluationEnvelope(input: {
  runId: string;
  caseId: string;
  message: string;
  stage: string;
  code: string;
  stageRuns?: StageRunRecord[];
}) {
  return {
    schemaVersion: 'evaluation-bundle/v1' as const,
    pipeline: 'claude' as const,
    runClass: 'generated-lesson' as const,
    status: 'failed' as const,
    caseId: input.caseId,
    runId: input.runId,
    failures: [{ code: input.code, stage: input.stage, message: input.message, hard: true }],
    metrics: {},
    stageRuns: input.stageRuns ?? [],
  };
}

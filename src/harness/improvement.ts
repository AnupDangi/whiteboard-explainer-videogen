/**
 * T8 improvement loop records (STCC §25/§27/§36). The loop is measured system
 * change: failures cluster by owning stage, one hypothesis becomes one
 * experiment record with baseline vs candidate, and promotion follows the
 * §27 rule — never a single anecdote, never bundled hypotheses.
 */

export const EXPERIMENT_SCHEMA = 'improvement-experiment/v1';

export interface FailureSample {
  stage: string;
  code: string;
  hard: boolean;
  message: string;
  runId?: string;
}

export interface FailureCluster {
  stage: string;
  code: string;
  count: number;
  hardCount: number;
  /** Representative messages, newest first, bounded. */
  evidence: string[];
}

/** Group failure samples by owning stage + code. Cross-stage piles stay separate: each cluster has exactly one owner. */
export function clusterFailures(samples: readonly FailureSample[], evidencePerCluster = 3): FailureCluster[] {
  const groups = new Map<string, FailureSample[]>();
  for (const sample of samples) {
    const key = `${sample.stage}\u0000${sample.code}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.entries()].map(([key, items]) => {
    const [stage, code] = key.split('\u0000');
    return {
      stage: stage!, code: code!, count: items.length,
      hardCount: items.filter((i) => i.hard).length,
      evidence: items.map((i) => i.message).slice(-evidencePerCluster).reverse(),
    };
  }).sort((a, b) => b.hardCount - a.hardCount || b.count - a.count);
}

export interface ExperimentGate { name: string; passed: boolean }
export type ExperimentRecommendation = 'PROMOTE' | 'REJECT' | 'NEEDS MORE EVIDENCE';

export interface ExperimentRecord {
  schemaVersion: typeof EXPERIMENT_SCHEMA;
  taskId: string;
  hypothesis: string;
  stageOwner: string;
  regressionDataset: string;
  targetMetric: string;
  /** Which direction counts as improvement for the target metric. */
  direction: 'higher' | 'lower';
  baseline: Record<string, number>;
  candidate: Record<string, number>;
  correctnessGates: ExperimentGate[];
  regressions: string[];
  determinismPreserved: boolean;
  /** Distinct topics/fixture ids the candidate was measured on. */
  topics: string[];
  recommendation: ExperimentRecommendation;
}

/** STCC §27 promotion rule, evaluated from the record alone. */
export function promotionVerdict(record: ExperimentRecord): { promote: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const base = record.baseline[record.targetMetric];
  const cand = record.candidate[record.targetMetric];
  if (base === undefined || cand === undefined) reasons.push(`target metric ${record.targetMetric} unmeasured on one side`);
  else {
    const improved = record.direction === 'higher' ? cand > base : cand < base;
    if (!improved) reasons.push(`target ${record.targetMetric}: candidate ${cand} did not improve on baseline ${base}`);
  }
  for (const gate of record.correctnessGates) if (!gate.passed) reasons.push(`correctness gate failed: ${gate.name}`);
  if (record.regressions.length > 0) reasons.push(`${record.regressions.length} unacceptable regression(s): ${record.regressions.join('; ')}`);
  if (!record.determinismPreserved) reasons.push('determinism not preserved where required');
  if (new Set(record.topics).size < 2) reasons.push('measured on fewer than 2 topics: no evidence of generalization');
  if (record.recommendation === 'REJECT') reasons.push('experiment recommends REJECT');
  if (record.recommendation === 'NEEDS MORE EVIDENCE' && reasons.length === 0) reasons.push('experiment needs more evidence');
  return { promote: reasons.length === 0 && record.recommendation === 'PROMOTE', reasons };
}

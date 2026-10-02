import type { StructuredCallReport } from '../llm/structuredCall.js';
import { diffCoercions, type CoercionEntry } from '../structured/coercionLedger.js';

/**
 * Phase 1 harness metrics and gates (V2 plan Phase 1 "benchmark gates"). Computed from the per-call reports, so they are
 * measured on every run rather than asserted. The V2 migration does not start until these are measurable.
 */
const covers = (ledgerPath: string, diffPath: string): boolean => diffPath === ledgerPath || diffPath.startsWith(`${ledgerPath}/`) || ledgerPath.startsWith(`${diffPath}/`);

/** Semantic differences between what the model wrote and what was validated that no ledger entry accounts for. */
export function silentSemanticCoercions(modelJson: unknown, validated: unknown, ledger: readonly CoercionEntry[]): number {
  return diffCoercions(modelJson, validated, 'silent-check').filter((entry) => entry.semanticRisk === 'semantic' && !ledger.some((logged) => covers(logged.path, entry.path))).length;
}

export type StageClass = 'S3' | 'S4' | 'S6';
const STAGE_CLASS: Record<string, StageClass> = {
  plan: 'S3', beats: 'S3',
  script: 'S4', 'beat-narration': 'S4',
  planner: 'S6', 'board-ops': 'S6',
};

export interface FirstTryRate { calls: number; valid: number; rate: number | undefined }
export interface StructuredHarnessMetrics {
  calls: number;
  constrainedRate: number | undefined;
  firstTryValid: Record<StageClass, FirstTryRate>;
  maxRepairsPerCall: number;
  lowCoercions: number;
  semanticCoercions: number;
  silentSemanticCoercions: number;
  rawRetainedRate: number | undefined;
  replayFixtureRate: number | undefined;
}

const rate = (n: number, d: number): number | undefined => (d === 0 ? undefined : n / d);

export function computeStructuredMetrics(reports: readonly StructuredCallReport[]): StructuredHarnessMetrics {
  const firstTry = (cls: StageClass): FirstTryRate => {
    const own = reports.filter((r) => STAGE_CLASS[r.stage] === cls);
    const valid = own.filter((r) => r.firstTryValid).length;
    return { calls: own.length, valid, rate: rate(valid, own.length) };
  };
  return {
    calls: reports.length,
    constrainedRate: rate(reports.filter((r) => r.schemaConstrained).length, reports.length),
    firstTryValid: { S3: firstTry('S3'), S4: firstTry('S4'), S6: firstTry('S6') },
    maxRepairsPerCall: reports.reduce((max, r) => Math.max(max, r.repairs), 0),
    lowCoercions: reports.reduce((sum, r) => sum + r.coercions.low, 0),
    semanticCoercions: reports.reduce((sum, r) => sum + r.coercions.semantic, 0),
    silentSemanticCoercions: reports.reduce((sum, r) => sum + r.silentSemanticCoercions, 0),
    rawRetainedRate: rate(reports.filter((r) => r.retained.raw).length, reports.length),
    replayFixtureRate: rate(reports.filter((r) => r.retained.replayFixture).length, reports.length),
  };
}

export type GateStatus = 'pass' | 'fail' | 'unmeasured';
export interface Phase1Gate { name: string; status: GateStatus; value: number | undefined; threshold: string }

export function evaluatePhase1Gates(metrics: StructuredHarnessMetrics): { passed: boolean; gates: Phase1Gate[] } {
  const atLeast = (name: string, value: number | undefined, min: number): Phase1Gate => ({ name, value, threshold: `>= ${min}`, status: value === undefined ? 'unmeasured' : value >= min ? 'pass' : 'fail' });
  const gates: Phase1Gate[] = [
    atLeast('schema-constrained', metrics.constrainedRate, 1),
    { name: 'silent-semantic-coercions', value: metrics.calls ? metrics.silentSemanticCoercions : undefined, threshold: '== 0', status: metrics.calls === 0 ? 'unmeasured' : metrics.silentSemanticCoercions === 0 ? 'pass' : 'fail' },
    { name: 'repairs-per-unit', value: metrics.calls ? metrics.maxRepairsPerCall : undefined, threshold: '<= 2', status: metrics.calls === 0 ? 'unmeasured' : metrics.maxRepairsPerCall <= 2 ? 'pass' : 'fail' },
    atLeast('first-try-valid-S3', metrics.firstTryValid.S3.rate, 0.95),
    atLeast('first-try-valid-S4', metrics.firstTryValid.S4.rate, 0.98),
    atLeast('first-try-valid-S6', metrics.firstTryValid.S6.rate, 0.95),
    atLeast('raw-outputs-retained', metrics.rawRetainedRate, 1),
    atLeast('replay-fixtures-emitted', metrics.replayFixtureRate, 1),
  ];
  return { passed: gates.every((gate) => gate.status === 'pass'), gates };
}

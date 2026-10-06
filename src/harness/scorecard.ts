import { computeStructuredMetrics, evaluatePhase1Gates, type Phase1Gate, type StructuredHarnessMetrics } from './structuredMetrics.js';
import type { StructuredCallReport } from '../llm/structuredCall.js';
import type { ReplayComparison } from './replayDeterminism.js';

/**
 * Per-run scorecard (V2 plan §5/§6). It reports what was measured, names what was not, and raises the plan's hard
 * blockers from measured values only. A composite never overrides a blocker, and a missing measurement is never a pass.
 */
export interface ScorecardInput {
  compilerVersion: string;
  reports: readonly StructuredCallReport[];
  coverageMetrics: Record<string, number | string | boolean | undefined>;
  replay?: ReplayComparison;
  /** Measurements a caller has made beyond the ones this module derives (name -> measured). */
  measured?: readonly string[];
}

export interface Scorecard {
  schemaVersion: 'scorecard/v1';
  compilerVersion: string;
  structured: { metrics: StructuredHarnessMetrics; gates: { passed: boolean; gates: Phase1Gate[] } };
  coverage: Record<string, number>;
  /** Plan §6 blockers raised from measured values. */
  blockers: string[];
  /** Plan §6 conditions this run has no measurement for. */
  unmeasured: string[];
  releaseCandidate: boolean;
}

/** Plan §6 release-blocker measurements that need more than the structured harness to produce. */
const REQUIRED_MEASUREMENTS = ['unsupported-major-claims', 'wrong-semantic-icons', 'hard-overlap-clipping', 'meaning-changing-truncation', 'major-narration-visual-mismatch', 'asset-provenance-licensing', 'deterministic-replay'] as const;

export function buildScorecard(input: ScorecardInput): Scorecard {
  const metrics = computeStructuredMetrics(input.reports);
  const blockers: string[] = [];
  if (input.reports.some((report) => !report.schemaConstrained)) blockers.push('schema-not-constrained');
  if (metrics.silentSemanticCoercions > 0) blockers.push('silent-semantic-coercion');
  if (Number(input.coverageMetrics['semantic.r10OnlyMajorClaims'] ?? 0) > 0) blockers.push('major-claim-r10-only');
  if (input.replay && !input.replay.identical) blockers.push('deterministic-replay-mismatch');
  if (Number(input.coverageMetrics['v2.dynamicMechanismMissingClaims'] ?? 0) > 0) blockers.push('dynamic-mechanism-coverage-incomplete');
  const measured = new Set(input.measured ?? []);
  if (input.replay) measured.add('deterministic-replay');
  const unmeasured = REQUIRED_MEASUREMENTS.filter((name) => !measured.has(name));
  const coverage = Object.fromEntries(Object.entries(input.coverageMetrics).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
  const gates = evaluatePhase1Gates(metrics);
  return { schemaVersion: 'scorecard/v1', compilerVersion: input.compilerVersion, structured: { metrics, gates }, coverage, blockers, unmeasured, releaseCandidate: blockers.length === 0 && unmeasured.length === 0 && gates.passed };
}

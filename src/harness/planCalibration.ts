import { buildConceptGraph, buildTeachingPlan, type LessonRequest, type PlanPromptVariant } from '../plan/stages.js';
import { analyzeTeachingPlan } from '../plan/analyze.js';
import { teachingContractFindings } from '../plan/contracts.js';
import { loadSourceDoc } from '../intake/sourceIntake.js';
import type { ConceptGraph } from '../plan/schemas.js';

/**
 * Measures S3 (teaching-plan) prompt variants against real cold LLM calls on a small, fixed
 * held-out source set, so a prompt change is adopted or rejected by measured pass rate — never
 * by hand-picking one attempt's output or by loosening `teachingContractProblems`/`analyzeTeachingPlan`
 * (the fixed "truth" both `plan/contracts.ts` and `plan/analyze.ts` already enforce; this module
 * never changes what counts as a pass, only which prompt text is measured against it).
 *
 * S2 (concept graph) runs once per source and is cached across every variant comparison for that
 * source, so every variant sees the identical graph — an apples-to-apples S3-only comparison.
 */

export interface CalibrationSourceSpec {
  id: string;
  path: string;
  targetDurationSec: number;
}

export interface CalibrationAttemptResult {
  sourceId: string;
  variant: PlanPromptVariant;
  attempt: number;
  passed: boolean;
  repairs: number;
  costUsd: number;
  durationMs: number;
  /**
   * Contract codes (`plan/contracts.ts`'s `CONTRACT_CODES`), `F-PED:<check>` tags from
   * `analyzeTeachingPlan`, and, when no plan came back, the stage's own failure codes as
   * `S3:<code>` (e.g. `S3:plan-repair-failed`, `S3:plan-call-failed`, `S3:plan-truncated`).
   */
  failureCodes: string[];
  /** Provider finish reason of each call ("length" = output cut off at maxTokens). */
  finishReasons: string[];
}

export interface CalibrationVariantSummary {
  variant: PlanPromptVariant;
  attempts: number;
  passed: number;
  passRate: number;
  failureCodeCounts: Record<string, number>;
  totalCostUsd: number;
}

export interface CalibrationReport {
  generatedAt: string;
  model: string;
  sources: string[];
  repeatsPerSource: number;
  variants: CalibrationVariantSummary[];
  attempts: CalibrationAttemptResult[];
  /** Sources whose S2 concept graph never succeeded (even after one retry) — no S3 variant data exists for these; the run continues with the rest rather than aborting. */
  skippedSources: Array<{ sourceId: string; reason: string }>;
}

export interface CalibrationOptions {
  sources: CalibrationSourceSpec[];
  variants: PlanPromptVariant[];
  repeatsPerSource: number;
  model: string;
  apiKey: string;
  /** Generous per-call ceiling for OpenRouter's price-ceiling math; actual spend is measured and reported separately, this only bounds it. */
  perCallBudgetUsd?: number;
  fetcher?: typeof fetch;
}

export async function runPlanCalibration(opts: CalibrationOptions): Promise<CalibrationReport> {
  const perCallBudgetUsd = opts.perCallBudgetUsd ?? 0.05;
  const graphCache = new Map<string, { graph: ConceptGraph; req: LessonRequest }>();
  const attempts: CalibrationAttemptResult[] = [];
  const skippedSources: Array<{ sourceId: string; reason: string }> = [];

  for (const source of opts.sources) {
    let cached = graphCache.get(source.id);
    if (!cached) {
      const sourceDoc = await loadSourceDoc(source.path);
      const req: LessonRequest = { source: sourceDoc.text, sourceDoc, sourceFormat: sourceDoc.format, targetDurationSec: source.targetDurationSec };
      // S2 is a separate, previously-measured cold LLM call with its own known intermittent failure
      // rate (evidence-quote fidelity / truncation) — one retry here is a fresh independent attempt at
      // the SAME real check, not a repair-until-it-passes loop; if both fail, skip this source only,
      // continue the run, and report it plainly rather than aborting every other source's measurement.
      let graph: ConceptGraph | undefined;
      const s2Failures: string[] = [];
      for (let s2Attempt = 1; s2Attempt <= 2 && !graph; s2Attempt++) {
        const gRes = await buildConceptGraph(req, { model: opts.model, apiKey: opts.apiKey, remainingBudgetUsd: perCallBudgetUsd, fetcher: opts.fetcher });
        if (gRes.value) graph = gRes.value;
        else s2Failures.push(gRes.failures.map((f) => f.message).join('; '));
      }
      if (!graph) {
        skippedSources.push({ sourceId: source.id, reason: `S2 failed twice: ${s2Failures.join(' | ')}` });
        continue;
      }
      cached = { graph, req };
      graphCache.set(source.id, cached);
    }
    const { graph, req } = cached;

    for (const variant of opts.variants) {
      for (let attempt = 1; attempt <= opts.repeatsPerSource; attempt++) {
        const startedAtMs = Date.now();
        const pRes = await buildTeachingPlan(req, graph, { model: opts.model, apiKey: opts.apiKey, remainingBudgetUsd: perCallBudgetUsd, fetcher: opts.fetcher }, variant);
        const durationMs = Date.now() - startedAtMs;
        const failureCodes: string[] = [];
        let passed = false;
        if (pRes.value) {
          const analysis = analyzeTeachingPlan(pRes.value, graph);
          const contractFindings = teachingContractFindings(pRes.value, graph, req.audience ?? 'general learner');
          for (const finding of analysis.findings) if (finding.severity === 'error') failureCodes.push(`F-PED:${finding.check}`);
          for (const finding of contractFindings) failureCodes.push(finding.code);
          passed = analysis.ok && contractFindings.length === 0;
        } else {
          // Keep the real cause (repair failed, timeout, truncation, cost ceiling, no endpoint), not one opaque label.
          const stageCodes = [...new Set(pRes.failures.map((failure) => `S3:${failure.code}`))];
          failureCodes.push(...(stageCodes.length ? stageCodes : ['S3:no-plan']));
        }
        attempts.push({ sourceId: source.id, variant, attempt, passed, repairs: pRes.usage.repairs, costUsd: pRes.usage.costUsd, durationMs, failureCodes, finishReasons: pRes.rawResponses.map((response) => response.finishReason ?? 'unknown') });
      }
    }
  }

  const variants: CalibrationVariantSummary[] = opts.variants.map((variant) => {
    const variantAttempts = attempts.filter((a) => a.variant === variant);
    const failureCodeCounts: Record<string, number> = {};
    for (const attempt of variantAttempts) for (const code of attempt.failureCodes) failureCodeCounts[code] = (failureCodeCounts[code] ?? 0) + 1;
    const passed = variantAttempts.filter((a) => a.passed).length;
    return {
      variant,
      attempts: variantAttempts.length,
      passed,
      passRate: variantAttempts.length ? passed / variantAttempts.length : 0,
      failureCodeCounts,
      totalCostUsd: variantAttempts.reduce((sum, a) => sum + a.costUsd, 0),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    model: opts.model,
    sources: opts.sources.map((s) => s.id),
    repeatsPerSource: opts.repeatsPerSource,
    variants,
    attempts,
    skippedSources,
  };
}

/** Highest measured pass rate wins; ties broken by fewest total failure-code occurrences. Never a manual override. */
export function pickWinningVariant(report: CalibrationReport): PlanPromptVariant {
  if (report.variants.length === 0) throw new Error('plan calibration: no variants to pick a winner from');
  const totalFailures = (summary: CalibrationVariantSummary) => Object.values(summary.failureCodeCounts).reduce((sum, count) => sum + count, 0);
  const [winner] = [...report.variants].sort((a, b) => (b.passRate !== a.passRate ? b.passRate - a.passRate : totalFailures(a) - totalFailures(b)));
  return winner.variant;
}

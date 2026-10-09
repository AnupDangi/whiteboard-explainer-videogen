import type { V2RichnessSummary } from './v2Richness.js';
import type { RichnessReport } from './v2RichnessReport.js';
import type { WrongIconScore } from './wrongIcon.js';

/**
 * Fixed acceptance rules for the rich-visuals live run. Absolute thresholds are fixed here; the icon-share bar is derived
 * from the measured baseline (Task 1) and the offline projection (Task 3), so no number is guessed before measurement.
 */
export const ACCEPTANCE = { iconShareGainMin: 0.15, projectionRatioMin: 0.8, wrongIconRateMax: 0.05, textGrowthMax: 1.1, minIconSidePx: 56 } as const;
export interface AcceptanceCheck { name: string; value: string; threshold: string; pass: boolean }

const n = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(3));

export function evaluateRichnessAcceptance(input: { baseline: V2RichnessSummary; projection: V2RichnessSummary; live: RichnessReport; wrongIcons: WrongIconScore }): { passed: boolean; checks: AcceptanceCheck[] } {
  const { baseline, projection, live, wrongIcons } = input;
  const pooled = live.pooled;
  const shareBar = Math.max((baseline.iconBearingShare ?? 0) + ACCEPTANCE.iconShareGainMin, (projection.iconBearingShare ?? 0) * ACCEPTANCE.projectionRatioMin);
  const attempted = live.runs;
  const complete = attempted.filter((run) => run.complete);
  const hardFailures = attempted.reduce((sum, run) => sum + (run.hardFailures ?? Number.POSITIVE_INFINITY), 0);
  const replayProblems = complete.filter((run) => run.status !== 'loaded' || run.timelineReplayMismatches > 0).length;
  const checks: AcceptanceCheck[] = [
    { name: 'complete live runs', value: `${complete.length}/${attempted.length}`, threshold: 'every attempted run complete, at least 1', pass: complete.length >= 1 && complete.length === attempted.length },
    { name: 'hard failures', value: String(hardFailures), threshold: '0 over every attempted run (unknown counts as failure)', pass: hardFailures === 0 },
    { name: 'replay matches recorded timeline', value: String(replayProblems), threshold: '0 complete runs with a replay mismatch or unreplayable snapshot', pass: replayProblems === 0 },
    { name: 'icon-bearing share', value: n(pooled.iconBearingShare), threshold: `>= ${shareBar.toFixed(3)} (max(baseline+${ACCEPTANCE.iconShareGainMin}, ${ACCEPTANCE.projectionRatioMin} x projection))`, pass: (pooled.iconBearingShare ?? 0) >= shareBar },
    { name: 'wrong-icon rate', value: n(wrongIcons.wrongIconRate), threshold: `<= ${ACCEPTANCE.wrongIconRateMax}`, pass: wrongIcons.wrongIconRate !== null && wrongIcons.wrongIconRate <= ACCEPTANCE.wrongIconRateMax },
    { name: 'review coverage', value: n(wrongIcons.coverage), threshold: '= 1.000 (every drawn icon has a human verdict)', pass: wrongIcons.coverage === 1 },
    { name: 'family-mix scenes', value: String(pooled.familyMixScenes), threshold: '0', pass: pooled.familyMixScenes === 0 },
    { name: 'asset reuse conflicts', value: String(pooled.assetReuseConflicts), threshold: '0', pass: pooled.assetReuseConflicts === 0 },
    { name: 'smallest icon side (px)', value: String(pooled.minIconSidePx ?? 'n/a'), threshold: `>= ${ACCEPTANCE.minIconSidePx}`, pass: pooled.minIconSidePx !== null && pooled.minIconSidePx >= ACCEPTANCE.minIconSidePx },
    { name: 'mean text chars per scene', value: pooled.meanTextChars.toFixed(1), threshold: `<= ${(baseline.meanTextChars * ACCEPTANCE.textGrowthMax).toFixed(1)} (icons add pictures, not words)`, pass: pooled.meanTextChars <= baseline.meanTextChars * ACCEPTANCE.textGrowthMax },
  ];
  return { passed: checks.every((check) => check.pass), checks };
}

/**
 * Execution-time report for one finished run. Stage `durationMs` values are summed over parallel work (S4/S6 run one
 * call per scene), so their sum is not wall time. This report separates the two: per-family summed work, the wall time
 * the family actually occupied (union of its intervals), the real-time factor against the produced media, and the
 * cost per produced minute. Pure; reads the stage records and the manifest timing only.
 */
export interface TimedStage { stage: string; durationMs: number; startedAt?: string; completedAt?: string; apiCostUsd?: number; cacheHit?: boolean }
export interface TimingInput { stageRuns: ReadonlyArray<TimedStage>; wallMs: number; preparationMs?: number; mediaMs: number; concurrentRuns?: number }
export interface FamilyTiming { family: string; calls: number; summedMs: number; wallMs: number; apiCostUsd: number; cacheHits: number }
export interface TimingReport {
  wallMs: number;
  preparationMs?: number;
  mediaMs: number;
  /** wall seconds per produced second; 1 means real time. */
  realTimeFactor: number;
  costUsd: number;
  costPerMediaMinuteUsd: number;
  families: FamilyTiming[];
  bottleneck?: { family: string; wallMs: number; share: number };
  note: string;
}

const familyOf = (stage: string): string => stage.split(':')[0]!;

const unionMs = (intervals: Array<[number, number]>): number => {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [from, to] of sorted) {
    if (to <= end) continue;
    total += to - Math.max(from, end);
    end = to;
  }
  return total;
};

export function buildTimingReport(input: TimingInput): TimingReport {
  const groups = new Map<string, TimedStage[]>();
  for (const stage of input.stageRuns) groups.set(familyOf(stage.stage), [...(groups.get(familyOf(stage.stage)) ?? []), stage]);
  const families: FamilyTiming[] = [...groups].map(([family, stages]) => {
    const intervals = stages.flatMap((stage) => {
      const from = stage.startedAt ? Date.parse(stage.startedAt) : NaN;
      // Some stage records open early and close late (the interval spans the whole run); the stage's own duration bounds it.
      const to = Number.isFinite(from) ? from + stage.durationMs : NaN;
      return Number.isFinite(from) && Number.isFinite(to) && to >= from ? [[from, to] as [number, number]] : [];
    });
    const summedMs = stages.reduce((sum, stage) => sum + stage.durationMs, 0);
    return {
      family, calls: stages.length, summedMs,
      // Without timestamps the best honest wall figure is the longest single call.
      wallMs: intervals.length === stages.length && intervals.length ? unionMs(intervals) : Math.max(0, ...stages.map((stage) => stage.durationMs)),
      apiCostUsd: stages.reduce((sum, stage) => sum + (stage.apiCostUsd ?? 0), 0),
      cacheHits: stages.filter((stage) => stage.cacheHit).length,
    };
  }).sort((a, b) => b.wallMs - a.wallMs);
  const costUsd = families.reduce((sum, family) => sum + family.apiCostUsd, 0);
  const minutes = input.mediaMs / 60_000;
  const top = families[0];
  return {
    wallMs: input.wallMs,
    ...(input.preparationMs !== undefined ? { preparationMs: input.preparationMs } : {}),
    mediaMs: input.mediaMs,
    realTimeFactor: input.mediaMs > 0 ? input.wallMs / input.mediaMs : 0,
    costUsd,
    costPerMediaMinuteUsd: minutes > 0 ? costUsd / minutes : 0,
    families,
    ...(top ? { bottleneck: { family: top.family, wallMs: top.wallMs, share: input.wallMs > 0 ? top.wallMs / input.wallMs : 0 } } : {}),
    note: input.concurrentRuns && input.concurrentRuns > 1 ? `measured with ${input.concurrentRuns} runs sharing the machine; wall times are inflated by contention` : 'wall time of a single run on this machine',
  };
}

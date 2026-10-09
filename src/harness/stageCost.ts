/** Per-stage provider cost and latency from retained runs. Prep stages are itemised; V2 S4+S6 spend is derived, not itemised. */
export interface StageRunRecord { stage: string; modelId?: string; status: string; durationMs: number; apiCostUsd: number }
export interface StageCostRow { stage: string; models: string[]; runs: number; failed: number; costUsd: number; meanDurationMs: number }

export const stageFamily = (stage: string): string => stage.split(':', 1)[0] ?? stage;

export function stageCostRows(perRun: ReadonlyArray<readonly StageRunRecord[]>): StageCostRow[] {
  const rows = new Map<string, { models: Set<string>; runs: number; failed: number; costUsd: number; durationMs: number }>();
  for (const run of perRun) for (const record of run) {
    const key = stageFamily(record.stage);
    const row = rows.get(key) ?? { models: new Set<string>(), runs: 0, failed: 0, costUsd: 0, durationMs: 0 };
    if (record.modelId) row.models.add(record.modelId);
    row.runs += 1;
    if (record.status !== 'completed') row.failed += 1;
    row.costUsd += record.apiCostUsd;
    row.durationMs += record.durationMs;
    rows.set(key, row);
  }
  return [...rows].map(([stage, row]) => ({ stage, models: [...row.models].sort(), runs: row.runs, failed: row.failed, costUsd: row.costUsd, meanDurationMs: row.runs ? row.durationMs / row.runs : 0 }))
    .sort((a, b) => b.costUsd - a.costUsd || a.stage.localeCompare(b.stage));
}

export function v2RemainderUsd(totalUsd: number, prep: readonly StageRunRecord[]): number {
  return Math.max(0, totalUsd - prep.reduce((sum, record) => sum + record.apiCostUsd, 0));
}

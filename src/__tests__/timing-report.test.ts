import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimingReport } from '../harness/timingReport.js';

test('parallel calls are summed as work but counted once as wall time, and the bottleneck is the longest family', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  const report = buildTimingReport({
    wallMs: 100_000, mediaMs: 60_000, concurrentRuns: 4,
    stageRuns: [
      { stage: 'S4-narration-script:a', durationMs: 20_000, startedAt: at(0), completedAt: at(20), apiCostUsd: 0.01 },
      { stage: 'S4-narration-script:b', durationMs: 20_000, startedAt: at(0), completedAt: at(20), apiCostUsd: 0.01 },
      { stage: 'S6-scene-planner:a', durationMs: 30_000, startedAt: at(20), completedAt: at(50), apiCostUsd: 0.02 },
      { stage: 'S5-module-audio', durationMs: 5_000, startedAt: at(50), completedAt: at(55) },
    ],
  });
  const s4 = report.families.find((family) => family.family === 'S4-narration-script')!;
  assert.equal(s4.summedMs, 40_000);
  assert.equal(s4.wallMs, 20_000);
  assert.equal(report.bottleneck!.family, 'S6-scene-planner');
  assert.equal(report.realTimeFactor, 100 / 60);
  assert.equal(Math.round(report.costPerMediaMinuteUsd * 1000) / 1000, 0.04);
  assert.match(report.note, /4 runs sharing the machine/);
});

test('a stage record whose interval spans the whole run is bounded by its own duration', () => {
  const report = buildTimingReport({
    wallMs: 200_000, mediaMs: 60_000,
    stageRuns: [
      { stage: 'S1-rag-index', durationMs: 0, startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(), completedAt: new Date(Date.UTC(2026, 0, 1, 0, 2, 12)).toISOString() },
      { stage: 'S6-scene-planner:a', durationMs: 30_000, startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 10)).toISOString(), completedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 40)).toISOString() },
    ],
  });
  assert.equal(report.bottleneck!.family, 'S6-scene-planner');
  assert.equal(report.families.find((family) => family.family === 'S1-rag-index')!.wallMs, 0);
});

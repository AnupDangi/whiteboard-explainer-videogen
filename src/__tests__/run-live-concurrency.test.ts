import assert from 'node:assert/strict';
import test from 'node:test';
import { contentStageModels, DEFAULT_SCENE_PLANNER_CONCURRENCY, withScenePlannerSlot } from '../run/runLive.js';

test('lock settings preserve the model selected for each preparation stage', () => {
  const actual = contentStageModels({
    caseId: 'stage-models', scenes: [], stageRuns: [
      { stage: 'S1-syllabus', kind: 'provider', modelId: 'provider/syllabus', status: 'completed', durationMs: 1, apiCostUsd: 0, cacheHit: true, fallbackCount: 0, failures: [] },
      { stage: 'S2-concepts', kind: 'provider', modelId: 'provider/concepts', status: 'completed', durationMs: 1, apiCostUsd: 0, cacheHit: true, fallbackCount: 0, failures: [] },
      { stage: 'S3-teaching-plan', kind: 'provider', modelId: 'provider/plan', status: 'completed', durationMs: 1, apiCostUsd: 0, cacheHit: true, fallbackCount: 0, failures: [] },
      { stage: 'S4-narration-script', kind: 'provider', modelId: 'provider/script', status: 'completed', durationMs: 1, apiCostUsd: 0, cacheHit: true, fallbackCount: 0, failures: [] },
    ],
  }, 'provider/default');
  assert.deepEqual(actual, { syllabus: 'provider/syllabus', concepts: 'provider/concepts', plan: 'provider/plan', script: 'provider/script' });
});

test('S6 semaphore bounds planner work across concurrent live runs in one process', async () => {
  let active = 0;
  let peak = 0;
  const task = async (value: number) => withScenePlannerSlot(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active--;
    return value;
  });
  const [first, second] = await Promise.all([
    Promise.all([task(1), task(2), task(3)]),
    Promise.all([task(4), task(5), task(6)]),
  ]);
  assert.deepEqual([...first, ...second], [1, 2, 3, 4, 5, 6]);
  assert.ok(peak <= DEFAULT_SCENE_PLANNER_CONCURRENCY, `observed ${peak} active planner calls`);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SCENE_PLANNER_CONCURRENCY, withScenePlannerSlot } from '../pipeline/runLive.js';

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

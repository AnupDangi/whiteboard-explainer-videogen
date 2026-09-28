import test from 'node:test';
import assert from 'node:assert/strict';
import { runSceneCalibration, type SceneCalibrationItem } from '../harness/sceneCalibration.js';
import type { PlannerSceneInput } from '../planner/prompt.js';

const input: PlannerSceneInput = { sceneId: 'cal_scene', raw: 'The [[src|source]] feeds the [[dst|target]].', plainText: 'The source feeds the target.', mentions: [{ id: 'src', phrase: 'source' }, { id: 'dst', phrase: 'target' }] };
const item: SceneCalibrationItem = { caseId: 'synthetic', sceneId: 'cal_scene', buildInput: () => input };
const spec = { schemaVersion: 'claude-scene-spec/v1', sceneId: 'cal_scene', title: 'Source Feeds Target', template: 'chain', elements: [
  { id: 'src', prim: 'box', slot: 'node', anchor: 'mention:src', text: 'SOURCE', origin: 'illustrative-example' },
  { id: 'dst', prim: 'box', slot: 'node', anchor: 'mention:dst', text: 'TARGET', origin: 'illustrative-example' },
], edges: [{ from: 'src', to: 'dst', origin: 'illustrative-example' }] };
const reply = (content: string) => new Response(JSON.stringify({ id: 'g', model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.0002 } }), { status: 200 });

test('scene calibration reports valid rate, richness, and cost per arm', async () => {
  const report = await runSceneCalibration({ items: [item], arms: ['zero'], repeats: 2, model: 'test/model', planner: 'scene-spec-v1', apiKey: 'test-only', fetcher: async () => reply(JSON.stringify(spec)) });
  assert.equal(report.resultClass, 'diagnostic-calibration');
  assert.equal(report.planner, 'scene-spec-v1');
  assert.equal(report.arms[0].attempts, 2);
  assert.equal(report.arms[0].valid, 2);
  assert.equal(report.arms[0].validRate, 1);
  assert.equal(report.arms[0].richness.meanEdges, 1);
  assert.ok(Math.abs(report.arms[0].totalCostUsd - 0.0004) < 1e-9);
});

test('an invalid scene after repair is recorded as invalid without a fallback', async () => {
  const report = await runSceneCalibration({ items: [item], arms: ['zero'], repeats: 1, model: 'test/model', planner: 'scene-spec-v1', apiKey: 'test-only', fetcher: async () => reply('{"not":"a scene"}') });
  assert.equal(report.arms[0].valid, 0);
  assert.equal(report.attempts[0].repairs, 1);
  assert.ok(report.attempts[0].failureCodes.includes('planner-repair-failed'));
  assert.equal(report.attempts[0].richness, undefined);
});

test('scene calibration measures the live default planner unless told otherwise', async () => {
  const report = await runSceneCalibration({ items: [item], arms: ['zero'], repeats: 1, model: 'test/model', apiKey: 'test-only', fetcher: async () => reply('{}') });
  assert.equal(report.planner, 'board-v2');
});

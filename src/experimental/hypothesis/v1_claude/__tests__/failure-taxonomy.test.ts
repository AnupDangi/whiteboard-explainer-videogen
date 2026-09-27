import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFailureCode, SIMI_60_BASELINE_CLASSIFICATION } from '../../shared/failure-taxonomy.js';
import { deterministicGates } from '../../shared/evaluation.js';
import { runClaudeGates, typedBoardAdequacyFailures } from '../validation/gates.js';
import type { LaidOutScene } from '../types.js';

test('planner/board-role/numeric/evidence-anchor codes map to S', () => {
  for (const code of [
    'planner-repair-failed', 'planner-fallback', 'planner-fallback-gate', 'planner-timeout',
    'board-role-incomplete', 'board-role-detached', 'board-role-duplicate', 'board-role-misplaced',
    'board-concept-omitted', 'board-relation-omitted',
    'scene-title-numeric-value', 'visual-plot-numeric-values',
    'concepts-evidence-anchored',
  ]) assert.equal(classifyFailureCode(code), 'S', code);
});

test('syllabus/graph/parse problems map to P even with planner prefix', () => {
  for (const code of [
    'syllabus-concept-missing', 'planner-syllabus-invalid',
    'graph-cycle-detected', 'planner-graph-unresolved', 'parse-failed', 'planner-parse-error',
  ]) assert.equal(classifyFailureCode(code), 'P', code);
});

test('layout/occupancy/overlap map to C', () => {
  for (const code of [
    'occupancy', 'overlap', 'safe-area', 'duplicate-element', 'duplicate-element-id',
    'dangling-id', 'anchor-cycle', 'invalid-anchor-target', 'invalid-math', 'min-readable-text',
  ]) assert.equal(classifyFailureCode(code), 'C', code);
});

test('timeline/idle/clamp map to T', () => {
  for (const code of [
    'timeline-bounds', 'dangling-event', 'av-sync', 'av-sync-over-budget',
    'av-duration-budget-delta', 'idle', 'concurrency', 'timeline-clamp-applied',
  ]) assert.equal(classifyFailureCode(code), 'T', code);
});

test('render/encode map to R', () => {
  for (const code of [
    'formula-error', 'unsafe-svg', 'render-failed', 'encode-failed',
    'captions-failed', 'contact-sheet-png-failed', 'no-scenes',
  ]) assert.equal(classifyFailureCode(code), 'R', code);
});

test('alignment/tts/mention-timing map to A', () => {
  for (const code of [
    'alignment-calibration-unmeasured', 'alignment-words-repaired', 'invalid-word-alignment',
    'invalid-module-audio-timing', 'module-audio-generation-failed',
    'tts-synthesis-failed', 'mention-timing-unresolved',
  ]) assert.equal(classifyFailureCode(code), 'A', code);
});

test('element-count (llm_gap 1-element) maps to S', () => {
  assert.equal(classifyFailureCode('element-count'), 'S');
});

test('gates keep hard/soft unchanged and only add failureClass', () => {
  const overlap = deterministicGates({
    elements: [
      { id: 'a', kind: 'box', bbox: { x: 100, y: 100, w: 200, h: 200 } },
      { id: 'b', kind: 'box', bbox: { x: 150, y: 150, w: 200, h: 200 } },
    ],
    timeline: [],
    durationMs: 1_000,
    svg: '<svg />',
  }).filter((f) => f.code === 'overlap');
  assert.equal(overlap.length, 1);
  assert.equal(overlap[0]?.hard, true);
  assert.equal(overlap[0]?.failureClass, 'C');

  const boardFailures = typedBoardAdequacyFailures({
    sceneId: 's', template: 'convergence', elements: [], edges: [],
    boardIntent: {
      schemaVersion: 'typed-board-intent/v1', layout: 'convergence', visualKind: 'process',
      roles: [], requiredConceptIds: ['c1'], requiredRelations: [],
    },
  } as unknown as LaidOutScene);
  assert.ok(boardFailures.length > 0);
  for (const f of boardFailures) {
    assert.equal(f.hard, true);
    assert.equal(f.failureClass, 'S');
  }

  const scene = {
    sceneId: 's', title: 't', template: 'chain', elements: [], edges: [],
    occupancy: 0.1, carryOver: [], focus: [],
  } as unknown as LaidOutScene;
  const { warnings } = runClaudeGates(scene, { sceneId: 's', events: [], sceneStartMs: 0, sceneEndMs: 1000 });
  const occupancy = warnings.find((w) => w.code === 'occupancy');
  assert.ok(occupancy);
  assert.equal(occupancy.hard, false);
  assert.equal(occupancy.failureClass, 'C');
});

test('SIMI-60 baseline reclassification matches F1-F4 rollup', () => {
  const byScene = new Map<string, string[]>();
  for (const row of SIMI_60_BASELINE_CLASSIFICATION) {
    // Fixture self-consistency: stored label equals the pure mapping.
    assert.equal(row.failureClass, classifyFailureCode(row.code), `${row.scene}:${row.code}`);
    byScene.set(row.scene, [...(byScene.get(row.scene) ?? []), row.failureClass]);
  }
  // reasoning_modes 4 codes -> S at code level, scene rollup S+C (fallback composition impact).
  assert.deepEqual(byScene.get('01-module_1_reasoning_modes'), ['S', 'S', 'S', 'S']);
  assert.deepEqual(byScene.get('01-module_1_llm_gap'), ['S']);
  assert.deepEqual(byScene.get('01-module_1_sensory_bridge'), ['C']);
  assert.deepEqual(byScene.get('01-module_1_key_takeaway'), ['C']);
});

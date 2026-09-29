import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonSummaryDurations, playableOutputDurationMs } from '../pipeline/runLive.js';

/** Domain-neutral fixtures: generic scene ids, no lesson topic. */
const GAP_MS = 200;

test('failed scenes: playable duration is the playable sum plus playable gaps, not the narration total', () => {
  const allDurations = [1000, 2000, 3000];
  const narrationTotalMs = allDurations.reduce((sum, ms) => sum + ms, 0) + GAP_MS * (allDurations.length - 1);
  const playableMs = playableOutputDurationMs([1000, 3000], GAP_MS);
  assert.equal(playableMs, 4200);
  assert.notEqual(playableMs, narrationTotalMs);

  const summary = lessonSummaryDurations({
    narratedDurationMs: narrationTotalMs,
    playableDurationMs: playableMs,
    playableSceneCount: 2,
    plannedSceneCount: 3,
  });
  assert.equal(summary.finalVideoDurationSec, 4.2);
  assert.equal(summary.actualNarratedDurationSec, narrationTotalMs / 1000);
  assert.equal(summary.droppedScenes, 1);
});

test('all playable: reported duration is unchanged and nothing is dropped', () => {
  const durations = [1000, 2000, 3000];
  const narrationTotalMs = durations.reduce((sum, ms) => sum + ms, 0) + GAP_MS * (durations.length - 1);
  const playableMs = playableOutputDurationMs(durations, GAP_MS);
  assert.equal(playableMs, narrationTotalMs);

  const summary = lessonSummaryDurations({
    narratedDurationMs: narrationTotalMs,
    playableDurationMs: playableMs,
    playableSceneCount: 3,
    plannedSceneCount: 3,
  });
  assert.equal(summary.finalVideoDurationSec, summary.actualNarratedDurationSec);
  assert.equal(summary.droppedScenes, 0);
});

test('module-grouped playable audio sums to the flat playable duration', () => {
  // Module 1 holds s1 (playable) + s2 (failed); module 2 holds s3 (playable).
  // Each module stitches its playable scenes with GAP_MS between them, plus a
  // GAP_MS boundary silence after every module except the last — which
  // collapses to one gap per playable boundary overall.
  const moduleOneMs = playableOutputDurationMs([1000], GAP_MS) + GAP_MS;
  const moduleTwoMs = playableOutputDurationMs([3000], GAP_MS);
  assert.equal(moduleOneMs + moduleTwoMs, playableOutputDurationMs([1000, 3000], GAP_MS));
});

test('no playable scenes: zero video duration with every scene dropped', () => {
  assert.equal(playableOutputDurationMs([], GAP_MS), 0);
  const summary = lessonSummaryDurations({
    narratedDurationMs: 6400,
    playableDurationMs: 0,
    playableSceneCount: 0,
    plannedSceneCount: 3,
  });
  assert.equal(summary.finalVideoDurationSec, 0);
  assert.equal(summary.droppedScenes, 3);
});

test('missing playable duration falls back to the narrated total', () => {
  const summary = lessonSummaryDurations({
    narratedDurationMs: 6400,
    playableDurationMs: undefined,
    playableSceneCount: 3,
    plannedSceneCount: 3,
  });
  assert.equal(summary.finalVideoDurationSec, 6.4);
  assert.equal(summary.droppedScenes, 0);
});

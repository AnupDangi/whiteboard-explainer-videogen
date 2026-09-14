import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LIVE_EVAL_CASES, SMOKE_CASE_IDS, caseCount, getCase} from '../dist/eval/live/manifest.js';
import {emptyMetrics, computeRunMetrics, evaluateCaseSemantics, percentile, mean} from '../dist/eval/live/metrics.js';
import {aggregateReport, reportToMarkdown} from '../dist/eval/live/compare.js';
import {runLiveEvaluation} from '../dist/eval/live/runner.js';

test('manifest has 48 cases and smoke subset', () => {
  assert.equal(caseCount(), 48);
  assert.equal(SMOKE_CASE_IDS.length, 6);
  assert.equal(SMOKE_CASE_IDS.includes('photosynthesis_inputs'), true);
  assert.throws(() => getCase('missing'), /Unknown live eval case/);
});

test('manifest categories cover required domains', () => {
  const categories = new Set(LIVE_EVAL_CASES.map(c => c.category));
  for (const required of ['structural', 'equation', 'matrix', 'flow', 'cycle', 'timeline', 'trajectory', 'cause_effect']) {
    assert.ok(categories.has(required), `missing category ${required}`);
  }
  const requiredIds = [
    'photosynthesis_inputs', 'cell_animal', 'dna_replication', 'plate_tectonics', 'water_cycle', 'refrigeration_cycle',
    'linear_equation', 'quadratic_equation', 'matrix_multiplication', 'gradient_descent',
    'transformer_attention', 'kv_cache', 'deepseek_mla', 'expert_routing', 'rag_pipeline',
    'http_lifecycle', 'cache_hit_miss', 'tcp_congestion',
    'bank_transfer', 'inflation_feedback',
    'roman_empire_timeline',
    'robot_path_planning', 'projectile_trajectory'
  ];
  for (const id of requiredIds) {
    assert.ok(LIVE_EVAL_CASES.some(c => c.id === id), `missing required case ${id}`);
  }
});

test('metrics aggregation computes success and repairs', () => {
  const telemetry = [
    {stage: 'teaching', status: 'success', elapsedMs: 1000},
    {stage: 'visual-model', status: 'success', elapsedMs: 50},
    {stage: 'director', status: 'success', elapsedMs: 2000},
    {stage: 'narration-finalize', status: 'success', elapsedMs: 10},
    {stage: 'tts', status: 'success', elapsedMs: 500, timingKind: 'engine'},
    {stage: 'compile', status: 'success', elapsedMs: 100, diagnostics: []}
  ];
  const modelEvents = [{kind: 'healed'}, {kind: 'failure'}];
  const calls = [{promptTokens: 10, completionTokens: 20, costUsd: 0.001, attempt: 0}];
  const scene = {
    sceneId: 's1',
    stageMetrics: {sceneReadyMs: 3660},
    diagnostics: ['geometry repair: nudged x'],
    compileFindings: [],
    timingKind: 'engine',
    durationMs: 4000,
    archetype: 'convergence'
  };
  const metrics = computeRunMetrics(telemetry, modelEvents, calls, [scene], 'complete');
  assert.equal(metrics.teachingPlanSuccess, true);
  assert.equal(metrics.compileSuccess, true);
  assert.equal(metrics.ttsSuccess, true);
  assert.equal(metrics.fullJobSuccess, true);
  assert.equal(metrics.schemaRetryCount, 1);
  assert.equal(metrics.normalizationCount, 1);
  assert.equal(metrics.modelRetryCount, 0);
  assert.equal(metrics.geometryRepairCount, 1);
  assert.equal(metrics.costUsd, 0.001);
  assert.equal(metrics.promptTokens, 10);
  assert.equal(metrics.firstAVPlayableMs, 3660);
  assert.equal(metrics.firstAudioByteMs, null);
  assert.equal(metrics.firstVisualReadyMs, null);
});

test('semantic coverage metrics check concepts, relations, archetype, and forbidden patterns', () => {
  const scene = {
    scene: {teachingGoal:'plant is central', mentalModel:'plant receives sunlight', archetype:'convergence', beats:[{narration:'Sunlight reaches the leaf.'}]},
    objects: [
      {id:'sun', conceptId:'sunlight', label:'Sunlight', role:'support', assetRef:'nature.sun.v2'},
      {id:'plant', conceptId:'plant', label:'Plant', role:'hero', assetRef:'biology.plant.sapling.v2'},
    ],
    relations: [{id:'r', from:{objectId:'sun',anchor:'center'}, to:{objectId:'plant',anchor:'leaf.top'}, relationType:'flows_to', visualForm:'arrow', points:[]}],
  };
  const coverage = evaluateCaseSemantics({
    id:'plant', prompt:'', category:'structural', mustExplain:['plant is central'], expectedConcepts:['plant','sunlight'],
    requiredRelations:[{id:'sun',fromConcept:'sunlight',relation:'enters',toConcept:'plant',targetPart:'leaf'}],
    preferredArchetypes:['convergence'], forbiddenPatterns:['generic box'], criticalAssetRoles:['hero plant','support sunlight']
  }, [scene]);
  assert.equal(coverage.criticalClaimCoverage, 1);
  assert.equal(coverage.conceptCoverage, 1);
  assert.equal(coverage.relationshipCoverage, 1);
  assert.equal(coverage.archetypeAppropriate, true);
  assert.equal(coverage.forbiddenPatternCount, 0);
  assert.equal(coverage.criticalAssetRoleCoverage, 1);
});

test('aggregate report surfaces stage rates and regressions', () => {
  const cases = LIVE_EVAL_CASES.slice(0, 2);
  const runs = [
    {caseId: cases[0].id, runIndex: 0, status: 'complete', metrics: {...emptyMetrics(), fullJobSuccess: true, costUsd: 0.01, firstAVPlayableMs: 1000, fullPlayableMs: 3000}, scenes: [{archetype: 'convergence'}], rawModelEvents: [], telemetryEvents: []},
    {caseId: cases[0].id, runIndex: 1, status: 'error', errorKind: 'plan', metrics: {...emptyMetrics(), fullJobSuccess: false, costUsd: 0.005, firstAVPlayableMs: null, fullPlayableMs: null}, scenes: [], rawModelEvents: [], telemetryEvents: []},
    {caseId: cases[1].id, runIndex: 0, status: 'complete', metrics: {...emptyMetrics(), fullJobSuccess: true, costUsd: 0.02, firstAVPlayableMs: 2000, fullPlayableMs: 4000}, scenes: [{archetype: 'flow'}], rawModelEvents: [], telemetryEvents: []}
  ];
  const report = aggregateReport(cases, runs, 'abc');
  assert.equal(report.totalRuns, 3);
  assert.equal(report.stageSuccess.fullJobSuccess.pass, 2);
  assert.equal(report.failureTaxonomy.plan, 1);
  assert.equal(report.regressions.length, 1);
  assert.ok(reportToMarkdown(report).includes('Live Evaluation Report'));
});

test('runner records a run even when model creation fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'live-eval-'));
  const result = await runLiveEvaluation({
    cases: LIVE_EVAL_CASES.filter(c => c.id === 'photosynthesis_inputs'),
    runs: 1,
    outDir: root,
    env: {...process.env, OPENROUTER_API_KEY: ''}
  });

  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].status, 'error');
  assert.ok(result.runs[0].error?.includes('OPENROUTER_API_KEY'));
  await rm(root, {recursive: true, force: true});
});

test('percentile and mean helpers handle empty arrays', () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(mean([]), 0);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
});

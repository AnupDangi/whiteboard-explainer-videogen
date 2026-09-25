#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXPERIMENT, type HypothesisRunOptions } from '../shared/contracts.js';
import { ATTENTION_SCENES } from './fixtures/attentionScenes.js';
import { MATH_SCENES } from './fixtures/mathScenes.js';
import { LIVE_NARRATION_SCRIPTS, teachingContextFor } from './fixtures/liveNarrationScripts.js';
import { loadOpenRouterEnv } from './planner/env.js';
import { runHypothesisLive, type HypothesisLiveInput } from './pipeline/runLive.js';
import { loadAlignmentCalibration } from '../shared/alignment/calibration.js';
import { PersistentBudgetLedger } from './pipeline/budgetLedger.js';
import { ContentAddressedArtifactStore } from './artifactCache.js';

/**
 * Live-run CLI: real local TTS + real forced alignment + real Scene Planner
 * (OpenRouter) + real @resvg/resvg-js/ffmpeg MP4 export, for one or all
 * golden cases. Never used by the fixture-mode `cli.ts`/`test:hypothesis`
 * path — no live network/model/process call is reachable from `npm run
 * test:hypothesis`.
 *
 * Usage:
 *   node liveCli.js                                    # all 4 golden cases
 *   node liveCli.js --case=gradient-descent
 *   node liveCli.js --out=.data/hypothesis-runs/claude/live
 */

const CASES = ['transformer-attention', 'gradient-descent', 'photosynthesis', 'electromagnetic-induction'] as const;

function buildInput(caseId: string): HypothesisLiveInput {
  // Renderer-first proofs with real narrated audio: hand-authored scenes, no LLM call (claude_pipeline.md §17).
  if (caseId === 'fixtures-attention') return { caseId, scenes: ATTENTION_SCENES.map((s) => ({ sceneId: s.sceneId, raw: s.raw, spec: s.spec })) };
  if (caseId === 'fixtures-math') return { caseId, scenes: MATH_SCENES.map((s) => ({ sceneId: s.sceneId, raw: s.raw, spec: s.spec })), targetDurationMs: 10_000 };
  if (caseId === 'transformer-attention') {
    return { caseId, scenes: ATTENTION_SCENES.map((s) => ({ sceneId: s.sceneId, raw: s.raw })) };
  }
  const script = LIVE_NARRATION_SCRIPTS[caseId];
  if (!script) throw new Error(`No live narration script for case "${caseId}"`);
  return {
    caseId,
    scenes: script.scenes.map((s) => ({ sceneId: s.sceneId, raw: s.raw, teachingContext: teachingContextFor(caseId, s.beatIndex) })),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith('--case='))?.slice('--case='.length);
  const outBase = args.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? '.data/hypothesis-runs/claude/live';
  const cacheMode = (args.find((a) => a.startsWith('--cache='))?.slice('--cache='.length) ?? 'warm') as 'cold' | 'warm' | 'replay';
  const cases = only ? [only] : [...CASES];

  const offline = cases.every((c) => c.startsWith('fixtures-'));
  // Hand-authored fixture runs make no OpenRouter call, so they do not need credentials.
  const env = offline ? { apiKey: '', directorModel: 'hand-authored', sceneModel: 'hand-authored', contentModel: 'hand-authored' } : await loadOpenRouterEnv();
  const calibration = await loadAlignmentCalibration();
  // --planner=<openrouter model id> runs experiment E5 (planner model A/B); default is the strong S6 model.
  const plannerModel = args.find((a) => a.startsWith('--planner='))?.slice('--planner='.length) ?? env.sceneModel;
  const summary: Array<Record<string, unknown>> = [];

  for (const caseId of cases) {
    const outputDir = path.join(outBase, caseId);
    const budgetLedger = new PersistentBudgetLedger(path.join(outputDir, 'budget-ledger.json'), EXPERIMENT.maxClipCostUsd);
    const artifactStore = new ContentAddressedArtifactStore(path.join(outputDir, 'stage-cache'), cacheMode);
    const options: HypothesisRunOptions = {
      mode: 'live',
      outputDir,
      narrationModel: 'voice-engine:supertonic',
      visualModel: plannerModel,
      voice: { provider: 'voice-engine', language: 'en', speed: 1 },
      alignment: { provider: 'stable-ts', ...(calibration.status === 'measured' ? { calibrationMedianErrorMs: calibration.medianAbsoluteBoundaryErrorMs! } : {}) },
      render: { width: 1920, height: 1080, fps: 30 },
      maxRepairs: 1,
      cache: cacheMode,
      maxCostUsd: EXPERIMENT.maxClipCostUsd,
    };
    console.log(`\n=== ${caseId} (planner model: ${plannerModel}) ===`);
    try {
      const input = buildInput(caseId);
      const result = await runHypothesisLive(input, options, { openRouterApiKey: env.apiKey, plannerModel, budgetLedger, artifactStore });
      const hardFailures = result.failures.filter((f) => f.hard);
      console.log(
        `runId=${result.runId} status=${result.status} scenes=${result.scenes.length}/${input.scenes.length} hardFailures=${hardFailures.length} costUsd=${result.evaluationBundle.usage.costUsd.toFixed(4)} video=${result.videoPath ?? 'NONE'}`,
      );
      for (const f of hardFailures) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
      const ledger = await budgetLedger.snapshot();
      summary.push({
        caseId,
        runId: result.runId,
        scenesOk: result.scenes.length,
        scenesTotal: input.scenes.length,
        hardFailures: hardFailures.length,
        status: result.status,
        costUsd: result.evaluationBundle.usage.costUsd,
        ledgerSpentUsd: ledger.spentUsd,
        ledgerCalls: ledger.calls,
        budgetUsd: ledger.budgetUsd,
        video: result.videoPath ?? null,
        outputDir,
      });
    } catch (error) {
      console.error(`  [CASE FAILED] ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
      summary.push({ caseId, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  await mkdir(outBase, { recursive: true });
  await writeFile(path.join(outBase, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log('\nSummary written to', path.join(outBase, 'summary.json'));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

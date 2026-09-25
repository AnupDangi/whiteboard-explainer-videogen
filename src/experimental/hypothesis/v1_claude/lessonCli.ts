#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXPERIMENT, type HypothesisRunOptions, type StageRunRecord } from '../shared/contracts.js';
import { MATH_LESSONS } from './fixtures/mathLessons.js';
import { loadOpenRouterEnv } from './planner/env.js';
import { lessonToLiveInput, prepareLesson } from './pipeline/lesson.js';
import { runHypothesisLive } from './pipeline/runLive.js';
import { loadAlignmentCalibration } from '../shared/alignment/calibration.js';
import { loadSourceDoc } from './plan/sourceIntake.js';
import { PersistentBudgetLedger } from './pipeline/budgetLedger.js';
import { ContentAddressedArtifactStore } from './artifactCache.js';
import { sha256 } from '../shared/artifacts.js';
import type { PromptArm } from './planner/exemplars.js';
import type { ExampleOrder } from './planner/context.js';

/**
 * Full lesson CLI: source text -> S2 concepts -> S3 teaching plan -> plan
 * analysis -> S4 marked script (content model) -> S5 real TTS + alignment ->
 * S6 Scene Planner (scene model) -> S7-S11 -> MP4.
 *
 * Usage:
 *   node lessonCli.js --lesson=m4-gradient-descent        # a math golden lesson
 *   node lessonCli.js --lesson=all
 *   node lessonCli.js --source=notes.md --duration=60 --id=my-lesson
 *   [--planner=<model>] [--content=<model>] [--prompt-arm=zero|text|mechanism|diverse]
 *   [--example-order=ranked|reverse] [--stage-cache=<shared-cache-dir>]
 *   [--plan-despite-alignment-failure] # diagnostic S6 opt-in; run remains failed
 *   [--out=.data/hypothesis-runs/claude/lessons]
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const env = await loadOpenRouterEnv();
  const plannerModel = arg('planner') ?? env.sceneModel;
  const contentModel = arg('content') ?? env.contentModel;
  const calibration = await loadAlignmentCalibration();
  const outBase = arg('out') ?? '.data/hypothesis-runs/claude/lessons';
  const cacheMode = (arg('cache') ?? 'warm') as 'cold' | 'warm' | 'replay';
  const promptArm = (arg('prompt-arm') ?? 'zero') as PromptArm;
  const exampleOrder = (arg('example-order') ?? 'ranked') as ExampleOrder;
  const planDespiteAlignmentFailure = args.includes('--plan-despite-alignment-failure');
  const sharedStageCache = arg('stage-cache') ? path.resolve(arg('stage-cache')!) : undefined;
  if (!['zero', 'text', 'mechanism', 'diverse'].includes(promptArm)) throw new Error(`unknown E5 prompt arm: ${promptArm}`);
  if (!['ranked', 'reverse'].includes(exampleOrder)) throw new Error(`unknown E5 example order: ${exampleOrder}`);
  if (promptArm === 'zero' && exampleOrder !== 'ranked') throw new Error('--example-order=reverse requires --prompt-arm=text|mechanism|diverse');

  const which = arg('lesson');
  const lessons = which === 'all' ? MATH_LESSONS : which ? MATH_LESSONS.filter((l) => l.id === which) : [];
  const sourceArtifacts = new Map<string, { key: string; contentHash: string; cacheHit: boolean }>();
  const sourceStageRuns = new Map<string, StageRunRecord>();
  const sourcePath = arg('source');
  if (sourcePath) {
    const id = arg('id') ?? path.basename(sourcePath).replace(/\W+/g, '-');
    const bytes = await readFile(sourcePath);
    const sourceStore = new ContentAddressedArtifactStore(sharedStageCache ?? path.join(outBase, id, 'stage-cache'), cacheMode);
    const sourceStartedAtMs = Date.now();
    const sourceStage = await sourceStore.run('S1-source-intake', { extension: path.extname(sourcePath).toLowerCase(), bytesSha256: sha256(bytes) }, { schemaVersion: 'source-doc/v2', stageVersion: 'source-intake-native-location-3', promptVersion: 'source-parser-3' }, () => loadSourceDoc(sourcePath));
    sourceArtifacts.set(id, { key: sourceStage.key, contentHash: sourceStage.artifact.contentHash, cacheHit: sourceStage.cacheHit });
    sourceStageRuns.set(id, { stage: 'S1-source-intake', kind: 'local', status: 'completed', durationMs: Date.now() - sourceStartedAtMs, apiCostUsd: 0, cacheHit: sourceStage.cacheHit, fallbackCount: 0, failures: [] });
    const sourceDoc = sourceStage.artifact.payload;
    lessons.push({ id, title: sourceDoc.title ?? 'lesson', source: sourceDoc.text, sourceDoc, sourceFormat: sourceDoc.format, targetDurationSec: Number(arg('duration') ?? 60), instruction: arg('instruction'), expect: { level: 'one-step', minStepScenes: 0 } });
  }
  if (lessons.length === 0) throw new Error('nothing to run: pass --lesson=<id>|all or --source=<file>');

  const summary: Array<Record<string, unknown>> = [];
  for (const lesson of lessons) {
    const outputDir = path.join(outBase, lesson.id);
    await mkdir(outputDir, { recursive: true });
    const t0 = Date.now();
    const budgetLedger = new PersistentBudgetLedger(path.join(outputDir, 'budget-ledger.json'), EXPERIMENT.maxClipCostUsd);
    const artifactStore = new ContentAddressedArtifactStore(sharedStageCache ?? path.join(outputDir, 'stage-cache'), cacheMode);
    console.log(`\n=== ${lesson.id} (content: ${contentModel}, planner: ${plannerModel}) ===`);
    const prepared = await prepareLesson(lesson, { model: contentModel, apiKey: env.apiKey, budgetUsd: 0.03, budgetLedger, artifactStore });
    const sourceArtifact = sourceArtifacts.get(lesson.id);
    if (sourceArtifact) {
      prepared.stageArtifacts['S1-source-intake'] = sourceArtifact;
      if (sourceArtifact.cacheHit) prepared.cacheHits.unshift('S1-source-intake');
    }
    const sourceStageRun = sourceStageRuns.get(lesson.id);
    if (sourceStageRun) {
      const sourceRunIndex = prepared.stageRuns.findIndex((stageRun) => stageRun.stage === 'S1-source-intake');
      if (sourceRunIndex >= 0) prepared.stageRuns[sourceRunIndex] = sourceStageRun;
      else prepared.stageRuns.unshift(sourceStageRun);
    }
    await writeFile(path.join(outputDir, 'lesson-prep.json'), `${JSON.stringify({ request: lesson, ...prepared }, null, 2)}\n`);
    const prepFailures = prepared.failures.filter((f) => f.hard);
    if (!prepared.script || prepFailures.length) {
      for (const f of prepFailures) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
      summary.push({ lesson: lesson.id, stage: 'prepare', status: 'failed', planDespiteAlignmentFailure, failures: prepFailures.length, costUsd: prepared.usage.costUsd, stageRuns: prepared.stageRuns });
      continue;
    }
    const options: HypothesisRunOptions = {
      mode: 'live',
      outputDir,
      narrationModel: contentModel,
      visualModel: plannerModel,
      voice: { provider: 'voice-engine', language: 'en', speed: 1 },
      alignment: { provider: 'stable-ts', ...(calibration.status === 'measured' ? { calibrationMedianErrorMs: calibration.medianAbsoluteBoundaryErrorMs! } : {}) },
      render: { width: 1920, height: 1080, fps: 30 },
      maxRepairs: 1,
      cache: cacheMode,
      maxCostUsd: Math.max(0.001, EXPERIMENT.maxClipCostUsd - prepared.usage.costUsd),
    };
    try {
      const result = await runHypothesisLive(lessonToLiveInput(lesson.id, prepared), options, { openRouterApiKey: env.apiKey, plannerModel, budgetLedger, artifactStore, promptArm, exampleOrder, planDespiteAlignmentFailure });
      const hard = result.failures.filter((f) => f.hard);
      const cost = prepared.usage.costUsd + result.evaluationBundle.usage.costUsd;
      console.log(`status=${result.status} scenes=${result.scenes.length}/${prepared.plan!.sections.length} hard=${hard.length} fallbacks=${result.evaluationBundle.usage.fallbacks} cost=$${cost.toFixed(4)} wall=${((Date.now() - t0) / 1000).toFixed(0)}s video=${result.videoPath ?? 'NONE'}`);
      for (const f of hard) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
      const ledger = await budgetLedger.snapshot();
      summary.push({ lesson: lesson.id, promptArm, exampleOrder, planDespiteAlignmentFailure, status: result.status, scenes: result.scenes.length, planned: prepared.plan!.sections.length, hardFailures: hard.length, fallbacks: result.evaluationBundle.usage.fallbacks, cacheHits: prepared.cacheHits.length + result.evaluationBundle.usage.cacheHits, cachedPreparationStages: prepared.cacheHits, costUsd: cost, ledgerSpentUsd: ledger.spentUsd, ledgerCalls: ledger.calls, budgetUsd: ledger.budgetUsd, prepCostUsd: prepared.usage.costUsd, plannerCostUsd: result.evaluationBundle.usage.costUsd, wallSec: (Date.now() - t0) / 1000, durationMs: result.alignedAudio.durationMs, video: result.videoPath ?? null, stageRuns: result.evaluationBundle.stageRuns, gateRecords: result.evaluationBundle.gateRecords, rungs: Object.fromEntries(Object.entries(result.evaluationBundle.metrics).filter(([k]) => k.startsWith('rung'))) });
    } catch (error) {
      console.error(`  [LESSON FAILED] ${lesson.id}: ${error instanceof Error ? error.message : String(error)}`);
      summary.push({ lesson: lesson.id, status: 'failed', planDespiteAlignmentFailure, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await writeFile(path.join(outBase, `summary-${plannerModel.replace(/\W+/g, '_')}.json`), `${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { scenePlanner as scenePlannerById } from './planner/registry.js';
import path from 'node:path';
import type { HypothesisRunOptions, StageRunRecord } from '../shared/contracts.js';
import { MATH_LESSONS } from './fixtures/mathLessons.js';
import { loadOpenRouterEnv } from './planner/env.js';
import { lessonToLiveInput, prepareLesson } from './pipeline/lesson.js';
import { runHypothesisLive } from './pipeline/runLive.js';
import { loadAlignmentCalibration } from '../shared/alignment/calibration.js';
import { closeSpeechWorkers, synthesizeAndAlign } from '../shared/alignment/align.js';
import { intakeWarningFailures, loadSourceDoc, loadSourceDocFromUrl, planSourceIntake } from './plan/sourceIntake.js';
import { buildSourceBundle } from './plan/sourceBundle.js';
import { indexSourceBundleWithRag } from './plan/ragSidecar.js';
import { PersistentBudgetLedger } from './pipeline/budgetLedger.js';
import { ContentAddressedArtifactStore } from './artifactCache.js';
import { sha256 } from '../shared/artifacts.js';
import { LESSON_DURATIONS_SEC, lessonCostCapUsd } from './plan/hierarchical.js';
import type { PromptArm } from './planner/exemplars.js';
import type { ExampleOrder } from './planner/context.js';
import { argValue, argValues, hasFlag } from './cli/args.js';

/**
 * Full lesson CLI: source text -> S2 concepts -> S3 teaching plan -> plan
 * analysis -> S4 marked script (content model) -> S5 real TTS + alignment ->
 * S6 Scene Planner (scene model) -> S7-S11 -> MP4.
 *
 * Usage:
 *   node lessonCli.js --lesson=m4-gradient-descent        # a math golden lesson
 *   node lessonCli.js --lesson=all
 *   node lessonCli.js --source=notes.md --duration=60|300|600|1800 --id=my-lesson
 *   [--planner=<model>] [--content=<model>] [--prompt-arm=zero|text|mechanism|diverse]
 *   [--example-order=ranked|reverse] [--stage-cache=<shared-cache-dir>]
 *   [--plan-despite-alignment-failure] # diagnostic S6 opt-in; run remains failed
 *   [--diagnostic-video-with-invalid-captions] # retain failed MP4 without captions when word timing is invalid
 *   [--out=.data/hypothesis-runs/claude/lessons]
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (key: string) => argValue(args, key);
  const env = await loadOpenRouterEnv();
  const plannerModel = arg('planner') ?? env.sceneModel;
  const contentModel = arg('content') ?? env.contentModel;
  const calibration = await loadAlignmentCalibration();
  const outBase = arg('out') ?? '.data/hypothesis-runs/claude/lessons';
  const cacheMode = (arg('cache') ?? 'warm') as 'cold' | 'warm' | 'replay';
  const promptArm = (arg('prompt-arm') ?? 'zero') as PromptArm;
  const exampleOrder = (arg('example-order') ?? 'ranked') as ExampleOrder;
  const planDespiteAlignmentFailure = hasFlag(args, 'plan-despite-alignment-failure');
  const diagnosticCaptionlessVideo = hasFlag(args, 'diagnostic-video-with-invalid-captions');
  const scenePlanner = scenePlannerById(arg('scene-planner')).id;
  const sharedStageCache = arg('stage-cache') ? path.resolve(arg('stage-cache')!) : undefined;
  if (!['zero', 'text', 'mechanism', 'diverse'].includes(promptArm)) throw new Error(`unknown E5 prompt arm: ${promptArm}`);
  if (!['ranked', 'reverse'].includes(exampleOrder)) throw new Error(`unknown E5 example order: ${exampleOrder}`);
  if (promptArm === 'zero' && exampleOrder !== 'ranked') throw new Error('--example-order=reverse requires --prompt-arm=text|mechanism|diverse');

  const which = arg('lesson');
  const lessons = which === 'all' ? MATH_LESSONS : which ? MATH_LESSONS.filter((l) => l.id === which) : [];
  const sourceArtifacts = new Map<string, Array<{ key: string; contentHash: string; cacheHit: boolean }>>();
  const sourceStageRuns = new Map<string, StageRunRecord[]>();
  const lessonExecutionStartedAt = new Map<string, number>();
  const sourcePaths = argValues(args, 'source');
  const sourceUrls = argValues(args, 'url');
  if (sourcePaths.length || sourceUrls.length) {
    const requestedDurationSec = Number(arg('duration') ?? 60);
    if (!LESSON_DURATIONS_SEC.includes(requestedDurationSec as typeof LESSON_DURATIONS_SEC[number])) throw new Error(`--duration must be one of ${LESSON_DURATIONS_SEC.join(', ')} seconds`);
    const firstLabel = sourcePaths[0] ? path.basename(sourcePaths[0]) : new URL(sourceUrls[0]!).hostname;
    const id = arg('id') ?? firstLabel.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const intakeStartedAtMs = Date.now();
    lessonExecutionStartedAt.set(id, intakeStartedAtMs);
    const pathEntries = await Promise.all(sourcePaths.map(async (sourcePath) => {
        const bytes = await readFile(sourcePath);
        const store = new ContentAddressedArtifactStore(sharedStageCache ?? path.join(outBase, id, 'stage-cache'), cacheMode);
        const startedAtMs = Date.now();
        // The chosen reader and its version are part of the key: switching
        // HYPOTHESIS_PDF_EXTRACTOR never replays another reader's text.
        const intakePlan = await planSourceIntake({ bytes, name: sourcePath });
        const stage = await store.run('S1-source-intake', { name: path.basename(sourcePath), bytesSha256: sha256(bytes), extractor: `${intakePlan.extractor.id}@${intakePlan.extractor.version}` }, { schemaVersion: 'source-doc/v2', stageVersion: 'source-intake-6-pluggable', promptVersion: 'none' }, () => loadSourceDoc(sourcePath, intakePlan));
        const doc = stage.artifact.payload;
        return { doc, artifact: { key: stage.key, contentHash: stage.artifact.contentHash, cacheHit: stage.cacheHit }, startedAtMs, completedAtMs: Date.now(), cacheHit: stage.cacheHit };
      }));
    const urlEntries = await Promise.all(sourceUrls.map(async (url) => {
        const startedAtMs = Date.now();
        const doc = await loadSourceDocFromUrl(url);
        return { doc, startedAtMs, completedAtMs: Date.now(), cacheHit: false as const };
      }));
    const sourceEntries = [...pathEntries, ...urlEntries];
    sourceArtifacts.set(id, pathEntries.map((entry) => entry.artifact));
    sourceStageRuns.set(id, sourceEntries.map(({ doc, startedAtMs, completedAtMs, cacheHit }) => ({ stage: `S1-source-intake:${doc.sourceId}`, kind: 'local', status: 'completed', durationMs: completedAtMs - startedAtMs, startedAt: new Date(startedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), apiCostUsd: 0, cacheHit, fallbackCount: 0, failures: intakeWarningFailures(doc) })));
    const docs = sourceEntries.map((entry) => entry.doc);
    const { sourceDoc, sourceBundle } = buildSourceBundle(docs, arg('instruction') ?? docs.map((doc) => doc.title ?? '').join(' '));
    lessons.push({ id, title: sourceDoc.title ?? 'lesson', source: sourceDoc.text, sourceDoc, sourceBundle, sources: [...sourcePaths.map((sourcePath) => ({ kind: 'document' as const, path: sourcePath })), ...sourceUrls.map((url) => ({ kind: 'url' as const, url }))], sourceFormat: sourceDoc.format, targetDurationSec: requestedDurationSec, instruction: arg('instruction'), expect: { level: 'one-step', minStepScenes: 0 } });
  }
  if (lessons.length === 0) throw new Error('nothing to run: pass --lesson=<id>|all or --source=<file>');

  const summary: Array<Record<string, unknown>> = [];
  for (const lesson of lessons) {
    const executionStartedAtMs = lessonExecutionStartedAt.get(lesson.id) ?? Date.now();
    lessonExecutionStartedAt.set(lesson.id, executionStartedAtMs);
    const runId = `${new Date(executionStartedAtMs).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const outputDir = path.join(outBase, lesson.id, 'runs', runId);
    await mkdir(outputDir, { recursive: true });
    const requestedBudgetUsd = lessonCostCapUsd(lesson.targetDurationSec);
    const budgetLedger = new PersistentBudgetLedger(path.join(outputDir, 'budget-ledger.json'), requestedBudgetUsd);
    const artifactStore = new ContentAddressedArtifactStore(sharedStageCache ?? path.join(outBase, lesson.id, 'stage-cache'), cacheMode);
    console.log(`\n=== ${lesson.id} (content: ${contentModel}, planner: ${plannerModel}) ===`);
    const ragStartedAtMs = Date.now();
    const ragOutcome = lesson.sourceBundle && lesson.sourceDoc
      ? await indexSourceBundleWithRag({ sourceDoc: lesson.sourceDoc, sourceBundle: lesson.sourceBundle, query: lesson.instruction ?? lesson.title, workingDir: path.join(outBase, lesson.id, 'rag-index', lesson.sourceBundle.bundleId), ledger: budgetLedger, remainingBudgetUsd: Math.max(0, requestedBudgetUsd - (await budgetLedger.snapshot()).spentUsd), providerEnv: env.ragSidecarEnv })
      : undefined;
    const prepared = await prepareLesson(lesson, { model: contentModel, stageModels: argValue(args, 'content') ? {} : env.stageModels, apiKey: env.apiKey, budgetUsd: requestedBudgetUsd, budgetLedger, artifactStore, speechAligner: synthesizeAndAlign, speechLanguage: 'en', alignmentCalibrationMedianErrorMs: calibration.status === 'measured' ? calibration.medianAbsoluteBoundaryErrorMs! : undefined });
    if (ragOutcome) prepared.stageRuns.push({ stage: 'S1-rag-index', kind: ragOutcome.estimatedCostUsd > 0 || ragOutcome.cacheHit ? 'provider' : 'local', status: ['completed', 'disabled', 'skipped'].includes(ragOutcome.status) ? 'completed' : 'failed', ...(ragOutcome.skipReason ? { skipReason: ragOutcome.skipReason } : {}), durationMs: ragOutcome.elapsedMs, startedAt: new Date(ragStartedAtMs).toISOString(), completedAt: new Date().toISOString(), apiCostUsd: ragOutcome.estimatedCostUsd, ...(ragOutcome.artifactEstimatedCostUsd ? { artifactApiCostUsd: ragOutcome.artifactEstimatedCostUsd } : {}), ...(ragOutcome.estimatedCostUsd > 0 || ragOutcome.artifactEstimatedCostUsd ? { costEstimated: true } : {}), cacheHit: ragOutcome.cacheHit, fallbackCount: 0, ...(ragOutcome.actualUsage ? { usage: { calls: ragOutcome.actualUsage.callAttempts, promptTokens: ragOutcome.actualUsage.promptTokens, completionTokens: ragOutcome.actualUsage.completionTokens, cachedTokens: 0, costUsd: ragOutcome.estimatedCostUsd, repairs: 0, fallbacks: 0, cacheHits: ragOutcome.cacheHit ? 1 : 0 } } : {}), failures: ragOutcome.error ? [{ code: ragOutcome.retrievalStatus === 'miss' ? 'rag-exact-span-retrieval-miss' : ragOutcome.status === 'partial' ? 'rag-index-partial' : 'rag-index-failed', stage: 'S1-rag-index', message: ragOutcome.error, hard: false }] : [] });
    const sourceArtifactList = sourceArtifacts.get(lesson.id);
    if (sourceArtifactList) {
      sourceArtifactList.forEach((sourceArtifact, index) => {
        prepared.stageArtifacts[`S1-source-intake:${index + 1}`] = sourceArtifact;
        if (sourceArtifact.cacheHit) prepared.cacheHits.unshift(`S1-source-intake:${index + 1}`);
      });
    }
    const sourceStageRunList = sourceStageRuns.get(lesson.id);
    if (sourceStageRunList) {
      prepared.stageRuns.splice(0, prepared.stageRuns.length, ...prepared.stageRuns.filter((stageRun) => stageRun.stage !== 'S1-source-intake'), ...sourceStageRunList);
    }
    const pipelineStartedAtMs = Date.now();
    await writeFile(path.join(outputDir, 'lesson-prep.json'), `${JSON.stringify({ request: lesson, ...prepared }, null, 2)}\n`);
    if (lesson.sourceBundle) await writeFile(path.join(outputDir, 'source-bundle.json'), `${JSON.stringify(lesson.sourceBundle, null, 2)}\n`);
    const prepFailures = prepared.failures.filter((f) => f.hard);
    const blockingPreparationFailures = prepFailures.filter((failure) => failure.stage !== 'align');
    if (!prepared.script || blockingPreparationFailures.length) {
      for (const f of prepFailures) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
      const completedAtMs = Date.now();
      summary.push({ lesson: lesson.id, runId, outputDir, stage: 'prepare', status: 'failed', planDespiteAlignmentFailure, failures: prepFailures.length, hardFailures: prepFailures.length, failureDetails: prepFailures.map(({ code, stage, message }) => ({ code, stage, message })), costUsd: prepared.usage.costUsd + (ragOutcome?.estimatedCostUsd ?? 0), estimatedRagCostUsd: ragOutcome?.estimatedCostUsd ?? 0, requestedDurationSec: lesson.targetDurationSec, plannedDurationSec: prepared.plannedDurationSec ?? null, coverageReason: prepared.coverageReason ?? null, startedAt: new Date(executionStartedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), wallMs: completedAtMs - executionStartedAtMs, preparationMs: completedAtMs - pipelineStartedAtMs, stageRuns: prepared.stageRuns });
      continue;
    }
    for (const f of prepFailures) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
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
      maxCostUsd: Math.max(0.001, lessonCostCapUsd(prepared.plannedDurationSec ?? lesson.targetDurationSec) - (await budgetLedger.snapshot()).spentUsd),
      ...(diagnosticCaptionlessVideo ? { diagnosticCaptionlessVideo: true } : {}),
    };
    try {
      const result = await runHypothesisLive(lessonToLiveInput(lesson.id, prepared), options, { openRouterApiKey: env.apiKey, plannerModel, budgetLedger, artifactStore, promptArm, exampleOrder, planDespiteAlignmentFailure, scenePlanner, executionTiming: { startedAtMs: executionStartedAtMs, pipelineStartedAtMs } });
      const hard = result.failures.filter((f) => f.hard);
      const cost = prepared.usage.costUsd + result.evaluationBundle.usage.costUsd + (ragOutcome?.estimatedCostUsd ?? 0);
      const completedAtMs = Date.now();
      console.log(`status=${result.status} scenes=${result.scenes.length}/${prepared.plan!.sections.length} hard=${hard.length} fallbacks=${result.evaluationBundle.usage.fallbacks} cost=$${cost.toFixed(4)} wall=${((completedAtMs - executionStartedAtMs) / 1000).toFixed(0)}s video=${result.videoPath ?? 'NONE'} encodedDuration=${result.encodedVideoDurationMs === undefined ? 'UNKNOWN' : `${(result.encodedVideoDurationMs / 1000).toFixed(3)}s`}`);
      for (const f of hard) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
      const ledger = await budgetLedger.snapshot();
      summary.push({ lesson: lesson.id, runId, outputDir, promptArm, exampleOrder, planDespiteAlignmentFailure, status: result.status, scenes: result.scenes.length, planned: prepared.plan!.sections.length, requestedDurationSec: prepared.requestedDurationSec ?? lesson.targetDurationSec, plannedDurationSec: prepared.plannedDurationSec ?? prepared.plan!.targetDurationSec, coverageReason: prepared.coverageReason ?? 'Full requested duration supported by source evidence.', modules: prepared.modules?.map(({ moduleId, title, goal, budgetSec, requestedBudgetSec, actualAudioDurationMs, plan }) => ({ id: moduleId, title, goal, budgetSec, requestedBudgetSec, actualAudioDurationMs, audioBudgetDeltaMs: actualAudioDurationMs === undefined ? null : actualAudioDurationMs - budgetSec * 1000, scenes: plan.sections.length })), actualNarratedDurationSec: Number(result.evaluationBundle.metrics.realNarratedMs ?? result.alignedAudio.durationMs) / 1000, finalVideoDurationSec: result.encodedVideoDurationMs === undefined ? null : result.encodedVideoDurationMs / 1000, durationBudgetDeltaMs: result.evaluationBundle.metrics.durationBudgetDeltaMs ?? null, hardFailures: hard.length, failureDetails: hard.map(({ code, stage, message }) => ({ code, stage, message })), fallbacks: result.evaluationBundle.usage.fallbacks, cacheHits: prepared.cacheHits.length + result.evaluationBundle.usage.cacheHits, cachedPreparationStages: prepared.cacheHits, costUsd: cost, ledgerSpentUsd: ledger.spentUsd, ledgerCalls: ledger.calls, budgetUsd: ledger.budgetUsd, prepCostUsd: prepared.usage.costUsd, plannerCostUsd: result.evaluationBundle.usage.costUsd, sceneApiCostUsd: result.evaluationBundle.metrics['cost.sceneApiUsd'] ?? 0, startedAt: new Date(executionStartedAtMs).toISOString(), pipelineStartedAt: new Date(pipelineStartedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), wallMs: completedAtMs - executionStartedAtMs, preparationMs: pipelineStartedAtMs - executionStartedAtMs, pipelineMs: completedAtMs - pipelineStartedAtMs, firstPlayableSceneMs: result.evaluationBundle.metrics['timing.firstPlayableSceneMs'] ?? null, durationMs: result.alignedAudio.durationMs, encodedVideoDurationMs: result.encodedVideoDurationMs ?? null, video: result.videoPath ?? null, stageRuns: result.evaluationBundle.stageRuns, gateRecords: result.evaluationBundle.gateRecords, rungs: Object.fromEntries(Object.entries(result.evaluationBundle.metrics).filter(([k]) => k.startsWith('rung'))) });
    } catch (error) {
      console.error(`  [LESSON FAILED] ${lesson.id}: ${error instanceof Error ? error.message : String(error)}`);
      const completedAtMs = Date.now();
      // A crashed run must still leave a bundle: diagnosis tooling reads
      // evaluation-bundle.json uniformly, and a missing file hides crashes.
      try {
        await writeFile(path.join(outputDir, 'evaluation-bundle.json'), `${JSON.stringify({ schemaVersion: 'evaluation-bundle/v1', runId, status: 'failed', failures: [{ code: 'run-crashed', stage: 'pipeline', message: error instanceof Error ? error.message : String(error), hard: true }], metrics: {}, stageRuns: prepared.stageRuns ?? [] }, null, 2)}\n`, { flag: 'wx' });
      } catch { /* outputDir itself may be the casualty; summary below still lands */ }
      summary.push({ lesson: lesson.id, runId, outputDir, status: 'failed', planDespiteAlignmentFailure, startedAt: new Date(executionStartedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), wallMs: completedAtMs - executionStartedAtMs, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const summaryPath = path.join(outBase, `summary-${plannerModel.replace(/\W+/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
  const temporarySummaryPath = `${summaryPath}.tmp`;
  await writeFile(temporarySummaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  await rename(temporarySummaryPath, summaryPath);
  // Keep the summary for diagnosis, but let callers distinguish a failed
  // source-to-video run from a successfully produced draft.
  if (summary.some((entry) => entry.status === 'failed')) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(closeSpeechWorkers);

#!/usr/bin/env node
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { scenePlanner as scenePlannerById } from '../planner/registry.js';
import path from 'node:path';
import type { EvaluationBundle, HypothesisRunOptions, StageRunRecord } from '../shared/contracts.js';
import { MATH_LESSONS } from '../fixtures/mathLessons.js';
import { loadOpenRouterEnv } from '../planner/env.js';
import { lessonToLiveInput, prepareLesson } from './lesson.js';
import { runHypothesisLive } from './runLive.js';
import { FileCallRecorder, setAmbientCallRecorder } from '../structured/recorder.js';
import { buildScorecard } from '../harness/scorecard.js';
import { FEATURE_FLAGS, TEACHING_COMPILER_VERSION } from './featureFlags.js';
import { runLessonV2 } from '../pipeline-v2/runLessonV2.js';
import { ttsProvider } from '../audio/sceneAudio.js';
import { encodeLockedLessonV2Clips } from '../pipeline-v2/clipsV2.js';
import { loadAlignmentCalibration } from '../shared/alignment/calibration.js';
import { closeSpeechWorkers } from '../shared/alignment/align.js';
import { intakeWarningFailures, loadSourceDocFromBytes, loadSourceDocFromUrl, planSourceIntake } from '../intake/sourceIntake.js';
import { buildSourceBundle, evidenceHitBudget } from '../intake/sourceBundle.js';
import { indexSourceBundleWithRag } from '../plan/ragSidecar.js';
import { PersistentBudgetLedger } from './budgetLedger.js';
import { ContentAddressedArtifactStore } from './artifactCache.js';
import { sha256 } from '../shared/artifacts.js';
import { isSupportedLessonDuration, lessonCostCapUsd } from '../plan/hierarchical.js';
import type { PromptArm } from '../planner/exemplars.js';
import type { ExampleOrder } from '../planner/context.js';
import { argValue, argValues, hasFlag } from './args.js';
import { resolveDevelopmentAttempt } from '../harness/developmentBenchmark.js';
import { renderVideoFromLessonLock, writeFailureLessonLock } from './lessonLock.js';
import { failedEvaluationEnvelope } from '../harness/failedEvaluation.js';

let activeRunFailureContext: {
  runId: string;
  caseId: string;
  outputDir: string;
  sourceFiles: string[];
  startedAtMs: number;
  stage: string;
  requestHash?: string;
  settingsHash?: string;
  inputSourceSha256?: Record<string, string>;
  benchmarkAttemptId?: string;
  benchmark?: ReturnType<typeof resolveDevelopmentAttempt>;
  cacheMode: string;
  inputSourcePaths?: string[];
  modelIds: string[];
} | undefined;
const preallocatedRuns = new Map<string, { runId: string; outputDir: string; startedAtMs: number; startedMonotonicMs: number }>();

async function writeFailedRunManifest(
  context: NonNullable<typeof activeRunFailureContext>,
  failure: { stage: string; code: string; message: string },
): Promise<void> {
  const completedAtMs = Date.now();
  const artifactSha256: Record<string, string> = {};
  for (const name of [
    'source-doc.json', 'source-bundle.json', 'lesson-prep.json', 'evaluation-bundle.json',
    'lesson.lock.json', 'narration.json', 'aligned-audio.json', 'scene-events.jsonl',
    'render-artifacts.json', 'final-scene.svg', 'contact-sheet.png', 'video.mp4', 'captions.vtt',
  ]) {
    try {
      artifactSha256[name] = sha256(await readFile(path.join(context.outputDir, name)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const manifest = {
    schemaVersion: 'hypothesis-run/v1', pipeline: 'claude', runClass: 'generated-lesson',
    status: 'failed', runId: context.runId, caseId: context.caseId,
    startedAt: new Date(context.startedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(),
    executionTiming: { startedAt: new Date(context.startedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), wallMs: completedAtMs - context.startedAtMs },
    ...(context.benchmarkAttemptId ? { requestedBenchmarkAttemptId: context.benchmarkAttemptId } : {}),
    ...(context.benchmark ? { benchmark: {
      setId: context.benchmark.setId, attemptId: context.benchmark.attemptId,
      topicId: context.benchmark.topicId, trial: context.benchmark.trial,
      sourcePath: context.benchmark.sourcePath, sourceSha256: context.benchmark.sourceSha256,
      instructionSha256: context.benchmark.instructionSha256,
    } } : {}),
    options: { cache: context.cacheMode, ...(context.modelIds.length === 2 ? { narrationModel: context.modelIds[0], visualModel: context.modelIds[1] } : {}) },
    stages: {
      failedAt: context.stage,
      ...(context.inputSourcePaths?.length ? { inputSourcePaths: context.inputSourcePaths } : {}),
      ...(context.requestHash ? { requestHash: context.requestHash } : {}),
      ...(context.settingsHash ? { settingsHash: context.settingsHash } : {}),
      ...(context.inputSourceSha256 ? { inputSourceSha256: context.inputSourceSha256 } : {}),
    },
    failure, artifactSha256,
    ...(artifactSha256['evaluation-bundle.json'] ? { evaluationBundle: 'evaluation-bundle.json' } : {}),
  };
  await writeFile(path.join(context.outputDir, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}

async function listRunFiles(root: string, rel = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await listRunFiles(root, next));
    else if (entry.isFile() && entry.name !== 'run-manifest.json' && !entry.name.endsWith('.partial')) found.push(next);
  }
  return found;
}

/** V2 outputs use the shared evidence envelope, but stay draft/failed until independent release evidence exists. */
async function writeV2RunArtifacts(input: {
  outputDir: string; runId: string; caseId: string; startedAtMs: number; completedAtMs: number;
  cacheMode: string; plannerModel: string; language: string; result: Awaited<ReturnType<typeof runLessonV2>>;
  prepared: Awaited<ReturnType<typeof prepareLesson>>; estimatedRagCostUsd: number;
}): Promise<EvaluationBundle> {
  const { outputDir, runId, caseId, startedAtMs, completedAtMs, cacheMode, plannerModel, language, result, prepared, estimatedRagCostUsd } = input;
  const failures = [...prepared.failures, ...result.failures].map(({ code, stage, message, hard }) => ({ code, stage, message, hard }));
  const spans = new Map(prepared.sourceDoc.spans.map((span) => [span.id, span]));
  const evidenceFor = (spanIds: readonly string[]) => spanIds.flatMap((spanId) => {
    const span = spans.get(spanId);
    return span ? [{ sourceId: span.citationSourceId ?? prepared.sourceDoc.sourceId, spanId: span.id, startChar: span.startChar, endChar: span.endChar, startLine: span.startLine, endLine: span.endLine, quote: span.text, ...(span.sourceLocation ? { sourceLocation: span.sourceLocation } : {}) }] : [];
  });
  const claims = (prepared.plan?.sections ?? []).flatMap((section) => section.contract?.essentialClaims ?? []);
  const claimEvidence = Object.fromEntries(claims.map((claim) => [claim.id, evidenceFor(claim.evidenceSpanIds)]));
  const visualEvidence: EvaluationBundle['visualEvidence'] = {};
  const neutralElements: EvaluationBundle['elements'] = [];
  const neutralTimeline: EvaluationBundle['timeline'] = [];
  const provenance: EvaluationBundle['provenance'] = {};
  const relations: EvaluationBundle['relations'] = [];
  for (const scene of result.compiled) {
    const finalState = scene.timeline.states.at(-1)!;
    for (const element of Object.values(finalState.elements).filter((item) => item.lifecycle.removedAtBeat === undefined)) {
      const box = scene.geometry.rectFor(finalState, element.id);
      if (!box) continue;
      const spec = element.spec;
      const label = spec.type === 'entity' || spec.type === 'kit' || spec.type === 'value' ? spec.label : spec.type === 'token' || spec.type === 'text' ? spec.type === 'token' ? spec.text : spec.text : spec.latex;
      const key = `${scene.sceneId}:${element.id}`;
      neutralElements.push({ id: key, kind: spec.type, label, bbox: box });
      const bindings = 'bindings' in spec ? spec.bindings : undefined;
      const boundRefs = (bindings?.claimIds ?? []).flatMap((claimId) => claimEvidence[claimId] ?? []);
      if (boundRefs.length) visualEvidence[key] = boundRefs;
      provenance[key] = [spec.provenance, ...(bindings?.conceptIds ?? []).map((id) => `concept:${id}`), ...(bindings?.claimIds ?? []).map((id) => `claim:${id}`)];
    }
    for (const state of scene.timeline.states) for (const edge of Object.values(state.edges)) {
    if (edge.lifecycle.removedAtBeat !== undefined) continue;
      const edgeKey = `${scene.sceneId}:edge:${edge.id}`;
      provenance[edgeKey] = [`relation:${edge.relation}`, ...(edge.bindings?.conceptIds ?? []).map((id) => `concept:${id}`), ...(edge.bindings?.claimIds ?? []).map((id) => `claim:${id}`)];
      if (edge.bindings?.claimIds.length) visualEvidence[edgeKey] = edge.bindings.claimIds.flatMap((id) => claimEvidence[id] ?? []);
      for (const relation of edge.bindings?.claimIds.flatMap((id) => claims.find((claim) => claim.id === id)?.relations ?? []) ?? []) relations.push({ from: relation.from, to: relation.to, type: relation.type });
    }
    for (const event of scene.timeline.ops) {
      const op = event.op as unknown as Record<string, unknown>;
      const target = typeof op.target === 'string' ? op.target : typeof op.id === 'string' ? op.id : op.opId as string;
      neutralTimeline.push({ elementId: `${scene.sceneId}:${target}`, action: String(op.op), startMs: event.t0, endMs: event.t1, anchor: event.op.beatId, pedagogicalHold: false });
    }
  }
  const nativeArtifacts: Record<string, string> = {};
  for (const file of await listRunFiles(outputDir)) nativeArtifacts[file] = sha256(await readFile(path.join(outputDir, file)));
  const bundle: EvaluationBundle = {
    schemaVersion: 'evaluation-bundle/v1', pipeline: 'claude', runClass: 'generated-lesson', status: result.status,
    caseId, runId, commit: process.env.GIT_COMMIT ?? 'unavailable',
    configHash: sha256(JSON.stringify({ compiler: TEACHING_COMPILER_VERSION, plannerModel, language, cacheMode })),
    nativeArtifacts, claims: claims.map((claim) => `${claim.id}: ${claim.statement}`), claimEvidence, visualEvidence,
    relations: [...new Map(relations.map((relation) => [`${relation.from}|${relation.to}|${relation.type}`, relation])).values()], elements: neutralElements, timeline: neutralTimeline, provenance,
    metrics: { ...result.metrics, 'cost.ttsCredits': result.elevenLabsCredits, 'cost.ttsUsdKnown': ttsProvider() === 'elevenlabs' ? 0 : 1, absoluteQualityCertification: 'UNAVAILABLE' },
    usage: { calls: prepared.usage.calls + result.usage.calls, promptTokens: prepared.usage.promptTokens + result.usage.promptTokens, completionTokens: prepared.usage.completionTokens + result.usage.completionTokens, cachedTokens: prepared.usage.cachedTokens + result.usage.cachedTokens, costUsd: prepared.usage.costUsd + result.usage.costUsd + estimatedRagCostUsd, repairs: prepared.usage.repairs + result.usage.repairs, fallbacks: 0, cacheHits: prepared.cacheHits.length + (result.metrics['v2.clipsCached'] ?? 0) },
    failures,
  };
  await writeFile(path.join(outputDir, 'evaluation-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  const artifactSha256: Record<string, string> = {};
  for (const file of await listRunFiles(outputDir)) artifactSha256[file] = sha256(await readFile(path.join(outputDir, file)));
  const manifest = {
    schemaVersion: 'hypothesis-run/v1', pipeline: 'claude', runClass: 'generated-lesson', status: result.status,
    runId, caseId, startedAt: new Date(startedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(),
    executionTiming: { startedAt: new Date(startedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), wallMs: result.metrics['v2.requestToCompleteMs'], requestToCompleteMs: result.metrics['v2.requestToCompleteMs'] },
    options: { cache: cacheMode, plannerModel, compiler: 'teaching-compiler-v2' },
    stages: { failedAt: failures.find((failure) => failure.hard)?.stage ?? null, language, sceneCount: result.scenes, plannedScenes: result.planned, preparationStages: prepared.stageRuns, speechUsage: result.speechUsage, providerUsageEvents: result.providerUsageEvents, limitations: ['V2 independent human quality and rights review are unmeasured', 'first audible-playable latency is unmeasured until progressive playback is verified', ...(ttsProvider() === 'elevenlabs' ? ['TTS credits are reported separately and are not valued in USD because the provider does not report a USD price'] : [])] },
    mediaSha256: { ...(artifactSha256['audio.wav'] ? { audio: artifactSha256['audio.wav'] } : {}), ...(artifactSha256['video.mp4'] ? { video: artifactSha256['video.mp4'] } : {}) },
    artifactSha256, evaluationBundle: 'evaluation-bundle.json', svg: 'v2/locked/svg', ...(artifactSha256['video.mp4'] ? { video: 'video.mp4' } : {}),
  };
  await writeFile(path.join(outputDir, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return bundle;
}

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
 *   [--allow-partial-video] # best-effort delivery: encode rendered scenes even when coverage blocks others (failures still recorded, status stays failed)
 *   [--out=.data/hypothesis-runs/claude/lessons]
 *   [--from=/path/to/lesson.lock.json] # offline S10/S11 rerender from verified inputs
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (key: string) => argValue(args, key);
  const lockPath = arg('from');
  if (lockPath) {
    const outputDir = path.dirname(path.resolve(lockPath));
    if (!['lesson.lock.json', 'lesson.lock.v2.json'].includes(path.basename(lockPath))) throw new Error('--from must point to lesson.lock.json or lesson.lock.v2.json');
    const lock = JSON.parse(await readFile(path.resolve(lockPath), 'utf8')) as { schemaVersion?: string };
    if (lock.schemaVersion === 'lesson.lock/v5-teaching-compiler-v2') {
      const videoPath = path.join(outputDir, 'video.replay.mp4');
      console.log({ videoPath, ...await encodeLockedLessonV2Clips(outputDir, videoPath) });
      return;
    }
    console.log(await renderVideoFromLessonLock(outputDir));
    return;
  }
  const outBase = arg('out') ?? '.data/hypothesis-runs/claude/lessons';
  const benchmarkAttemptId = arg('benchmark-attempt');
  const benchmarkAttempt = benchmarkAttemptId ? resolveDevelopmentAttempt(process.cwd(), benchmarkAttemptId) : undefined;
  // --language=<ISO 639-1> sets the narration and speech language (default en); --tts=elevenlabs switches speech and word timing to ElevenLabs.
  const language = arg('language') ?? 'en';
  if (arg('tts')) process.env.TTS_PROVIDER = arg('tts');
  const cacheMode = (arg('cache') ?? (benchmarkAttempt ? 'cold' : 'warm')) as 'cold' | 'warm' | 'replay';
  const explicitSourcePaths = argValues(args, 'source');
  const sourcePaths = benchmarkAttempt && explicitSourcePaths.length === 0
    ? [path.resolve(process.cwd(), benchmarkAttempt.sourcePath)]
    : explicitSourcePaths;
  const sourceUrls = argValues(args, 'url');
  const firstLabel = sourcePaths[0] ? path.basename(sourcePaths[0]) : 'url-source';
  const sourceId = arg('id') ?? benchmarkAttempt?.topicId ?? firstLabel.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  if (sourcePaths.length || sourceUrls.length) {
    const startedAtMs = Date.now();
    const startedMonotonicMs = performance.now();
    const runId = `${new Date(startedAtMs).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const outputDir = path.join(outBase, sourceId, 'runs', runId);
    await mkdir(outputDir, { recursive: true });
    preallocatedRuns.set(sourceId, { runId, outputDir, startedAtMs, startedMonotonicMs });
    activeRunFailureContext = {
      runId, caseId: sourceId, outputDir, startedAtMs, stage: 'cli-setup',
      sourceFiles: ['source-doc.json', 'source-bundle.json'],
      cacheMode, inputSourcePaths: sourcePaths,
      requestHash: sha256(JSON.stringify({ sourcePaths, sourceUrls, instruction: arg('instruction') ?? benchmarkAttempt?.instruction, duration: arg('duration') ?? benchmarkAttempt?.targetDurationSec })),
      ...(benchmarkAttemptId ? { benchmarkAttemptId } : {}), modelIds: [],
    };
  }
  if (activeRunFailureContext) activeRunFailureContext.benchmark = benchmarkAttempt;
  const env = await loadOpenRouterEnv();
  const plannerModel = arg('planner') ?? env.sceneModel;
  const contentModel = arg('content') ?? env.contentModel;
  const calibration = await loadAlignmentCalibration();
  const promptArm = (arg('prompt-arm') ?? 'zero') as PromptArm;
  const exampleOrder = (arg('example-order') ?? 'ranked') as ExampleOrder;
  const planDespiteAlignmentFailure = hasFlag(args, 'plan-despite-alignment-failure');
  const diagnosticCaptionlessVideo = hasFlag(args, 'diagnostic-video-with-invalid-captions');
  const allowPartialVideo = hasFlag(args, 'allow-partial-video');
  const scenePlanner = scenePlannerById(arg('scene-planner')).id;
  if (activeRunFailureContext) {
    activeRunFailureContext.settingsHash = sha256(JSON.stringify({ contentModel, plannerModel, cacheMode }));
    activeRunFailureContext.modelIds = [contentModel, plannerModel];
  }
  const sharedStageCache = arg('stage-cache') ? path.resolve(arg('stage-cache')!) : undefined;
  if (!['zero', 'text', 'mechanism', 'diverse'].includes(promptArm)) throw new Error(`unknown E5 prompt arm: ${promptArm}`);
  if (!['ranked', 'reverse'].includes(exampleOrder)) throw new Error(`unknown E5 example order: ${exampleOrder}`);
  if (promptArm === 'zero' && exampleOrder !== 'ranked') throw new Error('--example-order=reverse requires --prompt-arm=text|mechanism|diverse');

  const which = arg('lesson');
  const lessons = which === 'all' ? MATH_LESSONS : which ? MATH_LESSONS.filter((l) => l.id === which) : [];
  const sourceArtifacts = new Map<string, Array<{ key: string; contentHash: string; cacheHit: boolean }>>();
  const sourceStageRuns = new Map<string, StageRunRecord[]>();
  const lessonExecutionStartedAt = new Map<string, number>();
  const lessonExecutionStartedMonotonic = new Map<string, number>();
  if (sourcePaths.length || sourceUrls.length) {
    if (activeRunFailureContext) activeRunFailureContext.stage = 'cli-validation';
    const requestedDurationSec = Number(arg('duration') ?? benchmarkAttempt?.targetDurationSec ?? 60);
    if (!isSupportedLessonDuration(requestedDurationSec)) throw new Error('--duration must be a whole number of seconds between 60 and 3600');
    const id = sourceId;
    if (benchmarkAttempt) {
      if (sourcePaths.length !== 1 || sourceUrls.length !== 0) throw new Error('a frozen development trial requires exactly its one local source file');
      if (id !== benchmarkAttempt.topicId) throw new Error(`development trial ID must be ${benchmarkAttempt.topicId}`);
      if (requestedDurationSec !== benchmarkAttempt.targetDurationSec) throw new Error(`development trial duration must be ${benchmarkAttempt.targetDurationSec} seconds`);
      if (arg('instruction') !== undefined && arg('instruction') !== benchmarkAttempt.instruction) throw new Error('development trial instruction differs from the frozen prompt');
      if (cacheMode !== 'cold') throw new Error('development trials must use cold cache mode');
      if (realpathSync(sourcePaths[0]!) !== realpathSync(path.join(process.cwd(), benchmarkAttempt.sourcePath))) throw new Error('development trial source path differs from the frozen benchmark source');
    }
    const allocatedSourceRun = preallocatedRuns.get(id)!;
    lessonExecutionStartedAt.set(id, allocatedSourceRun.startedAtMs);
    lessonExecutionStartedMonotonic.set(id, allocatedSourceRun.startedMonotonicMs);
    if (activeRunFailureContext) {
      activeRunFailureContext.stage = 'S1-source-intake';
      activeRunFailureContext.requestHash = sha256(JSON.stringify({ sourcePaths, sourceUrls, instruction: arg('instruction') ?? benchmarkAttempt?.instruction, requestedDurationSec }));
    }
      const pathEntries = await Promise.all(sourcePaths.map(async (sourcePath) => {
        const bytes = await readFile(sourcePath);
        const actualSourceSha256 = sha256(bytes);
        if (activeRunFailureContext) {
          activeRunFailureContext.inputSourceSha256 ??= {};
          activeRunFailureContext.inputSourceSha256[sourcePath] = actualSourceSha256;
        }
        if (benchmarkAttempt && sourcePath === sourcePaths[0] && actualSourceSha256 !== benchmarkAttempt.sourceSha256) {
          throw new Error(`frozen development source changed after trial validation: expected ${benchmarkAttempt.sourceSha256}, got ${actualSourceSha256}`);
        }
        const store = new ContentAddressedArtifactStore(sharedStageCache ?? path.join(outBase, id, 'stage-cache'), cacheMode);
        const startedAtMs = Date.now();
        // The chosen reader and its version are part of the key: switching
        // HYPOTHESIS_PDF_EXTRACTOR never replays another reader's text.
        const intakePlan = await planSourceIntake({ bytes, name: sourcePath });
        const stage = await store.run('S1-source-intake', { name: path.basename(sourcePath), bytesSha256: sha256(bytes), extractor: `${intakePlan.extractor.id}@${intakePlan.extractor.version}` }, { schemaVersion: 'source-doc/v2', stageVersion: 'source-intake-6-pluggable', promptVersion: 'none' }, () => loadSourceDocFromBytes({ bytes, name: sourcePath }, intakePlan));
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
    const instruction = arg('instruction') ?? benchmarkAttempt?.instruction;
    const { sourceDoc, sourceBundle } = buildSourceBundle(docs, instruction ?? docs.map((doc) => doc.title ?? '').join(' '), { topK: evidenceHitBudget(requestedDurationSec) });
    lessons.push({ id, title: sourceDoc.title ?? 'lesson', source: sourceDoc.text, sourceDoc, sourceBundle, sources: [...sourcePaths.map((sourcePath) => ({ kind: 'document' as const, path: sourcePath })), ...sourceUrls.map((url) => ({ kind: 'url' as const, url }))], sourceFormat: sourceDoc.format, targetDurationSec: requestedDurationSec, instruction, expect: { level: 'one-step', minStepScenes: 0 } });
    if (activeRunFailureContext) activeRunFailureContext.requestHash = sha256(JSON.stringify(lessons[lessons.length - 1]));
  }
  if (lessons.length === 0) throw new Error('nothing to run: pass --lesson=<id>|all or --source=<file>');

  const summary: Array<Record<string, unknown>> = [];
  for (const lesson of lessons) {
    const allocated = preallocatedRuns.get(lesson.id);
    const executionStartedAtMs = allocated?.startedAtMs ?? lessonExecutionStartedAt.get(lesson.id) ?? Date.now();
    const executionStartedMonotonicMs = allocated?.startedMonotonicMs ?? lessonExecutionStartedMonotonic.get(lesson.id) ?? performance.now();
    lessonExecutionStartedAt.set(lesson.id, executionStartedAtMs);
    const runId = allocated?.runId ?? `${new Date(executionStartedAtMs).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const outputDir = allocated?.outputDir ?? path.join(outBase, lesson.id, 'runs', runId);
    await mkdir(outputDir, { recursive: true });
    activeRunFailureContext = {
      runId,
      caseId: lesson.id,
      outputDir,
      startedAtMs: executionStartedAtMs,
      stage: 'prepare',
      sourceFiles: ['lesson-prep.json', ...(lesson.sourceBundle ? ['source-bundle.json'] : [])],
      cacheMode, inputSourcePaths: sourcePaths,
      requestHash: sha256(JSON.stringify(lesson)),
      settingsHash: sha256(JSON.stringify({ contentModel, plannerModel, cacheMode })),
      ...(benchmarkAttemptId ? { benchmarkAttemptId } : {}),
      ...(benchmarkAttempt ? { benchmark: benchmarkAttempt } : {}),
      modelIds: [contentModel, plannerModel],
    };
    const requestedBudgetUsd = lessonCostCapUsd(lesson.targetDurationSec);
    const budgetLedger = new PersistentBudgetLedger(path.join(outputDir, 'budget-ledger.json'), requestedBudgetUsd);
    // Every model call of this run keeps its raw output, errors, patches and replay fixture under <run>/structured/.
    const callRecorder = new FileCallRecorder(outputDir);
    setAmbientCallRecorder(callRecorder);
    const artifactStore = new ContentAddressedArtifactStore(sharedStageCache ?? path.join(outBase, lesson.id, 'stage-cache'), cacheMode);
    console.log(`\n=== ${lesson.id} (content: ${contentModel}, planner: ${plannerModel}) ===`);
    const ragStartedAtMs = Date.now();
    const ragOutcome = lesson.sourceBundle && lesson.sourceDoc
      ? await indexSourceBundleWithRag({ sourceDoc: lesson.sourceDoc, sourceBundle: lesson.sourceBundle, query: lesson.instruction ?? lesson.title, workingDir: path.join(outBase, lesson.id, 'rag-index', lesson.sourceBundle.bundleId), ledger: budgetLedger, remainingBudgetUsd: Math.max(0, requestedBudgetUsd - (await budgetLedger.snapshot()).spentUsd), providerEnv: env.ragSidecarEnv })
      : undefined;
    const prepared = await prepareLesson(lesson, { model: contentModel, stageModels: argValue(args, 'content') ? {} : env.stageModels, apiKey: env.apiKey, budgetUsd: requestedBudgetUsd, budgetLedger, artifactStore, ...(env.visionModel ? { visionModel: env.visionModel } : {}), speechLanguage: language, alignmentCalibrationMedianErrorMs: calibration.status === 'measured' ? calibration.medianAbsoluteBoundaryErrorMs! : undefined, beats: FEATURE_FLAGS.enabled.TEACHING_BEATS_V2 });
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
      try {
        await writeFile(path.join(outputDir, 'evaluation-bundle.json'), `${JSON.stringify(failedEvaluationEnvelope({ runId, caseId: lesson.id, code: 'preparation-hard-failure', stage: 'prepare', message: prepFailures.map(({ stage, code }) => `${stage}/${code}`).join(', ') || 'preparation did not produce a script', stageRuns: prepared.stageRuns }), null, 2)}\n`, { flag: 'wx' });
      } catch { /* diagnosis summary below still lands */ }
      try {
        await writeFailureLessonLock({ runId, outputDir, sourceFiles: ['lesson-prep.json', ...(lesson.sourceBundle ? ['source-bundle.json'] : [])], inputs: { requestHash: sha256(JSON.stringify(lesson)), settingsHash: sha256(JSON.stringify({ contentModel, plannerModel, cacheMode })) }, execution: { cacheMode }, modelIds: [contentModel, plannerModel], failure: prepFailures.map(({ code, stage, message }) => ({ code, stage, message })) });
      } catch (error) { console.error(`  [LOCK FAILED] ${error instanceof Error ? error.message : String(error)}`); }
      try {
        await writeFailedRunManifest(activeRunFailureContext!, { stage: 'prepare', code: 'preparation-hard-failure', message: prepFailures.map(({ stage, code }) => `${stage}/${code}`).join(', ') || 'preparation did not produce a script' });
      } catch (error) { console.error(`  [MANIFEST FAILED] ${error instanceof Error ? error.message : String(error)}`); }
      summary.push({ lesson: lesson.id, runId, outputDir, stage: 'prepare', status: 'failed', planDespiteAlignmentFailure, failures: prepFailures.length, hardFailures: prepFailures.length, failureDetails: prepFailures.map(({ code, stage, message }) => ({ code, stage, message })), metrics: {}, costUsd: prepared.usage.costUsd + (ragOutcome?.estimatedCostUsd ?? 0), estimatedRagCostUsd: ragOutcome?.estimatedCostUsd ?? 0, requestedDurationSec: lesson.targetDurationSec, plannedDurationSec: prepared.plannedDurationSec ?? null, coverageReason: prepared.coverageReason ?? null, startedAt: new Date(executionStartedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), wallMs: completedAtMs - executionStartedAtMs, preparationMs: completedAtMs - pipelineStartedAtMs, stageRuns: prepared.stageRuns });
      activeRunFailureContext = undefined;
      continue;
    }
    for (const f of prepFailures) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
    if (FEATURE_FLAGS.enabled.BOARD_OPS_V2) {
      // Teaching Compiler V2: beats -> real audio -> board operations -> persistent board -> frames. No V1 board planner.
      const v2 = await runLessonV2({ lessonId: lesson.id, outputDir, prepared, plannerModel, apiKey: env.apiKey, budgetLedger, artifactStore, language, requestStartedAtMs: executionStartedAtMs, requestStartedMonotonicMs: executionStartedMonotonicMs, ...(calibration.status === 'measured' ? { calibrationMedianErrorMs: calibration.medianAbsoluteBoundaryErrorMs! } : {}), remainingBudgetUsd: Math.max(0.01, requestedBudgetUsd - (await budgetLedger.snapshot()).spentUsd) });
      const v2Hard = v2.failures.filter((f) => f.hard);
      const v2CompletedAtMs = Date.now();
      await writeFile(path.join(outputDir, 'scorecard.json'), `${JSON.stringify(buildScorecard({ compilerVersion: TEACHING_COMPILER_VERSION, reports: [...callRecorder.reports()], coverageMetrics: v2.metrics }), null, 2)}\n`, 'utf8');
      await writeV2RunArtifacts({ outputDir, runId, caseId: lesson.id, startedAtMs: executionStartedAtMs, completedAtMs: v2CompletedAtMs, cacheMode, plannerModel, language, result: v2, prepared, estimatedRagCostUsd: ragOutcome?.estimatedCostUsd ?? 0 });
      console.log(`status=${v2.status} scenes=${v2.scenes}/${v2.planned} hard=${v2Hard.length} ops=${v2.metrics['v2.ops'] ?? 0} stateChanging=${v2.metrics['v2.stateChangingOps'] ?? 0} late=${v2.metrics['v2.lateOps'] ?? 0} cost=$${(prepared.usage.costUsd + v2.usage.costUsd).toFixed(4)} wall=${Math.round((v2CompletedAtMs - executionStartedAtMs) / 1000)}s video=${v2.videoPath ?? 'none'} encodedDuration=${(v2.durationMs / 1000).toFixed(3)}s`);
      for (const f of v2Hard) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
      summary.push({ lesson: lesson.id, runId, outputDir, status: v2.status, scenes: v2.scenes, planned: v2.planned, compiler: 'v2', hardFailures: v2Hard.length, failureDetails: v2Hard.map(({ code, stage, message }) => ({ code, stage, message })), metrics: v2.metrics, costUsd: prepared.usage.costUsd + v2.usage.costUsd, video: v2.videoPath ?? null, durationMs: v2.durationMs, startedAt: new Date(executionStartedAtMs).toISOString(), completedAt: new Date(v2CompletedAtMs).toISOString(), wallMs: v2CompletedAtMs - executionStartedAtMs });
      activeRunFailureContext = undefined;
      continue;
    }
    const options: HypothesisRunOptions = {
      mode: 'live',
      outputDir,
      narrationModel: contentModel,
      visualModel: plannerModel,
      ...(env.visionModel ? { visionModel: env.visionModel } : {}),
      voice: { provider: 'voice-engine', language: 'en', speed: 1 },
      alignment: { provider: 'stable-ts', ...(calibration.status === 'measured' ? { calibrationMedianErrorMs: calibration.medianAbsoluteBoundaryErrorMs! } : {}) },
      render: { width: 1920, height: 1080, fps: 30 },
      maxRepairs: 1,
      cache: cacheMode,
      maxCostUsd: Math.max(0.001, lessonCostCapUsd(prepared.plannedDurationSec ?? lesson.targetDurationSec) - (await budgetLedger.snapshot()).spentUsd),
      ...(diagnosticCaptionlessVideo ? { diagnosticCaptionlessVideo: true } : {}),
      ...(allowPartialVideo ? { allowPartialVideo: true } : {}),
    };
    try {
      if (activeRunFailureContext) activeRunFailureContext.stage = 'pipeline';
      const result = await runHypothesisLive({ ...lessonToLiveInput(lesson.id, prepared), ...(benchmarkAttempt ? { benchmark: {
        setId: benchmarkAttempt.setId,
        attemptId: benchmarkAttempt.attemptId,
        topicId: benchmarkAttempt.topicId,
        trial: benchmarkAttempt.trial,
        sourcePath: benchmarkAttempt.sourcePath,
        sourceSha256: benchmarkAttempt.sourceSha256,
        instructionSha256: benchmarkAttempt.instructionSha256,
      } } : {}) }, options, { openRouterApiKey: env.apiKey, plannerModel, budgetLedger, artifactStore, promptArm, exampleOrder, planDespiteAlignmentFailure, scenePlanner, executionTiming: { startedAtMs: executionStartedAtMs, pipelineStartedAtMs } });
      const hard = result.failures.filter((f) => f.hard);
      // Scorecard (V2 plan §5/§6): measured values and blockers only; unmeasured conditions are listed, never passed.
      await writeFile(path.join(outputDir, 'scorecard.json'), `${JSON.stringify(buildScorecard({ compilerVersion: TEACHING_COMPILER_VERSION, reports: callRecorder.reports(), coverageMetrics: result.evaluationBundle.metrics }), null, 2)}\n`, 'utf8');
      const cost = prepared.usage.costUsd + result.evaluationBundle.usage.costUsd + (ragOutcome?.estimatedCostUsd ?? 0);
      const completedAtMs = Date.now();
      console.log(`status=${result.status} scenes=${result.scenes.length}/${prepared.plan!.sections.length} hard=${hard.length} fallbacks=${result.evaluationBundle.usage.fallbacks} cost=$${cost.toFixed(4)} wall=${((completedAtMs - executionStartedAtMs) / 1000).toFixed(0)}s video=${result.videoPath ?? 'NONE'} encodedDuration=${result.encodedVideoDurationMs === undefined ? 'UNKNOWN' : `${(result.encodedVideoDurationMs / 1000).toFixed(3)}s`}`);
      for (const f of hard) console.error(`  [HARD] ${f.stage}/${f.code}: ${f.message}`);
      const ledger = await budgetLedger.snapshot();
      summary.push({ lesson: lesson.id, runId, outputDir, promptArm, exampleOrder, planDespiteAlignmentFailure, status: result.status, scenes: result.scenes.length, planned: prepared.plan!.sections.length, requestedDurationSec: prepared.requestedDurationSec ?? lesson.targetDurationSec, plannedDurationSec: prepared.plannedDurationSec ?? prepared.plan!.targetDurationSec, coverageReason: prepared.coverageReason ?? 'Full requested duration supported by source evidence.', modules: prepared.modules?.map(({ moduleId, title, goal, budgetSec, requestedBudgetSec, actualAudioDurationMs, plan }) => ({ id: moduleId, title, goal, budgetSec, requestedBudgetSec, actualAudioDurationMs, audioBudgetDeltaMs: actualAudioDurationMs === undefined ? null : actualAudioDurationMs - budgetSec * 1000, scenes: plan.sections.length })), actualNarratedDurationSec: Number(result.evaluationBundle.metrics.realNarratedMs ?? result.alignedAudio.durationMs) / 1000, finalVideoDurationSec: result.encodedVideoDurationMs === undefined ? null : result.encodedVideoDurationMs / 1000, durationBudgetDeltaMs: result.evaluationBundle.metrics.durationBudgetDeltaMs ?? null, hardFailures: hard.length, failureDetails: hard.map(({ code, stage, message }) => ({ code, stage, message })), metrics: result.evaluationBundle.metrics, fallbacks: result.evaluationBundle.usage.fallbacks, cacheHits: prepared.cacheHits.length + result.evaluationBundle.usage.cacheHits, cachedPreparationStages: prepared.cacheHits, costUsd: cost, ledgerSpentUsd: ledger.spentUsd, ledgerCalls: ledger.calls, budgetUsd: ledger.budgetUsd, prepCostUsd: prepared.usage.costUsd, plannerCostUsd: result.evaluationBundle.usage.costUsd, sceneApiCostUsd: result.evaluationBundle.metrics['cost.sceneApiUsd'] ?? 0, startedAt: new Date(executionStartedAtMs).toISOString(), pipelineStartedAt: new Date(pipelineStartedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), wallMs: completedAtMs - executionStartedAtMs, preparationMs: pipelineStartedAtMs - executionStartedAtMs, pipelineMs: completedAtMs - pipelineStartedAtMs, firstPlayableSceneMs: result.evaluationBundle.metrics['timing.firstPlayableSceneMs'] ?? null, durationMs: result.alignedAudio.durationMs, encodedVideoDurationMs: result.encodedVideoDurationMs ?? null, video: result.videoPath ?? null, stageRuns: result.evaluationBundle.stageRuns, gateRecords: result.evaluationBundle.gateRecords, rungs: Object.fromEntries(Object.entries(result.evaluationBundle.metrics).filter(([k]) => k.startsWith('rung'))) });
    } catch (error) {
      console.error(`  [LESSON FAILED] ${lesson.id}: ${error instanceof Error ? error.message : String(error)}`);
      const completedAtMs = Date.now();
      // A crashed run must still leave a bundle: diagnosis tooling reads
      // evaluation-bundle.json uniformly, and a missing file hides crashes.
      try {
        await writeFile(path.join(outputDir, 'evaluation-bundle.json'), `${JSON.stringify(failedEvaluationEnvelope({ runId, caseId: lesson.id, code: 'run-crashed', stage: 'pipeline', message: error instanceof Error ? error.message : String(error), stageRuns: prepared.stageRuns ?? [] }), null, 2)}\n`, { flag: 'wx' });
      } catch { /* outputDir itself may be the casualty; summary below still lands */ }
      try {
        await writeFailureLessonLock({ runId, outputDir, sourceFiles: ['lesson-prep.json', ...(lesson.sourceBundle ? ['source-bundle.json'] : [])], inputs: { requestHash: sha256(JSON.stringify(lesson)), settingsHash: sha256(JSON.stringify({ contentModel, plannerModel, cacheMode })) }, execution: { cacheMode }, modelIds: [contentModel, plannerModel], failure: [{ code: 'run-crashed', stage: 'pipeline', message: error instanceof Error ? error.message : String(error) }] });
      } catch { /* a verified render lock may already exist; preserve it */ }
      try {
        await writeFailedRunManifest(activeRunFailureContext!, { stage: 'pipeline', code: 'run-crashed', message: error instanceof Error ? error.message : String(error) });
      } catch (manifestError) {
        if ((manifestError as NodeJS.ErrnoException).code !== 'EEXIST') console.error(`  [MANIFEST FAILED] ${manifestError instanceof Error ? manifestError.message : String(manifestError)}`);
      }
      summary.push({ lesson: lesson.id, runId, outputDir, status: 'failed', metrics: {}, planDespiteAlignmentFailure, startedAt: new Date(executionStartedAtMs).toISOString(), completedAt: new Date(completedAtMs).toISOString(), wallMs: completedAtMs - executionStartedAtMs, error: error instanceof Error ? error.message : String(error) });
    }
    activeRunFailureContext = undefined;
  }
  const summaryPath = path.join(outBase, `summary-${plannerModel.replace(/\W+/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
  const temporarySummaryPath = `${summaryPath}.tmp`;
  await writeFile(temporarySummaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  await rename(temporarySummaryPath, summaryPath);
  // Keep the summary for diagnosis, but let callers distinguish a failed
  // source-to-video run from a successfully produced draft.
  if (summary.some((entry) => entry.status === 'failed')) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  const context = activeRunFailureContext;
  if (context) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await writeFile(path.join(context.outputDir, 'evaluation-bundle.json'), `${JSON.stringify(failedEvaluationEnvelope({ runId: context.runId, caseId: context.caseId, code: 'run-preparation-threw', stage: context.stage, message }), null, 2)}\n`, { flag: 'wx' });
    } catch { /* preserve any more specific diagnosis already written */ }
    try {
      if (context.requestHash && context.settingsHash) await writeFailureLessonLock({ runId: context.runId, outputDir: context.outputDir, sourceFiles: context.sourceFiles, inputs: { requestHash: context.requestHash, settingsHash: context.settingsHash }, execution: { cacheMode: context.cacheMode }, modelIds: context.modelIds, failure: [{ stage: context.stage, code: 'run-preparation-threw', message }] });
    } catch (lockError) {
      console.error(`  [LOCK FAILED] ${lockError instanceof Error ? lockError.message : String(lockError)}`);
    }
    try {
      await writeFailedRunManifest(context, { stage: context.stage, code: 'run-preparation-threw', message });
    } catch (manifestError) {
      if ((manifestError as NodeJS.ErrnoException).code !== 'EEXIST') console.error(`  [MANIFEST FAILED] ${manifestError instanceof Error ? manifestError.message : String(manifestError)}`);
    }
  }
  process.exitCode = 1;
}).finally(closeSpeechWorkers);

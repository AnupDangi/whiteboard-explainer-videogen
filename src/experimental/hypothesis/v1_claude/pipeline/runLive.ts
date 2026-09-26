import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AlignedAudio, AlignedWord, LaidOutScene, NarrationScript, ResolvedScene, SceneSpec, StageFailure, Timeline } from '../types.js';
import { EXPERIMENT, assertCommonRunOptions, type EvaluationBundle, type GateRunRecord, type GoldenCase, type HypothesisRunOptions, type RunClass, type RunFailure, type RunStatus, type RunUsage, type StageRunRecord } from '../../shared/contracts.js';
import { deriveRunStatus, deterministicGates } from '../../shared/evaluation.js';
import { sha256, stableJson, writeJsonArtifact } from '../../shared/artifacts.js';
import { goldenById } from '../../shared/fixtures.js';
import { svgDocument } from '../../shared/svg.js';
import { synthesizeAndAlign } from '../../shared/alignment/align.js';
import { buildNarrationScene } from '../narration/markers.js';
import { resolveMentions } from '../narration/resolveMentions.js';
import { alignedWordTimingProblems } from '../narration/align.js';
import { resolveScene } from '../resolveScene.js';
import { catalogVersion } from '../catalog/registry.js';
import { collectPins, iconPinKey, type IconPin } from '../catalog/iconPins.js';
import { EMBEDDING_MODEL, rankConcepts } from '../catalog/semantic.js';
import { QueryEmbeddingCache } from '../catalog/queryEmbeddingCache.js';
import { layoutScene } from '../layout/solver.js';
import { compileTimelineFull } from '../timeline/compile.js';
import { renderSVG } from '../render/renderScene.js';
import { runClaudeGates, toNeutralElements, toNeutralEvents } from '../validation/gates.js';
import { BOARD_PROMPT_VERSION, BOARD_SCHEMA_VERSION, buildBoardPrompt, planBoardScene, skipBoardAfterAlignmentFailure } from '../planner/board.js';
import { planScene, plannerProblems, shouldSkipPaidPlanning, skipPlanAfterAlignmentFailure, type PlanSceneResult, type PlannerCallUsage } from '../planner/plan.js';
import { buildPlannerSceneInput } from '../planner/sceneInput.js';
import { safeParseSceneSpec } from '../schema.js';
import type { PlannerSceneInput, PlannerTeachingContext } from '../planner/prompt.js';
import { VISUAL_STAGE_VERSIONS } from './versions.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { concatSceneAudio } from '../export/audioStitch.js';
import { encodeVideoAtomically, rasterizePng, type VideoScene } from '../export/videoEncode.js';
import { attributionForSources, loadCatalogLibraries } from '../catalog/streamline.js';
import { buildWebVtt } from '../export/captions.js';
import { resolveSourceEvidence, type SourceDoc } from '../plan/sourceDoc.js';
import { budgetLedgerAccountingProblems, type PersistentBudgetLedger } from './budgetLedger.js';
import { ContentAddressedArtifactStore } from '../artifactCache.js';
import type { LessonBible, SceneContract } from '../plan/schemas.js';
import { CANDIDATE_FEASIBILITY_VERSION, compileScenePlanningContext, SCENE_PROMPT_VERSION, SCENE_SKILL_VERSION, type ExampleOrder } from '../planner/context.js';
import { EXAMPLE_BANK_VERSION, EXAMPLE_RANK_VERSION, type PromptArm } from '../planner/exemplars.js';
import { EXAMPLE_BANK_HASH } from '../planner/exemplars.js';
import { buildScenePlannerPrompt } from '../planner/prompt.js';
import { SCENE_DIRECTOR_SKILL_HASH } from '../planner/sceneDirectorSkill.js';
import { promptExperimentEligibilityProblems } from '../harness/promptExperimentEligibility.js';

/**
 * Live-mode pipeline (per claude_pipeline.md §1/§2): source-generated lessons
 * use real local TTS and forced alignment for S5, the Scene Planner LLM for S6,
 * and @resvg/resvg-js + ffmpeg for S11 MP4 export. Separate fixture inputs may
 * exercise renderer plumbing, but are classified as renderer-fixture and are
 * ineligible for generated-quality evaluation. pipeline/run.ts remains the
 * offline renderer-fixture runner.
 */

const SCENE_GAP_MS = 200; // mirrors narration/align.ts's fixture-mode convention

export interface LiveSceneInput {
  sceneId: string;
  sectionId?: string;
  /** Raw scripted text WITH `[[id|phrase]]` markers (S4 output) — spoken verbatim to the TTS engine once markers are stripped. */
  raw: string;
  teachingContext?: PlannerTeachingContext;
  sceneContract?: SceneContract;
  lessonBible?: LessonBible;
  /** Hand-authored SceneSpec (renderer-first proof, claude_pipeline.md §17): skips the S6 call; still validated. */
  spec?: SceneSpec;
}

export interface HypothesisLiveInput {
  caseId: string;
  scenes: LiveSceneInput[];
  runClass?: RunClass;
  sourceDoc?: SourceDoc;
  /** Nominal clip length; real narration shorter than this is padded with silence on the last scene. Defaults to the 30 s golden length. */
  targetDurationMs?: number;
  /** S1-S4 execution ledger from lesson preparation. */
  stageRuns?: StageRunRecord[];
}

export interface LiveScenePipelineResult {
  sceneId: string;
  spec: SceneSpec;
  resolved: ResolvedScene;
  laidOut: LaidOutScene;
  timeline: Timeline;
  finalFrameSvg: string;
  plannerUsage: PlannerCallUsage;
  plannerRawResponses: Array<{ attempt: number; model: string; content: string }>;
}

export interface HypothesisLiveRunResult {
  runId: string;
  narration: NarrationScript;
  alignedAudio: AlignedAudio;
  scenes: LiveScenePipelineResult[];
  evaluationBundle: EvaluationBundle;
  contactSheetSvg: string;
  failures: StageFailure[];
  status: RunStatus;
  audioPath: string;
  videoPath?: string;
  captionsPath?: string;
}

export interface LiveRunContext {
  openRouterApiKey: string;
  plannerModel: string;
  budgetLedger?: PersistentBudgetLedger;
  artifactStore?: ContentAddressedArtifactStore;
  /** E5 prompt arm. Zero-shot remains the default until a held-out arm passes visual review. */
  promptArm?: PromptArm;
  /** E5 order-sensitivity condition; ranked is the normal deterministic order. */
  exampleOrder?: ExampleOrder;
  /** Diagnostic only: run paid S6 even when S5 has hard failures. The S5 failures remain, so the run stays failed. */
  planDespiteAlignmentFailure?: boolean;
  /** S6 output contract. `board-v2` (default) is the enum-constrained board; `scene-spec-v1` is the legacy primitive schema kept for rollback. */
  scenePlanner?: 'board-v2' | 'scene-spec-v1';
}

/** A hand-authored spec goes through exactly the planner's validation (schema + mention ids + structure); no model call. */
function handAuthored(spec: SceneSpec, input: PlannerSceneInput): Awaited<ReturnType<typeof planScene>> {
  const usage = { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0, fallbacks: 0 };
  const parsed = safeParseSceneSpec(spec);
  const problems = parsed.success ? plannerProblems(parsed.data, input) : parsed.error.issues.map((i) => i.message);
  if (!parsed.success || problems.length) {
    return { usage, rawResponses: [], fallback: false, failures: [{ code: 'hand-authored-invalid', stage: 'planner', message: `${input.sceneId}: ${problems.join('; ')}`, hard: true }] };
  }
  return { spec: parsed.data, usage, rawResponses: [], fallback: false, failures: [] };
}

const toRunFailure = (f: StageFailure): RunFailure => ({ code: f.code, stage: f.stage, message: f.message, hard: f.hard });

/** Golden targets belong to explicit benchmark/script paths, never to source-generated input IDs. */
export function goldenForRun(input: Pick<HypothesisLiveInput, 'caseId' | 'runClass'>): GoldenCase | undefined {
  if (input.runClass === 'generated-lesson') return undefined;
  try {
    return goldenById(input.caseId);
  } catch {
    return undefined;
  }
}

export async function runHypothesisLive(input: HypothesisLiveInput, options: HypothesisRunOptions, ctx: LiveRunContext): Promise<HypothesisLiveRunResult> {
  assertCommonRunOptions(options);
  if (options.mode !== 'live') throw new Error('runHypothesisLive requires options.mode === "live"');
  if (!options.outputDir) throw new Error('runHypothesisLive requires options.outputDir (real audio/video artifacts must land on disk)');
  const promptArm = ctx.promptArm ?? 'zero';
  const exampleOrder = ctx.exampleOrder ?? 'ranked';
  const experimentProblems = promptExperimentEligibilityProblems(input, promptArm, exampleOrder);
  if (experimentProblems.length) throw new Error(`invalid E5 prompt experiment: ${experimentProblems.join('; ')}`);

  const failures: StageFailure[] = [];
  const stageRuns: StageRunRecord[] = [...(input.stageRuns ?? [])];
  const gateRecords: GateRunRecord[] = [];
  const stageArtifacts: Record<string, { key: string; contentHash: string; cacheHit: boolean }> = {};
  const outputDir = options.outputDir;
  const queryEmbeddingCache = new QueryEmbeddingCache(path.join(ctx.artifactStore?.root ?? outputDir, 'query-embeddings.json'), EMBEDDING_MODEL);
  await mkdir(outputDir, { recursive: true });
  const runStartedAtMs = Date.now();
  const startedAt = new Date(runStartedAtMs).toISOString();
  if (options.mode === 'live' && options.alignment.calibrationMedianErrorMs === undefined) {
    failures.push({ code: 'alignment-calibration-unmeasured', stage: 'align', message: 'S5 can run for diagnosis, but no reproducible word-boundary calibration is available; this run cannot pass publish gates.', hard: true });
  }
  if (input.runClass === 'generated-lesson' && !input.sourceDoc) {
    failures.push({ code: 'source-document-missing', stage: 'provenance', message: 'generated lessons require the exact SourceDoc used by concept extraction', hard: true });
  }

  const narration: NarrationScript = {
    schemaVersion: 'claude-narration-script/v1',
    scenes: input.scenes.map((s) => buildNarrationScene(s.sceneId, s.sectionId ?? s.sceneId, s.raw)),
  };

  // --- S5: real TTS (voice-engine) + real forced alignment (shared/alignment), per scene, stitched onto one master clock ---
  const sceneWords: Record<string, AlignedWord[]> = {};
  const sceneBoundsMs: Record<string, { startMs: number; endMs: number }> = {};
  const sceneAudioPaths: string[] = [];
  const alignmentCacheHits = new Set<string>();
  const alignmentStartedAtMs = Date.now();
  let cursorMs = 0;
  for (let i = 0; i < narration.scenes.length; i++) {
    const scene = narration.scenes[i];
    const alignmentInput = { text: scene.plainText, language: options.voice.language, voice: options.voice.voiceId, provider: 'auto', model: 'base', calibrationMedianErrorMs: options.alignment.calibrationMedianErrorMs };
    const align = () => synthesizeAndAlign(scene.plainText, {
      language: options.voice.language,
      voice: options.voice.voiceId,
      provider: 'auto',
      model: 'base',
    });
    let aligned: { durationMs: number; words: Array<{ word: string; startMs: number; endMs: number }>; audioPath: string };
    if (ctx.artifactStore) {
      const cached = await ctx.artifactStore.run(`S5-tts-alignment:${scene.sceneId}`, alignmentInput, { schemaVersion: 'claude-aligned-scene/v1', stageVersion: 'voice-align-2-submillisecond', modelId: 'voice-engine:auto+stable-ts:base' }, async () => {
        const generated = await align();
        return { durationMs: generated.durationMs, words: generated.words, audioBase64: (await readFile(generated.audioPath)).toString('base64') };
      });
      stageArtifacts[`S5-tts-alignment:${scene.sceneId}`] = { key: cached.key, contentHash: cached.artifact.contentHash, cacheHit: cached.cacheHit };
      if (cached.cacheHit) alignmentCacheHits.add(scene.sceneId);
      const sceneAudioDir = path.join(outputDir, 'scene-audio');
      await mkdir(sceneAudioDir, { recursive: true });
      const audioPath = path.join(sceneAudioDir, `${scene.sceneId}.wav`);
      await writeFile(audioPath, Buffer.from(cached.artifact.payload.audioBase64, 'base64'));
      aligned = { durationMs: cached.artifact.payload.durationMs, words: cached.artifact.payload.words, audioPath };
    } else aligned = await align();
    for (const problem of alignedWordTimingProblems(aligned.words.map((word) => ({ w: word.word, startMs: word.startMs, endMs: word.endMs })), aligned.durationMs)) {
      failures.push({ code: 'invalid-word-alignment', stage: 'align', message: `${scene.sceneId}: ${problem}`, hard: true });
    }
    const sceneStart = cursorMs;
    sceneWords[scene.sceneId] = aligned.words.map((w) => ({ w: w.word, startMs: sceneStart + w.startMs, endMs: sceneStart + w.endMs }));
    sceneBoundsMs[scene.sceneId] = { startMs: sceneStart, endMs: sceneStart + aligned.durationMs };
    sceneAudioPaths.push(aligned.audioPath);
    cursorMs = sceneStart + aligned.durationMs + (i < narration.scenes.length - 1 ? SCENE_GAP_MS : 0);
  }
  const totalRawMs = cursorMs;
  const targetMs = input.targetDurationMs ?? EXPERIMENT.targetDurationMs;
  const finalDurationMs = Math.max(totalRawMs, targetMs);
  const trailingPadMs = finalDurationMs - totalRawMs;
  if (trailingPadMs > 0 && narration.scenes.length > 0) {
    const lastSceneId = narration.scenes[narration.scenes.length - 1].sceneId;
    sceneBoundsMs[lastSceneId] = { ...sceneBoundsMs[lastSceneId], endMs: sceneBoundsMs[lastSceneId].endMs + trailingPadMs };
  }
  if (trailingPadMs === 0 && totalRawMs > targetMs) {
    failures.push({ code: 'av-sync-over-budget', stage: 'align', message: `real narrated audio (${totalRawMs}ms) exceeds the nominal ${targetMs}ms target — not truncated, recorded honestly`, hard: false });
  }

  const rawAudio: AlignedAudio = {
    schemaVersion: 'claude-aligned-audio/v1',
    provider: 'stable-ts',
    wavPath: '',
    durationMs: finalDurationMs,
    sceneWords,
    sceneBoundsMs,
    mentions: [],
  };
  const { mentions, failures: mentionFailures } = resolveMentions(narration, rawAudio);
  for (const mf of mentionFailures) {
    failures.push({ code: `mention-${mf.reason}`, stage: 'align', message: `${mf.sceneId}/${mf.mentionId}: "${mf.phrase}"`, hard: true });
  }

  const masterWavPath = path.join(outputDir, 'audio.wav');
  await concatSceneAudio(sceneAudioPaths, SCENE_GAP_MS, trailingPadMs, masterWavPath);
  const alignedAudio: AlignedAudio = { ...rawAudio, wavPath: masterWavPath, mentions };
  const alignmentMs = Date.now() - alignmentStartedAtMs;
  const alignmentStageFailures = failures.filter((failure) => failure.stage === 'align');
  stageRuns.push({ stage: 'S5-tts-alignment', kind: 'local', status: alignmentStageFailures.some((failure) => failure.hard) ? 'failed' : 'completed', durationMs: alignmentMs, apiCostUsd: 0, cacheHit: alignmentCacheHits.size > 0, fallbackCount: 0, usage: { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0, fallbacks: 0, cacheHits: alignmentCacheHits.size }, failures: alignmentStageFailures.map(toRunFailure) });

  // --- S6: Scene Planner (real OpenRouter call, <=1 repair, §9 fallback, cost-capped at options.maxCostUsd per clip) ---
  // A case ID/source filename must never select benchmark claims for a generated lesson.
  const golden = goldenForRun(input);

  const scenes: LiveScenePipelineResult[] = [];
  const activeCatalogVersion = catalogVersion();
  const videoScenes: VideoScene[] = [];
  const localStageMetrics = new Map<string, { durationMs: number; cacheHits: number; runs: number }>();
  const recordLocalStage = (stage: string, startedAtMs: number, cacheHit: boolean) => {
    const current = localStageMetrics.get(stage) ?? { durationMs: 0, cacheHits: 0, runs: 0 };
    current.durationMs += Date.now() - startedAtMs;
    current.cacheHits += cacheHit ? 1 : 0;
    current.runs += 1;
    localStageMetrics.set(stage, current);
  };
  let previousBoxes: Map<string, { x: number; y: number; w: number; h: number }> | undefined;
  let previousElements: PlannerSceneInput['previousElements'];
  let iconPins: Map<string, IconPin> = new Map();
  const totalUsage: RunUsage = { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0, fallbacks: 0, cacheHits: alignmentCacheHits.size };

  // Retrieval before planning (01 §3.3 item 3): top-k house-style icons per mention phrase.
  const scenePlanningStartedAtMs = Date.now();
  const mentionCandidatesStartedAtMs = Date.now();
  const mentionCandidates = await rankConcepts(narration.scenes.flatMap((s) => s.mentions.map((m) => m.phrase)), 5, queryEmbeddingCache);
  // The board planner may pick any enabled-catalog icon (one entry per name, lowest id wins); retrieval hits stay as suggestions.
  const iconCatalog = [...new Map([...loadCatalogLibraries().entries].sort((a, b) => a.id.localeCompare(b.id)).reverse().map((entry) => [entry.names[0], { id: entry.id, name: entry.names[0] }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  recordLocalStage('S7-resolve', mentionCandidatesStartedAtMs, false);
  const hardAlignmentFailureCount = failures.filter((failure) => failure.stage === 'align' && failure.hard).length;
  if (ctx.planDespiteAlignmentFailure && hardAlignmentFailureCount > 0) {
    failures.push({ code: 'planner-ran-on-uncalibrated-alignment', stage: 'planner', message: `S6 ran by explicit diagnostic opt-in despite ${hardAlignmentFailureCount} hard S5 failure(s); this run cannot publish`, hard: false });
  }

  for (const sceneInput of input.scenes) {
    if (input.runClass === 'generated-lesson' && sceneInput.spec) {
      failures.push({ code: 'fixture-spec-in-generated-lesson', stage: 'provenance', message: `${sceneInput.sceneId}: a hand-authored SceneSpec cannot be counted as a generated lesson`, hard: true });
      continue;
    }
    const narrationScene = narration.scenes.find((s) => s.sceneId === sceneInput.sceneId)!;
    const remainingBudgetUsd = Math.max(0, options.maxCostUsd - totalUsage.costUsd);
    const plannerInput: PlannerSceneInput = buildPlannerSceneInput({ sceneId: sceneInput.sceneId, narrationScene, teachingContext: sceneInput.teachingContext, mentionCandidates, previousElements, ...((ctx.scenePlanner ?? 'board-v2') === 'board-v2' ? { iconCatalog } : {}) });

    if (input.runClass === 'generated-lesson') {
      const refs = sceneInput.teachingContext?.sourceEvidenceRefs ?? [];
      const sourceRefsValid = Boolean(input.sourceDoc) && refs.length > 0 && refs.every((ref) => {
        const resolved = resolveSourceEvidence(input.sourceDoc!, ref.spanId, ref.quote);
        return Boolean(resolved && resolved.sourceId === ref.sourceId && resolved.startChar === ref.startChar && resolved.endChar === ref.endChar && resolved.startLine === ref.startLine && resolved.endLine === ref.endLine);
      });
      if (!sourceRefsValid) {
        failures.push({ code: 'source-evidence-invalid', stage: 'provenance', message: `${sceneInput.sceneId}: source references are absent or do not resolve to exact source offsets`, hard: true });
        continue;
      }
      if (!sceneInput.sceneContract || !sceneInput.lessonBible) {
        failures.push({ code: 'scene-contract-missing', stage: 'planner', message: `${sceneInput.sceneId}: generated scene lacks validated S3 contract or lesson bible`, hard: true });
        continue;
      }
      try {
        plannerInput.planningContext = compileScenePlanningContext(
          plannerInput, sceneInput.sceneContract, sceneInput.lessonBible,
          alignedAudio.mentions.filter((mention) => mention.sceneId === sceneInput.sceneId).map((mention) => ({ id: mention.mentionId, startMs: mention.startMs, endMs: mention.endMs })),
          promptArm, activeCatalogVersion, input.sourceDoc?.sourceId, input.caseId, exampleOrder,
        );
      } catch (error) {
        failures.push({ code: 'scene-context-invalid', stage: 'planner', message: error instanceof Error ? error.message : String(error), hard: true });
        continue;
      }
    }

    let planned: Awaited<ReturnType<typeof planScene>>;
    const plannerStartedAtMs = Date.now();
    let plannerCacheHit = false;
    let plannerArtifactCostUsd: number | undefined;
    const plannerSkipped = shouldSkipPaidPlanning({ hasHandAuthoredSpec: Boolean(sceneInput.spec), hardAlignmentFailureCount, planDespiteAlignmentFailure: Boolean(ctx.planDespiteAlignmentFailure) });
    const board = (ctx.scenePlanner ?? 'board-v2') === 'board-v2';
    const compiledPrompt = sceneInput.spec || plannerSkipped ? undefined : board ? buildBoardPrompt(plannerInput) : buildScenePlannerPrompt(plannerInput);
    const skip = () => (board ? skipBoardAfterAlignmentFailure : skipPlanAfterAlignmentFailure)(plannerInput, hardAlignmentFailureCount);
    const plan = (prompt: typeof compiledPrompt) => (board ? planBoardScene : planScene)(plannerInput, { model: ctx.plannerModel, apiKey: ctx.openRouterApiKey, remainingBudgetUsd, budgetLedger: ctx.budgetLedger, ...(prompt ? { compiledPrompt: prompt } : {}) });
    const promptHash = compiledPrompt ? sha256(stableJson(compiledPrompt)) : undefined;
    const promptAudit = compiledPrompt ? {
      compiledPrompt,
      promptHash,
      contextHash: plannerInput.planningContext?.contextHash,
      selectedExamples: plannerInput.planningContext?.examples.map(({ exemplar, score }, order) => ({ id: exemplar.id, order, score })) ?? [],
      versions: plannerInput.planningContext?.versions,
    } : undefined;
    if (sceneInput.spec) planned = handAuthored(sceneInput.spec, plannerInput);
    else if (ctx.artifactStore) {
      const cached = await ctx.artifactStore.run<{ result: PlanSceneResult; promptAudit?: NonNullable<typeof promptAudit> }>('S6-scene-planner', { plannerInput, promptAudit, hardAlignmentFailureCount, planDespiteAlignmentFailure: Boolean(ctx.planDespiteAlignmentFailure) }, {
        schemaVersion: board ? BOARD_SCHEMA_VERSION : 'claude-scene-spec/v1', stageVersion: board ? 'board-1' : '4', promptVersion: board ? BOARD_PROMPT_VERSION : SCENE_PROMPT_VERSION, modelId: plannerSkipped ? 'not-called-upstream-alignment-failure' : ctx.plannerModel, catalogVersion: activeCatalogVersion,
      }, async () => ({
        result: plannerSkipped ? skip() : await plan(compiledPrompt),
        ...(promptAudit ? { promptAudit } : {}),
      }));
      stageArtifacts[`S6-scene-planner:${sceneInput.sceneId}`] = { key: cached.key, contentHash: cached.artifact.contentHash, cacheHit: cached.cacheHit };
      planned = cached.artifact.payload.result;
      if (cached.cacheHit) {
        plannerCacheHit = true;
        plannerArtifactCostUsd = planned.usage.costUsd;
        totalUsage.cacheHits += 1;
        planned = { ...planned, usage: { ...planned.usage, calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0 } };
      }
    } else if (plannerSkipped) planned = skip();
    else planned = await plan(compiledPrompt);
    totalUsage.calls += planned.usage.calls;
    totalUsage.promptTokens += planned.usage.promptTokens;
    totalUsage.completionTokens += planned.usage.completionTokens;
    totalUsage.cachedTokens += planned.usage.cachedTokens;
    totalUsage.costUsd += planned.usage.costUsd;
    totalUsage.repairs += planned.usage.repairs;
    totalUsage.fallbacks += planned.usage.fallbacks;
    failures.push(...planned.failures);
    stageRuns.push({ stage: `S6-scene-planner:${sceneInput.sceneId}`, kind: plannerSkipped ? 'local' : 'provider', status: planned.failures.some((failure) => failure.hard) ? 'failed' : 'completed', durationMs: Date.now() - plannerStartedAtMs, apiCostUsd: planned.usage.costUsd, ...(plannerArtifactCostUsd !== undefined ? { artifactApiCostUsd: plannerArtifactCostUsd } : {}), cacheHit: plannerCacheHit, fallbackCount: planned.usage.fallbacks, usage: { ...planned.usage, cacheHits: plannerCacheHit ? 1 : 0 }, failures: planned.failures.map(toRunFailure) });

    await writeJsonArtifact(outputDir, `planner-log.${sceneInput.sceneId}.json`, { input: plannerInput, promptAudit, plannerSkipped, skipReason: plannerSkipped ? 'hard-s5-alignment-failure' : undefined, responses: planned.rawResponses, usage: planned.usage, failures: planned.failures, fallback: planned.fallback });

    if (!planned.spec) continue; // real, recorded planner failure for this scene.

    // A board names its icon exactly; pin it (an earlier scene's pin for the same concept still wins, for lesson-wide consistency).
    const boardIcons = (planned as { iconAssets?: Record<string, string> }).iconAssets ?? {};
    for (const element of planned.spec.elements) {
      const assetId = boardIcons[element.id];
      if (element.prim !== 'object' || !assetId) continue;
      const key = iconPinKey(element);
      if (!iconPins.has(key)) iconPins = new Map(iconPins).set(key, { assetId, rung: 2, score: 1 });
    }

    // S7 retrieval for the concepts the planner actually chose, then the pure resolve stage.
    const resolveStartedAtMs = Date.now();
    const objectConcepts = planned.spec.elements.flatMap((e) => (e.prim === 'object' ? [e.concept] : []));
    const resolutionCandidates = await rankConcepts(objectConcepts, 5, queryEmbeddingCache);
    const pinsForCache = [...iconPins.entries()].sort(([left], [right]) => left.localeCompare(right));
    const resolvedStage = ctx.artifactStore
      ? await ctx.artifactStore.run(`S7-resolve:${sceneInput.sceneId}`, { spec: planned.spec, candidates: resolutionCandidates, pins: pinsForCache }, { schemaVersion: 'claude-resolved-scene/v1', stageVersion: VISUAL_STAGE_VERSIONS.resolve, catalogVersion: activeCatalogVersion }, () => resolveScene(planned.spec!, { candidates: resolutionCandidates, pins: iconPins }))
      : undefined;
    if (resolvedStage) stageArtifacts[`S7-resolve:${sceneInput.sceneId}`] = { key: resolvedStage.key, contentHash: resolvedStage.artifact.contentHash, cacheHit: resolvedStage.cacheHit };
    if (resolvedStage?.cacheHit) totalUsage.cacheHits += 1;
    const resolved = resolvedStage?.artifact.payload ?? resolveScene(planned.spec, { candidates: resolutionCandidates, pins: iconPins });
    iconPins = collectPins(resolved, iconPins);
    const previousLayout = previousBoxes ? Object.fromEntries(previousBoxes) : undefined;
    recordLocalStage('S7-resolve', resolveStartedAtMs, Boolean(resolvedStage?.cacheHit));
    const layoutStartedAtMs = Date.now();
    const layoutStage = ctx.artifactStore
      ? await ctx.artifactStore.run(`S8-layout:${sceneInput.sceneId}`, { resolved, previousLayout, fontSha256: KALAM_FONT_SHA256 }, { schemaVersion: 'claude-laid-out-scene/v1', stageVersion: VISUAL_STAGE_VERSIONS.layout }, () => layoutScene(resolved, { previous: previousBoxes }))
      : undefined;
    if (layoutStage) stageArtifacts[`S8-layout:${sceneInput.sceneId}`] = { key: layoutStage.key, contentHash: layoutStage.artifact.contentHash, cacheHit: layoutStage.cacheHit };
    if (layoutStage?.cacheHit) totalUsage.cacheHits += 1;
    const laidOut = layoutStage?.artifact.payload ?? layoutScene(resolved, { previous: previousBoxes });
    recordLocalStage('S8-layout', layoutStartedAtMs, Boolean(layoutStage?.cacheHit));
    previousBoxes = new Map(laidOut.elements.map((e) => [e.id, e.bbox]));
    previousElements = laidOut.elements.map((e) => ({ id: e.id, prim: e.element.prim, label: e.element.label ?? (e.element.prim === 'object' ? e.element.concept : undefined), conceptIds: e.element.conceptIds }));

    const bounds = alignedAudio.sceneBoundsMs[sceneInput.sceneId] ?? { startMs: 0, endMs: finalDurationMs };
    const sceneMentions = alignedAudio.mentions.filter((m) => m.sceneId === sceneInput.sceneId);
    const timelineStartedAtMs = Date.now();
    const timelineStage = ctx.artifactStore
      ? await ctx.artifactStore.run(`S9-timeline:${sceneInput.sceneId}`, { laidOut, sceneMentions, bounds }, { schemaVersion: 'claude-timeline/v1', stageVersion: VISUAL_STAGE_VERSIONS.timeline }, () => compileTimelineFull(laidOut, sceneMentions, bounds.startMs, bounds.endMs))
      : undefined;
    if (timelineStage) stageArtifacts[`S9-timeline:${sceneInput.sceneId}`] = { key: timelineStage.key, contentHash: timelineStage.artifact.contentHash, cacheHit: timelineStage.cacheHit };
    if (timelineStage?.cacheHit) totalUsage.cacheHits += 1;
    const timeline = timelineStage?.artifact.payload ?? compileTimelineFull(laidOut, sceneMentions, bounds.startMs, bounds.endMs);
    recordLocalStage('S9-timeline', timelineStartedAtMs, Boolean(timelineStage?.cacheHit));

    const gateResult = runClaudeGates(laidOut, timeline);
    failures.push(...gateResult.failures, ...gateResult.warnings);
    gateRecords.push({ gateSet: 'claude', sceneId: sceneInput.sceneId, passed: gateResult.failures.length === 0, failures: gateResult.failures.map(toRunFailure), warnings: gateResult.warnings.map(toRunFailure) });

    const renderStartedAtMs = Date.now();
    const renderStage = ctx.artifactStore
      ? await ctx.artifactStore.run(`S10-render:${sceneInput.sceneId}`, { laidOut, timeline, frameTimeMs: bounds.endMs - 1, fontSha256: KALAM_FONT_SHA256 }, { schemaVersion: 'image/svg+xml', stageVersion: VISUAL_STAGE_VERSIONS.render }, () => renderSVG(laidOut, timeline, bounds.endMs - 1))
      : undefined;
    if (renderStage) stageArtifacts[`S10-render:${sceneInput.sceneId}`] = { key: renderStage.key, contentHash: renderStage.artifact.contentHash, cacheHit: renderStage.cacheHit };
    if (renderStage?.cacheHit) totalUsage.cacheHits += 1;
    const finalFrameSvg = renderStage?.artifact.payload ?? renderSVG(laidOut, timeline, bounds.endMs - 1);
    recordLocalStage('S10-render', renderStartedAtMs, Boolean(renderStage?.cacheHit));
    const sceneLicenses = laidOut.elements.map((e) => e.resolution?.license).filter((l): l is string => Boolean(l));
    const gateFailures = deterministicGates({ ...(golden ? { golden } : {}), elements: toNeutralElements(laidOut), timeline: toNeutralEvents(laidOut, timeline), durationMs: alignedAudio.durationMs, svg: finalFrameSvg, licenses: sceneLicenses });
    failures.push(...gateFailures.map((f) => ({ code: f.code, stage: f.stage, message: f.message, hard: f.hard })));
    gateRecords.push({ gateSet: 'shared', sceneId: sceneInput.sceneId, passed: gateFailures.length === 0, failures: gateFailures, warnings: [] });

    scenes.push({ sceneId: sceneInput.sceneId, spec: planned.spec, resolved, laidOut, timeline, finalFrameSvg, plannerUsage: planned.usage, plannerRawResponses: planned.rawResponses });
    videoScenes.push({ laidOut, timeline, startMs: bounds.startMs, endMs: bounds.endMs });
  }

  await queryEmbeddingCache.flush();

  if (ctx.budgetLedger) {
    try {
      const snapshot = await ctx.budgetLedger.snapshot();
      for (const message of budgetLedgerAccountingProblems(snapshot, stageRuns)) {
        failures.push({ code: 'budget-ledger-accounting', stage: 'budget', message, hard: true });
      }
    } catch (error) {
      failures.push({ code: 'budget-ledger-invalid', stage: 'budget', message: error instanceof Error ? error.message : String(error), hard: true });
    }
  }

  const allElements = scenes.flatMap((s) => toNeutralElements(s.laidOut));
  const allEvents = scenes.flatMap((s) => toNeutralEvents(s.laidOut, s.timeline));
  const combinedSvg = svgDocument(scenes.map((s) => s.finalFrameSvg).join(''));

  for (const [stage, metric] of localStageMetrics) {
    stageRuns.push({ stage, kind: 'local', status: 'completed', durationMs: metric.durationMs, apiCostUsd: 0, cacheHit: metric.runs > 0 && metric.cacheHits === metric.runs, fallbackCount: 0, usage: { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0, fallbacks: 0, cacheHits: metric.cacheHits }, failures: [] });
  }

  const rungCounts: Record<string, number> = {};
  for (const s of scenes) for (const e of s.laidOut.elements) if (e.resolution) rungCounts[`rung${e.resolution.rung}`] = (rungCounts[`rung${e.resolution.rung}`] ?? 0) + 1;
  const ambiguousMentions = alignedAudio.mentions.filter((m) => m.ambiguous).length;

  const inputHash = sha256(stableJson({ caseId: input.caseId, scenes: input.scenes, targetDurationMs: input.targetDurationMs, runClass: input.runClass, sourceDoc: input.sourceDoc }));
  const runId = sha256(stableJson({ inputHash, options, plannerModel: ctx.plannerModel, promptArm, exampleOrder, planDespiteAlignmentFailure: Boolean(ctx.planDespiteAlignmentFailure), activeCatalogVersion, scenePromptVersion: SCENE_PROMPT_VERSION, scenePlanner: ctx.scenePlanner ?? 'board-v2', boardPromptVersion: BOARD_PROMPT_VERSION, skillVersion: SCENE_SKILL_VERSION, skillHash: SCENE_DIRECTOR_SKILL_HASH, candidateFeasibilityVersion: CANDIDATE_FEASIBILITY_VERSION, exemplarBankVersion: EXAMPLE_BANK_VERSION, exemplarBankHash: EXAMPLE_BANK_HASH, exemplarRankVersion: EXAMPLE_RANK_VERSION, visualStageVersions: VISUAL_STAGE_VERSIONS, fontSha256: KALAM_FONT_SHA256 }));
  const evaluationBundle: EvaluationBundle = {
    schemaVersion: 'evaluation-bundle/v2',
    pipeline: 'claude',
    runClass: input.runClass ?? (input.scenes.every((s) => Boolean(s.spec)) ? 'renderer-fixture' : 'hand-authored-script'),
    status: deriveRunStatus(failures.filter((f) => f.hard).length),
    caseId: input.caseId,
    runId,
    commit: 'uncommitted-worktree',
    configHash: sha256(stableJson({ options, plannerModel: ctx.plannerModel, promptArm, exampleOrder, planDespiteAlignmentFailure: Boolean(ctx.planDespiteAlignmentFailure), activeCatalogVersion, scenePromptVersion: SCENE_PROMPT_VERSION, scenePlanner: ctx.scenePlanner ?? 'board-v2', boardPromptVersion: BOARD_PROMPT_VERSION, skillVersion: SCENE_SKILL_VERSION, skillHash: SCENE_DIRECTOR_SKILL_HASH, candidateFeasibilityVersion: CANDIDATE_FEASIBILITY_VERSION, exemplarBankVersion: EXAMPLE_BANK_VERSION, exemplarBankHash: EXAMPLE_BANK_HASH, exemplarRankVersion: EXAMPLE_RANK_VERSION, plannerSchema: (ctx.scenePlanner ?? 'board-v2') === 'board-v2' ? BOARD_SCHEMA_VERSION : 'claude-scene-spec/v1', visualStageVersions: VISUAL_STAGE_VERSIONS, fontSha256: KALAM_FONT_SHA256 })),
    nativeArtifacts: {},
    claims: narration.scenes.map((s) => s.plainText),
    claimEvidence: Object.fromEntries(input.scenes.map((scene) => {
      const narrationScene = narration.scenes.find((item) => item.sceneId === scene.sceneId);
      return [scene.sceneId + ':' + sha256(narrationScene?.plainText ?? ''), scene.teachingContext?.sourceEvidenceRefs ?? []];
    })),
    visualEvidence: Object.fromEntries(scenes.flatMap((scene) => [
      [scene.sceneId + ':title', scene.spec.titleEvidenceRefs ?? []] as const,
      ...scene.spec.elements.map((element) => [scene.sceneId + ':' + element.id, element.evidenceRefs ?? []] as const),
      ...scene.spec.edges.map((edge, index) => [scene.sceneId + ':edge:' + index, edge.evidenceRefs ?? edge.factualRelation?.evidenceRefs ?? []] as const),
    ])),
    relations: scenes.flatMap((scene) => scene.spec.edges.flatMap((edge) => edge.factualRelation ? [{
      from: edge.factualRelation.fromConceptId,
      to: edge.factualRelation.toConceptId,
      type: edge.factualRelation.type,
    }] : [])),
    elements: allElements,
    timeline: allEvents,
    provenance: Object.fromEntries(scenes.flatMap((s) => s.laidOut.elements.filter((e) => e.resolution).map((e) => [`${s.sceneId}:${e.id}`, [e.resolution!.lane, `rung${e.resolution!.rung}`, e.resolution!.source]]))),
    metrics: { ...rungCounts, ambiguousMentions, sceneCount: scenes.length, meanOccupancy: scenes.length ? scenes.reduce((sum, s) => sum + s.laidOut.occupancy, 0) / scenes.length : 0, realNarratedMs: totalRawMs, trailingPadMs, inputHash, sourceClaimEvidenceRefs: Object.values(input.scenes).reduce((count, scene) => count + (scene.teachingContext?.sourceEvidenceRefs?.length ?? 0), 0), visualEvidenceRefs: Object.values(scenes).reduce((count, scene) => count + (scene.spec.titleEvidenceRefs?.length ?? 0) + scene.spec.elements.reduce((n, element) => n + (element.evidenceRefs?.length ?? 0), 0) + scene.spec.edges.reduce((n, edge) => n + (edge.evidenceRefs?.length ?? edge.factualRelation?.evidenceRefs.length ?? 0), 0), 0), evaluationStatus: golden ? 'known-golden-duration-gated' : 'unscored-generic-input' },
    usage: totalUsage,
    failures: failures.map(toRunFailure),
    stageRuns,
    gateRecords,
  };

  const contactSheetSvg = svgDocument(
    scenes
      .map((s, i) => `<g transform="translate(${(i % 2) * 960},${Math.floor(i / 2) * 540}) scale(0.5)">${s.finalFrameSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`)
      .join(''),
  );
  const scenePlanningLayoutMs = Date.now() - scenePlanningStartedAtMs;

  // --- S11: real MP4 export (resvg PNG frames -> ffmpeg, real audio muxed in) ---
  let videoPath: string | undefined;
  const encodeStartedAtMs = Date.now();
  if (videoScenes.length > 0) {
    videoPath = path.join(outputDir, 'video.mp4');
    try {
      const produce = async () => { await encodeVideoAtomically(videoScenes, finalDurationMs, masterWavPath, videoPath!, options.render.fps); };
      if (ctx.artifactStore) {
        const artifact = await ctx.artifactStore.runFile<{ outputSha256: string; outputBytes: number }>('S11-mp4-encode', {
          scenes: videoScenes.map((scene) => ({ laidOut: scene.laidOut, timeline: scene.timeline, startMs: scene.startMs, endMs: scene.endMs })),
          durationMs: finalDurationMs, audioSha256: sha256(await readFile(masterWavPath)), fps: options.render.fps, fontSha256: KALAM_FONT_SHA256,
        }, { schemaVersion: 'video/mp4', stageVersion: 'ffmpeg-bundled-font-render-pool-file-cache-3', modelId: 'resvg+ffmpeg' }, videoPath, produce);
        stageArtifacts['S11-mp4-encode'] = { key: artifact.key, contentHash: artifact.artifact.contentHash, cacheHit: artifact.cacheHit };
        if (artifact.cacheHit) totalUsage.cacheHits += 1;
      } else await produce();
    } catch (error) {
      videoPath = undefined;
      failures.push({ code: 'encode-failed', stage: 'encode', message: error instanceof Error ? error.message : String(error), hard: true });
    }
  } else {
    failures.push({ code: 'no-scenes', stage: 'render', message: 'no scenes survived planning/validation for this case — no video produced', hard: true });
  }
  const encodeMs = Date.now() - encodeStartedAtMs;
  stageRuns.push({ stage: 'S11-mp4-encode', kind: 'local', status: videoPath ? 'completed' : 'failed', durationMs: encodeMs, apiCostUsd: 0, cacheHit: Boolean(stageArtifacts['S11-mp4-encode']?.cacheHit), fallbackCount: 0, failures: failures.filter((failure) => failure.stage === 'encode' || failure.stage === 'render').map(toRunFailure) });

  await writeJsonArtifact(outputDir, 'narration.json', narration);
  await writeJsonArtifact(outputDir, 'aligned-audio.json', alignedAudio);
  if (input.sourceDoc) await writeJsonArtifact(outputDir, 'source-doc.json', input.sourceDoc);
  let captionsPath: string | undefined;
  const captionsStartedAtMs = Date.now();
  try {
    captionsPath = path.join(outputDir, 'captions.vtt');
    let captions: string;
    if (ctx.artifactStore) {
      const stage = await ctx.artifactStore.run('S12-captions', alignedAudio, { schemaVersion: 'text/vtt', stageVersion: 'webvtt-word-clock-1' }, () => buildWebVtt(alignedAudio));
      stageArtifacts['S12-captions'] = { key: stage.key, contentHash: stage.artifact.contentHash, cacheHit: stage.cacheHit };
      if (stage.cacheHit) totalUsage.cacheHits += 1;
      captions = stage.artifact.payload;
    } else captions = buildWebVtt(alignedAudio);
    await writeFile(captionsPath, captions, 'utf8');
    evaluationBundle.nativeArtifacts.captions = 'captions.vtt';
  } catch (error) {
    captionsPath = undefined;
    failures.push({ code: 'captions-failed', stage: 'encode', message: error instanceof Error ? error.message : String(error), hard: true });
  }
  const captionsMs = Date.now() - captionsStartedAtMs;
  stageRuns.push({ stage: 'S12-captions', kind: 'local', status: captionsPath ? 'completed' : 'failed', durationMs: captionsMs, apiCostUsd: 0, cacheHit: Boolean(stageArtifacts['S12-captions']?.cacheHit), fallbackCount: 0, failures: failures.filter((failure) => failure.code === 'captions-failed').map(toRunFailure) });
  for (const s of scenes) {
    await writeJsonArtifact(outputDir, `scene-spec.${s.sceneId}.json`, s.spec);
    await writeJsonArtifact(outputDir, `resolved-scene.${s.sceneId}.json`, s.resolved);
    await writeJsonArtifact(outputDir, `layout.${s.sceneId}.json`, s.laidOut);
    await writeJsonArtifact(outputDir, `timeline.${s.sceneId}.json`, s.timeline);
  }
  evaluationBundle.failures = failures.map(toRunFailure); // re-sync after S11/S10 artifact results
  evaluationBundle.status = deriveRunStatus(failures.filter((f) => f.hard).length);
  gateRecords.push({ gateSet: 'publish', passed: evaluationBundle.status === 'passed', failures: failures.filter((failure) => failure.hard).map(toRunFailure), warnings: failures.filter((failure) => !failure.hard).map(toRunFailure) });
  await writeFile(path.join(outputDir, 'final-scene.svg'), combinedSvg, 'utf8');
  await writeFile(path.join(outputDir, 'contact-sheet.svg'), contactSheetSvg, 'utf8');
  let contactSheetPngPath: string | undefined;
  try {
    contactSheetPngPath = path.join(outputDir, 'contact-sheet.png');
    await writeFile(contactSheetPngPath, rasterizePng(contactSheetSvg, EXPERIMENT.width));
  } catch (error) {
    contactSheetPngPath = undefined;
    failures.push({ code: 'contact-sheet-png-failed', stage: 'encode', message: error instanceof Error ? error.message : String(error), hard: false });
  }

  // Every library that supplied an asset is credited next to the video (CC BY 4.0 and MIT notices).
  const usedSources = scenes.flatMap((sc) => sc.laidOut.elements.flatMap((e) => (e.resolution?.source ? [e.resolution.source] : [])));
  const creditLines = attributionForSources(usedSources);
  const credits = creditLines.length ? creditLines.join('\n') : undefined;
    if (credits) await writeFile(path.join(outputDir, 'attribution.txt'), `${credits}\n`, 'utf8');

  evaluationBundle.failures = failures.map(toRunFailure);
  evaluationBundle.status = deriveRunStatus(failures.filter((f) => f.hard).length);
  evaluationBundle.stageRuns = stageRuns;
  evaluationBundle.gateRecords = gateRecords;
  evaluationBundle.nativeArtifacts = {
    audio: 'audio.wav',
    ...(input.sourceDoc ? { sourceDoc: 'source-doc.json' } : {}),
    ...(videoPath ? { video: 'video.mp4' } : {}),
    ...(captionsPath ? { captions: 'captions.vtt' } : {}),
    ...(contactSheetPngPath ? { 'contact-sheet': 'contact-sheet.png' } : {}),
    ...(credits ? { attribution: 'attribution.txt' } : {}),
  };
  evaluationBundle.metrics['timing.alignmentMs'] = alignmentMs;
  evaluationBundle.metrics['timing.scenePlanningLayoutMs'] = scenePlanningLayoutMs;
  evaluationBundle.metrics['timing.encodeMs'] = encodeMs;
  evaluationBundle.metrics['timing.captionsMs'] = captionsMs;
  evaluationBundle.metrics['timing.totalPipelineMs'] = Date.now() - runStartedAtMs;
  await writeJsonArtifact(outputDir, 'evaluation-bundle.json', evaluationBundle);
  const mediaSha256 = { audio: sha256(await readFile(masterWavPath)) };
  await writeJsonArtifact(outputDir, 'run-manifest.json', {
    schemaVersion: 'hypothesis-run/v1',
    pipeline: 'claude',
    runClass: evaluationBundle.runClass,
    status: evaluationBundle.status,
    runId,
    caseId: input.caseId,
    startedAt,
    completedAt: new Date().toISOString(),
    options,
    mediaSha256,
    promptExperiment: {
      arm: promptArm,
      exampleOrder,
      planDespiteAlignmentFailure: Boolean(ctx.planDespiteAlignmentFailure),
      bankVersion: EXAMPLE_BANK_VERSION,
      bankHash: EXAMPLE_BANK_HASH,
      rankVersion: EXAMPLE_RANK_VERSION,
      catalogVersion: activeCatalogVersion,
      promptVersion: (ctx.scenePlanner ?? 'board-v2') === 'board-v2' ? BOARD_PROMPT_VERSION : SCENE_PROMPT_VERSION,
      scenePlanner: ctx.scenePlanner ?? 'board-v2',
      plannerModel: ctx.plannerModel,
    },
    stages: {
      stageArtifacts,
      cacheMode: options.cache,
      cacheRoot: ctx.artifactStore?.root ?? null,
      input: inputHash,
      ...(input.sourceDoc ? { sourceDoc: sha256(stableJson(input.sourceDoc)) } : {}),
      narration: sha256(stableJson(narration)),
      alignedAudio: sha256(stableJson({ ...alignedAudio, wavPath: 'REDACTED-PATH' })),
      ...Object.fromEntries(scenes.map((s) => [`sceneSpec:${s.sceneId}`, sha256(stableJson(s.spec))])),
      ...Object.fromEntries(scenes.map((s) => [`timeline:${s.sceneId}`, sha256(stableJson(s.timeline))])),
    },
    evaluationBundle: 'evaluation-bundle.json',
    svg: 'final-scene.svg',
    video: videoPath ? 'video.mp4' : undefined,
    contactSheet: 'contact-sheet.png',
    captions: captionsPath ? 'captions.vtt' : undefined,
    credits,
  });

  return { runId, narration, alignedAudio, scenes, evaluationBundle, contactSheetSvg, failures, status: evaluationBundle.status, audioPath: masterWavPath, videoPath, captionsPath };
}

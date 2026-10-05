import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PIPELINE } from '../run/config.js';
import { concatSceneAudio } from '../export/audioStitch.js';
import { addUsage, emptyUsage, type CallUsage, type StructuredCallReport } from '../llm/structuredCall.js';
import type { ModelClient } from '../llm/modelClient.js';
import { audioDurationProblems, synthesizeSceneAudio, type SceneAudioDeps } from '../audio/sceneAudio.js';
import type { ElevenLabsUsageEvent } from '../audio/elevenlabs.js';
import type { PreparedLesson } from '../run/lesson.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';
import type { ContentAddressedArtifactStore } from '../run/artifactCache.js';
import type { StageFailure } from '../shared/types.js';
import { certifyArtifact, type ArtifactCertification } from '../shared/artifactStatus.js';
import { beatIntervals } from '../narration/beat-narration/intervals.js';
import { alignedWordTimingProblems, tokenizeWords } from '../narration/align.js';
import { writeBeatNarration } from '../narration/beat-narration/generate.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';
import type { NarrationContext } from '../narration/beat-narration/validate.js';
import { sectionSourcePrompt } from '../plan/stages.js';
import { DEFAULT_PACING, fitPacing, revisionTargets } from './durationFit.js';
import { emptyBoardState, startScene } from '../visual-v2/board-state/reducer.js';
import type { BoardState } from '../visual-v2/board-state/types.js';
import { planSceneBoard } from '../visual-v2/ops-plan/plan.js';
import { fallbackSceneBoard } from '../visual-v2/ops-plan/fallback.js';
import { BOARD_OPS_PROMPT_VERSION } from '../visual-v2/ops-plan/prompt.js';
import type { BoardContext } from '../visual-v2/ops-plan/validate.js';
import { anchorQuote } from '../plan/evidenceAnchor.js';
import { validateSceneGeometry, type PriorLayout } from '../visual-v2/layout/sceneLayout.js';
import { compileSceneTimeline, type BeatTiming } from '../visual-v2/timeline/compile.js';
import { compileScene, type CompiledScene } from '../visual-v2/renderer/frame.js';
import { mapLimit } from './mapLimit.js';
import { publishSceneLockV2, recordSceneProgressV2, writeLessonLockV2 } from './lockV2.js';
import { encodeLockedLessonV2Clips } from './clipsV2.js';
import type { ConceptInfo } from '../visual-v2/resolver/typeGate.js';
import { depictEntity } from '../visual-v2/resolver/typeGate.js';
import { CATALOG } from '../assets/catalog.js';
import { loadCatalogLibraries } from '../assets/streamline.js';
import { loadBridge } from '../assets/bridge.js';
import { bridgeRecordForCatalogEntry, buildAssetRightsEvidence, rightsEvidenceFailure } from '../assets/rightsEvidence.js';
import { buildScorecard, type Scorecard } from '../harness/scorecard.js';
import { TEACHING_COMPILER_VERSION } from '../run/featureFlags.js';
import { createEvidenceLedgerFromClaims, validateEvidenceLedgerSources, type EvidenceLedger } from '../evidence/ledger.js';

/**
 * Teaching Compiler V2 run: locked beats and beat narration -> real audio and alignment -> board operations -> persistent board
 * state -> deterministic layout -> semantic timeline -> frames -> MP4. Board fallback is diagnostic-only and keeps the output
 * in DRAFT; it cannot promote a run to an automated or reviewed pass.
 */
export interface RunLessonV2Input {
  lessonId: string;
  outputDir: string;
  prepared: PreparedLesson;
  plannerModel: string;
  /** Optional S6-only BoardOps model; beat narration continues to use plannerModel. */
  s6PlannerModel?: string;
  apiKey: string;
  budgetLedger?: PersistentBudgetLedger;
  artifactStore?: ContentAddressedArtifactStore;
  language?: string;
  voice?: string;
  calibrationMedianErrorMs?: number;
  fps?: number;
  /** Tests: model client and aligner replacements. */
  client?: ModelClient;
  aligner?: SceneAudioDeps['aligner'];
  skipEncode?: boolean;
  /** Use the deterministic concept board for a scene whose model board cannot be validated (default on; the lesson is then a draft). Strict runs set false. */
  boardFallback?: boolean;
  /** Per-scene clip cache shared across runs (default: `<outputDir>/clips`). */
  clipCacheDir?: string;
  /** Scenes synthesised and aligned at once (default 1 until shared provider reservations have measured concurrency safety). */
  audioConcurrency?: number;
  /** Notified, in lesson order, as each scene's clip is ready (progressive playback). */
  onClipReady?: (clip: { sceneId: string; path: string; index: number }) => void;
  remainingBudgetUsd?: number;
  /** Wall-clock timestamp captured when the CLI accepted this request, before intake and S1–S4. */
  requestStartedAtMs?: number;
  /** Monotonic clock captured at the same request-acceptance boundary. */
  requestStartedMonotonicMs?: number;
  /** Provider usage is retained even when synthesis fails after a charged request. */
  onElevenLabsUsage?: (event: ElevenLabsUsageEvent) => void;
}

export interface RunLessonV2Result {
  status: 'draft' | 'failed';
  artifactCertification: ArtifactCertification;
  failures: StageFailure[];
  reports: StructuredCallReport[];
  usage: CallUsage;
  scenes: number;
  planned: number;
  videoPath?: string;
  durationMs: number;
  metrics: Record<string, number>;
  scorecard: Scorecard;
  compiled: CompiledScene[];
  speechUsage: Array<{ sceneId: string; model: string; voice: string; credits: number; cacheHit: boolean; capabilitySnapshotId?: string }>;
  providerUsageEvents: ElevenLabsUsageEvent[];
  elevenLabsCredits: number;
}

/** Each round rewrites every scene once to a word budget measured from real audio; five rounds converge or the run stops honestly. */
const MAX_DURATION_REVISIONS = 8;

const STATE_CHANGING = new Set(['move', 'remove', 'updateValue', 'transform', 'equationStep', 'strike', 'split', 'merge', 'replace', 'deemphasize', 'highlight', 'clearRegion']);

function vttTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}

export async function runLessonV2(input: RunLessonV2Input): Promise<RunLessonV2Result> {
  const { prepared, outputDir } = input;
  const startedAt = Date.now();
  const startedMonotonicMs = performance.now();
  const requestStartedMonotonicMs = input.requestStartedMonotonicMs ?? startedMonotonicMs;
  const timing: Record<string, number> = {};
  const failures: StageFailure[] = [];
  const reports: StructuredCallReport[] = [];
  const usage = emptyUsage();
  const compiled: CompiledScene[] = [];
  const speechUsage: RunLessonV2Result['speechUsage'] = [];
  const providerUsageEvents: ElevenLabsUsageEvent[] = [];
  const metrics: Record<string, number> = {};
  const finish = (status: 'draft' | 'failed', extra: Partial<RunLessonV2Result> = {}): RunLessonV2Result => {
    const finalMetrics: Record<string, number> = { ...metrics, ...timing, 'v2.totalMs': performance.now() - startedMonotonicMs, 'v2.requestToCompleteMs': performance.now() - requestStartedMonotonicMs };
    const uncertainUsage = providerUsageEvents.filter((event) => event.status === 'uncertain');
    if (uncertainUsage.length) {
      finalMetrics['v2.ttsUncertainAttempts'] = uncertainUsage.length;
      finalMetrics['v2.ttsCreditsAtRisk'] = uncertainUsage.reduce((sum, event) => sum + (event.credits ?? 0), 0);
    }
    const scorecard = buildScorecard({ compilerVersion: TEACHING_COMPILER_VERSION, reports, coverageMetrics: finalMetrics, measured: [] });
    const elevenLabsCredits = providerUsageEvents.filter((event) => event.status === 'succeeded').reduce((sum, event) => sum + (event.credits ?? 0), 0);
    const videoPath = extra.videoPath;
    const fallbackCount = Number(finalMetrics['v2.fallbackScenes'] ?? 0) + Number(finalMetrics['v2.ttsFallbackScenes'] ?? 0);
    const scorecardGate = scorecard.releaseCandidate
      ? { id: 'required-scorecard-gates', status: 'passed' as const }
      : scorecard.blockers.length
        ? { id: 'required-scorecard-gates', status: 'failed' as const, detail: scorecard.blockers.join(', ') }
        : { id: 'required-scorecard-gates', status: 'unmeasured' as const, detail: scorecard.unmeasured.join(', ') || 'required scorecard did not pass' };
    const artifactCertification = certifyArtifact({
      artifactValid: status !== 'failed' && Boolean(videoPath),
      gates: [
        { id: 'verified-playable-video', status: videoPath ? 'passed' : 'failed', ...(videoPath ? {} : { detail: 'no encoded V2 video was produced' }) },
        { id: 'no-hard-failures', status: [...(prepared.failures ?? []), ...failures].some((failure) => failure.hard) ? 'failed' : 'passed' },
        { id: 'no-fallback', status: fallbackCount === 0 ? 'passed' : 'failed', ...(fallbackCount ? { detail: `${fallbackCount} fallback scene(s) or synthesis fallback(s)` } : {}) },
        scorecardGate,
        { id: 'complete-semantic-qa-suite', status: 'unmeasured', detail: 'the full independent G1–G12 semantic QA contract is not implemented yet' },
      ],
    });
    return { status, artifactCertification, failures, reports, usage, scenes: compiled.length, planned: prepared.plan?.sections.length ?? 0, durationMs: 0, metrics: finalMetrics, scorecard, compiled, speechUsage, providerUsageEvents, elevenLabsCredits, ...extra };
  };
  const plan = prepared.plan;
  if (!plan || !prepared.beatPlans || !prepared.beatNarrations || !prepared.graph) {
    failures.push({ code: 'v2-no-beats', stage: 'v2', message: 'V2 needs a teaching plan with beat plans and beat narration (TEACHING_BEATS_V2)', hard: true });
    return finish('failed');
  }
  const graph = prepared.graph;
  const language = input.language ?? 'en';
  await mkdir(path.join(outputDir, 'v2'), { recursive: true });
  const dump = (name: string, value: unknown) => writeFile(path.join(outputDir, 'v2', name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

  let evidenceLedger: EvidenceLedger;
  try {
    const canonicalClaims = plan.sections.flatMap((section) => section.contract?.essentialClaims ?? []);
    evidenceLedger = createEvidenceLedgerFromClaims(canonicalClaims, prepared.groundingMode ?? 'STRICT_SOURCE');
    const graphEvidence = [
      ...graph.concepts.flatMap((concept) => concept.evidence),
      ...graph.relations.flatMap((relation) => relation.evidence),
    ];
    const sourceProblems = validateEvidenceLedgerSources(evidenceLedger, [prepared.sourceDoc], graphEvidence);
    if (sourceProblems.length) throw new Error(sourceProblems.join('; '));
  } catch (error) {
    failures.push({ code: 'v2-evidence-ledger-invalid', stage: 'v2', message: error instanceof Error ? error.message : String(error), hard: true });
    return finish('failed');
  }

  // 1. Real audio and alignment for each scene's speech: the master clock. Before any paid board planning the speech is fitted to
  // the requested runtime: first by bounded pacing (gaps and final hold), then, if the speech itself is too long or too short,
  // by rewriting each scene to a word budget measured from its real speaking rate (claims preserved) and re-synthesizing it.
  const requestedDurationMs = (prepared.requestedDurationSec ?? plan.targetDurationSec) * 1000;
  metrics['v2.requestedDurationMs'] = requestedDurationMs;
  const narrations: Record<string, CompiledSceneNarration> = { ...prepared.beatNarrations };
  const synthesized = new Map<string, { text: string; audio: Awaited<ReturnType<typeof synthesizeSceneAudio>> }>();
  let audioScenes: Array<{ section: (typeof plan.sections)[number]; narration: CompiledSceneNarration; audio: Awaited<ReturnType<typeof synthesizeSceneAudio>> }> = [];
  let pacing: { gapMs: number; trailingMs: number } = { gapMs: PIPELINE.sceneGapMs, trailingMs: DEFAULT_PACING.trailingMs.nominal };
  let revisionRounds = 0;
  for (;;) {
    const audios = await mapLimit(plan.sections, Math.max(1, input.audioConcurrency ?? 1), async (section) => {
      const narration = narrations[section.id]!;
      const reusable = synthesized.get(section.id);
      if (reusable && reusable.text === narration.text) return { ok: true as const, section, narration, audio: reusable.audio };
      const speechContext = prepared.beatNarrationContexts?.[section.id];
      try {
        const audio = await synthesizeSceneAudio({ sceneId: section.id, text: narration.text, language: speechContext?.language ?? language, ...(input.voice ? { voice: input.voice } : {}), ...(speechContext?.speechLanguagePolicy === 'native-plus-english-terms' ? { languagePolicy: 'native-plus-english-terms/v1' as const } : {}), ...(speechContext?.terminology?.length ? { terminology: speechContext.terminology } : {}), ...(input.calibrationMedianErrorMs !== undefined ? { calibrationMedianErrorMs: input.calibrationMedianErrorMs } : {}) }, { ...(input.artifactStore ? { artifactStore: input.artifactStore } : {}), ...(input.aligner ? { aligner: input.aligner } : {}), onElevenLabsUsage: (event) => { providerUsageEvents.push(event); input.onElevenLabsUsage?.(event); } });
        if (audio.providerMetadata) speechUsage.push({ sceneId: section.id, model: audio.providerMetadata.model, voice: audio.providerMetadata.voice, credits: audio.providerMetadata.credits, cacheHit: audio.cacheHit, ...(audio.providerMetadata.capabilitySnapshotId ? { capabilitySnapshotId: audio.providerMetadata.capabilitySnapshotId } : {}) });
        if (audio.ttsFallback) {
          metrics['v2.ttsFallbackScenes'] = (metrics['v2.ttsFallbackScenes'] ?? 0) + 1;
          if (!failures.some((failure) => failure.code === 'v2-tts-fallback-local')) failures.push({ code: 'v2-tts-fallback-local', stage: 'align', message: `elevenlabs failed, local synthesis carried the scene(s): ${audio.ttsFallback.reason.slice(0, 200)}`, hard: false });
        }
        synthesized.set(section.id, { text: narration.text, audio });
        return { ok: true as const, section, narration, audio };
      } catch (error) {
        return { ok: false as const, section, message: error instanceof Error ? error.message : String(error) };
      }
    });
    const failedAudio = audios.filter((result) => !result.ok);
    if (failedAudio.length) {
      for (const result of failedAudio) failures.push({ code: 'v2-audio-generation-failed', stage: 'align', message: `${result.section.id}: ${result.message}`, hard: true });
      return finish('failed');
    }
    audioScenes = audios.filter((result) => result.ok).map(({ section, narration, audio }) => ({ section, narration, audio }));
    for (const { section, audio } of audioScenes) {
      const problems = !Number.isFinite(audio.durationMs) || audio.durationMs <= 0
        ? ['audio duration must be finite and positive']
        : alignedWordTimingProblems(audio.words.map((word) => ({ w: word.word, startMs: word.startMs, endMs: word.endMs })), audio.durationMs);
      for (const message of problems) failures.push({ code: 'v2-invalid-alignment', stage: 'align', message: `${section.id}: ${message}`, hard: true });
    }
    if (failures.some((failure) => failure.hard)) {
      metrics['v2.hardAlignmentProblems'] = failures.length;
      return finish('failed');
    }
    const fit = fitPacing(audioScenes.map(({ audio }) => audio.durationMs), requestedDurationMs);
    if (fit.ok) { pacing = fit; break; }
    const speechMs = audioScenes.reduce((sum, { audio }) => sum + audio.durationMs, 0);
    const naturalMs = speechMs + PIPELINE.sceneGapMs * (audioScenes.length - 1) + DEFAULT_PACING.trailingMs.nominal;
    metrics['v2.actualDurationDeltaMs'] = naturalMs - requestedDurationMs;
    if (revisionRounds >= MAX_DURATION_REVISIONS) {
      failures.push({ code: 'v2-fixed-duration', stage: 'audio', message: `speech of ${speechMs}ms cannot be fitted to the requested ${requestedDurationMs}ms after ${revisionRounds} narration revision round(s): it must ${fit.direction} by about ${fit.deltaMs}ms; ${audioDurationProblems(naturalMs, requestedDurationMs, 200)[0] ?? ''}`.trim(), hard: true });
      return finish('failed', { durationMs: naturalMs });
    }
    revisionRounds++;
    const targets = revisionTargets(audioScenes.map(({ section, narration, audio }) => ({ sceneId: section.id, audioMs: audio.durationMs, words: tokenizeWords(narration.text, prepared.beatNarrationContexts?.[section.id]?.language ?? language).length })), requestedDurationMs, DEFAULT_PACING, fit.direction);
    const revisions = await mapLimit(audioScenes.filter(({ section }) => targets.scenes.some((item) => item.sceneId === section.id)), 4, async ({ section, narration, audio }) => {
      const target = targets.scenes.find((item) => item.sceneId === section.id)!;
      const base = prepared.beatNarrationContexts?.[section.id];
      const sentencesOf = (beatId: string): string[] => narration.beatSpans.find((span) => span.beatId === beatId)?.sentenceSpans.map((span) => narration.text.slice(span.charStart, span.charEnd)) ?? [];
      const ctx: NarrationContext = {
        ...(base ?? { sceneId: section.id, beats: prepared.beatPlans![section.id]!, allowedNumbers: new Set(narration.text.match(/\d+(?:\.\d+)?/g) ?? []), durationSec: section.budgetSec, emphasisCandidates: section.conceptIds.flatMap((id) => graph.concepts.find((c) => c.id === id)?.label ?? []) }),
        durationSec: target.targetAudioMs / 1000,
        revision: { direction: fit.direction, targetWords: target.targetWords, measuredWordsPerSec: target.measuredWordsPerSec, previousSeconds: audio.durationMs / 1000, previous: narration.beats.map((beat) => ({ beatId: beat.beatId, sentences: sentencesOf(beat.beatId) })) },
      };
      const excerpt = prepared.sourceDoc ? sectionSourcePrompt(prepared.sourceDoc, section, graph) : '';
      return { section, result: await writeBeatNarration({ ctx, scene: { title: section.title, goal: section.goal }, sourceExcerpt: excerpt }, { model: input.plannerModel, apiKey: input.apiKey, remainingBudgetUsd: (input.remainingBudgetUsd ?? 0.2) / Math.max(1, audioScenes.length), ...(input.budgetLedger ? { budgetLedger: input.budgetLedger } : {}), ...(input.client ? { client: input.client } : {}), language }) };
    });
    for (const { result } of revisions) { addUsage(usage, result.usage); failures.push(...result.failures); reports.push(...result.reports); }
    const unrevised = revisions.filter(({ result }) => !result.value);
    if (unrevised.length) {
      for (const { section } of unrevised) failures.push({ code: 'v2-duration-revision-failed', stage: 'narration', message: `${section.id}: the narration could not be rewritten to its measured word budget`, hard: true });
      failures.push({ code: 'v2-fixed-duration', stage: 'audio', message: `speech of ${speechMs}ms does not fit the requested ${requestedDurationMs}ms (it must ${fit.direction} by about ${fit.deltaMs}ms) and the narration rewrite failed`, hard: true });
      return finish('failed', { durationMs: naturalMs });
    }
    for (const { section, result } of revisions) narrations[section.id] = result.value!;
  }
  metrics['v2.durationRevisionRounds'] = revisionRounds;
  metrics['v2.pacingGapMs'] = pacing.gapMs;
  metrics['v2.pacingTrailingMs'] = pacing.trailingMs;
  const gap = pacing.gapMs;
  const trailing = pacing.trailingMs;
  const totalMs = audioScenes.reduce((sum, { audio }, i) => sum + audio.durationMs + (i < audioScenes.length - 1 ? gap : trailing), 0);
  metrics['v2.actualDurationDeltaMs'] = totalMs - requestedDurationMs;
  const durationProblems = audioDurationProblems(totalMs, requestedDurationMs, 200);
  for (const message of durationProblems) failures.push({ code: 'v2-fixed-duration', stage: 'audio', message, hard: true });
  if (durationProblems.length) return finish('failed', { durationMs: totalMs });

  // Preserve the complete measured word clock of the FINAL speech, including aligner/repair/calibration metadata.
  // Beat token matching alone cannot establish valid intervals.
  await dump('alignment.json', { schemaVersion: 'v2-alignment/v1', scenes: audioScenes.map(({ section, audio }) => ({
    sceneId: section.id, durationMs: audio.durationMs, words: audio.words,
    aligner: audio.aligner, repairedWordIndexes: audio.repairedWordIndexes,
    calibration: input.calibrationMedianErrorMs === undefined
      ? { status: 'unmeasured' }
      : { status: 'measured', medianAbsoluteBoundaryErrorMs: input.calibrationMedianErrorMs },
  })) });

  timing['v2.audioMs'] = Date.now() - startedAt;
  const conceptIndex = new Map(graph.concepts.map((c) => [c.id, { id: c.id, label: c.label, kind: c.kind, ...(plan.lessonBible?.domain ? { domain: plan.lessonBible.domain } : {}) } as ConceptInfo]));

  // Scene audio and the placement of every scene on the master clock are known now, so each scene can be frozen
  // (immutable scene lock) the moment its board compiles instead of waiting for the whole lesson.
  const sceneDir = path.join(outputDir, 'scene-audio');
  await mkdir(sceneDir, { recursive: true });
  const wavPaths: string[] = [];
  for (const { section, audio } of audioScenes) { const p = path.join(sceneDir, `${section.id}.wav`); await writeFile(p, audio.audio); wavPaths.push(p); }
  let cursor = 0;
  const placements = audioScenes.map(({ audio }, i) => { const startMs = cursor; cursor += audio.durationMs + (i < audioScenes.length - 1 ? gap : trailing); return { startMs, endMs: cursor }; });

  // 2. Board operations scene by scene (each scene sees the board the previous one left).
  let carried: BoardState = emptyBoardState();
  let prior: PriorLayout | undefined;
  const timings: BeatTiming[][] = [];
  for (const { section, narration, audio } of audioScenes) {
    let intervals;
    try { intervals = beatIntervals(narration, audio.words.map((w) => ({ w: w.word, startMs: w.startMs, endMs: w.endMs }))); } catch (error) {
      failures.push({ code: 'v2-alignment-mismatch', stage: 'align', message: `${section.id}: ${error instanceof Error ? error.message : String(error)}`, hard: true });
      return finish('failed');
    }
    const beatTimings: BeatTiming[] = intervals.map((interval) => ({ beatId: interval.beatId, startMs: interval.startMs, endMs: interval.endMs, sentences: interval.sentences.map((s) => ({ startMs: s.startMs, endMs: s.endMs })), pauseIntent: narration.beatSpans.find((span) => span.beatId === interval.beatId)?.pauseIntent ?? 'none' }));
    timings.push(beatTimings);
    const beats = prepared.beatPlans![section.id]!;
    const ctx: BoardContext = {
      sceneId: section.id, title: section.title, beats,
      claims: (section.contract?.essentialClaims ?? []).map(({ id, statement, conceptIds, relations }) => ({ id, statement, conceptIds, relations })),
      narration: narration.beatSpans.map((span) => ({ beatId: span.beatId, sentences: span.sentenceSpans.map((s) => narration.text.slice(s.charStart, s.charEnd)) })),
      concepts: section.conceptIds.flatMap((id) => { const c = graph.concepts.find((x) => x.id === id); return c ? [{ id: c.id, label: c.label, evidence: c.evidence.map((e) => ({ spanId: e.spanId, quote: e.quote })) }] : []; }),
      grounding: { verify: (spanId, quote) => anchorQuote(prepared.sourceDoc, spanId, quote)?.ref.quote, spanText: (spanId) => prepared.sourceDoc.spans.find((span) => span.id === spanId)?.text },
      initial: carried,
      ...(prior ? { prior } : {}),
    };
    const result = await planSceneBoard({ ctx }, { model: input.s6PlannerModel ?? input.plannerModel, apiKey: input.apiKey, remainingBudgetUsd: input.remainingBudgetUsd ?? 0.2, ...(input.budgetLedger ? { budgetLedger: input.budgetLedger } : {}), ...(input.client ? { client: input.client } : {}) });
    addUsage(usage, result.usage); reports.push(...result.reports);
    let boardDraft = result.value;
    if (!boardDraft) {
      // The model's board could not be validated. A deterministic board from the scene's own concepts keeps the lesson whole; it is
      // recorded as a soft failure for this scene, so the lesson stays a draft and is never counted as a pass.
      const fallback = input.boardFallback === false ? undefined : fallbackSceneBoard(ctx);
      if (fallback) {
        boardDraft = fallback;
        failures.push(...result.failures.map((f) => (f.hard ? { ...f, code: `${f.code}-fallback`, hard: false } : f)));
        failures.push({ code: 'v2-board-fallback', stage: 'board-ops', message: `${section.id}: the model's board did not validate, so a deterministic concept board from the scene's own data was used`, hard: false });
        metrics['v2.fallbackScenes'] = (metrics['v2.fallbackScenes'] ?? 0) + 1;
      }
    }
    if (!boardDraft) { failures.push(...result.failures); failures.push({ code: 'v2-board-failed', stage: 'board-ops', message: `${section.id}: no valid board operations`, hard: true }); return finish('failed'); }
    if (boardDraft === result.value) failures.push(...result.failures);
    const initial = startScene(carried, boardDraft.transition, section.id);
    const timeline = compileSceneTimeline({ ops: boardDraft.ops, initial, beats: beatTimings });
    const scene = compileScene(section.id, section.title, timeline, input.lessonId, conceptIndex, prior);
    for (const message of validateSceneGeometry(scene.geometry, timeline.states)) failures.push({ code: 'v2-geometry', stage: 'layout', message: `${section.id}: ${message}`, hard: true });
    for (const opId of timeline.lateOps) failures.push({ code: 'v2-late-op', stage: 'timeline', message: `${section.id}: ${opId} could not finish inside its sentence`, hard: false });
    for (const id of scene.geometry.moved) failures.push({ code: 'v2-retained-moved', stage: 'layout', message: `${section.id}: ${id} had to move or resize at the scene cut`, hard: false });
    compiled.push(scene);
    carried = timeline.states[timeline.states.length - 1]!;
    prior = { geometry: scene.geometry, state: carried };
    await dump(`scene.${section.id}.json`, { transition: boardDraft.transition, ops: boardDraft.ops, beats, narration, beatTimings, schedule: timeline.ops.map((s) => ({ opId: s.op.opId, t0: Math.round(s.t0), t1: Math.round(s.t1), late: s.late })), timelineHash: timeline.hash });
    if (!failures.some((f) => f.hard)) {
      const index = compiled.length - 1;
      await publishSceneLockV2({ outputDir, lessonId: input.lessonId, index, item: { scene, startMs: placements[index]!.startMs, endMs: placements[index]!.endMs }, fps: input.fps ?? 30, final: index === audioScenes.length - 1 });
      await recordSceneProgressV2(outputDir, { sceneId: section.id, index, sinceRequestMs: performance.now() - requestStartedMonotonicMs, sinceStartMs: performance.now() - startedMonotonicMs });
      timing['v2.requestToFirstReadySceneMs'] ??= performance.now() - requestStartedMonotonicMs;
    }
  }

  timing['v2.boardsMs'] = Date.now() - startedAt - timing['v2.audioMs']!;
  // 3. Metrics that say what the board actually teaches.
  const allOps = compiled.flatMap((s) => s.timeline.ops.map((o) => o.op));
  const visualBeats = plan.sections.flatMap((s) => prepared.beatPlans![s.id]!).filter((b) => !b.narrationOnly);
  const beatsWithOps = new Set(allOps.map((o) => o.beatId));
  const entityKeys = new Map(allOps.flatMap((o) => (o.op === 'add' || o.op === 'replace') && o.element.type === 'entity' ? [[`${o.element.conceptId}|${o.element.label}`, o.element] as const] : []));
  const entityDepictions = [...entityKeys.values()].map((spec) => depictEntity(conceptIndex.get(spec.conceptId), spec.label, { x: 0, y: 0, w: 240, h: 210 }));
  const catalogueAssets = new Map([...CATALOG, ...loadCatalogLibraries().entries].map((entry) => [entry.id, entry]));
  const bridge = loadBridge();
  const pictures = entityDepictions.flatMap((d) => {
    if (!d.meaningful || !d.assetId) return [];
    const entry = catalogueAssets.get(d.assetId);
    const sourceAsset = entry ? bridgeRecordForCatalogEntry(entry, bridge.assets) : undefined;
    return [buildAssetRightsEvidence({ assetId: d.assetId, license: d.license, releaseClean: d.releaseClean, attributionRequired: d.attributionRequired, ownerApproved: d.ownerApproved }, entry, sourceAsset)];
  });
  await dump('asset-provenance.json', { schemaVersion: 'v2-asset-provenance/v2', assets: pictures });
  const credits = [...new Set(pictures.filter((p) => p.attribution.required).map((p) => p.attribution.text ? `${p.attribution.text} [${p.license.identifier}; ${p.assetId}]` : `[MISSING ATTRIBUTION] ${p.assetId} (${p.license.identifier})`))].sort();
  if (credits.length) await writeFile(path.join(outputDir, 'attribution.txt'), `Picture credits required by licence:\n${credits.map((c) => `- ${c}`).join('\n')}\n`, 'utf8');
  for (const picture of pictures) { const failure = rightsEvidenceFailure(picture); if (failure) failures.push(failure); }
  Object.assign(metrics, {
    'v2.assetsNeedingReview': pictures.filter((p) => !p.releaseEligible).length,
    'v2.assetsNeedingAttribution': pictures.filter((p) => p.attribution.required).length,
    'v2.scenes': compiled.length,
    'v2.ops': allOps.length,
    'v2.stateChangingOps': allOps.filter((o) => STATE_CHANGING.has(o.op)).length,
    'v2.stateChangingOpShare': allOps.length ? allOps.filter((o) => STATE_CHANGING.has(o.op)).length / allOps.length : 0,
    'v2.kitElements': allOps.filter((o) => o.op === 'add' && o.element.type === 'kit').length,
    'v2.visualBeatCoverage': visualBeats.length ? visualBeats.filter((b) => beatsWithOps.has(b.beatId)).length / visualBeats.length : 1,
    'v2.pictorialEntities': entityDepictions.filter((d) => d.meaningful).length,
    'v2.labelledEntities': entityDepictions.filter((d) => !d.meaningful).length,
    'v2.retainedMoved': compiled.reduce((n, s) => n + s.geometry.moved.length, 0),
    'v2.lateOps': compiled.reduce((n, s) => n + s.timeline.lateOps.length, 0),
    'v2.hardGeometryProblems': failures.filter((f) => f.code === 'v2-geometry').length,
  });

  // 4. Master audio, video and captions.
  const masterAudio = path.join(outputDir, 'audio.wav');
  await concatSceneAudio(wavPaths, gap, trailing, masterAudio);
  const cues = compiled.flatMap((scene, i) => timings[i]!.flatMap((beat) => { const narration = narrations[scene.sceneId]!; const span = narration.beatSpans.find((b) => b.beatId === beat.beatId)!; return span.sentenceSpans.map((s, j) => ({ startMs: placements[i]!.startMs + beat.sentences[j]!.startMs, endMs: placements[i]!.startMs + beat.sentences[j]!.endMs, text: narration.text.slice(s.charStart, s.charEnd) })); }));
  await writeFile(path.join(outputDir, 'captions.vtt'), `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${vttTime(c.startMs)} --> ${vttTime(c.endMs)}\n${c.text}\n`).join('\n')}`, 'utf8');
  await dump('lesson-context.json', { schemaVersion: 'lesson-context/v2', groundingMode: prepared.groundingMode ?? 'STRICT_SOURCE', evidenceLedger, promptVersions: { boardOps: BOARD_OPS_PROMPT_VERSION }, sourceDoc: prepared.sourceDoc, plan, graph, beatPlans: prepared.beatPlans, beatNarrations: narrations });
  let videoPath: string | undefined;
  if (!failures.some((f) => f.hard)) {
    await writeLessonLockV2({ outputDir, lessonId: input.lessonId, scenes: compiled.map((scene, i) => ({ scene, startMs: placements[i]!.startMs, endMs: placements[i]!.endMs })), durationMs: totalMs, audioPath: masterAudio, fps: input.fps ?? 30 });
    if (!input.skipEncode) {
      videoPath = path.join(outputDir, 'video.mp4');
      const encodeStart = Date.now();
      const encoded = await encodeLockedLessonV2Clips(outputDir, videoPath, { ...(input.clipCacheDir ? { cacheDir: input.clipCacheDir } : {}), onClipReady: (clip) => { timing['v2.timeToFirstClipMs'] ??= Date.now() - startedAt; input.onClipReady?.(clip); } });
      timing['v2.encodeMs'] = Date.now() - encodeStart;
      Object.assign(metrics, { 'v2.frames': encoded.frames, 'v2.framesRendered': encoded.rendered, 'v2.framesReused': encoded.reused, 'v2.clips': encoded.clips.length, 'v2.clipsCached': encoded.clips.filter((c) => c.cached).length, 'v2.clipRetries': encoded.clips.reduce((n, c) => n + Math.max(0, c.attempts - 1), 0) });
    }
  }
  timing['v2.totalMs'] = performance.now() - startedMonotonicMs;
  // This is full request latency, including intake and S1–S4. The first
  // encoded clip above is silent media and is deliberately not called
  // first-playable latency; that metric stays absent until the audible player
  // can verify a frozen frame and its matching audio together.
  timing['v2.requestToCompleteMs'] = performance.now() - requestStartedMonotonicMs;
  Object.assign(metrics, timing);
  const result = finish(failures.some((f) => f.hard) ? 'failed' : 'draft', { durationMs: totalMs, ...(videoPath ? { videoPath } : {}) });
  await dump('scorecard.json', result.scorecard);
  await dump('v2-summary.json', { status: result.status, artifactCertification: result.artifactCertification, scenes: result.scenes, planned: result.planned, durationMs: totalMs, metrics, failures: failures.map(({ code, stage, message, hard }) => ({ code, stage, message, hard })), timelineHashes: compiled.map((s) => [s.sceneId, s.timeline.hash]) });
  return result;
}

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
import { beatIntervals } from '../narration/beat-narration/intervals.js';
import { alignedWordTimingProblems } from '../narration/align.js';
import { emptyBoardState, startScene } from '../visual-v2/board-state/reducer.js';
import type { BoardState } from '../visual-v2/board-state/types.js';
import { planSceneBoard } from '../visual-v2/ops-plan/plan.js';
import type { BoardContext } from '../visual-v2/ops-plan/validate.js';
import { anchorQuote } from '../plan/evidenceAnchor.js';
import { validateSceneGeometry, type PriorLayout } from '../visual-v2/layout/sceneLayout.js';
import { compileSceneTimeline, type BeatTiming } from '../visual-v2/timeline/compile.js';
import { compileScene, type CompiledScene } from '../visual-v2/renderer/frame.js';
import { mapLimit } from './mapLimit.js';
import { writeLessonLockV2 } from './lockV2.js';
import { encodeLockedLessonV2Clips } from './clipsV2.js';
import type { ConceptInfo } from '../visual-v2/resolver/typeGate.js';
import { depictEntity } from '../visual-v2/resolver/typeGate.js';
import { CATALOG } from '../assets/catalog.js';
import { loadCatalogLibraries } from '../assets/streamline.js';
import { loadBridge } from '../assets/bridge.js';
import { bridgeRecordForCatalogEntry, buildAssetRightsEvidence, rightsEvidenceFailure } from '../assets/rightsEvidence.js';
import { buildScorecard, type Scorecard } from '../harness/scorecard.js';
import { TEACHING_COMPILER_VERSION } from '../run/featureFlags.js';

/**
 * Teaching Compiler V2 run: locked beats and beat narration -> real audio and alignment -> board operations -> persistent board
 * state -> deterministic layout -> semantic timeline -> frames -> MP4. Fails closed: a scene whose board cannot be planned and
 * validated stops the run; nothing is replaced by a generic fallback board.
 */
export interface RunLessonV2Input {
  lessonId: string;
  outputDir: string;
  prepared: PreparedLesson;
  plannerModel: string;
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
  /** Per-scene clip cache shared across runs (default: `<outputDir>/clips`). */
  clipCacheDir?: string;
  /** Scenes synthesised and aligned at once (default 1 until shared provider reservations have measured concurrency safety). */
  audioConcurrency?: number;
  /** Notified, in lesson order, as each scene's clip is ready (progressive playback). */
  onClipReady?: (clip: { sceneId: string; path: string; index: number }) => void;
  remainingBudgetUsd?: number;
  /** Wall-clock timestamp captured when the CLI accepted this request, before intake and S1–S4. */
  requestStartedAtMs?: number;
  /**
   * Diagnostic mode: when the fixed lesson clock misses, keep building boards,
   * frames, and video instead of stopping at audio. The duration failure stays
   * hard and the status stays failed; the video is evidence, not a pass. V1
   * has the same concept (--allow-partial-video). Release still requires the gate.
   */
  diagnosticVideo?: boolean;
  /** Monotonic clock captured at the same request-acceptance boundary. */
  requestStartedMonotonicMs?: number;
  /** Provider usage is retained even when synthesis fails after a charged request. */
  onElevenLabsUsage?: (event: ElevenLabsUsageEvent) => void;
}

export interface RunLessonV2Result {
  status: 'draft' | 'failed';
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
    const finalMetrics = { ...metrics, ...timing, 'v2.totalMs': performance.now() - startedMonotonicMs, 'v2.requestToCompleteMs': performance.now() - requestStartedMonotonicMs };
    const scorecard = buildScorecard({ compilerVersion: TEACHING_COMPILER_VERSION, reports, coverageMetrics: finalMetrics, measured: [] });
    const elevenLabsCredits = providerUsageEvents.filter((event) => event.status === 'succeeded').reduce((sum, event) => sum + (event.credits ?? 0), 0);
    return { status, failures, reports, usage, scenes: compiled.length, planned: prepared.plan?.sections.length ?? 0, durationMs: 0, metrics: finalMetrics, scorecard, compiled, speechUsage, providerUsageEvents, elevenLabsCredits, ...extra };
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

  // 1. Real audio and alignment for each scene's speech: the master clock.
  const audios = await mapLimit(plan.sections, Math.max(1, input.audioConcurrency ?? 1), async (section) => {
    const narration = prepared.beatNarrations![section.id]!;
    const speechContext = prepared.beatNarrationContexts?.[section.id];
    try {
      const audio = await synthesizeSceneAudio({ sceneId: section.id, text: narration.text, language: speechContext?.language ?? language, ...(input.voice ? { voice: input.voice } : {}), ...(speechContext?.speechLanguagePolicy === 'native-plus-english-terms' ? { languagePolicy: 'native-plus-english-terms/v1' as const } : {}), ...(speechContext?.terminology?.length ? { terminology: speechContext.terminology } : {}), ...(input.calibrationMedianErrorMs !== undefined ? { calibrationMedianErrorMs: input.calibrationMedianErrorMs } : {}) }, { ...(input.artifactStore ? { artifactStore: input.artifactStore } : {}), ...(input.aligner ? { aligner: input.aligner } : {}), onElevenLabsUsage: (event) => { providerUsageEvents.push(event); input.onElevenLabsUsage?.(event); } });
      if (audio.providerMetadata) speechUsage.push({ sceneId: section.id, model: audio.providerMetadata.model, voice: audio.providerMetadata.voice, credits: audio.providerMetadata.credits, cacheHit: audio.cacheHit, ...(audio.providerMetadata.capabilitySnapshotId ? { capabilitySnapshotId: audio.providerMetadata.capabilitySnapshotId } : {}) });
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
  const readyAudios = audios.filter((result) => result.ok);
  const audioScenes = readyAudios.map(({ section, narration, audio }) => ({ section, narration, audio }));

  // Preserve the complete measured word clock, including aligner/repair/calibration metadata.
  // Beat token matching alone cannot establish valid intervals.
  await dump('alignment.json', { schemaVersion: 'v2-alignment/v1', scenes: audioScenes.map(({ section, audio }) => ({
    sceneId: section.id, durationMs: audio.durationMs, words: audio.words,
    aligner: audio.aligner, repairedWordIndexes: audio.repairedWordIndexes,
    calibration: input.calibrationMedianErrorMs === undefined
      ? { status: 'unmeasured' }
      : { status: 'measured', medianAbsoluteBoundaryErrorMs: input.calibrationMedianErrorMs },
  })) });
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

  // The requested runtime is a hard prerequisite for paid board planning. Check it
  // as soon as all audio clocks are known, before spending on any BoardOps calls.
  // The trailing closure hold is adaptive: the compiler fills the fixed clock with
  // final-board hold (at most 3000 ms, a legitimate closure beat), so sub-second
  // speech residuals land exactly instead of failing. Speech plus gaps beyond
  // the clock still fail at S4's owner, never trimmed.
  const gap = PIPELINE.sceneGapMs;
  const requestedDurationMs = (prepared.requestedDurationSec ?? plan.targetDurationSec) * 1000;
  const speechAndGapsMs = audioScenes.reduce((sum, { audio }, i) => sum + audio.durationMs + (i < audioScenes.length - 1 ? gap : 0), 0);
  const trailing = Math.min(3000, Math.max(0, requestedDurationMs - speechAndGapsMs));
  const totalMs = speechAndGapsMs + trailing;
  metrics['v2.requestedDurationMs'] = requestedDurationMs;
  metrics['v2.actualDurationDeltaMs'] = totalMs - requestedDurationMs;
  // Lesson-clock tolerance, calibrated 2026-10-03 over 7 measured 60 s runs
  // (speech deltas +41 s, +74 s, -0.7 s, +0.2 s, +1.9 s, +5.6 s, -5.6 s across
  // successive S4 fixes): per-scene Piper wps varies 1.9–2.5 unpredictably, so
  // word budgets cannot hold an absolute millisecond gate. Tolerance scales
  // with the requested clock (10%, floor 500 ms): runaways still fail loudly
  // while healthy lessons reach board planning, render, and encode — where the
  // remaining gates live. Tighten only with a duration repair loop
  // (re-prompt longest scene), not with more constants.
  const durationProblems = audioDurationProblems(totalMs, requestedDurationMs, Math.max(500, requestedDurationMs * 0.1));
  for (const message of durationProblems) failures.push({ code: 'v2-fixed-duration', stage: 'audio', message, hard: true });
  if (durationProblems.length && !input.diagnosticVideo) return finish('failed', { durationMs: totalMs });

  timing['v2.audioMs'] = Date.now() - startedAt;
  const conceptIndex = new Map(graph.concepts.map((c) => [c.id, { id: c.id, label: c.label, kind: c.kind } as ConceptInfo]));

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
    const speechContext = prepared.beatNarrationContexts?.[section.id];
    const ctx: BoardContext = {
      sceneId: section.id, title: section.title, beats,
      narration: narration.beatSpans.map((span) => ({ beatId: span.beatId, sentences: span.sentenceSpans.map((s) => narration.text.slice(s.charStart, s.charEnd)) })),
      concepts: section.conceptIds.flatMap((id) => { const c = graph.concepts.find((x) => x.id === id); return c ? [{ id: c.id, label: c.label, evidence: c.evidence.map((e) => ({ spanId: e.spanId, quote: e.quote })) }] : []; }),
      grounding: { verify: (spanId, quote) => anchorQuote(prepared.sourceDoc, spanId, quote)?.ref.quote },
      initial: carried,
      ...(prior ? { prior } : {}),
      ...(speechContext?.moves?.length ? { moves: speechContext.moves } : {}),
    };
    const result = await planSceneBoard({ ctx }, { model: input.plannerModel, apiKey: input.apiKey, remainingBudgetUsd: input.remainingBudgetUsd ?? 0.2, ...(input.budgetLedger ? { budgetLedger: input.budgetLedger } : {}), ...(input.client ? { client: input.client } : {}) });
    addUsage(usage, result.usage); failures.push(...result.failures); reports.push(...result.reports);
    if (!result.value) { failures.push({ code: 'v2-board-failed', stage: 'board-ops', message: `${section.id}: no valid board operations`, hard: true }); return finish('failed'); }
    const initial = startScene(carried, result.value.transition, section.id);
    const timeline = compileSceneTimeline({ ops: result.value.ops, initial, beats: beatTimings });
    const scene = compileScene(section.id, section.title, timeline, input.lessonId, conceptIndex, prior);
    for (const message of validateSceneGeometry(scene.geometry, timeline.states)) failures.push({ code: 'v2-geometry', stage: 'layout', message: `${section.id}: ${message}`, hard: true });
    for (const opId of timeline.lateOps) failures.push({ code: 'v2-late-op', stage: 'timeline', message: `${section.id}: ${opId} could not finish inside its sentence`, hard: false });
    for (const id of scene.geometry.moved) failures.push({ code: 'v2-retained-moved', stage: 'layout', message: `${section.id}: ${id} had to move or resize at the scene cut`, hard: false });
    compiled.push(scene);
    carried = timeline.states[timeline.states.length - 1]!;
    prior = { geometry: scene.geometry, state: carried };
    await dump(`scene.${section.id}.json`, { transition: result.value.transition, ops: result.value.ops, beats, narration, beatTimings, schedule: timeline.ops.map((s) => ({ opId: s.op.opId, t0: Math.round(s.t0), t1: Math.round(s.t1), late: s.late })), timelineHash: timeline.hash });
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
  const sceneDir = path.join(outputDir, 'scene-audio');
  await mkdir(sceneDir, { recursive: true });
  const wavPaths: string[] = [];
  for (const { section, audio } of audioScenes) { const p = path.join(sceneDir, `${section.id}.wav`); await writeFile(p, audio.audio); wavPaths.push(p); }
  const masterAudio = path.join(outputDir, 'audio.wav');
  await concatSceneAudio(wavPaths, gap, trailing, masterAudio);
  let cursor = 0;
  const placements = audioScenes.map(({ audio }, i) => { const startMs = cursor; cursor += audio.durationMs + (i < audioScenes.length - 1 ? gap : trailing); return { startMs, endMs: cursor }; });
  const cues = compiled.flatMap((scene, i) => timings[i]!.flatMap((beat) => { const narration = prepared.beatNarrations![scene.sceneId]!; const span = narration.beatSpans.find((b) => b.beatId === beat.beatId)!; return span.sentenceSpans.map((s, j) => ({ startMs: placements[i]!.startMs + beat.sentences[j]!.startMs, endMs: placements[i]!.startMs + beat.sentences[j]!.endMs, text: narration.text.slice(s.charStart, s.charEnd) })); }));
  await writeFile(path.join(outputDir, 'captions.vtt'), `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${vttTime(c.startMs)} --> ${vttTime(c.endMs)}\n${c.text}\n`).join('\n')}`, 'utf8');
  await dump('lesson-context.json', { sourceDoc: prepared.sourceDoc, plan, graph, beatPlans: prepared.beatPlans, beatNarrations: prepared.beatNarrations });
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
  await dump('v2-summary.json', { status: result.status, scenes: result.scenes, planned: result.planned, durationMs: totalMs, metrics, failures: failures.map(({ code, stage, message, hard }) => ({ code, stage, message, hard })), timelineHashes: compiled.map((s) => [s.sceneId, s.timeline.hash]) });
  return result;
}

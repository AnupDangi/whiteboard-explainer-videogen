import { createHash, randomUUID } from 'node:crypto';
import { access, link, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import { Resvg } from '@resvg/resvg-js';
import { z } from 'zod';
import { canonicalHash, type ReplayDigest } from '../harness/replayDeterminism.js';
import { alignedWordTimingProblems, tokenizeWords } from '../narration/align.js';
import { compiledSemanticAnchorProblems } from '../narration/beat-narration/compile.js';
import { representationSelectionProblems } from '../teaching/beat-plan/representationRegistry.js';
import { alignedSemanticAnchorIntervals } from '../narration/beat-narration/intervals.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';
import { claimIdentityMismatch, deriveClaimIdentity, formatClaimIdentityMismatch } from '../evidence/claimIdentity.js';
import { ClaimVerificationStatusSchema, EpistemicTypeSchema, epistemicClaimProblems, epistemicTextFramingProblem, parseEvidenceLedger, validateEvidenceLedger, validateEvidenceLedgerClaims, validateEvidenceLedgerSources, type CanonicalTeachingClaimEvidence } from '../evidence/ledger.js';
import type { EvidenceReference } from '../shared/contracts.js';
import type { SourceDoc } from '../intake/sourceDoc.js';
import { probeToolVersions } from '../run/lessonLock.js';
import { KALAM_BOLD_FILE, KALAM_FONT_FAMILY, KALAM_FONT_SHA256 } from '../render/fonts.js';
import { STYLE } from '../render/style.js';
import { RasterPool } from '../export/rasterPool.js';
import { spawnFrameEncoder } from '../export/ffmpeg.js';
import { holdKey, renderSceneSvg } from '../visual-v2/renderer/frame.js';
import type { V2VideoScene } from '../visual-v2/renderer/encode.js';
import { BoardOpSchema, SceneTransitionSchema, type BoardOp } from '../visual-v2/board-ops/types.js';
import { applyOpAfter, emptyBoardState, startScene } from '../visual-v2/board-state/reducer.js';
import type { BoardState } from '../visual-v2/board-state/types.js';
import { CompiledEntityRefSchema, CompiledSemanticChangeSchema, semanticEntityId } from '../teaching/beat-plan/types.js';
import { lessonHierarchyProblems } from './lessonHierarchy.js';
import { SemanticOpSchema, type SemanticOp, type SemanticSceneState } from '../teaching/semantic-ir/types.js';
import { applySemanticProgram } from '../teaching/semantic-ir/program.js';
import { compileSemanticOpsToBoardOps } from '../teaching/semantic-ir/toBoardOps.js';
import { stateTransitionProvider } from '../teaching/representation/stateTransition.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { VisualVocabulary } from '../planner/visualDiscovery.js';
import { auditRenderedEntityAssets, requiredSelectedIconConceptIds, requiredSelectedIconProblems } from './renderedEntityAssets.js';

export const LESSON_LOCK_V2_VERSION = 'lesson.lock/v5-teaching-compiler-v2';
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Ref = z.object({ file: z.string().min(1), hash: Hash }).strict();
const Range = { sceneId: z.string().min(1), firstFrame: z.number().int().nonnegative(), frameCount: z.number().int().positive() };
const Segment = z.discriminatedUnion('kind', [
  z.object({ ...Range, kind: z.literal('hold'), stateHash: Hash, svgHash: Hash }).strict(),
  z.object({ ...Range, kind: z.literal('transition'), fromStateHash: Hash, toStateHash: Hash, fps: z.number().int().positive(), svgHashes: z.array(Hash).min(1) }).strict(),
]);
const SampleSchema = z.object({ sceneId: z.string().min(1), kind: z.enum(['final', 'transition']), svgHash: Hash, pngHash: Hash, sampleTimeMs: z.number().nonnegative(), frame: z.number().int().nonnegative().optional() }).strict();
const LockSchema = z.object({
  schemaVersion: z.literal(LESSON_LOCK_V2_VERSION), lessonId: z.string().min(1),
  context: Ref, alignment: Ref, hierarchyInput: Ref.optional(),
  scenes: z.array(z.object({
    sceneId: z.string().regex(/^[a-zA-Z0-9_-]+$/), startMs: z.number().nonnegative(), endMs: z.number().positive(),
    file: z.string().min(1), fileHash: Hash, audioFile: z.string().min(1), audioHash: Hash,
    captured: Ref, timelineHash: Hash, geometryHash: Hash, boardOpsHash: Hash, boardStatesHash: Hash, conceptsHash: Hash,
  }).strict()).min(1),
  media: z.object({ audio: Ref, captions: Ref }).strict(),
  font: z.object({ file: z.string().min(1), hash: Hash, family: z.literal(KALAM_FONT_FAMILY), loadSystemFonts: z.literal(false) }).strict(),
  render: z.object({ fps: z.number().int().positive().max(120), durationMs: z.number().positive(), width: z.number().int().positive(), height: z.number().int().positive(), frames: z.number().int().positive() }).strict(),
  renderPlan: z.array(Segment).min(1), svgAssets: z.array(Ref).min(1),
  samples: z.array(SampleSchema).min(1),
  versions: z.object({ node: z.string().min(1), pipeline: z.string().min(1), resvg: z.string().min(1), roughjs: z.string().min(1), ffmpeg: z.string().min(1), kalamSha256: Hash, renderPlan: z.literal('svg-frame-ranges/v1') }).strict(),
  contentHash: Hash,
}).strict();
export type LessonLockV2 = z.infer<typeof LockSchema>;
export type RenderSegment = LessonLockV2['renderPlan'][number];

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict();
const PlacedRect = z.object({ id: z.string(), rect: Rect }).strict();
const Point = z.object({ x: z.number(), y: z.number() }).strict();
const EdgeRoute = z.object({ id: z.string(), points: z.tuple([Point, Point]), controlPoint: Point.optional(), arrowhead: z.tuple([Point, Point, Point]), arrowheadBounds: Rect, label: z.object({ x: z.number(), y: z.number(), text: z.string(), size: z.number(), bounds: Rect }).strict().optional() }).strict();
const CapturedSchema = z.object({
  sceneId: z.string(), title: z.string(), seedBase: z.string(),
  concepts: z.array(z.tuple([z.string(), z.unknown()])),
  geometry: z.object({ contentRect: Rect, regionRects: z.record(z.string(), Rect), allRects: z.array(PlacedRect), states: z.array(z.array(PlacedRect)), kitFrames: z.array(z.tuple([z.string(), z.unknown()])), edgeRoutes: z.array(z.array(EdgeRoute)).optional() }).strict(),
  timeline: z.object({
    ops: z.array(z.object({ index: z.number().int(), op: z.record(z.string(), z.unknown()), effects: z.array(z.unknown()), anchorMs: z.number(), t0: z.number(), t1: z.number(), deadlineMs: z.number(), late: z.boolean() }).strict()),
    states: z.array(z.record(z.string(), z.unknown())).min(1), durationMs: z.number(), lateOps: z.array(z.string()), hash: Hash,
    lifecycleEvents: z.array(z.object({ kind: z.enum(['beat-end', 'scene-end']), beatId: z.string().optional(), atMs: z.number(), state: z.record(z.string(), z.unknown()) }).strict()).optional(),
  }).strict(),
}).strict();
type CapturedScene = z.infer<typeof CapturedSchema>;

const RepresentationExecutionFields = z.object({
  sceneId: z.string().min(1),
  mode: z.enum(['typed-semantic', 'legacy-boardops-preview']),
  providerVersion: z.string().min(1).optional(),
  providerSource: z.literal('family-fallback').optional(),
  beats: z.array(z.object({
    beatId: z.string().min(1), family: z.string().min(1),
    status: z.enum(['compiled', 'provider-unavailable']),
    providerVersion: z.string().min(1).optional(), problem: z.string().min(1).optional(),
  }).strict()),
  semanticOperations: z.array(SemanticOpSchema),
  cueByEventId: z.record(z.string(), z.number().int().min(0).max(3)),
  selectedAssetIds: z.record(z.string(), z.string()),
  boardOpsHash: Hash.optional(),
}).strict();
const RepresentationExecutionV1Schema = RepresentationExecutionFields.extend({
  schemaVersion: z.literal('v2-representation-execution/v1'),
});
const RenderedEntityAssetSchema = z.object({
  elementId: z.string().min(1), conceptId: z.string().min(1),
  selectedAssetId: z.string().nullable(), resolvedAssetId: z.string().nullable(),
  depictionFamily: z.enum(['pictorial', 'role-shape', 'labelled']), meaningful: z.boolean(),
  pathCount: z.number().int().nonnegative(), fillCount: z.number().int().nonnegative(), embedCount: z.number().int().nonnegative(),
  resolutionReason: z.string().min(1),
}).strict();
const RepresentationExecutionV2Schema = RepresentationExecutionFields.extend({
  schemaVersion: z.literal('v2-representation-execution/v2'),
  renderedEntityAssets: z.array(RenderedEntityAssetSchema),
  unrenderedSelectedConceptIds: z.array(z.string().min(1)),
}).strict();
const RepresentationExecutionSchema = z.discriminatedUnion('schemaVersion', [RepresentationExecutionV1Schema, RepresentationExecutionV2Schema]);

function emptySemanticSceneState(sceneId: string): SemanticSceneState {
  return { sceneId, entities: [], relations: [], selectedEntityIds: [], plots: [], feedbackLoops: [], annotations: [] };
}

function expectedIconSelection(context: JsonRecord, sceneId: string): Record<string, string> {
  const vocabularies = recordOf(context.visualVocabularies);
  const vocabulary = recordOf(vocabularies?.[sceneId]);
  return Object.fromEntries((arrayOf(vocabulary?.concepts) ?? []).flatMap((raw) => {
    const item = recordOf(raw);
    const depiction = recordOf(item?.depiction);
    return item?.conceptKind === 'entity' && depiction?.kind === 'icon' && typeof item.conceptId === 'string' && typeof depiction.entryId === 'string'
      ? [[item.conceptId, depiction.entryId] as const] : [];
  }));
}

/** Cross-checks the new provider record against the pinned beat plan, phrase clocks and captured BoardOps. */
function representationExecutionProblems(sceneRecord: JsonRecord | undefined, context: JsonRecord, planBeats: unknown[], capturedOps: unknown[], captured: CapturedScene | undefined, sceneId: string): string[] {
  const problems: string[] = [];
  const topLevel = recordOf(context.representationExecution);
  if (!topLevel) return [];
  const topScenes = arrayOf(topLevel.scenes) ?? [];
  const topScene = topScenes.map(recordOf).find((item) => item?.sceneId === sceneId);
  const sceneRepresentation = recordOf(sceneRecord?.representationExecution);
  if (!topScene || !sceneRepresentation) {
    problems.push(`scene ${sceneId} representation execution differs from the lesson-context copy`);
    return problems;
  }
  if (canonicalHash(topScene) !== canonicalHash(sceneRepresentation)) problems.push(`scene ${sceneId} representation execution differs from the lesson-context copy`);
  const parsed = RepresentationExecutionSchema.safeParse(sceneRepresentation);
  if (!parsed.success) return [`scene ${sceneId} representation execution record is missing or malformed`];
  const execution = parsed.data;
  if (topLevel.schemaVersion !== execution.schemaVersion) problems.push(`scene ${sceneId} representation execution schema differs from the lesson-context copy`);
  const visualBeats = planBeats.map((raw) => recordOf(raw)).filter((beat): beat is JsonRecord => Boolean(beat && beat.narrationOnly !== true));
  const expectedBeats = visualBeats.map((beat) => ({ beatId: String(beat.beatId), family: String(beat.representationFamily) }));
  const executionBeats = execution.beats.map(({ beatId, family }) => ({ beatId, family }));
  if (execution.sceneId !== sceneId || canonicalHash(executionBeats) !== canonicalHash(expectedBeats)) problems.push(`scene ${sceneId} representation execution beat inventory differs from the pinned beat plan`);
  if (canonicalHash(execution.selectedAssetIds) !== canonicalHash(expectedIconSelection(context, sceneId))) problems.push(`scene ${sceneId} representation execution icon selection differs from pinned Visual Discovery`);
  if (execution.boardOpsHash !== canonicalHash(capturedOps)) problems.push(`scene ${sceneId} representation execution BoardOps hash differs from captured timeline`);
  if (execution.schemaVersion === 'v2-representation-execution/v2') {
    if (!captured) problems.push(`scene ${sceneId} has no captured board to verify rendered entity asset evidence`);
    else {
      const rendered = auditRenderedEntityAssets(captured.timeline.states, captured.geometry.states, captured.concepts);
      if (rendered.problems.length) problems.push(...rendered.problems.map((problem) => `scene ${sceneId} rendered entity asset evidence: ${problem}`));
      if (canonicalHash(rendered.evidence) !== canonicalHash(execution.renderedEntityAssets)) problems.push(`scene ${sceneId} rendered entity asset evidence differs from deterministic depiction resolution`);
      const visualBeatConceptIds = visualBeats.flatMap((beat) => (arrayOf(beat.entities) ?? []).flatMap((rawEntity) => {
        const entity = recordOf(rawEntity);
        return typeof entity?.conceptId === 'string' ? [entity.conceptId] : [];
      }));
      const requiredIconConceptIds = requiredSelectedIconConceptIds(visualBeatConceptIds, execution.selectedAssetIds);
      const requiredIconProblems = requiredSelectedIconProblems(requiredIconConceptIds, execution.selectedAssetIds, rendered.evidence);
      if (requiredIconProblems.length) problems.push(...requiredIconProblems.map((problem) => `scene ${sceneId} selected icon coverage: ${problem}`));
      const renderedConceptIds = new Set(execution.renderedEntityAssets.map((entity) => entity.conceptId));
      const expectedUnrendered = Object.keys(execution.selectedAssetIds).filter((conceptId) => !renderedConceptIds.has(conceptId)).sort();
      if (canonicalHash(expectedUnrendered) !== canonicalHash(execution.unrenderedSelectedConceptIds)) problems.push(`scene ${sceneId} unrendered selected icon concepts differ from captured entities`);
    }
  }

  if (execution.mode === 'legacy-boardops-preview') {
    if (execution.semanticOperations.length || execution.providerVersion || execution.providerSource) problems.push(`scene ${sceneId} legacy preview falsely claims typed semantic provider output`);
    if (execution.beats.some((beat) => beat.status !== 'provider-unavailable' || !beat.problem)) problems.push(`scene ${sceneId} legacy preview must identify every visual beat's unavailable provider`);
    if (expectedBeats.length && !execution.beats.length) problems.push(`scene ${sceneId} legacy preview omits provider status for visual beats`);
    return problems;
  }

  if (execution.providerVersion !== stateTransitionProvider.version || execution.providerSource !== 'family-fallback') problems.push(`scene ${sceneId} typed semantic provider identity is not recognized`);
  if (!visualBeats.length || visualBeats.some((beat) => beat.representationFamily !== 'state_transition')) problems.push(`scene ${sceneId} typed semantic provider is incompatible with its pinned representation families`);
  if (execution.beats.some((beat) => beat.status !== 'compiled' || beat.providerVersion !== stateTransitionProvider.version)) problems.push(`scene ${sceneId} typed semantic beat provider statuses are incomplete`);

  const beats = visualBeats as unknown as TeachingBeat[];
  let state = emptySemanticSceneState(sceneId);
  const expectedOperations: SemanticOp[] = [];
  for (const beat of beats) {
    const result = stateTransitionProvider.compileFallback(state, beat);
    if (!result.ok) {
      problems.push(`scene ${sceneId} state-transition fallback cannot replay ${beat.beatId}: ${result.problems.map((item) => item.message).join('; ')}`);
      break;
    }
    expectedOperations.push(...result.operations);
    const replay = applySemanticProgram(state, result.operations, { knownBeatIds: new Set(visualBeats.map((item) => String(item.beatId))), knownClaimIds: new Set(visualBeats.flatMap((item) => arrayOf(item.claimIds)?.filter((id): id is string => typeof id === 'string') ?? [])) });
    if (!replay.ok) { problems.push(`scene ${sceneId} semantic provider output does not replay: ${replay.problems.map((item) => item.message).join('; ')}`); break; }
    state = replay.state;
  }
  if (canonicalHash(expectedOperations) !== canonicalHash(execution.semanticOperations)) problems.push(`scene ${sceneId} typed semantic operations do not derive from the pinned beat changes`);

  const timings = arrayOf(sceneRecord?.beatTimings) ?? [];
  const expectedCues: Record<string, number> = {};
  for (const rawTiming of timings) {
    const timing = recordOf(rawTiming);
    if (!timing || typeof timing.beatId !== 'string') continue;
    const sentences = arrayOf(timing.sentences)?.map(recordOf).filter((item): item is JsonRecord => Boolean(item)) ?? [];
    for (const rawAnchor of arrayOf(timing.semanticAnchors) ?? []) {
      const anchor = recordOf(rawAnchor);
      if (typeof anchor?.semanticEventId !== 'string' || typeof anchor.startMs !== 'number') continue;
      const anchorStartMs = anchor.startMs;
      const cue = sentences.findIndex((sentence) => typeof sentence.startMs === 'number' && typeof sentence.endMs === 'number' && anchorStartMs >= sentence.startMs && anchorStartMs < sentence.endMs);
      if (cue >= 0) expectedCues[anchor.semanticEventId] = Math.min(3, cue);
    }
  }
  if (canonicalHash(expectedCues) !== canonicalHash(execution.cueByEventId)) problems.push(`scene ${sceneId} typed semantic cues do not match final aligned phrase clocks`);

  const graph = recordOf(context.graph);
  const concepts = (arrayOf(graph?.concepts) ?? []).map(recordOf).filter((item): item is JsonRecord => Boolean(item && typeof item.id === 'string' && typeof item.label === 'string'))
    .map((item) => ({ id: String(item.id), label: String(item.label), ...(typeof item.kind === 'string' ? { kind: item.kind } : {}) }));
  const vocabulary = recordOf(recordOf(context.visualVocabularies)?.[sceneId]) as unknown as VisualVocabulary | undefined;
  const knownBeatIds = new Set(visualBeats.flatMap((beat) => typeof beat.beatId === 'string' ? [beat.beatId] : []));
  const knownClaimIds = new Set(visualBeats.flatMap((beat) => arrayOf(beat.claimIds)?.filter((id): id is string => typeof id === 'string') ?? []));
  const lowered = compileSemanticOpsToBoardOps(emptySemanticSceneState(sceneId), execution.semanticOperations, {
    concepts, ...(vocabulary ? { visualVocabulary: vocabulary } : {}), knownBeatIds, knownClaimIds, cueByEventId: execution.cueByEventId,
  });
  if (!lowered.ok) problems.push(`scene ${sceneId} typed semantic operations cannot be lowered: ${lowered.problems.map((item) => item.message).join('; ')}`);
  else if (canonicalHash(lowered.operations) !== canonicalHash(sceneRecord?.ops as unknown[])) problems.push(`scene ${sceneId} typed semantic BoardOps do not reproduce the recorded BoardOps`);
  return problems;
}
const bytesHash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const lockHash = (lock: LessonLockV2): string => { const { contentHash: _ignored, ...body } = lock; return canonicalHash(body); };


const AlignmentSceneBaseSchema = z.object({
  sceneId: z.string().min(1), durationMs: z.number().positive(),
  words: z.array(z.object({ word: z.string().min(1), startMs: z.number(), endMs: z.number() }).strict()).min(1),
  aligner: z.enum(['stable-ts', 'stable-ts-fast-mode', 'torchaudio-wav2vec2-ctc', 'stable-ts+collapsed-repair', 'elevenlabs-timestamps']),
  repairedWordIndexes: z.array(z.number().int().nonnegative()),
  calibration: z.object({ status: z.enum(['measured', 'unmeasured']), medianAbsoluteBoundaryErrorMs: z.number().nonnegative().optional() }).strict()
    .refine((value) => value.status === 'measured' ? value.medianAbsoluteBoundaryErrorMs !== undefined : value.medianAbsoluteBoundaryErrorMs === undefined, 'calibration status must match the recorded boundary error'),
}).strict();
const AlignedSemanticAnchorSchema = z.object({
  semanticEventId: z.string().min(1), beatId: z.string().min(1), phrase: z.string().min(1),
  startMs: z.number().nonnegative(), endMs: z.number().positive(),
}).strict().refine((anchor) => anchor.endMs > anchor.startMs, 'semantic anchor interval must have positive duration');
const AlignmentSchemaV1 = z.object({ schemaVersion: z.literal('v2-alignment/v1'), scenes: z.array(AlignmentSceneBaseSchema).min(1) }).strict();
const AlignmentSchemaV2 = z.object({
  schemaVersion: z.literal('v2-alignment/v2'),
  scenes: z.array(AlignmentSceneBaseSchema.extend({ language: z.string().min(1), semanticAnchors: z.array(AlignedSemanticAnchorSchema) }).strict()).min(1),
}).strict();
const AlignmentSchema = z.discriminatedUnion('schemaVersion', [AlignmentSchemaV1, AlignmentSchemaV2]);

function alignmentProblems(bytes: Buffer, scenes: Array<{ sceneId: string; startMs: number; endMs: number }>, semantic: unknown[]): string[] {
  const problems: string[] = [];
  let record: z.infer<typeof AlignmentSchema>;
  try { record = AlignmentSchema.parse(JSON.parse(bytes.toString('utf8'))); }
  catch (error) { return [`alignment artifact invalid: ${error instanceof Error ? error.message : String(error)}`]; }
  type ParsedAlignmentScene = z.infer<typeof AlignmentSceneBaseSchema> & { language?: string; semanticAnchors?: Array<z.infer<typeof AlignedSemanticAnchorSchema>> };
  const alignmentScenes = record.scenes as ParsedAlignmentScene[];
  const isAlignmentV2 = record.schemaVersion === 'v2-alignment/v2';
  const byId = new Map(alignmentScenes.map((scene) => [scene.sceneId, scene]));
  if (byId.size !== alignmentScenes.length || alignmentScenes.length !== scenes.length || alignmentScenes.some((scene) => !scenes.some((locked) => locked.sceneId === scene.sceneId))) problems.push('alignment scene set does not match locked scenes');
  scenes.forEach((scene, index) => {
    const aligned = byId.get(scene.sceneId);
    if (!aligned) { problems.push(`alignment missing for scene ${scene.sceneId}`); return; }
    if (aligned.durationMs > scene.endMs - scene.startMs) problems.push(`alignment scene ${scene.sceneId} duration exceeds its placement`);
    problems.push(...alignedWordTimingProblems(aligned.words.map((word) => ({ w: word.word, startMs: word.startMs, endMs: word.endMs })), aligned.durationMs).map((problem) => `alignment scene ${scene.sceneId}: ${problem}`));
    if (new Set(aligned.repairedWordIndexes).size !== aligned.repairedWordIndexes.length || aligned.repairedWordIndexes.some((wordIndex) => wordIndex >= aligned.words.length)) problems.push(`alignment scene ${scene.sceneId} repaired word indexes invalid`);
    const narration = z.object({ narration: z.object({ text: z.string().min(1) }).passthrough() }).passthrough().safeParse(semantic[index]);
    if (!narration.success) { problems.push(`alignment scene ${scene.sceneId} needs locked narration text`); return; }
    const language = aligned.language ?? 'und';
    const expected = tokenizeWords(narration.data.narration.text, language);
    const actual = aligned.words.flatMap((word) => tokenizeWords(word.word, language));
    if (actual.length !== expected.length || actual.some((word, wordIndex) => word !== expected[wordIndex])) problems.push(`alignment scene ${scene.sceneId} words do not match narration token sequence`);
    if (isAlignmentV2) {
      const narrationValue = (semantic[index] as { narration?: unknown } | undefined)?.narration;
      if (!narrationValue || typeof narrationValue !== 'object' || Array.isArray(narrationValue)) {
        problems.push(`alignment scene ${scene.sceneId} needs compiled narration anchors`);
      } else {
        try {
          const expectedAnchors = alignedSemanticAnchorIntervals(
            narrationValue as CompiledSceneNarration,
            aligned.words.map((word) => ({ w: word.word, startMs: word.startMs, endMs: word.endMs })),
            language,
          );
          const actualAnchors = aligned.semanticAnchors ?? [];
          if (JSON.stringify(actualAnchors) !== JSON.stringify(expectedAnchors)) problems.push(`alignment scene ${scene.sceneId} semantic anchors differ from final narration and aligned word times`);
        } catch (error) {
          problems.push(`alignment scene ${scene.sceneId} semantic anchor timing invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  });
  return problems;
}

type JsonRecord = Record<string, unknown>;
const recordOf = (value: unknown): JsonRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
const arrayOf = (value: unknown): unknown[] | undefined => Array.isArray(value) ? value : undefined;
const normalizedConceptLabel = (label: string): string => label.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
const relationKey = (value: unknown): string | undefined => {
  const relation = recordOf(value);
  return typeof relation?.from === 'string' && typeof relation.to === 'string' && typeof relation.type === 'string'
    ? `${relation.from}|${relation.type}|${relation.to}` : undefined;
};

/** Cross-check the teaching graph and all scene artifacts after their byte hashes have been verified. */
function teachingIdentityProblems(contextBytes: Buffer, scenes: LessonLockV2['scenes'], semantic: unknown[], captured: CapturedScene[]): string[] {
  let context: JsonRecord;
  try { context = recordOf(JSON.parse(contextBytes.toString('utf8'))) ?? {}; } catch { return []; }
  const plan = recordOf(context.plan);
  const sections = arrayOf(plan?.sections)?.map(recordOf).filter((section): section is JsonRecord => Boolean(section));
  const contextV2 = context.schemaVersion === 'lesson-context/v2';
  const contextV3 = context.schemaVersion === 'lesson-context/v3';
  const contextV4 = context.schemaVersion === 'lesson-context/v4';
  const contextV5 = context.schemaVersion === 'lesson-context/v5';
  const contextV6 = context.schemaVersion === 'lesson-context/v6';
  const contextV9 = context.schemaVersion === 'lesson-context/v9';
  const contextV8 = context.schemaVersion === 'lesson-context/v8' || contextV9;
  const contextV7 = context.schemaVersion === 'lesson-context/v7' || contextV8;
  const contextVersion = contextV9 ? 'v9' : contextV8 ? 'v8' : contextV7 ? 'v7' : contextV6 ? 'v6' : contextV5 ? 'v5' : contextV4 ? 'v4' : contextV3 ? 'v3' : contextV2 ? 'v2' : 'legacy';
  if (context.schemaVersion !== undefined && !contextV2 && !contextV3 && !contextV4 && !contextV5 && !contextV6 && !contextV7 && !contextV9) return [`unsupported lesson context schema version: ${String(context.schemaVersion)}`];
  // Older synthetic and cached V2 locks predate the claim graph / beat identity contract.
  if (!sections?.some((section) => recordOf(section.contract))) {
    return contextV2 || contextV3 || contextV4 || contextV5 || contextV6 || contextV7 ? [`lesson context ${contextVersion} has no canonical scene contracts`] : [];
  }

  const problems: string[] = [];
  const graph = recordOf(context.graph);
  const concepts = arrayOf(graph?.concepts)?.map(recordOf).filter((concept): concept is JsonRecord => Boolean(concept)) ?? [];
  const conceptLabels = new Map(concepts.flatMap((concept) => typeof concept.id === 'string' && typeof concept.label === 'string' ? [[concept.id, concept.label] as const] : []));
  if (conceptLabels.size !== concepts.length) problems.push('pinned concept graph has missing or duplicate concept ids/labels');
  const rawGraphRelations = arrayOf(graph?.relations) ?? [];
  const graphRelationKeys = rawGraphRelations.map(relationKey).filter((key): key is string => key !== undefined);
  if (graphRelationKeys.length !== rawGraphRelations.length || new Set(graphRelationKeys).size !== graphRelationKeys.length) problems.push('pinned concept graph has malformed or duplicate directed relations');
  const graphRelations = new Set(graphRelationKeys);
  for (const relation of rawGraphRelations) {
    const parsed = recordOf(relation);
    if (parsed && (typeof parsed.from !== 'string' || typeof parsed.to !== 'string' || !conceptLabels.has(parsed.from) || !conceptLabels.has(parsed.to))) problems.push('pinned concept graph relation endpoint is missing');
  }

  const validatedByConcept = recordOf(context.validatedByConcept);
  if (contextV6 || contextV7) {
    if (!validatedByConcept) problems.push(`lesson context ${contextVersion} has no validatedByConcept map`);
    else for (const [conceptId, assetId] of Object.entries(validatedByConcept)) {
      if (!conceptLabels.has(conceptId)) problems.push(`lesson context ${contextVersion} visual selection refers to unknown concept ${conceptId}`);
      if (typeof assetId !== 'string' || !assetId.trim()) problems.push(`lesson context ${contextVersion} visual selection for ${conceptId} has no asset id`);
    }
    if (!recordOf(context.visualVocabularies)) problems.push(`lesson context ${contextVersion} has no visualVocabularies map`);
  }

  if (contextV2 || contextV3 || contextV4 || contextV5 || contextV6 || contextV7) {
    const ledgerValidation = validateEvidenceLedger(context.evidenceLedger);
    if (!ledgerValidation.valid) problems.push(...ledgerValidation.errors.map((problem) => `pinned evidence ledger: ${problem}`));
    else {
      const ledger = parseEvidenceLedger(context.evidenceLedger);
      if (context.groundingMode !== ledger.groundingMode) problems.push('lesson context grounding mode does not match its evidence ledger');
      const canonicalClaims: CanonicalTeachingClaimEvidence[] = [];
      for (const section of sections ?? []) {
        const contract = recordOf(section.contract);
        for (const rawClaim of arrayOf(contract?.essentialClaims) ?? []) {
          const claim = recordOf(rawClaim);
          if (!claim || typeof claim.id !== 'string' || typeof claim.statement !== 'string') {
            problems.push('canonical plan has a malformed claim in the evidence-ledger projection');
            continue;
          }
          const epistemicType = EpistemicTypeSchema.safeParse(claim.epistemicType);
          if ((contextV3 || contextV4 || contextV5 || contextV6 || contextV7) && !epistemicType.success) problems.push(`canonical plan claim ${claim.id} has no valid epistemicType`);
          const verificationStatus = ClaimVerificationStatusSchema.safeParse(claim.verificationStatus);
          if ((contextV4 || contextV5 || contextV6 || contextV7) && !verificationStatus.success) problems.push(`canonical plan claim ${claim.id} has no valid verificationStatus`);
          if (epistemicType.success) {
            for (const issue of epistemicClaimProblems({ id: claim.id, statement: claim.statement, relations: arrayOf(claim.relations) ?? [], epistemicType: epistemicType.data })) {
              problems.push(`canonical plan ${issue}`);
            }
          }
          const citedSpanIds = new Set((arrayOf(claim.evidenceSpanIds) ?? []).filter((id): id is string => typeof id === 'string'));
          for (const sourceRef of arrayOf(claim.sourceRefs) ?? []) {
            const ref = recordOf(sourceRef);
            if (typeof ref?.spanId !== 'string' || !citedSpanIds.has(ref.spanId)) {
              problems.push(`canonical plan claim ${claim.id} has a source reference outside its explicitly cited evidence spans`);
            }
          }
          canonicalClaims.push({
            id: claim.id,
            statement: claim.statement,
            relations: arrayOf(claim.relations) ?? [],
            ...(epistemicType.success ? { epistemicType: epistemicType.data } : {}),
            ...(verificationStatus.success ? { verificationStatus: verificationStatus.data } : {}),
            ...(Array.isArray(claim.sourceRefs) ? { sourceRefs: claim.sourceRefs as CanonicalTeachingClaimEvidence['sourceRefs'] } : {}),
            ...(typeof claim.confidence === 'number' ? { confidence: claim.confidence } : {}),
          });
        }
      }
      problems.push(...validateEvidenceLedgerClaims(ledger, canonicalClaims));
      const sourceDoc = recordOf(context.sourceDoc);
      if (!sourceDoc || typeof sourceDoc.sourceId !== 'string' || typeof sourceDoc.text !== 'string' || !Array.isArray(sourceDoc.spans)) {
        problems.push(`lesson context ${contextVersion} has no verifiable source document for its evidence ledger`);
      } else {
        const graphEvidence = [
          ...concepts.flatMap((concept) => arrayOf(concept.evidence) ?? []),
          ...rawGraphRelations.flatMap((relation) => arrayOf(recordOf(relation)?.evidence) ?? []),
        ].filter((ref): ref is JsonRecord => Boolean(recordOf(ref))).map((ref) => ref as unknown as EvidenceReference);
        problems.push(...validateEvidenceLedgerSources(ledger, [sourceDoc as unknown as SourceDoc], graphEvidence));
      }
    }
  }
  const beatPlans = recordOf(context.beatPlans) ?? {};
  const beatNarrations = recordOf(context.beatNarrations) ?? {};
  let expectedCarried: BoardState = emptyBoardState();
  const lessonEntityConceptById = new Map<string, string>();
  const statefulSemanticChanges = new Set(['flow', 'transform', 'move', 'separate', 'merge', 'quantity_update', 'select', 'finalize', 'plot', 'feedback']);

  scenes.forEach((locked, sceneIndex) => {
    const sceneSeenSemanticEntityIds = new Set<string>();
    if (contextV6 || contextV7) {
      for (const [conceptId, rawInfo] of captured[sceneIndex]!.concepts) {
        const info = recordOf(rawInfo);
        const expectedAssetId = validatedByConcept?.[conceptId];
        if (expectedAssetId !== undefined && info?.validatedAssetId !== expectedAssetId) {
          problems.push(`scene ${locked.sceneId} concept ${conceptId} visual asset does not match lesson-context/${contextVersion} Visual Discovery`);
        }
        if (expectedAssetId === undefined && typeof info?.validatedAssetId === 'string') {
          problems.push(`scene ${locked.sceneId} concept ${conceptId} has an unrecorded Visual Discovery asset`);
        }
      }
    }
    const section = sections.find((candidate) => candidate.id === locked.sceneId);
    const contract = recordOf(section?.contract);
    const claims = arrayOf(contract?.essentialClaims)?.map(recordOf).filter((claim): claim is JsonRecord => Boolean(claim)) ?? [];
    if (!section || !contract || !claims.length) {
      problems.push(`scene ${locked.sceneId} has no canonical essential claims in the pinned lesson context`);
      return;
    }
    const unverifiedClaimIds = new Set(claims.flatMap((claim) =>
      typeof claim.id === 'string' && (claim.epistemicType === 'unverified_explanation' || claim.verificationStatus === 'unverified') ? [claim.id] : [],
    ));
    for (const rawIntent of arrayOf(contract.semanticVisualIntents) ?? []) {
      const intent = recordOf(rawIntent);
      if (typeof intent?.claimId === 'string' && unverifiedClaimIds.has(intent.claimId)) {
        problems.push(`scene ${locked.sceneId} unverified explanation claim ${intent.claimId} must not have a semanticVisualIntent`);
      }
    }
    if (claims.every((claim) => claim.epistemicType === 'unverified_explanation' || claim.verificationStatus === 'unverified')
      && contract.visualForm !== undefined) {
      problems.push(`scene ${locked.sceneId} contains only unverified explanations and must omit visualForm`);
    }
    const claimsById = new Map<string, JsonRecord>();
    for (const claim of claims) {
      if (typeof claim.id !== 'string' || claimsById.has(claim.id)) { problems.push(`scene ${locked.sceneId} has missing or duplicate canonical claim ids`); continue; }
      claimsById.set(claim.id, claim);
      const claimConceptIds = arrayOf(claim.conceptIds)?.filter((id): id is string => typeof id === 'string') ?? [];
      if (!claimConceptIds.length || claimConceptIds.some((id) => !conceptLabels.has(id))) problems.push(`scene ${locked.sceneId} claim ${claim.id} has concept ids missing from the canonical graph`);
      const claimRelations = arrayOf(claim.relations) ?? [];
      for (const relation of claimRelations) {
        const key = relationKey(relation);
        const parsed = recordOf(relation);
        if (!key || !graphRelations.has(key)) problems.push(`scene ${locked.sceneId} claim ${claim.id} relation is absent from the canonical directed graph`);
        if (parsed && (!claimConceptIds.includes(String(parsed.from)) || !claimConceptIds.includes(String(parsed.to)))) problems.push(`scene ${locked.sceneId} claim ${claim.id} relation endpoints are outside its linked concepts`);
      }
      if (typeof claim.statement === 'string') {
        const identity = deriveClaimIdentity({ statement: claim.statement, conceptIds: claimConceptIds, relations: claimRelations } as Parameters<typeof deriveClaimIdentity>[0], concepts.flatMap((concept) => typeof concept.id === 'string' && typeof concept.label === 'string' ? [{ id: concept.id, label: concept.label }] : []));
        if (identity.relations.length !== claimRelations.length) problems.push(`scene ${locked.sceneId} claim ${claim.id} has a relation whose graph endpoints cannot be resolved to labels`);
        for (const mismatch of claimIdentityMismatch(identity, claim.statement)) problems.push(`scene ${locked.sceneId} claim ${claim.id} canonical identity conflict: ${formatClaimIdentityMismatch(mismatch)}`);
      }
    }

    const planBeats = arrayOf(beatPlans[locked.sceneId]);
    const sceneRecord = recordOf(semantic[sceneIndex]);
    const sceneBeats = arrayOf(sceneRecord?.beats);
    if (!planBeats?.length || !sceneBeats?.length || canonicalHash(planBeats) !== canonicalHash(sceneBeats)) {
      problems.push(`scene ${locked.sceneId} semantic beats do not match the pinned beat plan`);
    }
    const beatsById = new Map<string, JsonRecord>();
    for (const [beatIndex, rawBeat] of (planBeats ?? []).entries()) {
      const beat = recordOf(rawBeat);
      if (!beat || typeof beat.beatId !== 'string') { problems.push(`scene ${locked.sceneId} has a beat without a stable id`); continue; }
      if (contextV5 || contextV6 || contextV7) {
        if (beat.beatId !== `${locked.sceneId}.b${beatIndex + 1}` || beat.order !== beatIndex + 1) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has an unstable order or id`);
        if (typeof beat.learningQuestion !== 'string' || !/[?？]$/u.test(beat.learningQuestion.trim())) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has no question-form learningQuestion`);
        const learnerBefore = typeof beat.learnerBefore === 'string' ? beat.learnerBefore.trim().toLowerCase() : '';
        const learnerAfter = typeof beat.learnerAfter === 'string' ? beat.learnerAfter.trim().toLowerCase() : '';
        if (!learnerBefore || !learnerAfter || learnerBefore === learnerAfter) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has no distinct learner-before/after state`);
        if (!Array.isArray(beat.dependsOnOrders) || !Array.isArray(beat.dependsOnBeatIds)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has no dependency arrays`);
        const dependencyOrders = arrayOf(beat.dependsOnOrders) ?? [];
        const dependencyIds = arrayOf(beat.dependsOnBeatIds) ?? [];
        const expectedDependencyIds: string[] = [];
        const seenDependencyOrders = new Set<number>();
        dependencyOrders.forEach((rawOrder) => {
          if (typeof rawOrder !== 'number' || !Number.isInteger(rawOrder) || rawOrder < 1 || rawOrder > beatIndex) {
            problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has a dependency that does not reference an earlier beat order`);
          } else {
            if (seenDependencyOrders.has(rawOrder)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} repeats dependency order ${rawOrder}`);
            seenDependencyOrders.add(rawOrder);
            expectedDependencyIds.push(`${locked.sceneId}.b${rawOrder}`);
          }
        });
        if (canonicalHash(expectedDependencyIds) !== canonicalHash(dependencyIds)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} compiled dependency ids do not match its declared earlier orders`);
      }
      if (contextV7) {
        for (const message of representationSelectionProblems(beat)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} representation selection: ${message}`);
        for (const field of ['entities', 'semanticRevealOrder', 'requiredSemanticChanges', 'persistentEntityIds']) {
          if (!Array.isArray(beat[field])) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has no ${field} array`);
        }
        if (beat.persistence !== 'beat' && beat.persistence !== 'scene' && beat.persistence !== 'lesson') problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has an invalid persistence value`);
        const rawEntities = arrayOf(beat.entities) ?? [];
        const entities = rawEntities.flatMap((entity) => {
          const parsed = CompiledEntityRefSchema.safeParse(entity);
          if (!parsed.success) {
            problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has a malformed semantic entity`);
            return [];
          }
          return [parsed.data as unknown as JsonRecord];
        });
        const entityIdByKey = new Map<string, string>();
        const entityIds = new Set<string>();
        for (const entity of entities) {
          if (typeof entity.identityKey !== 'string' || !entity.identityKey.trim()) {
            problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has an entity without a semantic identity key`);
            continue;
          }
          const expectedEntityId = semanticEntityId(entity.identityKey, locked.sceneId);
          if (entity.entityId !== expectedEntityId) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} semantic entity ${entity.identityKey} has an unstable compiled id`);
          if (entityIds.has(expectedEntityId)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} repeats semantic entity ${entity.identityKey}`);
          entityIds.add(expectedEntityId);
          entityIdByKey.set(entity.identityKey, expectedEntityId);
          const conceptId = typeof entity.conceptId === 'string' ? entity.conceptId : '';
          const previousConceptId = lessonEntityConceptById.get(expectedEntityId);
          if (previousConceptId && previousConceptId !== conceptId) problems.push(`scene-scoped semantic entity ${entity.identityKey} changes concept from ${previousConceptId} to ${conceptId}`);
          else lessonEntityConceptById.set(expectedEntityId, conceptId);
        }
        const rawRevealOrder = arrayOf(beat.semanticRevealOrder) ?? [];
        const revealOrder = rawRevealOrder.filter((id): id is string => typeof id === 'string');
        if (revealOrder.length !== rawRevealOrder.length) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has a non-string semantic reveal id`);
        const revealIds = new Set(revealOrder);
        if (revealIds.size !== revealOrder.length) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} repeats an entity in semantic reveal order`);
        for (const id of revealOrder) if (!entityIds.has(id)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} reveal order references an entity outside the beat`);
        const firstSeenIds: string[] = [];
        for (const entity of entities) {
          if (typeof entity.identityKey === 'string' && typeof entity.entityId === 'string' && !sceneSeenSemanticEntityIds.has(entity.entityId)) firstSeenIds.push(entity.entityId);
        }
        for (const id of firstSeenIds) if (!revealIds.has(id)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} omits a new entity from semantic reveal order`);
        for (const id of revealOrder) if (sceneSeenSemanticEntityIds.has(id)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} reveals an entity that appeared in an earlier beat`);
        if (revealOrder.length !== firstSeenIds.length) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} semantic reveal order does not match its newly appearing entities`);
        const rawChanges = arrayOf(beat.requiredSemanticChanges) ?? [];
        const changes = rawChanges.flatMap((change) => {
          const parsed = CompiledSemanticChangeSchema.safeParse(change);
          if (!parsed.success) {
            problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has a malformed required semantic change`);
            return [];
          }
          return [parsed.data as unknown as JsonRecord];
        });
        for (const change of changes) {
          if (typeof change.identityKey !== 'string' || entityIdByKey.get(change.identityKey) !== change.entityId) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} semantic change does not bind to its declared entity`);
          if (typeof change.toState !== 'string' || !change.toState.trim()) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} semantic change has no required after-state`);
          if (typeof change.kind === 'string' && statefulSemanticChanges.has(change.kind) && (typeof change.fromState !== 'string' || !change.fromState.trim())) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} ${change.kind} change has no required before-state`);
        }
        for (const id of firstSeenIds) {
          const entity = entities.find((candidate) => candidate.entityId === id);
          const isIntroduced = changes.some((change) => change.identityKey === entity?.identityKey && change.kind === 'introduce');
          if (!isIntroduced) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} first appearance of ${String(entity?.identityKey)} has no introduce change`);
        }
        if (beat.narrationOnly === true && (changes.length || revealOrder.length)) problems.push(`scene ${locked.sceneId} narration-only beat ${beat.beatId} contains visual changes or reveals`);
        if (beat.narrationOnly !== true && !changes.length) problems.push(`scene ${locked.sceneId} visual beat ${beat.beatId} has no required semantic changes`);
        const expectedPersistentIds = beat.persistence === 'beat' ? [] : [...new Set(entities.map((entity) => typeof entity.entityId === 'string' ? entity.entityId : '').filter(Boolean))];
        if (canonicalHash(expectedPersistentIds) !== canonicalHash(arrayOf(beat.persistentEntityIds) ?? [])) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} persistent entity ids do not match its declared persistence`);
        for (const id of entityIds) sceneSeenSemanticEntityIds.add(id);
      }
      beatsById.set(beat.beatId, beat);
      const rawBeatClaimIds = arrayOf(beat.claimIds) ?? [];
      const beatClaimIds = rawBeatClaimIds.filter((id): id is string => typeof id === 'string');
      if (contextV7 && (!Array.isArray(beat.claimIds) || !beatClaimIds.length || beatClaimIds.length !== rawBeatClaimIds.length)) {
        problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has no valid claim ids`);
      }
      for (const claimId of beatClaimIds) if (!claimsById.has(claimId)) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} cites unknown claim ${claimId}`);
      if (contextV7) {
        const expectedEvidenceSpanIds = [...new Set(beatClaimIds.flatMap((claimId) => arrayOf(claimsById.get(claimId)?.evidenceSpanIds)?.filter((id): id is string => typeof id === 'string') ?? []))];
        const rawEvidenceSpanIds = arrayOf(beat.evidenceSpanIds);
        const evidenceSpanIds = rawEvidenceSpanIds?.filter((id): id is string => typeof id === 'string') ?? [];
        if (!rawEvidenceSpanIds || evidenceSpanIds.length !== rawEvidenceSpanIds.length || canonicalHash(expectedEvidenceSpanIds) !== canonicalHash(evidenceSpanIds)) {
          problems.push(`scene ${locked.sceneId} beat ${beat.beatId} evidence span projection does not match its cited canonical claims`);
        }
      }
      const cited = beatClaimIds.map((id) => claimsById.get(id)).filter((claim): claim is JsonRecord => Boolean(claim));
      const unverifiedClaims = cited.filter((claim) => claim.epistemicType === 'unverified_explanation' || claim.verificationStatus === 'unverified');
      if (unverifiedClaims.length && (beatClaimIds.length !== 1 || beatClaimIds[0] !== unverifiedClaims[0]?.id)) problems.push(`scene ${locked.sceneId} unverified explanation beat ${beat.beatId} must cite only its one unverified claim`);
      if (unverifiedClaims.length && beat.narrationOnly !== true) problems.push(`scene ${locked.sceneId} unverified explanation beat ${beat.beatId} must be narration-only`);
      if (unverifiedClaims.length && (arrayOf(beat.relationships)?.length ?? 0) > 0) problems.push(`scene ${locked.sceneId} unverified explanation beat ${beat.beatId} cannot assert graph relations`);
      if (unverifiedClaims.length && (arrayOf(beat.entities)?.length ?? 0) > 0) problems.push(`scene ${locked.sceneId} unverified explanation beat ${beat.beatId} cannot depict entities`);
      for (const rawEntity of arrayOf(beat.entities) ?? []) {
        const entity = recordOf(rawEntity);
        if (typeof entity?.conceptId !== 'string' || !cited.some((claim) => (arrayOf(claim.conceptIds) ?? []).includes(entity.conceptId))) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has an entity outside its cited claim concepts`);
      }
      for (const relation of arrayOf(beat.relationships) ?? []) {
        const key = relationKey(relation);
        if (!key || !cited.some((claim) => (arrayOf(claim.relations) ?? []).some((candidate) => relationKey(candidate) === key))) problems.push(`scene ${locked.sceneId} beat ${beat.beatId} has a directed relation outside its cited claims`);
      }
    }
    for (const claimId of unverifiedClaimIds) {
      const beatCount = (planBeats ?? []).reduce<number>((count, rawBeat) => {
        const beat = recordOf(rawBeat);
        return count + ((arrayOf(beat?.claimIds) ?? []).filter((id) => id === claimId).length);
      }, 0);
      if (beatCount !== 1) problems.push(`scene ${locked.sceneId} unverified explanation claim ${claimId} must appear in exactly one isolated narration-only beat`);
    }

    const contextNarration = recordOf(beatNarrations[locked.sceneId]);
    const sceneNarration = recordOf(sceneRecord?.narration);
    if (!contextNarration || !sceneNarration || typeof contextNarration.text !== 'string' || canonicalHash(contextNarration) !== canonicalHash(sceneNarration)) {
      problems.push(`scene ${locked.sceneId} narration does not match the pinned beat narration`);
    }
    if (contextV9) {
      for (const problem of compiledSemanticAnchorProblems(contextNarration, planBeats ?? [])) {
        problems.push(`scene ${locked.sceneId}: ${problem}`);
      }
    }
    if (sceneNarration && typeof sceneNarration.text === 'string') {
      const text = sceneNarration.text;
      const spans = arrayOf(sceneNarration.claimSpans) ?? [];
      const seen = new Set<string>();
      for (const rawSpan of spans) {
        const span = recordOf(rawSpan);
        const start = typeof span?.plainStart === 'number' ? span.plainStart : undefined;
        const end = typeof span?.plainEnd === 'number' ? span.plainEnd : undefined;
        if (!span || typeof span.claimId !== 'string' || !claimsById.has(span.claimId) || typeof span.exactText !== 'string' || start === undefined || end === undefined) {
          problems.push(`scene ${locked.sceneId} has an invalid anchored claim span`); continue;
        }
        const exact = text.slice(start, end);
        if (exact !== span.exactText || end <= start) problems.push(`scene ${locked.sceneId} claim ${span.claimId} anchor does not match its narration text`);
        const claim = claimsById.get(span.claimId)!;
        if (claim.epistemicType === 'unverified_explanation') {
          const framingProblem = epistemicTextFramingProblem('unverified_explanation', span.exactText);
          if (framingProblem) problems.push(`scene ${locked.sceneId} claim ${span.claimId} narration framing mismatch: ${framingProblem}`);
        }
        if (typeof claim.statement === 'string') {
          const claimConceptIds = arrayOf(claim.conceptIds)?.filter((id): id is string => typeof id === 'string') ?? [];
          const claimRelations = arrayOf(claim.relations) ?? [];
          const identity = deriveClaimIdentity({ statement: claim.statement, conceptIds: claimConceptIds, relations: claimRelations } as Parameters<typeof deriveClaimIdentity>[0], concepts.flatMap((concept) => typeof concept.id === 'string' && typeof concept.label === 'string' ? [{ id: concept.id, label: concept.label }] : []));
          for (const mismatch of claimIdentityMismatch(identity, span.exactText)) problems.push(`scene ${locked.sceneId} claim ${span.claimId} narration identity mismatch: ${formatClaimIdentityMismatch(mismatch)}`);
        }
        const beatSpan = (arrayOf(sceneNarration.beatSpans) ?? []).map(recordOf).find((beat) => typeof beat?.charStart === 'number' && typeof beat.charEnd === 'number' && start >= beat.charStart && end <= beat.charEnd);
        if (!beatSpan || typeof beatSpan.beatId !== 'string' || !(arrayOf(beatsById.get(beatSpan.beatId)?.claimIds) ?? []).includes(span.claimId)) problems.push(`scene ${locked.sceneId} claim ${span.claimId} anchor is not joined to a beat that cites it`);
        seen.add(span.claimId);
      }
      for (const claimId of claimsById.keys()) if (!seen.has(claimId)) problems.push(`scene ${locked.sceneId} claim ${claimId} has no anchored narration sentence`);
    }

    const ops = arrayOf(sceneRecord?.ops) ?? [];
    const capturedScene = captured[sceneIndex];
    const capturedOps = capturedScene?.timeline.ops.map((scheduled) => scheduled.op) ?? [];
    if (canonicalHash(ops) !== canonicalHash(capturedOps)) problems.push(`scene ${locked.sceneId} semantic BoardOps do not match the captured timeline`);
    problems.push(...representationExecutionProblems(sceneRecord, context, planBeats ?? [], capturedOps, capturedScene, locked.sceneId));
    const transition = SceneTransitionSchema.safeParse(sceneRecord?.transition);
    const parsedOps = ops.map((op) => BoardOpSchema.safeParse(op));
    if (!transition.success || parsedOps.some((parsed) => !parsed.success)) {
      problems.push(`scene ${locked.sceneId} has an invalid transition or BoardOp identity record`);
    } else if (capturedScene) {
      try {
        const beatOrder = (planBeats ?? []).flatMap((beat) => typeof recordOf(beat)?.beatId === 'string' ? [recordOf(beat)!.beatId as string] : []);
        const validOps = parsedOps.map((parsed) => (parsed as { success: true; data: BoardOp }).data);
        const initial = startScene(expectedCarried, transition.data, locked.sceneId);
        if (canonicalHash(initial) !== canonicalHash(capturedScene.timeline.states[0])) problems.push(`scene ${locked.sceneId} captured initial board state does not follow the pinned transition`);
        let state = initial;
        validOps.forEach((op, opIndex) => {
          state = applyOpAfter(state, op, validOps[opIndex - 1]?.beatId, beatOrder).state;
          if (canonicalHash(state) !== canonicalHash(capturedScene.timeline.states[opIndex + 1])) problems.push(`scene ${locked.sceneId} captured board state after operation ${op.opId} does not match deterministic BoardOp replay`);
        });
        if (capturedScene.timeline.states.length !== validOps.length + 1) problems.push(`scene ${locked.sceneId} captured board state count does not match its operations`);
        expectedCarried = state;
      } catch (error) {
        problems.push(`scene ${locked.sceneId} BoardOps cannot reproduce captured board state: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const stateAt = (index: number): JsonRecord | undefined => recordOf(capturedScene?.timeline.states[index]);
    const elementSpec = (id: unknown, stateIndex: number): JsonRecord | undefined => {
      if (typeof id !== 'string') return undefined;
      const elements = recordOf(stateAt(stateIndex)?.elements);
      return recordOf(recordOf(elements?.[id])?.spec);
    };
    const specsOf = (op: JsonRecord): JsonRecord[] => {
      if (op.op === 'add' || op.op === 'replace') { const spec = recordOf(op.element); return spec ? [spec] : []; }
      if (op.op === 'split') return (arrayOf(op.into) ?? []).flatMap((part) => { const spec = recordOf(recordOf(part)?.element); return spec ? [spec] : []; });
      if (op.op === 'merge') { const spec = recordOf(recordOf(op.into)?.element); return spec ? [spec] : []; }
      return [];
    };
    const opClaimIds = (op: JsonRecord, beatId: string): string[] => {
      const beatClaims = arrayOf(beatsById.get(beatId)?.claimIds)?.filter((id): id is string => typeof id === 'string') ?? [];
      if (op.op !== 'connect') return beatClaims;
      const bindings = recordOf(op.bindings);
      const claimIds = arrayOf(bindings?.claimIds)?.filter((id): id is string => typeof id === 'string') ?? [];
      if (!claimIds.length || claimIds.some((id) => !beatClaims.includes(id))) problems.push(`scene ${locked.sceneId} operation is not bound to claims on its beat`);
      return claimIds;
    };
    ops.forEach((rawOp, opIndex) => {
      const op = recordOf(rawOp);
      if (!op || typeof op.beatId !== 'string') { problems.push(`scene ${locked.sceneId} has an operation without a beat id`); return; }
      const parentClaimIds = opClaimIds(op, op.beatId);
      const beatClaimIds = arrayOf(beatsById.get(op.beatId)?.claimIds)?.filter((id): id is string => typeof id === 'string') ?? [];
      if (beatClaimIds.some((id) => claimsById.get(id)?.epistemicType === 'unverified_explanation' || claimsById.get(id)?.verificationStatus === 'unverified')) {
        problems.push(`scene ${locked.sceneId} BoardOp ${String(op.opId ?? opIndex)} is attached to an unverified explanation beat`);
      }
      if (parentClaimIds.some((id) => claimsById.get(id)?.epistemicType === 'unverified_explanation' || claimsById.get(id)?.verificationStatus === 'unverified')) {
        problems.push(`scene ${locked.sceneId} BoardOp ${String(op.opId ?? opIndex)} is bound to an unverified explanation claim`);
      }
      for (const spec of specsOf(op)) {
        const bindings = recordOf(spec.bindings);
        const boundClaims = arrayOf(bindings?.claimIds)?.filter((id): id is string => typeof id === 'string') ?? [];
        if (boundClaims.some((id) => claimsById.get(id)?.epistemicType === 'unverified_explanation' || claimsById.get(id)?.verificationStatus === 'unverified')) problems.push(`scene ${locked.sceneId} visual is bound to an unverified explanation claim`);
        const conceptIds = [ ...(typeof spec.conceptId === 'string' ? [spec.conceptId] : []), ...(arrayOf(bindings?.conceptIds)?.filter((id): id is string => typeof id === 'string') ?? []) ];
        if (!boundClaims.length || boundClaims.some((id) => !parentClaimIds.includes(id))) problems.push(`scene ${locked.sceneId} visual is not bound to claims on its beat`);
        const allowed = new Set(boundClaims.flatMap((id) => arrayOf(claimsById.get(id)?.conceptIds)?.filter((value): value is string => typeof value === 'string') ?? []));
        if (!conceptIds.length || conceptIds.some((id) => !allowed.has(id))) problems.push(`scene ${locked.sceneId} visual concepts do not match its linked claims`);
        if (spec.type === 'entity' && typeof spec.conceptId === 'string' && typeof spec.label === 'string') {
          const other = [...conceptLabels].find(([id, label]) => id !== spec.conceptId && normalizedConceptLabel(label) === normalizedConceptLabel(spec.label as string));
          if (other) problems.push(`scene ${locked.sceneId} entity label ${JSON.stringify(spec.label)} names graph concept ${other[0]}, but is bound to ${spec.conceptId}`);
        }
      }
      if (op.op === 'connect') {
        const from = elementSpec(op.from, opIndex);
        const to = elementSpec(op.to, opIndex);
        const fromIds = from ? [...new Set([...(typeof from.conceptId === 'string' ? [from.conceptId] : []), ...(arrayOf(recordOf(from.bindings)?.conceptIds)?.filter((id): id is string => typeof id === 'string') ?? [])])] : [];
        const toIds = to ? [...new Set([...(typeof to.conceptId === 'string' ? [to.conceptId] : []), ...(arrayOf(recordOf(to.bindings)?.conceptIds)?.filter((id): id is string => typeof id === 'string') ?? [])])] : [];
        const bindings = recordOf(op.bindings);
        const boundConcepts = arrayOf(bindings?.conceptIds)?.filter((id): id is string => typeof id === 'string') ?? [];
        const allowed = new Set(parentClaimIds.flatMap((id) => arrayOf(claimsById.get(id)?.conceptIds)?.filter((value): value is string => typeof value === 'string') ?? []));
        if (!boundConcepts.length || boundConcepts.some((id) => !allowed.has(id)) || fromIds.some((id) => !boundConcepts.includes(id)) || toIds.some((id) => !boundConcepts.includes(id))) problems.push(`scene ${locked.sceneId} captured edge concept bindings do not match its endpoints and linked claims`);
        const predicate = typeof op.relation === 'string' ? op.relation.toLowerCase() : undefined;
        const relevant = parentClaimIds.flatMap((id) => arrayOf(claimsById.get(id)?.relations) ?? []).map(recordOf).filter((relation): relation is JsonRecord => Boolean(relation));
        if (relevant.length === 0) problems.push(`scene ${locked.sceneId} captured factual edge has no directed relation on its linked claims`);
        if (fromIds.length === 1 && toIds.length === 1 && predicate !== undefined) {
          if (relevant.length > 0 && !relevant.some((relation) => relation.from === fromIds[0] && relation.to === toIds[0] && typeof relation.type === 'string' && relation.type.toLowerCase() === predicate)) problems.push(`scene ${locked.sceneId} captured edge direction or predicate does not match a linked claim relation`);
        }
      }
    });
  });
  return [...new Set(problems)];
}

/** A completed temp file is linked into place atomically; link never overwrites an existing lock. */
async function publishExclusive(file: string, bytes: string): Promise<void> {
  const partial = `${file}.${randomUUID()}.partial.json`;
  try { await writeFile(partial, bytes, { flag: 'wx' }); await link(partial, file); }
  finally { await rm(partial, { force: true }); }
}

/** Lexical and realpath checks both apply: a hash-matching symlink outside the run is still forbidden. */
async function confinedPath(root: string, rel: string): Promise<string> {
  if (!rel || path.isAbsolute(rel) || rel.includes('\\') || rel.includes('\0') || rel.split('/').some((part) => part === '..' || part === '.' || part === '')) throw new Error(`unsafe locked path ${rel}`);
  const base = await realpath(root);
  const full = await realpath(path.join(base, rel));
  if (!full.startsWith(`${base}${path.sep}`)) throw new Error(`locked path escapes outputDir: ${rel}`);
  return full;
}

/** Read a pinned file, refusing unsafe paths and any byte drift. */
export async function readRef(root: string, ref: { file: string; hash: string }): Promise<Buffer> {
  const bytes = await readFile(await confinedPath(root, ref.file));
  if (bytesHash(bytes) !== ref.hash) throw new Error(`${ref.file} hash drift`);
  return bytes;
}

function captureScene({ scene }: V2VideoScene): CapturedScene {
  const ids = [...new Set(scene.timeline.states.flatMap((state) => Object.keys(state.elements)))].sort();
  return CapturedSchema.parse(JSON.parse(JSON.stringify({
    sceneId: scene.sceneId, title: scene.title, seedBase: scene.seedBase,
    concepts: [...(scene.concepts?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b)),
    timeline: scene.timeline,
    geometry: {
      contentRect: scene.geometry.contentRect, regionRects: scene.geometry.regionRects, allRects: scene.geometry.allRects(),
      states: scene.timeline.states.map((state) => ids.flatMap((id) => { const rect = scene.geometry.rectFor(state, id); return rect ? [{ id, rect }] : []; })),
      kitFrames: ids.flatMap((id) => { const kit = scene.geometry.kitGeometry(id); return kit ? [[id, kit.frame]] : []; }),
      edgeRoutes: scene.timeline.states.map((state) => Object.keys(state.edges).sort().flatMap((id) => { const route = scene.geometry.edgeRouteFor(state, id); return route ? [route] : []; })),
    },
  })));
}

function capturedHashes(captured: CapturedScene) {
  const scheduledHashInput = captured.timeline.ops.map((s) => [s.op.opId, Math.round(s.t0), Math.round(s.t1)]);
  return {
    timelineHash: captured.timeline.lifecycleEvents
      ? canonicalHash([scheduledHashInput, captured.timeline.lifecycleEvents.map((event) => [event.kind, event.beatId, Math.round(event.atMs), event.state])])
      : canonicalHash(scheduledHashInput),
    geometryHash: canonicalHash(captured.geometry), boardOpsHash: canonicalHash(captured.timeline.ops.map((s) => s.op)),
    boardStatesHash: canonicalHash(captured.timeline.states), conceptsHash: canonicalHash(captured.concepts),
  };
}

function raster(svg: string, lock: Pick<LessonLockV2, 'font' | 'render'>, fontFile: string): Buffer {
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: [fontFile], defaultFontFamily: lock.font.family, sansSerifFamily: lock.font.family }, fitTo: { mode: 'width', value: lock.render.width } }).render().asPng());
}

export const SCENE_LOCK_V2_VERSION = 'scene.lock/v2-teaching-compiler';
const SceneLockSchema = z.object({
  schemaVersion: z.literal(SCENE_LOCK_V2_VERSION), lessonId: z.string().min(1),
  sceneId: z.string().regex(/^[a-zA-Z0-9_-]+$/), index: z.number().int().nonnegative(),
  startMs: z.number().nonnegative(), endMs: z.number().positive(), fps: z.number().int().positive().max(120),
  scene: Ref, audio: Ref, captured: Ref,
  timelineHash: Hash, geometryHash: Hash, boardOpsHash: Hash, boardStatesHash: Hash, conceptsHash: Hash,
  firstFrame: z.number().int().nonnegative(), frames: z.number().int().positive(),
  renderPlan: z.array(Segment).min(1), svgAssets: z.array(Ref).min(1), samples: z.array(SampleSchema).min(1),
  contentHash: Hash,
}).strict();
export type SceneLockV2 = z.infer<typeof SceneLockSchema>;
const SCENE_LOCK_DIR = 'v2/locked/scene-locks';
const sceneLockFile = (sceneId: string): string => `${SCENE_LOCK_DIR}/${sceneId}.scene.lock.json`;
const sceneLockHash = (lock: SceneLockV2): string => { const { contentHash: _ignored, ...body } = lock; return canonicalHash(body); };

/** First frame whose timestamp is at or after `ms`; frames belong to the scene whose placement contains their time. */
function firstFrameAtOrAfter(ms: number, fps: number): number {
  let frame = Math.max(0, Math.floor(ms * fps / 1000) - 1);
  while (frame * 1000 / fps < ms) frame++;
  return frame;
}
/** Frame range of a placement. The last scene runs to the lock's rounded frame count, as the single-lock writer always did. */
function sceneFrameRange(startMs: number, endMs: number, fps: number, final: boolean): { firstFrame: number; frames: number } {
  const firstFrame = firstFrameAtOrAfter(startMs, fps);
  const end = final ? Math.max(1, Math.round(endMs * fps / 1000)) : firstFrameAtOrAfter(endMs, fps);
  return { firstFrame, frames: Math.max(1, end - firstFrame) };
}

function svgProblem(hash: string, svg: string): string | undefined {
  if (!/^<svg[\s>]/.test(svg) || /<(?:script|foreignObject)\b/i.test(svg) || /(?:href\s*=\s*["'](?!#)|url\(\s*["']?(?!#))[^\s)]*(?:https?:|file:|\/\/)/i.test(svg)) return `SVG ${hash} contains external or executable content`;
  return undefined;
}

/** Content-addressed and idempotent: an existing file must already hold exactly these bytes. */
async function persistAddressed(outputDir: string, file: string, bytes: Buffer | string): Promise<{ file: string; hash: string }> {
  const hash = bytesHash(bytes);
  try { await writeFile(path.join(outputDir, file), bytes, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (bytesHash(await readFile(path.join(outputDir, file))) !== hash) throw new Error(`${file} exists with different bytes`);
  }
  return { file, hash };
}

async function sceneLockExists(outputDir: string, sceneId: string): Promise<boolean> {
  try { await access(path.join(outputDir, sceneLockFile(sceneId))); return true; } catch { return false; }
}

/**
 * Freeze one scene as soon as it compiles: its captured state, every SVG frame it needs, its render-plan segments and raster
 * pins. A scene lock is immutable and verifiable alone, so playback of the finished prefix can start while later scenes are
 * still being planned. The lesson lock later aggregates these files without re-rendering.
 */
export async function publishSceneLockV2(input: { outputDir: string; lessonId: string; index: number; item: V2VideoScene; fps: number; final?: boolean }): Promise<SceneLockV2> {
  const { outputDir, lessonId, index, item, fps } = input;
  const sceneId = item.scene.sceneId;
  if (!/^[a-zA-Z0-9_-]+$/.test(sceneId)) throw new Error('invalid V2 sceneId');
  if (!Number.isInteger(fps) || fps < 1 || fps > 120 || !Number.isInteger(index) || index < 0) throw new Error('scene lock needs a non-negative index and FPS from 1 to 120');
  if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs) throw new Error('V2 scene placement must be a positive interval');
  if (await sceneLockExists(outputDir, sceneId)) throw new Error(`scene lock already published: ${sceneId}`);
  const fontBytes = await readFile(KALAM_BOLD_FILE);
  if (bytesHash(fontBytes) !== KALAM_FONT_SHA256) throw new Error('bundled font content hash drift');
  for (const dir of ['svg', 'scenes']) await mkdir(path.join(outputDir, 'v2', 'locked', dir), { recursive: true });
  await mkdir(path.join(outputDir, SCENE_LOCK_DIR), { recursive: true });

  const captured = captureScene(item);
  const capturedRef = await persistAddressed(outputDir, `v2/locked/scenes/${sceneId}.json`, jsonBytes(captured));
  const readRefFile = async (file: string) => ({ file, hash: bytesHash(await readFile(await confinedPath(outputDir, file))) });
  const sceneRef = await readRefFile(`v2/scene.${sceneId}.json`);
  const audioRef = await readRefFile(`scene-audio/${sceneId}.wav`);

  const { firstFrame, frames } = sceneFrameRange(item.startMs, item.endMs, fps, input.final === true);
  const svgBytes = new Map<string, string>();
  const svgAssets: SceneLockV2['svgAssets'] = [];
  const storeSvg = async (svg: string): Promise<string> => {
    const hash = bytesHash(svg);
    if (!svgBytes.has(hash)) { svgBytes.set(hash, svg); svgAssets.push(await persistAddressed(outputDir, `v2/locked/svg/${hash}.svg`, svg)); }
    return hash;
  };
  const renderPlan: RenderSegment[] = [];
  const transitions: Array<{ frame: number; svgHash: string; sampleTimeMs: number }> = [];
  const holds = new Map<string, string>();
  const stateHash = (index: number) => canonicalHash([captured.geometry, captured.timeline.states[index]]);
  for (let frame = firstFrame; frame < firstFrame + frames; frame++) {
    const local = Math.max(0, frame * 1000 / fps - item.startMs);
    const key = holdKey(item.scene, local);
    let svgHash = key === undefined ? undefined : holds.get(key);
    if (!svgHash) { svgHash = await storeSvg(renderSceneSvg(item.scene, local)); if (key !== undefined) holds.set(key, svgHash); }
    const done = captured.timeline.ops.filter((s) => s.t1 <= local).length;
    const previous = renderPlan.at(-1);
    if (key !== undefined) {
      if (previous?.kind === 'hold' && previous.svgHash === svgHash) previous.frameCount++;
      else renderPlan.push({ kind: 'hold', sceneId, firstFrame: frame, frameCount: 1, stateHash: stateHash(done), svgHash });
    } else {
      const flightEnd = captured.timeline.ops.filter((s) => s.t0 < local).length;
      const fromStateHash = stateHash(done); const toStateHash = stateHash(Math.max(done, flightEnd));
      if (previous?.kind === 'transition' && previous.fromStateHash === fromStateHash && previous.toStateHash === toStateHash) { previous.frameCount++; previous.svgHashes.push(svgHash); }
      else renderPlan.push({ kind: 'transition', sceneId, firstFrame: frame, frameCount: 1, fromStateHash, toStateHash, fps, svgHashes: [svgHash] });
      transitions.push({ frame, svgHash, sampleTimeMs: local });
    }
  }
  const samples: SceneLockV2['samples'] = [];
  const pinFont = { family: KALAM_FONT_FAMILY } as const;
  const rasterHash = (svgHash: string): string => bytesHash(raster(svgBytes.get(svgHash)!, { font: { ...pinFont, file: '', hash: KALAM_FONT_SHA256, loadSystemFonts: false }, render: { fps, durationMs: 1, width: STYLE.canvas.w, height: STYLE.canvas.h, frames: 1 } }, KALAM_BOLD_FILE));
  // Representative evidence: first, middle and last sampled transition frame, plus the completed scene. Not every video frame.
  for (const at of new Set([0, Math.floor(transitions.length / 2), transitions.length - 1])) {
    const selected = transitions[at]; if (selected) samples.push({ sceneId, kind: 'transition', svgHash: selected.svgHash, sampleTimeMs: selected.sampleTimeMs, frame: selected.frame, pngHash: rasterHash(selected.svgHash) });
  }
  const finalTime = Math.max(700, item.scene.timeline.durationMs);
  const finalHash = await storeSvg(renderSceneSvg(item.scene, finalTime));
  samples.push({ sceneId, kind: 'final', svgHash: finalHash, sampleTimeMs: finalTime, pngHash: rasterHash(finalHash) });

  const lock = SceneLockSchema.parse({
    schemaVersion: SCENE_LOCK_V2_VERSION, lessonId, sceneId, index, startMs: item.startMs, endMs: item.endMs, fps,
    scene: sceneRef, audio: audioRef, captured: capturedRef, ...capturedHashes(captured), firstFrame, frames, renderPlan, svgAssets, samples, contentHash: '0'.repeat(64),
  });
  lock.contentHash = sceneLockHash(lock);
  await publishExclusive(path.join(outputDir, sceneLockFile(sceneId)), jsonBytes(lock));
  return lock;
}

/** Everything a scene lock pins must still hold: bytes, hashes, safe paths, SVG content and a gapless frame range. */
export async function verifySceneLockV2(outputDir: string, sceneId: string): Promise<string[]> {
  const problems: string[] = [];
  let lock: SceneLockV2;
  try {
    const parsed = SceneLockSchema.safeParse(JSON.parse((await readFile(await confinedPath(outputDir, sceneLockFile(sceneId)))).toString('utf8')));
    if (!parsed.success) return [`scene lock ${sceneId} structure invalid: ${parsed.error.message}`];
    lock = parsed.data;
  } catch (error) { return [`scene lock ${sceneId} unreadable: ${error instanceof Error ? error.message : String(error)}`]; }
  if (lock.sceneId !== sceneId) problems.push(`scene lock ${sceneId} names scene ${lock.sceneId}`);
  if (sceneLockHash(lock) !== lock.contentHash) problems.push(`scene lock ${sceneId} content hash mismatch`);
  const load = async (ref: { file: string; hash: string }, label: string): Promise<Buffer | undefined> => {
    try { return await readRef(outputDir, ref); } catch (error) { problems.push(`scene ${sceneId} ${label}: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
  };
  await load(lock.scene, 'semantic data');
  await load(lock.audio, 'audio');
  const capturedBytes = await load(lock.captured, 'captured state');
  if (capturedBytes) {
    try {
      const data = CapturedSchema.parse(JSON.parse(capturedBytes.toString('utf8')));
      const hashes = capturedHashes(data);
      for (const [key, actual] of Object.entries(hashes)) if (actual !== lock[key as keyof typeof hashes]) problems.push(`scene ${sceneId} ${key} hash drift`);
    } catch { problems.push(`scene ${sceneId} captured JSON invalid`); }
  }
  const svgs = new Set<string>();
  for (const ref of lock.svgAssets) {
    const bytes = await load(ref, 'SVG');
    if (bytes) { const problem = svgProblem(ref.hash, bytes.toString('utf8')); if (problem) problems.push(problem); svgs.add(ref.hash); }
  }
  let cursor = lock.firstFrame;
  for (const segment of lock.renderPlan) {
    if (segment.sceneId !== sceneId || segment.firstFrame !== cursor) problems.push(`scene ${sceneId} render plan frame range invalid`);
    cursor += segment.frameCount;
    const hashes = segment.kind === 'hold' ? [segment.svgHash] : segment.svgHashes;
    if (segment.kind === 'transition' && (segment.fps !== lock.fps || hashes.length !== segment.frameCount)) problems.push(`scene ${sceneId} transition frame range or FPS invalid`);
    if (hashes.some((hash) => !svgs.has(hash))) problems.push(`scene ${sceneId} render plan references missing SVG bytes`);
  }
  if (cursor !== lock.firstFrame + lock.frames) problems.push(`scene ${sceneId} render plan does not cover its frames`);
  if (!lock.samples.some((sample) => sample.kind === 'final')) problems.push(`scene ${sceneId} requires a final raster sample`);
  for (const sample of lock.samples) if (sample.sceneId !== sceneId || !svgs.has(sample.svgHash)) problems.push(`scene ${sceneId} raster sample reference invalid`);
  return problems;
}

export interface ReadyPrefixV2 { scenes: SceneLockV2[]; readyThroughMs: number; stoppedBecause?: string }

/** The playable prefix: scene locks 0..k that are all present, verified, and placed edge to edge on the audio clock. */
export async function readyPrefixV2(outputDir: string): Promise<ReadyPrefixV2> {
  let names: string[];
  try { names = (await readdir(path.join(outputDir, SCENE_LOCK_DIR))).filter((name) => name.endsWith('.scene.lock.json')); }
  catch { return { scenes: [], readyThroughMs: 0 }; }
  const byIndex = new Map<number, string>();
  for (const name of names) {
    const sceneId = name.slice(0, -'.scene.lock.json'.length);
    try {
      const parsed = SceneLockSchema.safeParse(JSON.parse(await readFile(path.join(outputDir, SCENE_LOCK_DIR, name), 'utf8')));
      if (parsed.success && !byIndex.has(parsed.data.index)) byIndex.set(parsed.data.index, sceneId);
    } catch { /* unreadable locks simply are not ready */ }
  }
  const ready: SceneLockV2[] = [];
  let endMs = 0;
  for (let index = 0; byIndex.has(index); index++) {
    const sceneId = byIndex.get(index)!;
    const problems = await verifySceneLockV2(outputDir, sceneId);
    if (problems.length) return { scenes: ready, readyThroughMs: endMs, stoppedBecause: problems[0]! };
    const lock = SceneLockSchema.parse(JSON.parse(await readFile(path.join(outputDir, sceneLockFile(sceneId)), 'utf8')));
    if (lock.startMs !== endMs) return { scenes: ready, readyThroughMs: endMs, stoppedBecause: `scene ${sceneId} does not start where the previous scene ends` };
    ready.push(lock); endMs = lock.endMs;
  }
  return { scenes: ready, readyThroughMs: endMs };
}

/** Wall-clock publication log. Deliberately outside every pinned file so locks stay byte-deterministic. */
export async function recordSceneProgressV2(outputDir: string, event: { sceneId: string; index: number; sinceRequestMs: number; sinceStartMs: number }): Promise<void> {
  const file = path.join(outputDir, 'v2', 'progress.json');
  let events: unknown[] = [];
  try { events = (JSON.parse(await readFile(file, 'utf8')) as { events: unknown[] }).events; } catch { /* first event */ }
  const next = { schemaVersion: 'v2-progress/v1', events: [...events, { ...event, sinceRequestMs: Math.round(event.sinceRequestMs), sinceStartMs: Math.round(event.sinceStartMs) }] };
  const partial = `${file}.${randomUUID()}.partial.json`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(partial, jsonBytes(next), { flag: 'wx' });
  await rename(partial, file);
}

/** Aggregate the published scene locks into the lesson lock. Missing scene locks are published here; none are re-rendered if present. */
export async function writeLessonLockV2(input: { outputDir: string; lessonId: string; scenes: readonly V2VideoScene[]; durationMs: number; audioPath: string; fps: number }): Promise<LessonLockV2> {
  const { outputDir, lessonId, fps, durationMs } = input;
  for (const name of ['lesson.lock.json', 'lesson.lock.v2.json']) {
    try { await access(path.join(outputDir, name)); } catch { continue; }
    throw new Error(`lesson lock already published: ${name}`);
  }
  if (!input.scenes.length || !Number.isInteger(fps) || fps < 1 || fps > 120 || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error('V2 lock needs scenes, a positive duration and FPS from 1 to 120');
  const scenes = [...input.scenes].sort((a, b) => a.startMs - b.startMs);
  const ids = new Set<string>();
  for (const [i, item] of scenes.entries()) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.scene.sceneId) || ids.has(item.scene.sceneId)) throw new Error('invalid or duplicate V2 sceneId');
    ids.add(item.scene.sceneId);
    if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.endMs <= item.startMs || item.startMs < 0 || (i === 0 && item.startMs !== 0) || (i > 0 && item.startMs !== scenes[i - 1]!.endMs)) throw new Error('V2 scene placements must cover a continuous audio clock');
  }
  if (scenes.at(-1)!.endMs !== durationMs) throw new Error('V2 scene placements must end at durationMs');
  const versions = { ...probeToolVersions(), kalamSha256: KALAM_FONT_SHA256, renderPlan: 'svg-frame-ranges/v1' as const };
  for (const [tool, version] of Object.entries(versions)) if (!version || version === 'unknown') throw new Error(`V2 lock requires a known ${tool} version`);
  const fontBytes = await readFile(KALAM_BOLD_FILE);
  if (bytesHash(fontBytes) !== KALAM_FONT_SHA256) throw new Error('bundled font content hash drift');
  const lockedDir = path.join(outputDir, 'v2', 'locked');
  await mkdir(path.join(lockedDir, 'fonts'), { recursive: true });
  await mkdir(path.join(lockedDir, 'audio'), { recursive: true });
  const persist = async (file: string, bytes: Buffer | string) => {
    await writeFile(path.join(outputDir, file), bytes, { flag: 'wx' });
    return { file, hash: bytesHash(bytes) };
  };
  const ref = async (file: string) => ({ file, hash: bytesHash(await readFile(await confinedPath(outputDir, file))) });
  const font: LessonLockV2['font'] = { ...await persist('v2/locked/fonts/Kalam-Bold.ttf', fontBytes), family: KALAM_FONT_FAMILY, loadSystemFonts: false as const };
  // Audio input must itself belong to this run; export reads the captured copy.
  const sourceAudio = path.relative(outputDir, input.audioPath).split(path.sep).join('/');
  const audio = await persist('v2/locked/audio/master.wav', await readFile(await confinedPath(outputDir, sourceAudio)));
  const context = await ref('v2/lesson-context.json');
  const alignment = await ref('v2/alignment.json');
  const hierarchyInput = await ref('v2/lesson-hierarchy-input.json').catch(() => undefined);
  const alignmentBytes = await readRef(outputDir, alignment);
  const semantic: unknown[] = [];
  const captions = await ref('captions.vtt');
  const records: LessonLockV2['scenes'] = [];
  const renderPlan: RenderSegment[] = [];
  const svgAssets: LessonLockV2['svgAssets'] = [];
  const seenSvg = new Set<string>();
  const samples: LessonLockV2['samples'] = [];
  let frameCursor = 0;
  for (const [index, item] of scenes.entries()) {
    const sceneId = item.scene.sceneId;
    const final = index === scenes.length - 1;
    const expected = sceneFrameRange(item.startMs, item.endMs, fps, final);
    let sceneLock: SceneLockV2;
    if (await sceneLockExists(outputDir, sceneId)) {
      const problems = await verifySceneLockV2(outputDir, sceneId);
      if (problems.length) throw new Error(`scene lock ${sceneId} failed verification: ${problems.join('; ')}`);
      sceneLock = SceneLockSchema.parse(JSON.parse(await readFile(path.join(outputDir, sceneLockFile(sceneId)), 'utf8')));
      const captured = capturedHashes(captureScene(item));
      const differs = sceneLock.index !== index || sceneLock.lessonId !== lessonId || sceneLock.fps !== fps || sceneLock.startMs !== item.startMs || sceneLock.endMs !== item.endMs
        || sceneLock.firstFrame !== expected.firstFrame || sceneLock.frames !== expected.frames
        || (Object.keys(captured) as Array<keyof typeof captured>).some((key) => sceneLock[key] !== captured[key]);
      if (differs) throw new Error(`scene lock ${sceneId} differs from the compiled scene (placement, frame range or captured state)`);
    } else {
      sceneLock = await publishSceneLockV2({ outputDir, lessonId, index, item, fps, final });
    }
    if (sceneLock.firstFrame !== frameCursor) throw new Error('scene lock frame ranges must be contiguous');
    frameCursor += sceneLock.frames;
    semantic.push(JSON.parse((await readRef(outputDir, sceneLock.scene)).toString('utf8')));
    records.push({ sceneId, startMs: item.startMs, endMs: item.endMs, file: sceneLock.scene.file, fileHash: sceneLock.scene.hash, audioFile: sceneLock.audio.file, audioHash: sceneLock.audio.hash, captured: sceneLock.captured,
      timelineHash: sceneLock.timelineHash, geometryHash: sceneLock.geometryHash, boardOpsHash: sceneLock.boardOpsHash, boardStatesHash: sceneLock.boardStatesHash, conceptsHash: sceneLock.conceptsHash });
    renderPlan.push(...sceneLock.renderPlan);
    for (const asset of sceneLock.svgAssets) if (!seenSvg.has(asset.hash)) { seenSvg.add(asset.hash); svgAssets.push(asset); }
    samples.push(...sceneLock.samples);
  }
  const frames = Math.max(1, Math.round(durationMs * fps / 1000));
  if (frameCursor !== frames) throw new Error(`scene locks cover ${frameCursor} frames, the lesson needs ${frames}`);
  const invalidAlignment = alignmentProblems(alignmentBytes, records, semantic);
  if (invalidAlignment.length) throw new Error(`V2 lock alignment validation failed: ${invalidAlignment.join('; ')}`);
  const render = { fps, durationMs, width: STYLE.canvas.w, height: STYLE.canvas.h, frames };
  const lock = LockSchema.parse({ schemaVersion: LESSON_LOCK_V2_VERSION, lessonId, context, alignment, ...(hierarchyInput ? { hierarchyInput } : {}), scenes: records, media: { audio, captions }, font, render, renderPlan, svgAssets, samples, versions, contentHash: '0'.repeat(64) });
  lock.contentHash = lockHash(lock);
  // Publish only after all inputs and representative PNG pins exist. Exclusive writes preserve previously published locks.
  const bytes = jsonBytes(lock);
  await publishExclusive(path.join(outputDir, 'lesson.lock.json'), bytes);
  await publishExclusive(path.join(outputDir, 'lesson.lock.v2.json'), bytes);
  return lock;
}

interface VerifiedLock { lock: LessonLockV2; captured: CapturedScene[]; semantic: unknown[]; context: Buffer; alignment: Buffer; audio: Buffer[]; svgs: Map<string, string>; fontPath: string }
interface RasterToolDrift { tool: 'node' | 'pipeline'; pinned: string; current: string }
async function inspectLock(outputDir: string, options: { allowRasterOnlyToolDrift?: boolean } = {}): Promise<{ problems: string[]; verified?: VerifiedLock; toleratedToolDrift: RasterToolDrift[] }> {
  const problems: string[] = [];
  const toleratedToolDrift: RasterToolDrift[] = [];
  let lock: LessonLockV2;
  try {
    const primary = await readFile(await confinedPath(outputDir, 'lesson.lock.json'));
    let aliasPresent = false;
    try { await lstat(path.join(outputDir, 'lesson.lock.v2.json')); aliasPresent = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problems.push('V2 compatibility alias cannot be inspected'); }
    if (aliasPresent) {
      try {
        const alias = await readFile(await confinedPath(outputDir, 'lesson.lock.v2.json'));
        if (!primary.equals(alias)) problems.push('canonical lesson.lock.json and V2 compatibility alias differ');
      } catch (error) { problems.push(`V2 compatibility alias unreadable: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const parsed = LockSchema.safeParse(JSON.parse(primary.toString('utf8')));
    if (!parsed.success) return { problems: [...problems, `V2 lock structure invalid: ${parsed.error.message}`], toleratedToolDrift };
    lock = parsed.data;
  } catch (error) { return { problems: [`V2 lesson lock unreadable: ${error instanceof Error ? error.message : String(error)}`], toleratedToolDrift }; }
  if (lockHash(lock) !== lock.contentHash) problems.push('lock content hash mismatch');
  const current = probeToolVersions();
  for (const tool of ['node', 'pipeline', 'resvg', 'roughjs', 'ffmpeg'] as const) {
    if (lock.versions[tool] === 'unknown' || current[tool] === 'unknown' || lock.versions[tool] !== current[tool]) {
      if (options.allowRasterOnlyToolDrift && (tool === 'node' || tool === 'pipeline') && lock.versions[tool] !== 'unknown' && current[tool] !== 'unknown') {
        toleratedToolDrift.push({ tool, pinned: lock.versions[tool], current: current[tool] });
      } else problems.push(`${tool} tool version drift or unknown pin`);
    }
  }
  if (lock.versions.kalamSha256 !== KALAM_FONT_SHA256 || lock.font.hash !== KALAM_FONT_SHA256) problems.push('font content hash drift');
  try { if (bytesHash(await readFile(KALAM_BOLD_FILE)) !== lock.font.hash) problems.push('bundled font content hash drift'); } catch { problems.push('bundled font missing'); }
  const load = async (ref: { file: string; hash: string }, label: string): Promise<Buffer | undefined> => {
    try { return await readRef(outputDir, ref); } catch (error) { problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
  };
  const context = await load(lock.context, 'lesson context');
  const alignment = await load(lock.alignment, 'alignment');
  const hierarchyInput = lock.hierarchyInput ? await load(lock.hierarchyInput, 'lesson hierarchy input') : undefined;
  try { if (context) JSON.parse(context.toString('utf8')); } catch { problems.push('lesson context JSON invalid'); }
  const captions = await load(lock.media.captions, 'captions');
  if (captions && !captions.toString('utf8').startsWith('WEBVTT')) problems.push('captions must be WEBVTT');
  const master = await load(lock.media.audio, 'master audio');
  await load(lock.font, 'font');
  const captured: CapturedScene[] = []; const semantic: unknown[] = []; const audio: Buffer[] = master ? [master] : [];
  const sceneIds = new Set<string>();
  let endMs = 0;
  for (const scene of lock.scenes) {
    if (sceneIds.has(scene.sceneId)) problems.push(`duplicate scene ${scene.sceneId}`); sceneIds.add(scene.sceneId);
    if (scene.startMs !== endMs || scene.endMs <= scene.startMs) problems.push(`scene ${scene.sceneId} audio placement invalid`); endMs = scene.endMs;
    const raw = await load({ file: scene.file, hash: scene.fileHash }, `scene ${scene.sceneId}`);
    const sceneAudio = await load({ file: scene.audioFile, hash: scene.audioHash }, `scene ${scene.sceneId} audio`); if (sceneAudio) audio.push(sceneAudio);
    try { semantic.push(raw ? JSON.parse(raw.toString('utf8')) : undefined); } catch { semantic.push(undefined); problems.push(`scene ${scene.sceneId} semantic JSON invalid`); }
    const bytes = await load(scene.captured, `scene ${scene.sceneId} captured`);
    if (bytes) {
      try {
        const data = CapturedSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (data.sceneId !== scene.sceneId || data.timeline.states.length !== data.timeline.ops.length + 1 || data.geometry.states.length !== data.timeline.states.length) problems.push(`scene ${scene.sceneId} captured state structure invalid`);
        if (data.geometry.edgeRoutes) {
          if (data.geometry.edgeRoutes.length !== data.timeline.states.length) problems.push(`scene ${scene.sceneId} captured edge route state count invalid`);
          data.geometry.edgeRoutes.forEach((routes, index) => {
            const state = data.timeline.states[index] as { edges?: Record<string, { lifecycle?: { removedAtBeat?: string } }> } | undefined;
            const expected = Object.entries(state?.edges ?? {}).filter(([, edge]) => edge.lifecycle?.removedAtBeat === undefined).map(([id]) => id).sort();
            if (routes.map((route) => route.id).join('\0') !== expected.join('\0')) problems.push(`scene ${scene.sceneId} captured edge route ids invalid at state ${index}`);
          });
        }
        const hashes = capturedHashes(data);
        for (const [key, actual] of Object.entries(hashes)) if (actual !== scene[key as keyof typeof hashes]) problems.push(`scene ${scene.sceneId} ${key} hash drift`);
        if (data.timeline.hash !== hashes.timelineHash) problems.push(`scene ${scene.sceneId} timeline content hash drift`);
        captured.push(data);
      } catch { problems.push(`scene ${scene.sceneId} captured JSON invalid`); }
    }
  }
  if (alignment) problems.push(...alignmentProblems(alignment, lock.scenes, semantic));
  if (context) {
    problems.push(...teachingIdentityProblems(context, lock.scenes, semantic, captured));
    problems.push(...lessonHierarchyProblems(context, lock.scenes, alignment, hierarchyInput));
  }
  if (endMs !== lock.render.durationMs || lock.render.frames !== Math.max(1, Math.round(lock.render.durationMs * lock.render.fps / 1000))) problems.push('render duration or frame count invalid');
  if (lock.render.width !== STYLE.canvas.w || lock.render.height !== STYLE.canvas.h) problems.push('render canvas version drift');
  const svgs = new Map<string, string>();
  for (const ref of lock.svgAssets) {
    if (svgs.has(ref.hash)) problems.push('duplicate SVG asset hash');
    const bytes = await load(ref, 'SVG');
    if (bytes) {
      const svg = bytes.toString('utf8');
      const problem = svgProblem(ref.hash, svg);
      if (problem) problems.push(problem);
      svgs.set(ref.hash, svg);
    }
  }
  let frameCursor = 0;
  for (const segment of lock.renderPlan) {
    if (!sceneIds.has(segment.sceneId) || segment.firstFrame !== frameCursor) problems.push('render plan frame range invalid');
    frameCursor += segment.frameCount;
    const hashes = segment.kind === 'hold' ? [segment.svgHash] : segment.svgHashes;
    if (segment.kind === 'transition' && (segment.fps !== lock.render.fps || hashes.length !== segment.frameCount)) problems.push('transition frame range or FPS invalid');
    if (hashes.some((hash) => !svgs.has(hash))) problems.push('render plan references missing SVG bytes');
  }
  if (frameCursor !== lock.render.frames) problems.push('render plan does not cover every frame');
  for (const sample of lock.samples) if (!sceneIds.has(sample.sceneId) || !svgs.has(sample.svgHash) || (sample.frame !== undefined && sample.frame >= lock.render.frames)) problems.push('raster sample reference invalid');
  for (const sceneId of sceneIds) {
    if (!lock.samples.some((sample) => sample.sceneId === sceneId && sample.kind === 'final')) problems.push(`scene ${sceneId} requires a final raster sample`);
    if (lock.renderPlan.some((segment) => segment.sceneId === sceneId && segment.kind === 'transition') && !lock.samples.some((sample) => sample.sceneId === sceneId && sample.kind === 'transition')) problems.push(`scene ${sceneId} requires a transition raster sample`);
  }
  if (problems.length || !context || !alignment) return { problems, toleratedToolDrift };
  return { problems, toleratedToolDrift, verified: { lock, captured, semantic, context, alignment, audio, svgs, fontPath: await confinedPath(outputDir, lock.font.file) } };
}

/** Fail closed on byte drift, unknown tool/font pins, incomplete frame ranges or unsafe references. */
export async function verifyLessonLockV2(outputDir: string): Promise<string[]> { return (await inspectLock(outputDir)).problems; }
export async function verifiedInputs(outputDir: string): Promise<VerifiedLock> {
  const { problems, verified } = await inspectLock(outputDir);
  if (problems.length || !verified) throw new Error(`V2 lesson lock verification failed: ${problems.join('; ')}`);
  return verified;
}

/**
 * Verify hash-pinned inputs for a raster-only benchmark. Only known Node and
 * compiler-version drift is tolerated: renderer libraries, font, canvas,
 * locked SVGs, samples, and every other lock invariant remain strict. Normal
 * playback, replay, and export must use `verifiedInputs` instead.
 */
export async function verifiedRasterInputs(outputDir: string): Promise<{ lock: LessonLockV2; svgs: Map<string, string>; toleratedToolDrift: RasterToolDrift[] }> {
  const { problems, verified, toleratedToolDrift } = await inspectLock(outputDir, { allowRasterOnlyToolDrift: true });
  if (problems.length || !verified) throw new Error(`V2 raster benchmark input verification failed: ${problems.join('; ')}`);
  return { lock: verified.lock, svgs: verified.svgs, toleratedToolDrift };
}

/** Recompute digests from captured bytes; fresh Resvg runs check representative PNG pins on every replay. This is sample evidence, not full decoded-video equality. */
export async function replayLessonV2(outputDir: string): Promise<ReplayDigest> {
  const { lock, captured, semantic, context, alignment, audio, svgs, fontPath } = await verifiedInputs(outputDir);
  const frames = lock.samples.map((sample) => {
    const actual = bytesHash(raster(svgs.get(sample.svgHash)!, lock, fontPath));
    if (actual !== sample.pngHash) throw new Error(`V2 raster sample PNG hash drift: ${sample.sceneId} ${sample.kind}`);
    return [sample.sceneId, sample.kind, sample.frame ?? null, sample.sampleTimeMs, actual];
  });
  return {
    geometry: canonicalHash(captured.map((scene) => [scene.sceneId, scene.geometry, scene.timeline.states])),
    events: canonicalHash([JSON.parse(context.toString('utf8')), alignment.toString('base64'), semantic, captured.map((scene) => [scene.sceneId, scene.timeline])]),
    assets: canonicalHash([captured.map((scene) => [scene.sceneId, scene.concepts]), [...svgs].map(([hash, svg]) => [hash, bytesHash(svg)]), bytesHash(await readFile(fontPath))]),
    audio: canonicalHash(audio.map(bytesHash)), frames: canonicalHash(frames),
  };
}

export interface EncodeLockedLessonV2Deps {
  createRasterPool?: (workers: number) => Pick<RasterPool, 'render' | 'close'>;
  spawnEncoder?: typeof spawnFrameEncoder;
}

/** Export consumes only verified locked bytes, including a private snapshot of verified audio. */
export async function encodeLockedLessonV2(outputDir: string, outPath: string, deps: EncodeLockedLessonV2Deps = {}): Promise<{ frames: number; rendered: number; reused: number }> {
  const { lock, audio, svgs } = await verifiedInputs(outputDir);
  await mkdir(path.dirname(outPath), { recursive: true });
  const nonce = randomUUID();
  const partial = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${nonce}.partial.mp4`);
  const audioSnapshot = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${nonce}.audio.wav`);
  const workers = Math.max(1, Math.min(4, availableParallelism() - 1));
  let pool: Pick<RasterPool, 'render' | 'close'> | undefined;
  let encoder: ReturnType<typeof spawnFrameEncoder> | undefined;
  const pending = new Map<number, Promise<Buffer>>();
  let segmentIndex = 0; let scheduled = 0; let written = 0; let rendered = 0; let reused = 0;
  let lastHash: string | undefined; let lastPng: Promise<Buffer> | undefined;
  try {
    // ffmpeg must not reopen the mutable locked file after verification. This WAV is exactly the verified Buffer.
    await writeFile(audioSnapshot, audio[0]!, { flag: 'wx' });
    pool = (deps.createRasterPool ?? ((size) => new RasterPool(size)))(workers);
    encoder = (deps.spawnEncoder ?? spawnFrameEncoder)(partial, lock.render.fps, audioSnapshot);
    void encoder.done.catch(() => undefined);
    while (written < lock.render.frames) {
      while (scheduled < lock.render.frames && pending.size < workers * 2) {
        const frame = scheduled++;
        while (frame >= lock.renderPlan[segmentIndex]!.firstFrame + lock.renderPlan[segmentIndex]!.frameCount) segmentIndex++;
        const segment = lock.renderPlan[segmentIndex]!;
        const hash = segment.kind === 'hold' ? segment.svgHash : segment.svgHashes[frame - segment.firstFrame]!;
        let png: Promise<Buffer>;
        if (hash === lastHash && lastPng) { png = lastPng; reused++; }
        else { png = pool.render(svgs.get(hash)!, lock.render.width); rendered++; }
        lastHash = hash; lastPng = png; pending.set(frame, png);
      }
      const png = await pending.get(written)!; pending.delete(written++); await encoder.write(png);
    }
    encoder.end(); await encoder.done; await rename(partial, outPath);
  } catch (error) {
    encoder?.abort(); await encoder?.done.catch(() => undefined); await rm(partial, { force: true }); throw error;
  } finally {
    try { await pool?.close(); } finally { await rm(audioSnapshot, { force: true }); }
  }
  return { frames: lock.render.frames, rendered, reused };
}

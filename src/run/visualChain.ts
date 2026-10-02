import type { ContentAddressedArtifactStore } from './artifactCache.js';
import { layoutScene } from '../layout/solver.js';
import { renderSVG } from '../render/renderScene.js';
import { resolveScene, type ResolveOptions } from '../assets/resolveScene.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { compileTimelineFull, type TimelineDeadlines } from '../timeline/compile.js';
import { CLAIM_REVEAL_GRACE_MS, claimSpanTimesMs } from '../validate/gates.js';
import type { BBox, LaidOutScene, ResolvedMention, ResolvedScene, SceneSpec, StageFailure, Timeline } from '../shared/types.js';
import { runClaudeGates, type ClaimCoverageInput } from '../validate/gates.js';
import { VISUAL_STAGE_VERSIONS } from './versions.js';
import { ROUGH_PROFILE_VERSION, ROUGH_RENDERER_VERSION } from '../render/roughAdapter.js';

export type VisualStage = 'S7-resolve' | 'S8-layout' | 'S9-timeline' | 'S10-render';

export interface VisualChainScene {
  lessonId?: string;
  sceneId: string;
  spec: SceneSpec;
  /** Ranked icon candidates and lesson-level icon pins for S7. */
  resolve?: ResolveOptions;
  /** The previous scene's boxes, so carried-over elements keep their place. */
  previousBoxes?: ReadonlyMap<string, BBox>;
  /** This scene's mentions on the master clock. */
  mentions: ResolvedMention[];
  bounds: { startMs: number; endMs: number };
  /** Generated lessons require every S4 spoken essential claim to have a visible, source-backed depiction. */
  claimCoverage?: ClaimCoverageInput;
}

/** Latest allowed end for each claim target (elements and relation arrows) per claim target, from the aligned spoken claim windows. */
export function claimDeadlines(spec: SceneSpec, coverage: ClaimCoverageInput | undefined): { elementEndBy: Map<string, number>; edgeEndBy: Map<string, number> } {
  const elementEndBy = new Map<string, number>();
  const edgeEndBy = new Map<string, number>();
  if (!coverage) return { elementEndBy, edgeEndBy };
  const windows = claimSpanTimesMs(coverage);
  const margin = 150; // stay clear of the gate's own grace boundary
  const keep = (map: Map<string, number>, key: string, value: number) => map.set(key, Math.min(map.get(key) ?? Infinity, value));
  for (const intent of spec.boardIntent?.visualIntents ?? []) {
    const window = windows.get(intent.claimId);
    if (!window) continue;
    const by = window.endMs + CLAIM_REVEAL_GRACE_MS - margin;
    for (const target of intent.targets) {
      if (target.kind === 'element') keep(elementEndBy, target.elementId, by);
      else keep(edgeEndBy, `${target.fromElementId}->${target.toElementId}`, by);
    }
  }
  return { elementEndBy, edgeEndBy };
}

export interface VisualChainContext {
  store?: ContentAddressedArtifactStore;
  catalogVersion: string;
  /** Best-effort delivery: draw a scene whose claim coverage failed (failure stays hard and recorded; status never becomes passed). */
  renderCoverageGaps?: boolean;
  /** Live compilation stops after S9; S10 starts only after its lock verifies. */
  deferRender?: boolean;
  /** Called once per stage with its wall time and cache result (for stage records). */
  onStage?: (stage: VisualStage, record: { startedAtMs: number; completedAtMs: number; cacheHit: boolean; artifact?: { key: string; contentHash: string; cacheHit: boolean } }) => void;
}

export interface VisualChainResult {
  resolved: ResolvedScene;
  laidOut: LaidOutScene;
  timeline: Timeline;
  /** The last frame of the scene, rendered by the same deterministic renderer the video uses. */
  finalFrameSvg?: string;
  renderEligible: boolean;
  gates: { failures: StageFailure[]; warnings: StageFailure[] };
}

/**
 * S7 resolve → S8 layout → S9 timeline → Claude gates → S10 final frame, for
 * one validated scene. Every stage is deterministic; with a store each is a
 * content-addressed artifact. The fixture runner and the live runner share
 * this function, so a code path cannot drift between them.
 */
export async function runVisualChain(scene: VisualChainScene, ctx: VisualChainContext): Promise<VisualChainResult> {
  const stage = async <T>(name: VisualStage, input: unknown, meta: { schemaVersion: string; stageVersion: string; catalogVersion?: string }, produce: () => T): Promise<T> => {
    const startedAtMs = Date.now();
    if (!ctx.store) {
      const value = produce();
      ctx.onStage?.(name, { startedAtMs, completedAtMs: Date.now(), cacheHit: false });
      return value;
    }
    const result = await ctx.store.run(`${name}:${scene.sceneId}`, input, meta, produce);
    ctx.onStage?.(name, { startedAtMs, completedAtMs: Date.now(), cacheHit: result.cacheHit, artifact: { key: result.key, contentHash: result.artifact.contentHash, cacheHit: result.cacheHit } });
    return result.artifact.payload;
  };
  const pins = scene.resolve?.pins ? [...scene.resolve.pins.entries()].sort(([left], [right]) => left.localeCompare(right)) : undefined;
  const resolved = await stage('S7-resolve', { spec: scene.spec, candidates: scene.resolve?.candidates, pins, domain: scene.resolve?.domain, validatedByConcept: scene.resolve?.validatedByConcept ? [...scene.resolve.validatedByConcept.entries()].sort(([left], [right]) => left.localeCompare(right)) : undefined, validated: scene.resolve?.validated ? [...scene.resolve.validated.entries()].sort(([left], [right]) => left.localeCompare(right)) : undefined }, { schemaVersion: 'claude-resolved-scene/v1', stageVersion: VISUAL_STAGE_VERSIONS.resolve, catalogVersion: ctx.catalogVersion }, () => resolveScene(scene.spec, scene.resolve));
  const previousLayout = scene.previousBoxes ? Object.fromEntries(scene.previousBoxes) : undefined;
  const previous = scene.previousBoxes ? new Map(scene.previousBoxes) : undefined;
  const lessonId = scene.lessonId ?? scene.sceneId;
  const laidOut = await stage('S8-layout', { resolved, previousLayout, lessonId, roughRenderer: ROUGH_RENDERER_VERSION, roughProfile: ROUGH_PROFILE_VERSION, fontSha256: KALAM_FONT_SHA256 }, { schemaVersion: 'claude-laid-out-scene/v1', stageVersion: VISUAL_STAGE_VERSIONS.layout }, () => layoutScene(resolved, { previous, lessonId }));
  const { startMs, endMs } = scene.bounds;
  const timelineStartedAtMs = Date.now();
  let timeline: Timeline;
  try {
    const deadlines: TimelineDeadlines = claimDeadlines(scene.spec, scene.claimCoverage);
    const deadlineKey = { elements: [...(deadlines.elementEndBy ?? [])].sort(([a], [b]) => a.localeCompare(b)), edges: [...(deadlines.edgeEndBy ?? [])].sort(([a], [b]) => a.localeCompare(b)) };
    timeline = await stage('S9-timeline', { laidOut, sceneMentions: scene.mentions, bounds: scene.bounds, deadlines: deadlineKey }, { schemaVersion: 'claude-timeline/v1', stageVersion: VISUAL_STAGE_VERSIONS.timeline }, () => compileTimelineFull(laidOut, scene.mentions, startMs, endMs, deadlines));
  } catch (error) {
    ctx.onStage?.('S9-timeline', { startedAtMs: timelineStartedAtMs, completedAtMs: Date.now(), cacheHit: false });
    const failure: StageFailure = {
      code: 'timeline-compile-failed', stage: 'S9-timeline',
      message: error instanceof Error ? error.message : String(error), hard: true,
    };
    const emptyTimeline: Timeline = { sceneId: scene.sceneId, sceneStartMs: startMs, sceneEndMs: endMs, events: [] };
    const checked = runClaudeGates(laidOut, emptyTimeline, scene.claimCoverage);
    return { resolved, laidOut, timeline: emptyTimeline, gates: { failures: [...checked.failures, failure], warnings: checked.warnings }, renderEligible: false };
  }
  const gates = runClaudeGates(laidOut, timeline, scene.claimCoverage);
  // Coverage failures are publication failures and must not produce an S10 frame.
  // With best-effort delivery the scene is still drawn (the learner gets the whole lesson); the failure stays hard and recorded.
  if (gates.failures.some((failure) => failure.code === 'visual-claim-coverage') && !ctx.renderCoverageGaps) return { resolved, laidOut, timeline, gates, renderEligible: false };
  if (ctx.deferRender) return { resolved, laidOut, timeline, gates, renderEligible: true };
  const finalFrameSvg = await stage('S10-render', { laidOut, timeline, frameTimeMs: endMs - 1, fontSha256: KALAM_FONT_SHA256 }, { schemaVersion: 'image/svg+xml', stageVersion: VISUAL_STAGE_VERSIONS.render }, () => renderSVG(laidOut, timeline, endMs - 1));
  return { resolved, laidOut, timeline, finalFrameSvg, gates, renderEligible: true };
}

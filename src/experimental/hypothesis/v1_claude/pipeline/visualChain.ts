import type { ContentAddressedArtifactStore } from '../artifactCache.js';
import { layoutScene } from '../layout/solver.js';
import { renderSVG } from '../render/renderScene.js';
import { resolveScene, type ResolveOptions } from '../resolveScene.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { compileTimelineFull } from '../timeline/compile.js';
import type { BBox, LaidOutScene, ResolvedMention, ResolvedScene, SceneSpec, StageFailure, Timeline } from '../types.js';
import { runClaudeGates, type ClaimCoverageInput } from '../validation/gates.js';
import { VISUAL_STAGE_VERSIONS } from './versions.js';

export type VisualStage = 'S7-resolve' | 'S8-layout' | 'S9-timeline' | 'S10-render';

export interface VisualChainScene {
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

export interface VisualChainContext {
  store?: ContentAddressedArtifactStore;
  catalogVersion: string;
  /** Called once per stage with its wall time and cache result (for stage records). */
  onStage?: (stage: VisualStage, record: { startedAtMs: number; completedAtMs: number; cacheHit: boolean; artifact?: { key: string; contentHash: string; cacheHit: boolean } }) => void;
}

export interface VisualChainResult {
  resolved: ResolvedScene;
  laidOut: LaidOutScene;
  timeline: Timeline;
  /** The last frame of the scene, rendered by the same deterministic renderer the video uses. */
  finalFrameSvg?: string;
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
  const resolved = await stage('S7-resolve', { spec: scene.spec, candidates: scene.resolve?.candidates, pins }, { schemaVersion: 'claude-resolved-scene/v1', stageVersion: VISUAL_STAGE_VERSIONS.resolve, catalogVersion: ctx.catalogVersion }, () => resolveScene(scene.spec, scene.resolve));
  const previousLayout = scene.previousBoxes ? Object.fromEntries(scene.previousBoxes) : undefined;
  const previous = scene.previousBoxes ? new Map(scene.previousBoxes) : undefined;
  const laidOut = await stage('S8-layout', { resolved, previousLayout, fontSha256: KALAM_FONT_SHA256 }, { schemaVersion: 'claude-laid-out-scene/v1', stageVersion: VISUAL_STAGE_VERSIONS.layout }, () => layoutScene(resolved, { previous }));
  const { startMs, endMs } = scene.bounds;
  const timeline = await stage('S9-timeline', { laidOut, sceneMentions: scene.mentions, bounds: scene.bounds }, { schemaVersion: 'claude-timeline/v1', stageVersion: VISUAL_STAGE_VERSIONS.timeline }, () => compileTimelineFull(laidOut, scene.mentions, startMs, endMs));
  const gates = runClaudeGates(laidOut, timeline, scene.claimCoverage);
  // Coverage failures are publication failures and must not produce an S10 frame.
  if (gates.failures.some((failure) => failure.code === 'visual-claim-coverage')) return { resolved, laidOut, timeline, gates };
  const finalFrameSvg = await stage('S10-render', { laidOut, timeline, frameTimeMs: endMs - 1, fontSha256: KALAM_FONT_SHA256 }, { schemaVersion: 'image/svg+xml', stageVersion: VISUAL_STAGE_VERSIONS.render }, () => renderSVG(laidOut, timeline, endMs - 1));
  return { resolved, laidOut, timeline, finalFrameSvg, gates };
}

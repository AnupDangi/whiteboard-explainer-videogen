import type { AlignedAudio, LaidOutScene, NarrationScript, ResolvedScene, SceneSpec, StageFailure, Timeline } from '../shared/types.js';
import { EXPERIMENT, assertCommonRunOptions, type EvaluationBundle, type HypothesisRunOptions, type RunFailure } from '../shared/contracts.js';
import { deriveRunStatus, deterministicGates } from '../shared/evaluation.js';
import { sha256, stableJson, writeJsonArtifact } from '../shared/artifacts.js';
import { ContentAddressedArtifactStore } from './artifactCache.js';
import { goldenById } from '../shared/fixtures.js';
import { svgDocument } from '../shared/svg.js';
import { buildNarrationScene } from '../narration/markers.js';
import { alignFixture } from '../narration/align.js';
import { resolveMentions } from '../narration/resolveMentions.js';
import { safeParseSceneSpec, validateSceneSpecStructure } from '../shared/schema.js';
import { toNeutralElements, toNeutralEvents } from '../validate/gates.js';
import { runVisualChain } from './visualChain.js';
import { VISUAL_STAGE_VERSIONS } from './versions.js';
import { KALAM_FONT_SHA256 } from '../render/fonts.js';
import { sourceCommit } from './provenance.js';
import { catalogVersion } from '../assets/registry.js';
import { canonicalResolutionCounts } from '../assets/resolutionMetrics.js';

export interface HandAuthoredSceneInput {
  sceneId: string;
  sectionId?: string;
  /** Raw scripted text with `[[id|phrase]]` markers (S4 output). */
  raw: string;
  /** Hand-authored SceneSpec supplied only by the offline renderer-fixture runner. */
  spec: SceneSpec;
}

export interface HypothesisInput {
  caseId: string;
  scenes: HandAuthoredSceneInput[];
}

export interface ScenePipelineResult {
  sceneId: string;
  resolved: ResolvedScene;
  laidOut: LaidOutScene;
  timeline: Timeline;
  finalFrameSvg: string;
}

export interface HypothesisRunResult {
  runId: string;
  narration: NarrationScript;
  alignedAudio: AlignedAudio;
  scenes: ScenePipelineResult[];
  evaluationBundle: EvaluationBundle;
  contactSheetSvg: string;
  failures: StageFailure[];
}

const toRunFailure = (f: StageFailure): RunFailure => ({ code: f.code, stage: f.stage, message: f.message, hard: f.hard });

/**
 * Wires the full Claude-track order (claude_pipeline.md §1/§2):
 *   marked NarrationScript -> fixture TTS+alignment -> resolved mentions
 *   -> validated SceneSpec (supplied by renderer-fixture input) -> catalog/primitive
 *   ladder -> deterministic template layout -> mention-anchored timeline
 *   -> deterministic SVG.
 *
 * This offline renderer-fixture runner receives supplied SceneSpecs and
 * records typed cached artifacts for S4/S5/S7-S10. S6 planner and real
 * audio/MP4 export run through pipeline/runLive.ts; this fixture path remains
 * deliberately offline and SVG-only. `contactSheetSvg` is an SVG grid.
 */
export async function runHypothesis(input: HypothesisInput, options: HypothesisRunOptions, artifactCacheDir?: string): Promise<HypothesisRunResult> {
  assertCommonRunOptions(options);
  if (options.mode !== 'fixture') throw new Error('This session only implements fixture mode (no live TTS/model calls)');

  const failures: StageFailure[] = [];
  const store = new ContentAddressedArtifactStore(artifactCacheDir ?? '.data/hypothesis-stage-cache', options.cache);
  const stageArtifacts: Record<string, { key: string; contentHash: string }> = {};
  let cacheHits = 0;
  const runStage = async <T>(name: string, dependency: unknown, meta: { schemaVersion: string; stageVersion: string; promptVersion?: string; modelId?: string; catalogVersion?: string }, produce: () => T | Promise<T>) => {
    const result = await store.run(name, dependency, meta, produce);
    stageArtifacts[name] = { key: result.key, contentHash: result.artifact.contentHash };
    if (result.cacheHit) cacheHits++;
    return result;
  };
  const narrationStage = await runStage('S4-narration', { caseId: input.caseId, scenes: input.scenes.map(({ sceneId, sectionId, raw }) => ({ sceneId, sectionId, raw })) }, { schemaVersion: 'claude-narration-script/v1', stageVersion: 'marked-script-1', promptVersion: 'fixture-markers-1', modelId: options.narrationModel }, (): NarrationScript => ({
    schemaVersion: 'claude-narration-script/v1',
    scenes: input.scenes.map((s) => buildNarrationScene(s.sceneId, s.sectionId ?? s.sceneId, s.raw)),
  }));
  const narration = narrationStage.artifact.payload;

  const alignmentStage = await runStage('S5-alignment', { narrationHash: narrationStage.artifact.contentHash, targetDurationMs: EXPERIMENT.targetDurationMs, alignment: options.alignment }, { schemaVersion: 'claude-aligned-audio/v1', stageVersion: 'fixture-word-clock-1', modelId: 'fixture-aligner-1' }, () => {
    const audio = alignFixture(narration, EXPERIMENT.targetDurationMs);
    const resolved = resolveMentions(narration, audio);
    return { audio, mentions: resolved.mentions, failures: resolved.failures };
  });
  const { audio: rawAudio, mentions, failures: mentionFailures } = alignmentStage.artifact.payload;
  for (const mf of mentionFailures) {
    failures.push({ code: `mention-${mf.reason}`, stage: 'align', message: `${mf.sceneId}/${mf.mentionId}: "${mf.phrase}"`, hard: true });
  }
  const alignedAudio: AlignedAudio = { ...rawAudio, mentions };

  let golden;
  try {
    golden = goldenById(input.caseId);
  } catch {
    golden = undefined;
  }

  const scenes: ScenePipelineResult[] = [];
  let previousBoxes: Map<string, { x: number; y: number; w: number; h: number }> | undefined;

  for (const sceneInput of input.scenes) {
    const parsed = safeParseSceneSpec(sceneInput.spec);
    if (!parsed.success) {
      failures.push({ code: 'schema', stage: 'planner', message: `${sceneInput.sceneId}: ${parsed.error.message}`, hard: true });
      continue;
    }
    const structuralIssues = validateSceneSpecStructure(parsed.data);
    for (const issue of structuralIssues) {
      const hard = issue.code !== 'unresolved-object-candidate';
      failures.push({ code: issue.code, stage: 'planner', message: issue.message, hard });
    }
    if (structuralIssues.some((i) => i.code !== 'unresolved-object-candidate')) continue;

    const bounds = alignedAudio.sceneBoundsMs[sceneInput.sceneId] ?? { startMs: 0, endMs: EXPERIMENT.targetDurationMs };
    const sceneMentions = alignedAudio.mentions.filter((m) => m.sceneId === sceneInput.sceneId);
    const { resolved, laidOut, timeline, finalFrameSvg, gates: gateResult } = await runVisualChain(
      { lessonId: input.caseId, sceneId: sceneInput.sceneId, spec: parsed.data, previousBoxes, mentions: sceneMentions, bounds },
      { store, catalogVersion: catalogVersion(), onStage: (stage, record) => { if (record.artifact) stageArtifacts[`${stage}:${sceneInput.sceneId}`] = record.artifact; if (record.cacheHit) cacheHits++; } },
    );
    previousBoxes = new Map(laidOut.elements.map((e) => [e.id, e.bbox]));
    failures.push(...gateResult.failures, ...gateResult.warnings);

    // The shared `deterministicGates` overlap/safe-area checks assume every
    // passed element is simultaneously visible — true WITHIN one scene, but
    // NOT across scenes that share the same 1920x1080 coordinate space at
    // different points in time. Running it once per scene (rather than once
    // globally over every scene's elements pooled together) keeps overlap
    // and safe-area scoped correctly while still exercising the whole-clip
    // av-sync/license/unsafe-svg checks on every call (same golden/duration
    // each time, so the result is consistent, just redundantly confirmed).
    if (golden) {
      const sceneLicenses = laidOut.elements.map((e) => e.resolution?.license).filter((l): l is string => Boolean(l));
      if (finalFrameSvg !== undefined) {
        const gateFailures = deterministicGates({ golden, elements: toNeutralElements(laidOut), timeline: toNeutralEvents(laidOut, timeline), durationMs: alignedAudio.durationMs, svg: finalFrameSvg, licenses: sceneLicenses });
        failures.push(...gateFailures.map((f) => ({ code: f.code, stage: f.stage, message: f.message, hard: f.hard })));
      }
    }

    scenes.push({ sceneId: sceneInput.sceneId, resolved, laidOut, timeline, finalFrameSvg: finalFrameSvg ?? '' });
  }

  const allElements = scenes.flatMap((s) => toNeutralElements(s.laidOut));
  const allEvents = scenes.flatMap((s) => toNeutralEvents(s.laidOut, s.timeline));
  const combinedSvg = svgDocument(scenes.map((s) => s.finalFrameSvg).join(''));

  const rungCounts: Record<string, number> = {};
  for (const s of scenes) for (const e of s.laidOut.elements) if (e.resolution) rungCounts[`rung${e.resolution.rung}`] = (rungCounts[`rung${e.resolution.rung}`] ?? 0) + 1;
  const canonicalRungCounts = canonicalResolutionCounts(scenes.flatMap((scene) => scene.laidOut.elements.map((element) => element.resolution)));
  const ambiguousMentions = alignedAudio.mentions.filter((m) => m.ambiguous).length;

  const inputHash = sha256(stableJson({ caseId: input.caseId, scenes: input.scenes }));
  const runConfig = { ...options, outputDir: '', cache: 'cold' as const, artifactCacheDir: undefined };
  const runId = sha256(stableJson({ inputHash, runConfig, visualStageVersions: VISUAL_STAGE_VERSIONS, fontSha256: KALAM_FONT_SHA256 }));
  const evaluationBundle: EvaluationBundle = {
    schemaVersion: 'evaluation-bundle/v1',
    pipeline: 'claude',
    runClass: 'renderer-fixture',
    status: deriveRunStatus(failures.filter((f) => f.hard).length),
    caseId: input.caseId,
    runId,
    commit: sourceCommit(),
    configHash: sha256(stableJson({ runConfig, rendererSchema: 'claude-scene-spec/v1', visualStageVersions: VISUAL_STAGE_VERSIONS, fontSha256: KALAM_FONT_SHA256 })),
    nativeArtifacts: {},
    claims: narration.scenes.map((s) => s.plainText),
    claimEvidence: {},
    visualEvidence: {},
    relations: [], // Untyped visual edges are not evidence of factual relations.
    elements: allElements,
    timeline: allEvents,
    provenance: Object.fromEntries(scenes.flatMap((s) => s.laidOut.elements.filter((e) => e.resolution).map((e) => [`${s.sceneId}:${e.id}`, [e.resolution!.lane, `rung${e.resolution!.rung}`, e.resolution!.source, ...(e.resolution!.strategy ? [e.resolution!.strategy] : [])]]))),
    metrics: { ...rungCounts, ...canonicalRungCounts, ambiguousMentions, sceneCount: scenes.length, meanOccupancy: scenes.length ? scenes.reduce((sum, s) => sum + s.laidOut.occupancy, 0) / scenes.length : 0, inputHash, cacheHits },
    usage: { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0, fallbacks: rungCounts.rung4 ?? 0, cacheHits },
    failures: failures.map(toRunFailure),
  };

  const contactSheetSvg = svgDocument(
    scenes
      .map((s, i) => `<g transform="translate(${(i % 2) * 960},${Math.floor(i / 2) * 540}) scale(0.5)">${s.finalFrameSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`)
      .join(''),
  );

  if (options.outputDir) {
    const dir = options.outputDir;
    await writeJsonArtifact(dir, 'narration.json', narration);
    await writeJsonArtifact(dir, 'aligned-audio.json', alignedAudio);
    for (const s of scenes) {
      await writeJsonArtifact(dir, `scene-spec.${s.sceneId}.json`, input.scenes.find((i) => i.sceneId === s.sceneId)!.spec);
      await writeJsonArtifact(dir, `resolved-scene.${s.sceneId}.json`, s.resolved);
      await writeJsonArtifact(dir, `layout.${s.sceneId}.json`, s.laidOut);
      await writeJsonArtifact(dir, `timeline.${s.sceneId}.json`, s.timeline);
    }
    await writeJsonArtifact(dir, 'evaluation-bundle.json', evaluationBundle);
    await writeJsonArtifact(dir, 'run-manifest.json', { schemaVersion: 'hypothesis-run/v1', pipeline: 'claude', runClass: 'renderer-fixture', status: evaluationBundle.status, runId, caseId: input.caseId, options: runConfig, cache: { mode: options.cache, root: artifactCacheDir ?? '.data/hypothesis-stage-cache' }, stageArtifacts, cacheHits, evaluationBundle: 'evaluation-bundle.json', svg: 'final-scene.svg', contactSheet: 'contact-sheet.svg' });
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.writeFile(path.join(dir, 'final-scene.svg'), combinedSvg, 'utf8');
    await fs.writeFile(path.join(dir, 'contact-sheet.svg'), contactSheetSvg, 'utf8');
  }

  return { runId, narration, alignedAudio, scenes, evaluationBundle, contactSheetSvg, failures };
}

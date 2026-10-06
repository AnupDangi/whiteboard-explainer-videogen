import { canonicalHash } from '../harness/replayDeterminism.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import { applySemanticProgram } from '../teaching/semantic-ir/program.js';
import { compileSemanticOpsToBoardOps } from '../teaching/semantic-ir/toBoardOps.js';
import type { SemanticOp, SemanticSceneState } from '../teaching/semantic-ir/types.js';
import { stateTransitionProvider } from '../teaching/representation/stateTransition.js';
import type { BeatTiming } from '../visual-v2/timeline/compile.js';
import type { BoardOp, SceneTransition } from '../visual-v2/board-ops/types.js';
import { startScene } from '../visual-v2/board-state/reducer.js';
import type { BoardContext } from '../visual-v2/ops-plan/validate.js';
import type { RenderedEntityAssetEvidence } from './renderedEntityAssets.js';

export interface RepresentationExecutionRecord {
  schemaVersion: 'v2-representation-execution/v2';
  sceneId: string;
  mode: 'typed-semantic' | 'legacy-boardops-preview';
  providerVersion?: string;
  providerSource?: 'family-fallback';
  beats: Array<{
    beatId: string;
    family: string;
    status: 'compiled' | 'provider-unavailable';
    providerVersion?: string;
    problem?: string;
  }>;
  semanticOperations: SemanticOp[];
  cueByEventId: Record<string, number>;
  selectedAssetIds: Record<string, string>;
  renderedEntityAssets: RenderedEntityAssetEvidence[];
  unrenderedSelectedConceptIds: string[];
  boardOpsHash?: string;
}

export type SemanticSceneExecution =
  | { status: 'compiled'; transition: SceneTransition; operations: BoardOp[]; record: RepresentationExecutionRecord }
  | { status: 'legacy-preview'; record: RepresentationExecutionRecord }
  | { status: 'failed'; record: RepresentationExecutionRecord; problems: string[] };

function emptySemanticState(sceneId: string): SemanticSceneState {
  return { sceneId, entities: [], relations: [], selectedEntityIds: [], plots: [], feedbackLoops: [], annotations: [] };
}

function selectedIcons(ctx: BoardContext): Record<string, string> {
  return Object.fromEntries((ctx.visualVocabulary?.concepts ?? []).flatMap((item) =>
    item.conceptKind === 'entity' && item.depiction.kind === 'icon' ? [[item.conceptId, item.depiction.entryId] as const] : []));
}

function cuesFromTimings(beats: readonly TeachingBeat[], timings: readonly BeatTiming[]): Record<string, number> {
  const result: Record<string, number> = {};
  const changes = new Map(beats.map((beat) => [beat.beatId, beat.requiredSemanticChanges.length]));
  for (const timing of timings) {
    for (const anchor of timing.semanticAnchors ?? []) {
      if (!changes.has(timing.beatId)) continue;
      const sentenceIndex = timing.sentences.findIndex((sentence) => anchor.startMs >= sentence.startMs && anchor.startMs < sentence.endMs);
      if (sentenceIndex >= 0) result[anchor.semanticEventId] = Math.min(3, sentenceIndex);
    }
  }
  return result;
}

function cuesFromNarration(narration: CompiledSceneNarration): Record<string, number> {
  const cues: Record<string, number> = {};
  for (const anchor of narration.semanticAnchors) {
    const beat = narration.beatSpans.find((candidate) => candidate.beatId === anchor.beatId);
    const sentenceIndex = beat?.sentenceSpans.findIndex((span) => anchor.charStart >= span.charStart && anchor.charStart < span.charEnd) ?? -1;
    if (sentenceIndex >= 0) cues[anchor.semanticEventId] = Math.min(3, sentenceIndex);
  }
  return cues;
}

/**
 * Execute the one implemented typed family in V2. Unsupported families are left on the existing S6 preview route and
 * are explicitly marked unavailable; a state-transition contract failure never falls through to generic BoardOps.
 */
export function executeSemanticScene(input: {
  context: BoardContext;
  narration: CompiledSceneNarration;
  beatTimings: readonly BeatTiming[];
}): SemanticSceneExecution {
  const { context, narration, beatTimings } = input;
  const visualBeats = context.beats.filter((beat) => !beat.narrationOnly);
  const icons = selectedIcons(context);
  if (!visualBeats.length || visualBeats.some((beat) => beat.representationFamily !== 'state_transition')) {
    const beats = visualBeats.map((beat) => ({
      beatId: beat.beatId,
      family: beat.representationFamily,
      status: 'provider-unavailable' as const,
      problem: beat.representationFamily === 'state_transition'
        ? 'scene has mixed representation families; typed composition is not implemented'
        : `typed semantic provider for ${beat.representationFamily} is not implemented`,
    }));
    return {
      status: 'legacy-preview',
      record: {
        schemaVersion: 'v2-representation-execution/v2', sceneId: context.sceneId,
        mode: 'legacy-boardops-preview', beats, semanticOperations: [], cueByEventId: {}, selectedAssetIds: icons,
        renderedEntityAssets: [], unrenderedSelectedConceptIds: Object.keys(icons).sort(),
      },
    };
  }

  let semanticState = emptySemanticState(context.sceneId);
  const allSemanticOperations: SemanticOp[] = [];
  const boardOperations: BoardOp[] = [];
  const startingBoard = startScene(context.initial, { mode: 'clean' }, context.sceneId);
  const usedElementIds = new Set(Object.keys(startingBoard.elements));
  const existingStateValues: Record<string, string | number> = {};
  for (const element of Object.values(startingBoard.elements)) {
    if (element.lifecycle.removedAtBeat === undefined && element.spec.type === 'value' && element.value !== undefined) existingStateValues[element.id] = element.value;
  }
  const knownBeatIds = new Set(context.beats.map((beat) => beat.beatId));
  const knownClaimIds = new Set(context.beats.flatMap((beat) => beat.claimIds));
  const cueByEventId = cuesFromTimings(context.beats, beatTimings);
  const beatRecords: RepresentationExecutionRecord['beats'] = [];

  for (const beat of visualBeats) {
    const provider = stateTransitionProvider.compileFallback(semanticState, beat);
    if (!provider.ok) {
      beatRecords.push({ beatId: beat.beatId, family: beat.representationFamily, status: 'provider-unavailable', problem: `${provider.code}: ${provider.problems.map((problem) => problem.message).join('; ')}` });
      return {
        status: 'failed',
        record: {
          schemaVersion: 'v2-representation-execution/v2', sceneId: context.sceneId, mode: 'typed-semantic',
          providerVersion: stateTransitionProvider.version, providerSource: 'family-fallback', beats: beatRecords,
          semanticOperations: allSemanticOperations, cueByEventId, selectedAssetIds: icons, renderedEntityAssets: [], unrenderedSelectedConceptIds: Object.keys(icons).sort(),
        },
        problems: beatRecords.map((item) => `${item.beatId}: ${item.problem ?? 'provider failed'}`),
      };
    }
    const lowered = compileSemanticOpsToBoardOps(semanticState, provider.operations, {
      concepts: context.concepts.map(({ id, label, kind }) => ({ id, label, ...(kind ? { kind } : {}) })),
      ...(context.visualVocabulary ? { visualVocabulary: context.visualVocabulary } : {}),
      knownBeatIds, knownClaimIds, existingElementIds: usedElementIds, existingStateValues,
      cueByEventId,
    });
    if (!lowered.ok) {
      beatRecords.push({ beatId: beat.beatId, family: beat.representationFamily, status: 'provider-unavailable', problem: lowered.problems.map((problem) => problem.message).join('; ') });
      return {
        status: 'failed',
        record: {
          schemaVersion: 'v2-representation-execution/v2', sceneId: context.sceneId, mode: 'typed-semantic',
          providerVersion: stateTransitionProvider.version, providerSource: 'family-fallback', beats: beatRecords,
          semanticOperations: allSemanticOperations, cueByEventId, selectedAssetIds: icons, renderedEntityAssets: [], unrenderedSelectedConceptIds: Object.keys(icons).sort(),
        },
        problems: beatRecords.map((item) => `${item.beatId}: ${item.problem ?? 'lowering failed'}`),
      };
    }
    semanticState = lowered.resultingSemanticState;
    allSemanticOperations.push(...provider.operations);
    boardOperations.push(...lowered.operations);
    for (const op of lowered.operations) {
      if (op.op === 'add') {
        usedElementIds.add(op.id);
        if (op.element.type === 'value') existingStateValues[op.id] = op.element.value;
      } else if (op.op === 'updateValue') existingStateValues[op.target] = op.value;
      else if (op.op === 'remove') delete existingStateValues[op.target];
      else if (op.op === 'split') for (const part of op.into) usedElementIds.add(part.id);
    }
    beatRecords.push({ beatId: beat.beatId, family: beat.representationFamily, status: 'compiled', providerVersion: provider.providerVersion });
  }

  const semanticReplay = applySemanticProgram(emptySemanticState(context.sceneId), allSemanticOperations, { knownBeatIds, knownClaimIds });
  if (!semanticReplay.ok) {
    return {
      status: 'failed',
      record: {
        schemaVersion: 'v2-representation-execution/v2', sceneId: context.sceneId, mode: 'typed-semantic',
        providerVersion: stateTransitionProvider.version, providerSource: 'family-fallback', beats: beatRecords,
        semanticOperations: allSemanticOperations, cueByEventId, selectedAssetIds: icons, renderedEntityAssets: [], unrenderedSelectedConceptIds: Object.keys(icons).sort(),
      },
      problems: semanticReplay.problems.map((problem) => `${problem.path}: ${problem.message}`),
    };
  }
  const record: RepresentationExecutionRecord = {
    schemaVersion: 'v2-representation-execution/v2', sceneId: context.sceneId,
    mode: 'typed-semantic', providerVersion: stateTransitionProvider.version, providerSource: 'family-fallback',
    beats: beatRecords, semanticOperations: allSemanticOperations,
    cueByEventId: cuesFromNarration(narration), selectedAssetIds: icons, renderedEntityAssets: [], unrenderedSelectedConceptIds: Object.keys(icons).sort(),
  };
  // The timing-derived cue map and source-text-derived cue map must agree before compiling a board.
  if (canonicalHash(record.cueByEventId) !== canonicalHash(cueByEventId)) {
    return { status: 'failed', record, problems: ['semantic event sentence cues differ between aligned phrases and compiled narration anchors'] };
  }
  return { status: 'compiled', transition: { mode: 'clean' }, operations: boardOperations, record };
}

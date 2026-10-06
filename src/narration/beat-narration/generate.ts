import { addUsage, emptyUsage, structuredCall, type StructuredCallResult } from '../../llm/structuredCall.js';
import type { BeatStageModel } from '../../teaching/beat-plan/plan.js';
import type { StageFailure } from '../../shared/types.js';
import { mergeTraces, type StructuredTrace } from '../../structured/trace.js';
import { tokenizeWords } from '../align.js';
import { compileSceneNarration } from './compile.js';
import { buildNarrationPrompt } from './prompt.js';
import { BeatNarrationDraftSchema, type BeatNarrationDraft, type CompiledSceneNarration } from './types.js';
import { clampClaimAnchors, validateSceneNarration, type NarrationContext } from './validate.js';

function wordCount(sentences: readonly string[], language?: string): number {
  return tokenizeWords(sentences.join(' '), language ?? 'und').length;
}

/** Allocate the scene's spoken-time budget by structural obligations, not by equal beat count. */
function beatDurationBudgets(ctx: NarrationContext): number[] {
  if (!ctx.beats.length) return [];
  const weights = ctx.beats.map((beat) => Math.max(1, beat.claimIds.length, beat.requiredSemanticChanges.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => ctx.durationSec * weight / total);
}

/** Allocate a scene revision target across beats, weighted by their previous spoken length. */
function revisionTargets(ctx: NarrationContext): number[] | undefined {
  if (!ctx.revision) return undefined;
  const count = ctx.beats.length;
  if (!count) return [];
  const previous = new Map(ctx.revision.previous.map((beat) => [beat.beatId, wordCount(beat.sentences, ctx.language)]));
  const weights = ctx.beats.map((beat) => previous.get(beat.beatId) ?? 0);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const target = Math.max(count, Math.round(ctx.revision.targetWords));
  const remainder = target - count;
  const exact = weights.map((weight) => remainder * (totalWeight > 0 ? weight / totalWeight : 1 / count));
  const targets = exact.map((value) => 1 + Math.floor(value));
  let left = target - targets.reduce((sum, value) => sum + value, 0);
  const order = exact.map((fraction, index) => ({ index, fraction: fraction - Math.floor(fraction) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; left > 0; i++, left--) targets[order[i % order.length]!.index]!++;
  return targets;
}

function contextForBeat(ctx: NarrationContext, index: number, previousSentences: string[], durationSec: number, targetWords?: number): NarrationContext {
  const beat = ctx.beats[index]!;
  const priorVersion = ctx.revision?.previous.find((item) => item.beatId === beat.beatId);
  const canonicalClaims = ctx.canonicalClaims
    ? Object.fromEntries(beat.claimIds.flatMap((id) => ctx.canonicalClaims?.[id] ? [[id, ctx.canonicalClaims[id]!] as const] : []))
    : undefined;
  return {
    ...ctx,
    beats: [beat],
    durationSec,
    ...(canonicalClaims ? { canonicalClaims } : {}),
    beatFlow: {
      index,
      count: ctx.beats.length,
      ...(previousSentences.length ? { previousSentences } : {}),
      ...(ctx.beats[index + 1] ? { nextGoal: ctx.beats[index + 1]!.narrationGoal } : {}),
    },
    ...(ctx.revision ? {
      revision: {
        ...ctx.revision,
        targetWords: targetWords ?? wordCount(priorVersion?.sentences ?? [], ctx.language),
        previousSeconds: wordCount(priorVersion?.sentences ?? [], ctx.language) / Math.max(0.1, ctx.revision.measuredWordsPerSec),
        previous: priorVersion ? [priorVersion] : [],
      },
    } : {}),
  };
}

/** S4 writes a scene through sequential, beat-local calls; each call can repair only its own narration beat. */
export async function writeBeatNarration(input: { ctx: NarrationContext; scene: { title: string; goal: string }; sourceExcerpt: string }, m: BeatStageModel): Promise<StructuredCallResult<CompiledSceneNarration>> {
  const { ctx } = input;
  const drafts: BeatNarrationDraft[] = [];
  const results: Array<StructuredCallResult<BeatNarrationDraft>> = [];
  const targets = revisionTargets(ctx);
  const durations = ctx.revision && targets
    ? targets.map((target) => target / Math.max(0.1, ctx.revision!.measuredWordsPerSec))
    : beatDurationBudgets(ctx);
  for (let index = 0; index < ctx.beats.length; index++) {
    const beat = ctx.beats[index]!;
    const beatCtx = contextForBeat(ctx, index, drafts.flatMap((draft) => draft.sentences), durations[index]!, targets?.[index]);
    const { system, user } = buildNarrationPrompt(beatCtx, input.scene, input.sourceExcerpt);
    const result = await structuredCall({
      stage: 'beat-narration', subject: `scene ${ctx.sceneId} beat ${beat.beatId}`, model: m.model, apiKey: m.apiKey, system, user,
      schema: BeatNarrationDraftSchema, schemaName: 'beat_narration', maxTokens: 1800, effort: 'low', maxRepairs: 2,
      remainingBudgetUsd: m.remainingBudgetUsd / Math.max(1, ctx.beats.length),
      ...(m.budgetLedger ? { budgetLedger: m.budgetLedger } : {}), ...(m.fetcher ? { fetcher: m.fetcher } : {}), ...(m.client ? { client: m.client } : {}),
      validate: (draft) => validateSceneNarration({ beats: [draft] }, beatCtx).map((problem) => {
        if (typeof problem === 'string') return problem;
        // Validation runs through the scene-shaped contract, but this call's schema is a beat at the root.
        // Make repair pointers address that root object. Scene-level word-budget errors can only be fixed in sentences.
        const path = problem.path.replace(/^\/beats\/0(?=\/|$)/, '');
        return { ...problem, path: path || (problem.path === '/beats' ? '/sentences' : '') };
      }),
      salvage: (draft) => {
        const fixed = clampClaimAnchors({ beats: [draft] }, beatCtx);
        if (!fixed) return undefined;
        return { value: fixed.value.beats[0]!, entries: fixed.entries.map((entry) => ({ ...entry, path: entry.path.replace(/^\/beats\/0/, '') })) };
      },
      repairScope: (pointer) => {
        const local = pointer.replace(/^\/beats\/0(?=\/|$)/, '');
        return local.replace(/^\/([^/]+).*$/, '/$1');
      },
    });
    results.push(result);
    if (!result.value) break;
    drafts.push(result.value);
  }

  const usage = emptyUsage();
  const failures: StageFailure[] = [];
  const reports = results.flatMap((result) => result.reports);
  const traces: StructuredTrace[] = [];
  for (const result of results) {
    addUsage(usage, result.usage);
    failures.push(...result.failures);
    traces.push(result.trace);
  }
  const rawResponses = results.flatMap((result) => result.rawResponses);
  const trace = mergeTraces(traces);
  if (drafts.length !== ctx.beats.length) return { usage, failures, reports, trace, rawResponses };

  const sceneDraft = { beats: drafts };
  const sceneProblems = validateSceneNarration(sceneDraft, ctx);
  if (sceneProblems.length) {
    failures.push({ code: 'beat-narration-scene-invalid', stage: 'beat-narration', message: `scene ${ctx.sceneId}: combined beat narration failed: ${sceneProblems.map((problem) => typeof problem === 'string' ? problem : `${problem.path}: ${problem.message}`).join('; ')}`, hard: true });
    return { usage, failures, reports, trace, rawResponses };
  }
  try {
    return { usage, failures, reports, trace, rawResponses, value: compileSceneNarration(ctx.sceneId, sceneDraft, ctx.beats) };
  } catch (error) {
    failures.push({ code: 'beat-narration-compile-failed', stage: 'beat-narration', message: `scene ${ctx.sceneId}: ${error instanceof Error ? error.message : String(error)}`, hard: true });
    return { usage, failures, reports, trace, rawResponses };
  }
}

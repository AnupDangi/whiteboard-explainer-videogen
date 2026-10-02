import { addUsage, emptyUsage, type CallUsage, type StructuredCallReport } from '../llm/structuredCall.js';
import type { StageFailure } from '../shared/types.js';
import type { ConceptGraph, Script, TeachingPlan } from '../plan/schemas.js';
import type { SourceDoc } from '../intake/sourceDoc.js';
import { sectionSourcePrompt } from '../plan/stages.js';
import { withHostResourcePermit } from '../shared/hostResourcePool.js';
import { mergeTraces, type StructuredTrace } from '../structured/trace.js';
import { planSceneBeats, type BeatStageModel } from './beat-plan/plan.js';
import type { TeachingBeat } from './beat-plan/types.js';
import { writeBeatNarration } from '../narration/beat-narration/generate.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';
import type { NarrationContext } from '../narration/beat-narration/validate.js';
import type { StructuredCallAttemptRecord } from '../llm/structuredCall.js';

export interface BeatStagesValue {
  beatPlans: Record<string, TeachingBeat[]>;
  narrations: Record<string, CompiledSceneNarration>;
  narrationContexts: Record<string, NarrationContext>;
  /** Scene text as V1 stages read it: plain speech per scene with claim spans. */
  script: Script;
}

export interface BeatStagesResult {
  value?: BeatStagesValue;
  usage: CallUsage;
  failures: StageFailure[];
  reports: StructuredCallReport[];
  trace: StructuredTrace;
  rawResponses: StructuredCallAttemptRecord[];
}

const BEAT_PROVIDER_CONCURRENCY = 4;

/** The scene's place in the lesson: what came before and what comes next, so each scene bridges from the last one. */
function lessonPosition(plan: TeachingPlan, sceneId: string): NonNullable<NarrationContext['lesson']> {
  const index = Math.max(0, plan.sections.findIndex((s) => s.id === sceneId));
  const brief = (s?: TeachingPlan['sections'][number]) => (s ? { title: s.title, goal: s.goal } : undefined);
  const previous = brief(plan.sections[index - 1]); const next = brief(plan.sections[index + 1]);
  return { title: plan.intro?.sourceTitle ?? plan.sections[0]?.title ?? '', sceneIndex: index, sceneCount: plan.sections.length, ...(previous ? { previous } : {}), ...(next ? { next } : {}) };
}
const numbersIn = (texts: readonly string[]): Set<string> => new Set(texts.flatMap((text) => text.match(/\d+(?:\.\d+)?/g) ?? []));

/** S3b + S4 in beat mode: per scene, plan the teaching beats, then write the speech of each beat. Scenes run in parallel. */
export async function runBeatStages(input: { plan: TeachingPlan; graph: ConceptGraph; sourceDoc: SourceDoc }, m: BeatStageModel): Promise<BeatStagesResult> {
  const { plan, graph, sourceDoc } = input;
  const perScene = m.remainingBudgetUsd / Math.max(1, plan.sections.length);
  const outcomes = await Promise.all(plan.sections.map((section) => withHostResourcePermit('provider-beats', BEAT_PROVIDER_CONCURRENCY, async () => {
    const stage = { ...m, remainingBudgetUsd: perScene };
    const beats = await planSceneBeats({ section, graph }, stage);
    if (!beats.value || !beats.context) return { section, beats, narration: undefined as undefined | Awaited<ReturnType<typeof writeBeatNarration>>, ctx: undefined as NarrationContext | undefined };
    const claims = beats.context.claims;
    const evidence = section.conceptIds.flatMap((id) => graph.concepts.find((c) => c.id === id)?.evidence.map((ref) => ref.quote) ?? []);
    const definitions = section.conceptIds.flatMap((id) => graph.concepts.find((c) => c.id === id)?.definition ?? []);
    // The scene's own source excerpt is what the speaker is shown, so a number printed there is a number the source gives.
    const sourceExcerpt = sectionSourcePrompt(sourceDoc, section, graph);
    const ctx: NarrationContext = {
      sceneId: section.id, beats: beats.value, durationSec: beats.context.durationSec,
      allowedNumbers: numbersIn([...claims.map((claim) => claim.statement), ...evidence, ...definitions, sourceExcerpt]),
      emphasisCandidates: section.conceptIds.flatMap((id) => graph.concepts.find((c) => c.id === id)?.label ?? []),
      ...(m.language ? { language: m.language } : {}),
      lesson: lessonPosition(plan, section.id),
    };
    const narration = await writeBeatNarration({ ctx, scene: { title: section.title, goal: section.goal }, sourceExcerpt }, stage);
    return { section, beats, narration, ctx };
  })));
  const usage = emptyUsage();
  const failures: StageFailure[] = [];
  const reports: StructuredCallReport[] = [];
  const traces: StructuredTrace[] = [];
  const rawResponses: StructuredCallAttemptRecord[] = [];
  for (const { beats, narration } of outcomes) {
    for (const call of [beats, narration]) {
      if (!call) continue;
      addUsage(usage, call.usage); failures.push(...call.failures); reports.push(...call.reports); traces.push(call.trace); rawResponses.push(...call.rawResponses);
    }
  }
  const trace = mergeTraces(traces);
  if (outcomes.some(({ beats, narration }) => !beats.value || !narration?.value)) return { usage, failures, reports, trace, rawResponses };
  const value: BeatStagesValue = { beatPlans: {}, narrations: {}, narrationContexts: {}, script: { scenes: [] } };
  for (const { section, beats, narration, ctx } of outcomes) {
    value.beatPlans[section.id] = beats.value!;
    value.narrations[section.id] = narration!.value!;
    value.narrationContexts[section.id] = ctx!;
    value.script.scenes.push({ sectionId: section.id, text: narration!.value!.text, claimSpans: narration!.value!.claimSpans.map(({ claimId, exactText }) => ({ claimId, exactText })) });
  }
  return { value, usage, failures, reports, trace, rawResponses };
}

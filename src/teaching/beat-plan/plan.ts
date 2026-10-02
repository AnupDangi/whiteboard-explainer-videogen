import type { ConceptGraph, SceneContract } from '../../plan/schemas.js';
import { emptyUsage, structuredCall, type StructuredCallResult } from '../../llm/structuredCall.js';
import type { ModelClient } from '../../llm/modelClient.js';
import type { PersistentBudgetLedger } from '../../run/budgetLedger.js';
import { compileBeatPlan } from './compile.js';
import { buildBeatPrompt } from './prompt.js';
import { BeatPlanDraftSchema, type TeachingBeat } from './types.js';
import { beatContextFor, validateBeatPlan, type BeatContext } from './validate.js';
import { emptyTrace } from '../../structured/trace.js';

export interface BeatSection { id: string; title: string; goal: string; conceptIds: string[]; budgetSec: number; contract?: SceneContract }
export interface BeatStageModel { model: string; apiKey: string; remainingBudgetUsd: number; budgetLedger?: PersistentBudgetLedger; fetcher?: typeof fetch; client?: ModelClient }

/** S3b: the beats of one scene, planned from its S3 contract and the concept graph. The model sees no source text and writes no wording. */
export async function planSceneBeats(input: { section: BeatSection; graph: ConceptGraph }, m: BeatStageModel): Promise<StructuredCallResult<TeachingBeat[]> & { context?: BeatContext }> {
  const { section, graph } = input;
  if (!section.contract) {
    return { usage: emptyUsage(), rawResponses: [], reports: [], trace: emptyTrace(), failures: [{ code: 'beats-no-contract', stage: 'beats', message: `scene ${section.id}: no S3 scene contract to plan beats from`, hard: true }] };
  }
  const ctx = beatContextFor(section, graph);
  const { system, user } = buildBeatPrompt(ctx, {
    title: section.title, goal: section.goal, learningDelta: section.contract.learningDelta, ...(section.contract.mentalModel ? { mentalModel: section.contract.mentalModel } : {}),
    misconceptionRisk: section.contract.misconceptionRisk ?? [], priorKnowledge: section.contract.priorKnowledge ?? [],
  }, graph.concepts);
  const result = await structuredCall({
    stage: 'beats', subject: `scene ${section.id}`, model: m.model, apiKey: m.apiKey, system, user, schema: BeatPlanDraftSchema, schemaName: 'teaching_beats',
    maxTokens: 4000, maxRepairs: 2, remainingBudgetUsd: m.remainingBudgetUsd, ...(m.budgetLedger ? { budgetLedger: m.budgetLedger } : {}), ...(m.fetcher ? { fetcher: m.fetcher } : {}), ...(m.client ? { client: m.client } : {}),
    validate: (draft) => validateBeatPlan(draft, ctx),
  });
  const { value, ...rest } = result;
  return { ...rest, ...(value ? { value: compileBeatPlan(value, ctx) } : {}), context: ctx };
}

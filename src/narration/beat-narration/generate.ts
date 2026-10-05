import { structuredCall, type StructuredCallResult } from '../../llm/structuredCall.js';
import type { BeatStageModel } from '../../teaching/beat-plan/plan.js';
import { compileSceneNarration } from './compile.js';
import { buildNarrationPrompt } from './prompt.js';
import { SceneNarrationDraftSchema, type CompiledSceneNarration } from './types.js';
import { validateSceneNarration, type NarrationContext } from './validate.js';

/** S4 (beat mode): the speech of one scene, one narration beat per teaching beat. */
export async function writeBeatNarration(input: { ctx: NarrationContext; scene: { title: string; goal: string }; sourceExcerpt: string }, m: BeatStageModel): Promise<StructuredCallResult<CompiledSceneNarration>> {
  const { ctx } = input;
  const { system, user } = buildNarrationPrompt(ctx, input.scene, input.sourceExcerpt);
  const result = await structuredCall({
    stage: 'beat-narration', subject: `scene ${ctx.sceneId}`, model: m.model, apiKey: m.apiKey, system, user, schema: SceneNarrationDraftSchema, schemaName: 'beat_narration',
    maxTokens: 6000, maxRepairs: 3, remainingBudgetUsd: m.remainingBudgetUsd, ...(m.budgetLedger ? { budgetLedger: m.budgetLedger } : {}), ...(m.fetcher ? { fetcher: m.fetcher } : {}), ...(m.client ? { client: m.client } : {}),
    validate: (draft) => validateSceneNarration(draft, ctx),
    repairScope: (pointer) => pointer.replace(/^(\/beats\/\d+)(\/.*)?$/, '$1'),
  });
  const { value, ...rest } = result;
  return { ...rest, ...(value ? { value: compileSceneNarration(ctx.sceneId, value, ctx.beats) } : {}) };
}

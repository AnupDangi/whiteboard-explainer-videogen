import { structuredCall, type StructuredCallResult } from '../../llm/structuredCall.js';
import type { BeatStageModel } from '../../teaching/beat-plan/plan.js';
import { buildBoardPrompt } from './prompt.js';
import { SceneBoardDraftSchema, type SceneBoardDraft } from './types.js';
import { validateSceneBoard, type BoardContext } from './validate.js';

/** S6 (V2): the board operations of one scene, written from its teaching beats and narration. */
export async function planSceneBoard(input: { ctx: BoardContext }, m: BeatStageModel): Promise<StructuredCallResult<SceneBoardDraft>> {
  const { ctx } = input;
  const { system, user } = buildBoardPrompt(ctx);
  return structuredCall({
    stage: 'board-ops', subject: `scene ${ctx.sceneId}`, model: m.model, apiKey: m.apiKey, system, user, schema: SceneBoardDraftSchema, schemaName: 'scene_board',
    maxTokens: 7000, maxRepairs: 2, remainingBudgetUsd: m.remainingBudgetUsd, ...(m.budgetLedger ? { budgetLedger: m.budgetLedger } : {}), ...(m.fetcher ? { fetcher: m.fetcher } : {}), ...(m.client ? { client: m.client } : {}),
    validate: (draft) => validateSceneBoard(draft, ctx),
  });
}

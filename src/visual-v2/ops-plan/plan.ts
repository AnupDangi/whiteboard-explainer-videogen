import { structuredCall, type StructuredCallResult, type ValidatorProblem } from '../../llm/structuredCall.js';
import type { BeatStageModel } from '../../teaching/beat-plan/plan.js';
import { buildBoardPrompt } from './prompt.js';
import { SceneBoardDraftSchema, type SceneBoardDraft } from './types.js';
import { validateSceneBoard, type BoardContext } from './validate.js';
import { completeBindings } from './complete.js';

/**
 * A movement-path collision is a cosmetic transition artifact: the endpoints are valid and every
 * correctness gate passed, but the mover's straight path passes through a resting element during the
 * transition. The deterministic alternatives (a routing layer) do not exist, so the real board is
 * accepted with the collision recorded as a soft failure instead of failing the scene into no video.
 * This is deliberately narrow: text overflow, overlaps, off-canvas, evidence and binding problems
 * all remain hard.
 */
export function isSoftBoardProblem(problem: ValidatorProblem): boolean {
  const message = typeof problem === 'string' ? problem : problem.message;
  return /^layout\[movement_path_collision\]/.test(message);
}

/** S6 (V2): the board operations of one scene, written from its teaching beats and narration. */
export async function planSceneBoard(input: { ctx: BoardContext }, m: BeatStageModel): Promise<StructuredCallResult<SceneBoardDraft>> {
  const { ctx } = input;
  const { system, user } = buildBoardPrompt(ctx);
  const result = await structuredCall({
    stage: 'board-ops', subject: `scene ${ctx.sceneId}`, model: m.model, apiKey: m.apiKey, system, user, schema: SceneBoardDraftSchema, schemaName: 'scene_board',
    maxTokens: 8000, maxRepairs: 3, remainingBudgetUsd: m.remainingBudgetUsd, ...(m.budgetLedger ? { budgetLedger: m.budgetLedger } : {}), ...(m.fetcher ? { fetcher: m.fetcher } : {}), ...(m.client ? { client: m.client } : {}),
    // A validator problem on one field of an operation is usually fixed by editing a sibling
    // field of the SAME operation (relabel the element so its text agrees with the cited
    // evidence). Widen the patch target to the operation/element so a correct sibling fix is
    // accepted; content elsewhere is still protected by the patch guard.
    repairScope: (pointer) => pointer.match(/^(\/ops\/\d+(?:\/element)?)/)?.[1] ?? pointer,
    // Unambiguous bindings are completed deterministically before validation so
    // repair rounds address real defects; the raw model output is retained
    // separately and anything ambiguous still fails for model repair.
    validate: (draft) => validateSceneBoard(completeBindings(draft, ctx), ctx).filter((problem) => !isSoftBoardProblem(problem)),
  });
  if (result.value) {
    for (const problem of validateSceneBoard(completeBindings(result.value, ctx), ctx).filter(isSoftBoardProblem)) {
      result.failures.push({ code: 'board-movement-collision', stage: 'board-ops', message: typeof problem === 'string' ? problem : problem.message, hard: false });
    }
  }
  return result;
}

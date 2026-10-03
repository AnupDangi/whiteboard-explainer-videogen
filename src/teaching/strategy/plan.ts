import { selectStrategy, STRATEGY_POLICY_VERSION } from './select.js';
import { TeachingStrategyPlanSchema, type StrategyInput, type TeachingStrategyPlan } from './types.js';

/** Compile one scene's strategy plan from its S3-derived inputs. Pure: no LLM, no I/O. */
export function compileStrategyPlan(input: StrategyInput): TeachingStrategyPlan {
  const selection = selectStrategy(input);
  return TeachingStrategyPlanSchema.parse({
    sceneId: input.sceneId,
    strategy: selection.strategy,
    reasons: selection.reasons,
    policyVersion: STRATEGY_POLICY_VERSION,
  });
}

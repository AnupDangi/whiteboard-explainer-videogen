import { StrategyInputSchema, type StrategyInput, type StrategySelection } from './types.js';

export const STRATEGY_POLICY_VERSION = 'strategy-policy/v1';

/**
 * Deterministic strategy selection (STCC §7). Priority order is the policy:
 * misconceptions first, then boundary conditions, then skill-driven treatment,
 * then novelty. A plain definition scene selects `direct`: the policy must be
 * able to choose NO example, or every scene would carry example overhead.
 */
export function selectStrategy(raw: StrategyInput): StrategySelection {
  const input = StrategyInputSchema.parse(raw);
  const reasons: string[] = [];
  const pick = (strategy: StrategySelection['strategy'], reason: string): StrategySelection =>
    ({ strategy, reasons: [reason, ...reasons].slice(0, 4) });

  if (input.sectionKind === 'recap') return pick('direct', 'recap consolidates earlier deltas without new treatment');
  if (input.misconceptionCount > 0) {
    if (input.teachingSkill === 'mechanism' || input.teachingSkill === 'process') {
      return pick('erroneous-example', `${input.misconceptionCount} misconception(s) on a mechanism: diverge wrong vs correct reasoning, then repair`);
    }
    return pick('contrastive-example', `${input.misconceptionCount} misconception(s): compare the wrong idea against the correct one`);
  }
  if (input.hasBoundaryClaim) return pick('boundary-case', 'a claim turns on a threshold or edge condition: test the boundary');
  if (input.teachingSkill === 'comparison') return pick('contrastive-example', 'comparison skill: align cases side by side');
  if (input.teachingSkill === 'derivation') return pick('worked-example', 'derivation: show state -> step -> reason -> resulting state');
  if (input.teachingSkill === 'application') return pick('transfer-example', 'application: learner applies the principle to a nearby case');
  if (input.sectionKind === 'example') {
    return pick('worked-example', 'example scene on a procedure: work it fully');
  }
  if (input.teachingSkill === 'mechanism' || input.teachingSkill === 'process') {
    if (input.hasStateChange && input.budgetSec >= 20) return pick('predict-reveal', 'mechanism with a visible state change and time to pause: ask, then reveal');
    return pick('mechanism-trace', 'mechanism: trace the process beat by beat');
  }
  if (input.newConceptCount >= 2) return pick('intuition-example', `${input.newConceptCount} new concepts: build intuition before formalism`);
  if (input.sectionKind === 'intro') return pick('motivation', 'opening scene: earn attention with the puzzle before the machinery');
  reasons.push('no misconception, boundary, procedure, or novelty pressure: smallest effective treatment');
  return { strategy: 'direct', reasons };
}

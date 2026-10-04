import type { ConceptGraph, SceneContract } from '../../plan/schemas.js';

/**
 * S3-derived strategy signals (STCC §7). The beat planner hardcoded
 * hasBoundaryClaim/hasStateChange to false, which silently killed the
 * boundary-case and predict-reveal branches. These signals derive both from
 * fields the S3 contract and S2 graph already carry — no model call, no
 * guessing. Precedence: explicit mechanisms > structured intents/relations >
 * claim text. The firing rule is returned for the strategy reasons.
 */
export interface StrategySignals {
  hasBoundaryClaim: boolean;
  hasStateChange: boolean;
  /** Which rule fired for each signal, highest precedence first. */
  rules: string[];
}

const BOUNDARY_RELATIONS = new Set(['excepts', 'opposes', 'compares']);
const STATE_RELATIONS = new Set(['transforms', 'produces', 'causes', 'feeds', 'precedes']);
const STATE_INTENT_TYPES = new Set(['state', 'process', 'sequence']);
const STATE_CONCEPT_KINDS = new Set(['process', 'event']);
const BOUNDARY_TEXT = /\b(threshold|limit|edge case|boundary|except|unless|only when|only if|at most|at least|breaks? (down|when)|beyond \d|over \d)\b/i;

export function deriveStrategySignals(contract: SceneContract | undefined, graph: ConceptGraph, conceptIds: readonly string[]): StrategySignals {
  const rules: string[] = [];
  let hasBoundaryClaim = false;
  let hasStateChange = false;
  if (!contract) return { hasBoundaryClaim, hasStateChange, rules };
  if ((contract.candidateMechanisms ?? []).includes('threshold')) {
    hasBoundaryClaim = true;
    rules.push('candidateMechanisms includes threshold');
  }
  const intents = contract.semanticVisualIntents ?? [];
  if (!hasBoundaryClaim && intents.some((intent) => intent.conceptType === 'condition' || (intent.relationType !== undefined && BOUNDARY_RELATIONS.has(intent.relationType)))) {
    hasBoundaryClaim = true;
    rules.push('semantic intent marks a condition or boundary relation');
  }
  const relationTypes = new Set([
    ...(contract.requiredRelations ?? []).map((r) => r.type),
    ...contract.essentialClaims.flatMap((claim) => claim.relations.map((r) => r.type)),
  ]);
  if (!hasBoundaryClaim && [...relationTypes].some((t) => BOUNDARY_RELATIONS.has(t))) {
    hasBoundaryClaim = true;
    rules.push('contract relations include excepts/opposes/compares');
  }
  if (!hasBoundaryClaim && contract.essentialClaims.some((claim) => BOUNDARY_TEXT.test(claim.statement))) {
    hasBoundaryClaim = true;
    rules.push('claim text states a threshold or edge condition');
  }
  if (intents.some((intent) => intent.strategy === 'state-change' || STATE_INTENT_TYPES.has(intent.conceptType))) {
    hasStateChange = true;
    rules.push('semantic intent uses state-change or a state/process/sequence type');
  }
  if (!hasStateChange && [...relationTypes].some((t) => STATE_RELATIONS.has(t))) {
    hasStateChange = true;
    rules.push('contract relations include transforms/produces/causes/feeds/precedes');
  }
  if (!hasStateChange) {
    const kinds = new Set(graph.concepts.filter((c) => conceptIds.includes(c.id)).map((c) => c.kind));
    if ([...kinds].some((k) => STATE_CONCEPT_KINDS.has(k))) {
      hasStateChange = true;
      rules.push('scene concepts include a process or event kind');
    }
  }
  return { hasBoundaryClaim, hasStateChange, rules };
}

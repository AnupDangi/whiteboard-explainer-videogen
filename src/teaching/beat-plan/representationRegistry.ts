import {
  COGNITIVE_OPERATIONS,
  REPRESENTATION_FAMILIES,
  type CognitiveOperation,
  type RepresentationFamily,
} from './types.js';

export interface RepresentationProviderSpec {
  /** The generic learner operations for which this family can be a useful representation. */
  suitableOperations: readonly CognitiveOperation[];
  /** Selection is always made from the beat question and operation; never from lesson/topic identifiers. */
  selectionInputs: readonly ['learningQuestion', 'cognitiveOperation'];
}

/**
 * Phase 4's topic-independent selection registry. This contract filters mismatched choices before S4/S6.
 * Typed semantic validators, compilers, and family fallbacks are implemented by later provider phases.
 */
export const REPRESENTATION_REGISTRY: Record<RepresentationFamily, RepresentationProviderSpec> = {
  literal_object: { suitableOperations: ['identify', 'classify'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  process: { suitableOperations: ['trace', 'transform', 'predict', 'explain_cause', 'understand_system'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  state_transition: { suitableOperations: ['trace', 'transform', 'predict', 'compare', 'understand_system'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  sequence: { suitableOperations: ['trace', 'transform', 'identify', 'predict'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  topology: { suitableOperations: ['identify', 'compare', 'classify', 'understand_system', 'trace'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  hierarchy: { suitableOperations: ['identify', 'compare', 'classify', 'understand_system'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  comparison: { suitableOperations: ['compare', 'classify', 'identify'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  causal_chain: { suitableOperations: ['explain_cause', 'infer', 'predict', 'understand_system', 'trace'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  feedback_loop: { suitableOperations: ['explain_cause', 'infer', 'predict', 'understand_system'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  quantity: { suitableOperations: ['quantify', 'compare', 'predict', 'transform', 'infer'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  spatial_model: { suitableOperations: ['identify', 'trace', 'transform', 'predict', 'understand_system'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  equation: { suitableOperations: ['quantify', 'transform', 'infer', 'compare'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  plot: { suitableOperations: ['quantify', 'compare', 'predict', 'infer', 'trace'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  code: { suitableOperations: ['trace', 'transform', 'identify', 'infer'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  scientific_diagram: { suitableOperations: ['identify', 'trace', 'understand_system', 'explain_cause', 'classify'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  weighted_graph: { suitableOperations: ['compare', 'infer', 'understand_system', 'trace', 'explain_cause'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  material_flow: { suitableOperations: ['trace', 'understand_system', 'explain_cause', 'predict', 'transform'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  wave_propagation: { suitableOperations: ['trace', 'predict', 'understand_system', 'transform'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
  circuit: { suitableOperations: ['trace', 'understand_system', 'explain_cause', 'predict'], selectionInputs: ['learningQuestion', 'cognitiveOperation'] },
} satisfies Record<RepresentationFamily, RepresentationProviderSpec>;

export interface RepresentationSelectionInput {
  representationFamily?: unknown;
  cognitiveOperation?: unknown;
  learningQuestion?: unknown;
}

/** Reject unsupported or operation-incompatible choices; there is deliberately no generic family fallback. */
export function representationSelectionProblems(input: RepresentationSelectionInput): string[] {
  const problems: string[] = [];
  const family = input.representationFamily;
  const operation = input.cognitiveOperation;
  const question = input.learningQuestion;
  if (typeof question !== 'string' || !question.trim()) problems.push('representation selection needs the beat learningQuestion');
  if (typeof family !== 'string' || !(REPRESENTATION_FAMILIES as readonly string[]).includes(family)) {
    problems.push(`unknown representation family ${String(family)}; supported family names: ${REPRESENTATION_FAMILIES.join(', ')}`);
    return problems;
  }
  if (typeof operation !== 'string' || !(COGNITIVE_OPERATIONS as readonly string[]).includes(operation)) {
    problems.push(`unknown cognitive operation ${String(operation)} for representation family ${family}`);
    return problems;
  }
  const provider = REPRESENTATION_REGISTRY[family as RepresentationFamily];
  if (!provider.suitableOperations.includes(operation as CognitiveOperation)) {
    problems.push(`${family} is not registered for ${operation}; suitable operations: ${provider.suitableOperations.join(', ')}`);
  }
  return problems;
}

import type { TeachingStrategy } from '../strategy/types.js';
import { SceneMovePlanSchema, type SceneMovePlan, type TeachingMoveName } from './types.js';

export const MOVES_POLICY_VERSION = 'moves-policy/v1';

/**
 * Strategy → moves compiler (STCC §8). Fixed, reviewable mapping: the strategy
 * decides the treatment, the moves spell its instructional steps. Pure function.
 */
const STRATEGY_MOVES: Record<TeachingStrategy, TeachingMoveName[]> = {
  direct: ['RevealDefinition', 'ConfirmInvariant'],
  motivation: ['RevealMotivation', 'StateLearningQuestion'],
  'intuition-example': ['BuildIntuition', 'IntroduceMentalModel'],
  'worked-example': ['RevealDefinition', 'WorkExample', 'ConfirmInvariant'],
  'contrastive-example': ['CompareCases', 'ConfirmInvariant'],
  'erroneous-example': ['ExposeMisconception', 'ForkCorrectIncorrect', 'ExplainDivergence', 'RepairMisconception'],
  'example-nonexample': ['ShowNonExample', 'CompareCases'],
  counterexample: ['ShowCounterexample', 'ConfirmInvariant'],
  'boundary-case': ['TestBoundary', 'ConfirmInvariant'],
  'predict-reveal': ['PredictNextStep', 'TraceMechanism'],
  'faded-worked-example': ['WorkExample', 'FadeSupport'],
  'transfer-example': ['TransferVariant', 'ConfirmInvariant'],
  'mechanism-trace': ['TraceMechanism', 'SummarizeLearnerDelta'],
};

const NOTES: Record<TeachingMoveName, string> = {
  RevealMotivation: 'Open with the puzzle this scene answers.',
  ActivatePriorKnowledge: 'Reconnect what the learner already owns.',
  StateLearningQuestion: 'State the one question this scene resolves.',
  BuildIntuition: 'Concrete before formal: build the gut picture first.',
  IntroduceMentalModel: 'Name the model the learner will reuse.',
  RevealDefinition: 'Define the term with its meaning before use.',
  TraceMechanism: 'Walk the process step by step in causal order.',
  WorkExample: 'Show state, step, reason, and resulting state.',
  PredictNextStep: 'Ask what happens next, pause, then reveal.',
  ExposeMisconception: 'Name the plausible wrong idea explicitly.',
  ForkCorrectIncorrect: 'Show wrong and correct paths diverging.',
  ExplainDivergence: 'Explain why the wrong path seemed plausible.',
  RepairMisconception: 'Repair at the violated invariant.',
  ShowNonExample: 'Show what the concept is not.',
  ShowCounterexample: 'Show the case that breaks the naive rule.',
  TestBoundary: 'Probe the threshold or edge condition.',
  CompareCases: 'Align cases so the difference is visible.',
  ConfirmInvariant: 'Confirm what stays the same.',
  FadeSupport: 'Remove scaffolding; learner carries more.',
  TransferVariant: 'Apply the principle to a nearby case.',
  SummarizeLearnerDelta: 'Close with what the learner can now do.',
};

export function movesForStrategy(strategy: TeachingStrategy): TeachingMoveName[] {
  return [...STRATEGY_MOVES[strategy]];
}

/** Compile one scene's move plan from its strategy. Beat attachment happens downstream (S4/S6); moves stay ordered. */
export function compileMovePlan(sceneId: string, strategy: TeachingStrategy): SceneMovePlan {
  return SceneMovePlanSchema.parse({
    sceneId,
    moves: movesForStrategy(strategy).map((move) => ({ move, note: NOTES[move] })),
    policyVersion: MOVES_POLICY_VERSION,
  });
}

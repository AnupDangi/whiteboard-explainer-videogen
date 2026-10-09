import { sha256, stableJson } from '../../shared/artifacts.js';

/**
 * Strict-JSON few-shot examples for the content agents (S1b syllabus, S2 concept
 * graph, S3 teaching plan). They teach the exact JSON contract each stage schema
 * accepts. The examples are validated against those same schemas by
 * `src/__tests__/agent-examples.test.ts`, so a malformed example fails the offline
 * suite rather than reaching a model. Examples are deliberately neutral (no topic,
 * benchmark source, or catalog facts) so they teach shape, never facts — the same
 * rule the S6 exemplar bank follows.
 *
 * The objects here are re-serialized compactly into prompts, so prompt text and
 * this data cannot drift. This module intentionally imports no stage module, so a
 * prompt builder may import it without an import cycle.
 */
export const AGENT_EXAMPLES_VERSION = 'agent-examples/v1';

export type AgentStage = 'syllabus' | 'concept_graph' | 'teaching_plan';
export interface AgentExample { id: string; shape: string; json: unknown }

// --- S1b syllabus -----------------------------------------------------------

const SYLLABUS_EXAMPLES: AgentExample[] = [
  {
    id: 'syllabus-mechanism-60',
    shape: 'science mechanism, one 60s module',
    json: {
      requestedDurationSec: 60,
      plannedDurationSec: 60,
      coverageReason: 'The source explains how the two stages connect at the requested depth.',
      sourceSupport: 'supported',
      learningObjective: 'Explain how the first stage leads to the second.',
      audienceAssumptions: ['No prior background in the subject.'],
      concepts: [
        { id: 'stage_one', label: 'First stage', definition: 'The first stage sets the starting condition.', evidence: [{ spanId: 'span_2', quote: 'the first stage sets the starting condition' }] },
        { id: 'stage_two', label: 'Second stage', definition: 'The second stage acts on what the first produced.', evidence: [{ spanId: 'span_3', quote: 'the second stage acts on what the first produced' }] },
      ],
      prerequisites: [{ concept: 'stage_two', needs: 'stage_one' }],
      modules: [{ id: 'module_1', title: 'How the two stages connect', goal: 'Connect the first stage to the second and state the relation.', budgetSec: 60, conceptIds: ['stage_one', 'stage_two'], evidenceSpanIds: ['span_2', 'span_3'], recallOfModuleIds: [] }],
    },
  },
  {
    id: 'syllabus-partial-shallower',
    shape: 'source supports the goal at a shallower depth only (partial)',
    json: {
      requestedDurationSec: 300,
      plannedDurationSec: 60,
      coverageReason: 'The source explains the core idea but not the deeper mechanism the learner asked for.',
      sourceSupport: 'partial',
      learningObjective: 'Explain the core idea the source supports.',
      audienceAssumptions: ['No prior background in the subject.'],
      concepts: [{ id: 'core_idea', label: 'Core idea', definition: 'The central idea the source explains.', evidence: [{ spanId: 'span_1', quote: 'the central idea the source explains' }] }],
      prerequisites: [],
      modules: [{ id: 'module_1', title: 'The core idea', goal: 'Explain the core idea the source supports.', budgetSec: 60, conceptIds: ['core_idea'], evidenceSpanIds: ['span_1'], recallOfModuleIds: [] }],
    },
  },
];

// --- S2 concept graph -------------------------------------------------------

const CONCEPT_GRAPH_EXAMPLES: AgentExample[] = [
  {
    id: 'graph-mechanism',
    shape: 'two linked concepts (cause), one-step',
    json: {
      concepts: [
        { id: 'heat_input', label: 'Heat input', kind: 'quantity', definition: 'Heat added to the system.', evidence: [{ spanId: 'span_2', quote: 'heat added to the system' }], level: 'one-step' },
        { id: 'state_change', label: 'State change', kind: 'process', definition: 'The system changes state.', evidence: [{ spanId: 'span_2', quote: 'the system changes state' }], level: 'one-step' },
      ],
      relations: [{ from: 'heat_input', to: 'state_change', type: 'causes', evidence: [{ spanId: 'span_2', quote: 'heat added to the system causes it to change state' }] }],
      prerequisites: [{ concept: 'state_change', needs: 'heat_input' }],
    },
  },
  {
    id: 'graph-formula-multistep',
    shape: 'formula idea, multi-step, one relation',
    json: {
      concepts: [
        { id: 'rate', label: 'Rate', kind: 'formula', definition: 'The rate is a change per unit time.', evidence: [{ spanId: 'span_4', quote: 'the rate is a change per unit time' }], latex: 'r = \\frac{\\Delta x}{\\Delta t}', level: 'one-step' },
        { id: 'total_change', label: 'Total change', kind: 'quantity', definition: 'The accumulated change over the interval.', evidence: [{ spanId: 'span_4', quote: 'the accumulated change over the interval' }], level: 'multi-step' },
      ],
      relations: [{ from: 'rate', to: 'total_change', type: 'produces', evidence: [{ spanId: 'span_4', quote: 'the rate produces the total change over the interval' }] }],
      prerequisites: [{ concept: 'total_change', needs: 'rate' }],
    },
  },
  {
    id: 'graph-comparison',
    shape: 'two entities the source contrasts (compare)',
    json: {
      concepts: [
        { id: 'option_a', label: 'Option A', kind: 'entity', definition: 'The first option the source describes.', evidence: [{ spanId: 'span_1', quote: 'the first option' }], level: 'one-step' },
        { id: 'option_b', label: 'Option B', kind: 'entity', definition: 'The second option the source describes.', evidence: [{ spanId: 'span_1', quote: 'the second option' }], level: 'one-step' },
      ],
      relations: [{ from: 'option_a', to: 'option_b', type: 'compares', evidence: [{ spanId: 'span_2', quote: 'unlike the first option, the second option' }] }],
      prerequisites: [],
    },
  },
];

// --- S3 teaching plan (draft: contracts derived in code) --------------------

const TEACHING_PLAN_EXAMPLES: AgentExample[] = [
  {
    id: 'plan-mechanism-60',
    shape: 'one explain scene teaching a two-concept mechanism',
    json: {
      targetDurationSec: 60,
      intro: { sourceTitle: 'How the two stages connect', sections: ['First stage', 'Second stage'] },
      domain: 'science',
      sections: [
        {
          id: 'scene_1', title: 'How one stage leads to the next', goal: 'Explain the relation between the first and second stage.', kind: 'explain', conceptIds: ['stage_one', 'stage_two'], budgetSec: 60,
          teachingSkill: 'mechanism', candidateMechanisms: ['chain'],
          essentialClaims: [{ id: 'stages_link', statement: 'The first stage sets the condition the second stage acts on.', conceptIds: ['stage_one', 'stage_two'], relations: [{ from: 'stage_one', to: 'stage_two', type: 'causes' }], evidenceSpanIds: ['span_2', 'span_3'] }],
          visualForm: 'process', mentalModel: 'Stage one feeds stage two as a chain.', misconceptionRisk: ['The stages are independent.'],
          semanticVisualIntents: [{ claimId: 'stages_link', conceptType: 'process', strategy: 'diagram', conceptIds: ['stage_one', 'stage_two'], roles: [] }],
        },
      ],
      recap: { keyPoints: ['The first stage sets up the second.'] },
    },
  },
  {
    id: 'plan-quantity-plot',
    shape: 'a quantity scene that must be shown as a plot',
    json: {
      targetDurationSec: 60,
      intro: { sourceTitle: 'A quantity that changes', sections: ['The quantity'] },
      domain: 'math',
      sections: [
        {
          id: 'scene_1', title: 'How the quantity changes', goal: 'Show how the quantity changes over the interval.', kind: 'explain', conceptIds: ['rate', 'total_change'], budgetSec: 60,
          teachingSkill: 'process', candidateMechanisms: ['trajectory'],
          essentialClaims: [{ id: 'rate_accumulates', statement: 'The rate adds up to the total change over the interval.', conceptIds: ['rate', 'total_change'], relations: [{ from: 'rate', to: 'total_change', type: 'produces' }], evidenceSpanIds: ['span_4'] }],
          visualForm: 'plot', mentalModel: 'A curve whose accumulated area is the total change.', misconceptionRisk: [],
          semanticVisualIntents: [{ claimId: 'rate_accumulates', conceptType: 'quantity', strategy: 'plot', conceptIds: ['rate', 'total_change'], roles: [] }],
        },
      ],
      recap: { keyPoints: ['The rate accumulates into the total change.'] },
    },
  },
];

// --- rendering --------------------------------------------------------------

const BANK: Record<AgentStage, AgentExample[]> = {
  syllabus: SYLLABUS_EXAMPLES,
  concept_graph: CONCEPT_GRAPH_EXAMPLES,
  teaching_plan: TEACHING_PLAN_EXAMPLES,
};

export const AGENT_EXAMPLE_IDS = Object.fromEntries((Object.keys(BANK) as AgentStage[]).map((stage) => [stage, BANK[stage].map((example) => example.id)])) as Record<AgentStage, string[]>;

/** One compact JSON example for a stage, or undefined when the stage has none. */
export function agentExample(stage: AgentStage, id?: string): AgentExample | undefined {
  const list = BANK[stage];
  return id ? list.find((example) => example.id === id) : list[0];
}

/**
 * A prompt block teaching one strict-JSON example for a stage. Rendered from the
 * validated data, so the block and the checked example are the same object.
 */
export function agentExampleBlock(stage: AgentStage, id?: string): string {
  const example = agentExample(stage, id);
  if (!example) return '';
  return `\n\nEXAMPLE (${example.shape}) — shape to copy, NOT facts or labels; replace every value with data from YOUR source:\n${JSON.stringify(example.json)}`;
}

export { SYLLABUS_EXAMPLES, CONCEPT_GRAPH_EXAMPLES, TEACHING_PLAN_EXAMPLES };

export const AGENT_EXAMPLES_HASH = sha256(stableJson({ version: AGENT_EXAMPLES_VERSION, syllabus: SYLLABUS_EXAMPLES, concept_graph: CONCEPT_GRAPH_EXAMPLES, teaching_plan: TEACHING_PLAN_EXAMPLES }));

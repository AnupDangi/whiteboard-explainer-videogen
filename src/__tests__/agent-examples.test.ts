import assert from 'node:assert/strict';
import test from 'node:test';
import { agentExample, agentExampleBlock, AGENT_EXAMPLE_IDS, AGENT_EXAMPLES_HASH, AGENT_EXAMPLES_VERSION, CONCEPT_GRAPH_EXAMPLES, SYLLABUS_EXAMPLES, TEACHING_PLAN_EXAMPLES } from '../plan/prompts/stageExamples.js';
import { SyllabusSchema, syllabusSystemPrompt, validateSyllabus } from '../plan/hierarchical.js';
import { ConceptGraphSchema, TeachingPlanDraftSchema } from '../plan/schemas.js';

test('every agent example is valid against the schema its stage accepts', () => {
  for (const example of SYLLABUS_EXAMPLES) assert.ok(SyllabusSchema.safeParse(example.json).success, `syllabus/${example.id}`);
  for (const example of CONCEPT_GRAPH_EXAMPLES) assert.ok(ConceptGraphSchema.safeParse(example.json).success, `concept_graph/${example.id}`);
  for (const example of TEACHING_PLAN_EXAMPLES) assert.ok(TeachingPlanDraftSchema.safeParse(example.json).success, `teaching_plan/${example.id}`);
  assert.ok(AGENT_EXAMPLES_VERSION.length > 0);
  assert.match(AGENT_EXAMPLES_HASH, /^[0-9a-f]{64}$/);
});

test('a mutated example that breaks the contract fails validation (the bank teaches shape, not laxness)', () => {
  const bad = structuredClone(SYLLABUS_EXAMPLES[0]!.json) as { sourceSupport: string };
  bad.sourceSupport = 'definitely';
  assert.equal(SyllabusSchema.safeParse(bad).success, false);

  const badGraph = structuredClone(CONCEPT_GRAPH_EXAMPLES[0]!.json) as { relations: Array<{ type: string }> };
  badGraph.relations[0]!.type = 'not-a-relation';
  assert.equal(ConceptGraphSchema.safeParse(badGraph).success, false);

  const badPlan = structuredClone(TEACHING_PLAN_EXAMPLES[0]!.json) as { targetDurationSec: number };
  badPlan.targetDurationSec = 0;
  assert.equal(TeachingPlanDraftSchema.safeParse(badPlan).success, false);
});

test('the syllabus example is a real 60s single-module lesson the validator accepts', () => {
  const example = SYLLABUS_EXAMPLES[0]!.json as { requestedDurationSec: number; plannedDurationSec: number };
  assert.deepEqual(validateSyllabus(example as never, example.requestedDurationSec), []);
});

test('the rendered example block carries the exact validated JSON, not a copy', () => {
  for (const stage of ['syllabus', 'concept_graph', 'teaching_plan'] as const) {
    const first = agentExample(stage)!;
    const block = agentExampleBlock(stage);
    assert.match(block, /EXAMPLE \(/);
    assert.match(block, /replace every value with data from YOUR source/);
    assert.ok(block.includes(JSON.stringify(first.json)), `${stage} block must embed the example JSON verbatim`);
  }
  assert.deepEqual(AGENT_EXAMPLE_IDS.syllabus, SYLLABUS_EXAMPLES.map((example) => example.id));
});

test('the S1 syllabus prompt embeds its strict-JSON example', () => {
  assert.ok(syllabusSystemPrompt([60, 300]).includes(JSON.stringify(SYLLABUS_EXAMPLES[0]!.json)));
});

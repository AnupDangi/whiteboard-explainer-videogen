import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { CONTRACT_CODES, teachingContractFindings } from '../plan/contracts.js';
import { completeRecurringBible, completeSceneContractReferences, buildTeachingPlan, teachingPlanTokenBudget } from '../plan/stages.js';
import { TeachingPlanSchema, type ConceptGraph, type TeachingPlan } from '../plan/schemas.js';

const evidence = { sourceId: 'source', spanId: 'span_a', startChar: 0, endChar: 19, startLine: 1, endLine: 1, quote: 'A source-backed idea.' };
const graph: ConceptGraph = {
  concepts: [{ id: 'idea', label: 'Idea', kind: 'entity', definition: evidence.quote, evidence: [evidence], level: 'one-step' }],
  relations: [], prerequisites: [],
};
const plan: TeachingPlan = {
  targetDurationSec: 36,
  intro: { sourceTitle: 'Study', sections: ['Define', 'Apply'] },
  lessonBible: { audience: 'general learner', terminology: [], persistentConceptIds: [] },
  sections: [
    { id: 'define', title: 'Define Idea', goal: 'Define the source idea clearly.', kind: 'explain', conceptIds: ['idea'], budgetSec: 18, contract: { learningDelta: 'Define the source idea clearly.', targetDurationSec: 18, requiredConceptIds: ['idea'], requiredRelations: [], evidenceSpanIds: ['span_a'], teachingSkill: 'definition', candidateMechanisms: ['focus'] } },
    { id: 'apply', title: 'Apply Idea', goal: 'Apply the source idea correctly.', kind: 'example', conceptIds: ['idea'], budgetSec: 18, contract: { learningDelta: 'Apply the source idea correctly.', targetDurationSec: 18, requiredConceptIds: ['idea'], requiredRelations: [], evidenceSpanIds: ['span_a'], teachingSkill: 'application', candidateMechanisms: ['focus'] } },
  ],
  recap: { keyPoints: ['The idea is useful.'] },
};

test('recurring concept metadata is completed from repeated section IDs and exact graph label', () => {
  const completed = completeRecurringBible(plan, graph);
  assert.deepEqual(completed.lessonBible?.persistentConceptIds, ['idea']);
  assert.deepEqual(completed.lessonBible?.terminology, [{ conceptId: 'idea', label: 'Idea' }]);
  assert.deepEqual(teachingContractFindings(completed, graph, 'general learner'), []);
  assert.deepEqual(plan.lessonBible?.persistentConceptIds, [], 'raw model output is not mutated');

  const wrongLabel = structuredClone(plan);
  wrongLabel.lessonBible!.terminology = [{ conceptId: 'idea', label: 'Unsupported Name' }];
  assert.ok(teachingContractFindings(completeRecurringBible(wrongLabel, graph), graph).some((finding) => finding.code === CONTRACT_CODES.TERMINOLOGY_LABEL_MISMATCH));
  const missingContract = structuredClone(plan);
  missingContract.sections[0]!.contract = undefined;
  assert.ok(teachingContractFindings(completeRecurringBible(missingContract, graph), graph).some((finding) => finding.code === CONTRACT_CODES.SECTION_CONTRACT_MISSING));
});

test('missing contract relation and evidence copies come only from the source graph', () => {
  const secondRef = { ...evidence, spanId: 'span_b', quote: 'A second source-backed idea.' };
  const relationRef = { ...evidence, spanId: 'span_relation', quote: 'The first idea causes the second.' };
  const relatedGraph: ConceptGraph = {
    concepts: [...graph.concepts, { id: 'second', label: 'Second', kind: 'entity', definition: secondRef.quote, evidence: [secondRef], level: 'one-step' }],
    relations: [{ from: 'idea', to: 'second', type: 'causes', evidence: [relationRef] }], prerequisites: [],
  };
  const raw = structuredClone(plan);
  raw.sections[0]!.conceptIds = ['idea', 'second'];
  raw.sections[0]!.contract!.requiredConceptIds = ['idea', 'second'];
  raw.sections[0]!.contract!.evidenceSpanIds = ['span_a'];
  raw.sections[1]!.conceptIds = ['idea'];
  const completed = completeSceneContractReferences(completeRecurringBible(raw, relatedGraph), relatedGraph);
  assert.deepEqual(completed.sections[0]!.contract!.requiredRelations, [{ from: 'idea', to: 'second', type: 'causes' }]);
  assert.deepEqual(completed.sections[0]!.contract!.evidenceSpanIds, ['span_a', 'span_b', 'span_relation']);
  assert.deepEqual(teachingContractFindings(completed, relatedGraph, 'general learner'), []);
  assert.deepEqual(raw.sections[0]!.contract!.requiredRelations, [], 'raw model output is not mutated');

  const invented = structuredClone(raw);
  invented.sections[0]!.contract!.requiredRelations = [{ from: 'idea', to: 'second', type: 'opposes' }];
  invented.sections[0]!.contract!.evidenceSpanIds.push('span_unrelated');
  const findings = teachingContractFindings(completeSceneContractReferences(completeRecurringBible(invented, relatedGraph), relatedGraph), relatedGraph);
  assert.ok(findings.some((finding) => finding.code === CONTRACT_CODES.UNSUPPORTED_RELATION));
  assert.ok(findings.some((finding) => finding.code === CONTRACT_CODES.EVIDENCE_SPAN_UNRELATED));

  const absentConcept = structuredClone(raw);
  absentConcept.sections[0]!.conceptIds = [];
  assert.ok(teachingContractFindings(completeSceneContractReferences(absentConcept, relatedGraph), relatedGraph).some((finding) => finding.code === CONTRACT_CODES.CONCEPTIDS_CONTRACT_MISMATCH));
});

test('S3 repairs truncated JSON and accepts only a fully checked plan with completed metadata', async () => {
  const responses = ['{"targetDurationSec":36,"intro":', JSON.stringify(plan)];
  const maxTokens: number[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { max_tokens: number };
    maxTokens.push(request.max_tokens);
    return new Response(JSON.stringify({ choices: [{ message: { content: responses.shift() }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 50, cost: 0.001 } }), { status: 200 });
  };
  const result = await buildTeachingPlan({ source: evidence.quote, targetDurationSec: 36 }, graph, { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.1, fetcher });
  assert.equal(result.usage.repairs, 1);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.value?.lessonBible?.persistentConceptIds, ['idea']);
  assert.deepEqual(maxTokens, [teachingPlanTokenBudget(2, 1, 0), teachingPlanTokenBudget(2, 1, 0)]);
  assert.ok(maxTokens[0]! > 3_000);
  assert.equal(z.toJSONSchema(TeachingPlanSchema).type, 'object');
});

test('S3 does not turn unsupported scene relations into a valid plan', async () => {
  const bad = structuredClone(plan);
  bad.sections[0]!.contract!.requiredRelations = [{ from: 'idea', to: 'idea', type: 'causes' }];
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bad) }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 50, cost: 0.001 } }), { status: 200 });
  const result = await buildTeachingPlan({ source: evidence.quote, targetDurationSec: 36 }, graph, { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.1, fetcher });
  assert.equal(result.value, undefined);
  assert.equal(result.usage.repairs, 1);
  assert.match(result.failures[0]?.message ?? '', /unsupported relation/);
});

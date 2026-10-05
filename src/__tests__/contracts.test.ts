import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_CODES, teachingContractFindings, teachingContractProblems } from '../plan/contracts.js';
import { SceneContractSchema, type ConceptGraph, type SceneContract, type TeachingPlan } from '../plan/schemas.js';
import { epistemicClaimProblems } from '../evidence/ledger.js';

const heatRef = { sourceId: 'source_a', spanId: 'span_heat', startChar: 0, endChar: 11, startLine: 1, endLine: 1, quote: 'heat enters' };
const pressureRef = { sourceId: 'source_a', spanId: 'span_pressure', startChar: 12, endChar: 26, startLine: 2, endLine: 2, quote: 'pressure rises' };
const relationRef = { sourceId: 'source_a', spanId: 'span_relation', startChar: 27, endChar: 47, startLine: 3, endLine: 3, quote: 'heat raises pressure' };
const graph: ConceptGraph = {
  concepts: [
    { id: 'heat', label: 'Heat', kind: 'quantity', definition: 'Energy enters.', level: 'one-step', evidence: [heatRef] },
    { id: 'pressure', label: 'Pressure', kind: 'quantity', definition: 'Pressure rises.', level: 'one-step', evidence: [pressureRef] },
  ],
  relations: [{ from: 'heat', to: 'pressure', type: 'causes', evidence: [relationRef] }], prerequisites: [],
};
const contract: SceneContract = {
  learningDelta: 'Explain how heat raises pressure', targetDurationSec: 20, requiredConceptIds: ['heat', 'pressure'],
  requiredRelations: [{ from: 'heat', to: 'pressure', type: 'causes' }], evidenceSpanIds: ['span_heat', 'span_pressure', 'span_relation'],
  essentialClaims: [{ id: 'heat_raises_pressure', statement: 'Heat raises pressure', epistemicType: 'derived_relation', conceptIds: ['heat', 'pressure'], relations: [{ from: 'heat', to: 'pressure', type: 'causes' }], evidenceSpanIds: ['span_relation'] }],
  teachingSkill: 'mechanism', candidateMechanisms: ['convergence', 'threshold'],
};
const bible = { audience: 'general learner', terminology: [{ conceptId: 'heat', label: 'Heat' }, { conceptId: 'pressure', label: 'Pressure' }], persistentConceptIds: ['heat'] };
const plan: TeachingPlan = {
  targetDurationSec: 20, intro: { sourceTitle: 'Pressure', sections: ['Heat and pressure'] }, lessonBible: bible,
  sections: [{ id: 'heat_pressure', title: 'Heat Raises Pressure', goal: contract.learningDelta, kind: 'explain', conceptIds: ['heat', 'pressure'], budgetSec: 20, contract }],
  recap: { keyPoints: [] },
};

test('generated scene contracts cannot validate without an essential claim', () => {
  assert.equal(SceneContractSchema.safeParse({ ...contract, essentialClaims: [] }).success, false);
});

test('teachingContractFindings tags a clean plan with no findings', () => {
  assert.deepEqual(teachingContractFindings(plan, graph, 'general learner'), []);
});

test('teachingContractFindings codes a missing SceneContract distinctly from an empty conceptIds mismatch', () => {
  const missingContract = structuredClone(plan);
  missingContract.sections[0].contract = undefined;
  const findings = teachingContractFindings(missingContract, graph, 'general learner');
  // The missing contract also mechanically drops the only source relation from every SceneContract,
  // so both codes fire — this test only asserts SECTION_CONTRACT_MISSING is one of them.
  assert.ok(findings.some((f) => f.code === CONTRACT_CODES.SECTION_CONTRACT_MISSING));

  const emptiedConceptIds = structuredClone(plan);
  emptiedConceptIds.sections[0].conceptIds = [];
  const emptied = teachingContractFindings(emptiedConceptIds, graph, 'general learner');
  assert.ok(emptied.some((f) => f.code === CONTRACT_CODES.CONCEPTIDS_CONTRACT_MISMATCH));
  // The two root causes diagnosed from live runs must never collapse into the same code —
  // that is exactly what would make a calibration harness unable to tell them apart.
  assert.notEqual(findings[0]!.code, emptied.find((f) => f.code === CONTRACT_CODES.CONCEPTIDS_CONTRACT_MISMATCH)!.code);
});

test('teachingContractFindings codes an invented relation distinctly from a dropped one', () => {
  const invented = structuredClone(plan);
  invented.sections[0].contract!.requiredRelations = [{ from: 'heat', to: 'pressure', type: 'opposes' }];
  const inventedFindings = teachingContractFindings(invented, graph, 'general learner');
  assert.ok(inventedFindings.some((f) => f.code === CONTRACT_CODES.UNSUPPORTED_RELATION));

  const dropped = structuredClone(plan);
  dropped.sections[0].contract!.requiredRelations = [];
  const droppedFindings = teachingContractFindings(dropped, graph, 'general learner');
  assert.ok(droppedFindings.some((f) => f.code === CONTRACT_CODES.SECTION_OMITS_SOURCE_RELATION));
  assert.ok(droppedFindings.some((f) => f.code === CONTRACT_CODES.LESSON_OMITS_SOURCE_RELATION));
});

test('teachingContractProblems (legacy string view) stays byte-identical to teachingContractFindings messages', () => {
  const missingContract = structuredClone(plan);
  missingContract.sections[0].contract = undefined;
  const findings = teachingContractFindings(missingContract, graph, 'general learner');
  assert.deepEqual(teachingContractProblems(missingContract, graph, 'general learner'), findings.map((f) => f.message));
});

test('generated claims require consistent explicit epistemic types and framed examples or analogies', () => {
  const untyped = structuredClone(plan);
  delete untyped.sections[0]!.contract!.essentialClaims[0]!.epistemicType;
  assert.ok(teachingContractFindings(untyped, graph).some((finding) => finding.code === CONTRACT_CODES.ESSENTIAL_CLAIM_EPISTEMIC_TYPE && /explicit epistemicType/.test(finding.message)));

  const directWithRelation = structuredClone(plan);
  directWithRelation.sections[0]!.contract!.essentialClaims[0]!.epistemicType = 'direct_source';
  assert.ok(teachingContractFindings(directWithRelation, graph).some((finding) => /direct_source but lists a graph relation/.test(finding.message)));

  const noRelation = structuredClone(plan);
  noRelation.sections[0]!.contract!.essentialClaims[0]!.epistemicType = 'derived_relation';
  noRelation.sections[0]!.contract!.essentialClaims[0]!.relations = [];
  assert.ok(teachingContractFindings(noRelation, graph).some((finding) => /derived_relation but lists no graph relation/.test(finding.message)));

  assert.deepEqual(epistemicClaimProblems({ id: 'example', statement: 'The river carries the water.', relations: [], epistemicType: 'illustrative_example' }), ['claim example needs explicit example framing']);
  assert.deepEqual(epistemicClaimProblems({ id: 'example', statement: 'For example, a river carries water.', relations: [], epistemicType: 'illustrative_example' }), []);
  assert.deepEqual(epistemicClaimProblems({ id: 'analogy', statement: 'A queue works like a line at a shop.', relations: [], epistemicType: 'analogy' }), []);
  assert.deepEqual(epistemicClaimProblems({ id: 'analogy', statement: 'A queue stores tasks.', relations: [], epistemicType: 'analogy' }), ['claim analogy needs explicit analogy framing']);
});

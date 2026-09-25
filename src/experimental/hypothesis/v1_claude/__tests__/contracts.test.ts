import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_CODES, teachingContractFindings, teachingContractProblems } from '../plan/contracts.js';
import type { ConceptGraph, SceneContract, TeachingPlan } from '../plan/schemas.js';

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
  teachingSkill: 'mechanism', candidateMechanisms: ['convergence', 'threshold'],
};
const bible = { audience: 'general learner', terminology: [{ conceptId: 'heat', label: 'Heat' }, { conceptId: 'pressure', label: 'Pressure' }], persistentConceptIds: ['heat'] };
const plan: TeachingPlan = {
  targetDurationSec: 20, intro: { sourceTitle: 'Pressure', sections: ['Heat and pressure'] }, lessonBible: bible,
  sections: [{ id: 'heat_pressure', title: 'Heat Raises Pressure', goal: contract.learningDelta, kind: 'explain', conceptIds: ['heat', 'pressure'], budgetSec: 20, contract }],
  recap: { keyPoints: [] },
};

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { teachingContractProblems } from '../plan/contracts.js';
import type { ConceptGraph, SceneContract, TeachingPlan } from '../plan/schemas.js';
import type { SceneSpec } from '../types.js';
import { compileScenePlanningContext } from '../planner/context.js';
import { buildScenePlannerPrompt } from '../planner/prompt.js';
import { EXAMPLE_BANK_HASH, EXAMPLE_BANK_VERSION, EXAMPLE_NEAR_DUPLICATE_THRESHOLD, exemplarPromotionProblems, exemplarRetrievalProblems, selectExemplars } from '../planner/exemplars.js';
import type { PlannerSceneInput } from '../planner/prompt.js';
import { deriveRunStatus } from '../../shared/evaluation.js';
import { exemplarCopyProblems, plannerProblems } from '../planner/plan.js';
import { SCENE_EXEMPLARS } from '../planner/exemplars.js';
import { exemplarContextRecord, exemplarPromptRecord, type SceneExemplar } from '../planner/exemplars.js';
import { sha256, stableJson } from '../../shared/artifacts.js';

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
const scene: PlannerSceneInput = {
  sceneId: 'heat_pressure', raw: '[[heat|Heat]] raises [[pressure|pressure]].', plainText: 'Heat raises pressure.',
  mentions: [{ id: 'heat', phrase: 'Heat' }, { id: 'pressure', phrase: 'pressure' }],
  teachingContext: { requireEvidence: true, sourceId: 'source_a', displayText: 'Heat Raises Pressure', sourceEvidenceRefs: [heatRef, pressureRef, relationRef],
    concepts: graph.concepts.map((item) => ({ id: item.id, label: item.label, kind: item.kind, definition: item.definition, evidenceRefs: item.evidence })),
    relations: graph.relations.map((item) => ({ from: item.from, to: item.to, type: item.type, evidenceRefs: item.evidence })) },
  candidates: { heat: [], pressure: [] },
};
const times = [{ id: 'heat', startMs: 100, endMs: 300 }, { id: 'pressure', startMs: 1100, endMs: 1600 }];

test('S3 contract rejects dropped relations, unrelated evidence and renamed source terminology', () => {
  assert.deepEqual(teachingContractProblems(plan, graph, 'general learner'), []);
  const missing = structuredClone(plan);
  missing.sections[0].contract!.requiredRelations = [];
  assert.match(teachingContractProblems(missing, graph).join('|'), /omits source relation/);
  assert.match(teachingContractProblems(missing, graph).join('|'), /from every SceneContract/);
  const invented = structuredClone(plan);
  invented.sections[0].contract!.evidenceSpanIds.push('span_unrelated');
  assert.match(teachingContractProblems(invented, graph).join('|'), /unrelated evidence span/);
  const renamed = structuredClone(plan);
  renamed.lessonBible!.terminology[0].label = 'Flames';
  assert.match(teachingContractProblems(renamed, graph).join('|'), /source concept label/);
  const badDuration = structuredClone(plan);
  badDuration.sections[0].contract!.targetDurationSec = 18;
  assert.match(teachingContractProblems(badDuration, graph).join('|'), /targetDurationSec must equal section budgetSec/);

  const missingConcepts = structuredClone(plan);
  missingConcepts.sections[0].conceptIds = [];
  assert.match(teachingContractProblems(missingConcepts, graph).join('|'), /contract concepts must exactly match its nonempty section conceptIds/);
});

test('S3 requires unique canonical terms for concepts declared persistent across scenes', () => {
  const missingTerm = structuredClone(plan);
  missingTerm.lessonBible!.terminology = missingTerm.lessonBible!.terminology.filter((item) => item.conceptId !== 'heat');
  assert.match(teachingContractProblems(missingTerm, graph).join('|'), /persistent concept heat lacks a canonical terminology entry/);

  const duplicateTerm = structuredClone(plan);
  duplicateTerm.lessonBible!.terminology.push({ conceptId: 'heat', label: 'Heat' });
  assert.match(teachingContractProblems(duplicateTerm, graph).join('|'), /terminology must map each concept at most once/);

  const duplicatePersistent = structuredClone(plan);
  duplicatePersistent.lessonBible!.persistentConceptIds.push('heat');
  assert.match(teachingContractProblems(duplicatePersistent, graph).join('|'), /persistentConceptIds must be unique/);

  const recurringWithoutPersistence = structuredClone(plan);
  const secondUse = structuredClone(recurringWithoutPersistence.sections[0]);
  secondUse.id = 'pressure_recap';
  secondUse.title = 'Pressure Recap';
  secondUse.kind = 'recap';
  recurringWithoutPersistence.sections.push(secondUse);
  assert.match(teachingContractProblems(recurringWithoutPersistence, graph).join('|'), /must declare recurring concept pressure persistent across scenes/);
});

test('S6 requires canonical LessonBible terminology to be visibly present for persistent concepts', () => {
  const planningContext = compileScenePlanningContext(scene, contract, bible, times, 'zero', 'catalog-v1');
  const input = { ...scene, planningContext };
  const spec: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: 'heat_pressure', title: 'Heat Raises Pressure',
    titleConceptIds: ['heat', 'pressure'], titleEvidenceRefs: [heatRef, pressureRef], template: 'chain',
    elements: [
      { id: 'heat_node', prim: 'box', anchor: 'mention:heat', text: 'THERMAL INPUT', conceptIds: ['heat'], evidenceRefs: [heatRef] },
      { id: 'pressure_node', prim: 'box', anchor: 'mention:pressure', text: 'PRESSURE', conceptIds: ['pressure'], evidenceRefs: [pressureRef] },
    ],
    edges: [{ from: 'heat_node', to: 'pressure_node', evidenceRefs: [relationRef], factualRelation: { fromConceptId: 'heat', toConceptId: 'pressure', type: 'causes', evidenceRefs: [relationRef] } }],
  };
  assert.ok(plannerProblems(spec, input).some((problem) => problem.includes('persistent concept heat must visibly use its canonical term "Heat"')));
  const named = structuredClone(spec);
  named.elements = named.elements.map((element) => element.id === 'heat_node' && element.prim === 'box' ? { ...element, text: 'HEAT INPUT' } : element);
  assert.ok(!plannerProblems(named, input).some((problem) => problem.includes('must visibly use its canonical term')));
});

test('S6 context fails closed on missing evidence or measured alignment', () => {
  assert.throws(() => compileScenePlanningContext(scene, contract, bible, times.slice(0, 1), 'zero', 'catalog-v1'), /missing measured mention alignment/);
  assert.throws(() => compileScenePlanningContext({ ...scene, teachingContext: { ...scene.teachingContext, sourceEvidenceRefs: [heatRef] } }, contract, bible, times, 'zero', 'catalog-v1'), /evidence does not match/);
});

test('S6 may compile semantic context before S5 without inventing mention times, then strict validation requires measurements', () => {
  const pending = compileScenePlanningContext(scene, contract, bible, [], 'zero', 'catalog-v1', undefined, undefined, 'ranked', false);
  assert.equal(pending.mentionTimingState, 'pending-s5');
  assert.deepEqual(pending.mentionTimes, []);
  assert.match(buildScenePlannerPrompt({ ...scene, planningContext: pending }).user, /"mentionTimingState":"pending-s5"/);
  assert.throws(() => compileScenePlanningContext(scene, contract, bible, [], 'zero', 'catalog-v1'), /missing measured mention alignment/);
});

test('S6 only prompts with catalog candidates above the current feasibility threshold', () => {
  const input = { ...scene, candidates: { heat: [{ name: 'weak associated icon', score: 0.49 }], pressure: [{ name: 'pressure gauge', score: 0.72 }] } };
  const context = compileScenePlanningContext(input, contract, bible, times, 'zero', 'catalog-v1');
  assert.deepEqual(context.visualCandidates?.heat, []);
  assert.deepEqual(context.visualCandidates?.pressure, [{ name: 'pressure gauge', score: 0.72 }]);
  assert.match(context.versions.candidateFeasibility, /catalog-embedding-min-/);
  const prompt = buildScenePlannerPrompt({ ...input, planningContext: context });
  assert.ok(!prompt.user.includes('weak associated icon'));
  assert.match(prompt.user, /pressure gauge/);
});

test('S6 rejects a scene that drops a required visual concept from its contract', () => {
  const context = compileScenePlanningContext(scene, contract, bible, times, 'zero', 'catalog-v1');
  const problems = plannerProblems({ schemaVersion: 'claude-scene-spec/v1', sceneId: 'heat_pressure', title: 'Heat Raises Pressure', titleConceptIds: ['heat'], titleEvidenceRefs: [heatRef], template: 'list_icon',
    elements: [{ id: 'heat', prim: 'box', anchor: 'mention:heat', text: 'HEAT', conceptIds: ['heat'], evidenceRefs: [heatRef] }], edges: [] }, { ...scene, planningContext: context });
  assert.ok(problems.some((problem) => problem.includes('required visual concept pressure')));
});

test('S6 rejects missing or unrelated source concepts and concept citations before planning', () => {
  assert.throws(() => compileScenePlanningContext(
    { ...scene, teachingContext: { ...scene.teachingContext, concepts: scene.teachingContext!.concepts!.slice(0, 1) } }, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout',
  ), /source concept context must exactly match SceneContract.requiredConceptIds/);
  assert.throws(() => compileScenePlanningContext(
    { ...scene, teachingContext: { ...scene.teachingContext, concepts: [...scene.teachingContext!.concepts!, { id: 'unrelated', label: 'Unrelated', kind: 'entity', definition: 'Unrelated concept', evidenceRefs: [heatRef] }] } }, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout',
  ), /source concept context must exactly match SceneContract.requiredConceptIds/);
  assert.throws(() => compileScenePlanningContext(
    { ...scene, teachingContext: { ...scene.teachingContext, concepts: scene.teachingContext!.concepts!.map((concept) => concept.id === 'heat' ? { ...concept, evidenceRefs: [{ ...heatRef, quote: 'unrelated quote' }] } : concept) } }, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout',
  ), /each required source concept must retain its evidence references/);
});

test('S6 rejects missing, duplicated, or unrelated relation context before planning', () => {
  assert.throws(() => compileScenePlanningContext(
    { ...scene, teachingContext: { ...scene.teachingContext, relations: [] } }, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout',
  ), /source relation context must exactly match SceneContract.requiredRelations/);
  assert.throws(() => compileScenePlanningContext(
    { ...scene, teachingContext: { ...scene.teachingContext, relations: [...scene.teachingContext!.relations!, ...scene.teachingContext!.relations!] } }, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout',
  ), /source relation context must exactly match SceneContract.requiredRelations/);
  assert.throws(() => compileScenePlanningContext(
    { ...scene, teachingContext: { ...scene.teachingContext, relations: [...scene.teachingContext!.relations!, { from: 'pressure', to: 'heat', type: 'opposes', evidenceRefs: [relationRef] }] } }, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout',
  ), /source relation context must exactly match SceneContract.requiredRelations/);
});

test('generated factual numeric labels and visual values need matching cited evidence', () => {
  const generatedInput = { ...scene, teachingContext: { ...scene.teachingContext, requireEvidence: true } };
  const unsupported: SceneSpec = { schemaVersion: 'claude-scene-spec/v1', sceneId: scene.sceneId, title: 'Pressure reaches 12 kPa', titleConceptIds: ['pressure'], titleEvidenceRefs: [pressureRef], template: 'list_icon',
    elements: [{ id: 'pressure_value', prim: 'box', anchor: 'mention:pressure', text: '12 kPa', conceptIds: ['pressure'], evidenceRefs: [pressureRef] }], edges: [] };
  const unsupportedProblems = plannerProblems(unsupported, generatedInput);
  assert.ok(unsupportedProblems.some((problem) => problem.includes('scene title numeric value')));
  assert.ok(unsupportedProblems.some((problem) => problem.includes('remove it or cite an exact source span that contains it')));
  assert.ok(unsupportedProblems.some((problem) => problem.includes('element pressure_value numeric value')));

  const citedValueRef = { ...pressureRef, quote: 'Pressure reaches 12 kPa' };
  const groundedInput = { ...generatedInput, teachingContext: { ...generatedInput.teachingContext, sourceEvidenceRefs: [heatRef, citedValueRef, relationRef], concepts: generatedInput.teachingContext?.concepts?.map((concept) => concept.id === 'pressure' ? { ...concept, evidenceRefs: [citedValueRef] } : concept) } };
  const grounded: SceneSpec = { ...unsupported, titleEvidenceRefs: [citedValueRef], elements: [{ ...unsupported.elements[0], evidenceRefs: [citedValueRef] }] };
  assert.ok(!plannerProblems(grounded, groundedInput).some((problem) => /numeric value/.test(problem)));
  const wrongUnit: SceneSpec = { ...grounded, title: 'Pressure reaches 12 °C', elements: [{ id: 'pressure_value', prim: 'box', anchor: 'mention:pressure', text: '12 °C', conceptIds: ['pressure'], evidenceRefs: [citedValueRef] }] };
  assert.ok(plannerProblems(wrongUnit, groundedInput).some((problem) => problem.includes('scene title numeric value')));

  const percentRef = { ...pressureRef, quote: 'The rate is 70%.' };
  const percentInput = { ...generatedInput, teachingContext: { ...generatedInput.teachingContext, sourceEvidenceRefs: [percentRef] } };
  const meterScene: SceneSpec = { ...unsupported, title: 'Pressure changes', titleEvidenceRefs: [percentRef], elements: [{ id: 'rate_meter', prim: 'meter', anchor: 'mention:pressure', values: [0.7], labels: ['70%'], evidenceRefs: [percentRef] }] };
  assert.ok(!plannerProblems(meterScene, percentInput).some((problem) => problem.includes('rate_meter numeric value')));
});

test('S6 zero-shot context has no retrieved examples; changed source input changes context and prompt', () => {
  const context = compileScenePlanningContext(scene, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout');
  const prompt = buildScenePlannerPrompt({ ...scene, planningContext: context });
  assert.equal(context.examples.length, 0);
  assert.match(prompt.user, /heat raises pressure/);
  assert.match(prompt.user, /availableTemplates/);
  const changed = { ...scene, raw: '[[heat|Warmth]] raises [[pressure|pressure]].', plainText: 'Warmth raises pressure.' };
  const changedContext = compileScenePlanningContext(changed, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout');
  assert.notEqual(context.contextHash, changedContext.contextHash);
  assert.notEqual(prompt.user, buildScenePlannerPrompt({ ...changed, planningContext: changedContext }).user);
});

test('experimental exemplars are versioned, feasible, deterministic and structural rather than topic keyed', () => {
  const query = { sceneContract: contract, capabilities: ['box', 'text', 'operator', 'meter'], arm: 'mechanism' as const, caseId: 'attention-heldout' };
  const first = selectExemplars(query);
  assert.deepEqual(first, selectExemplars(query));
  assert.ok(first.length >= 1 && first.length <= 3);
  assert.ok(first.every(({ exemplar }) => exemplar.reviewStatus === 'experimental' && exemplar.requiredCapabilities.every((cap) => query.capabilities.includes(cap))));
  assert.match(EXAMPLE_BANK_VERSION, /v4/);
  assert.equal(EXAMPLE_BANK_HASH.length, 64);
  const nearDuplicate = selectExemplars({ sceneContract: { ...contract, learningDelta: 'Trace a package through a transfer process', candidateMechanisms: ['chain'] }, capabilities: query.capabilities, arm: 'text' });
  assert.ok(nearDuplicate.every(({ exemplar }) => exemplar.id !== 'flow-transport-01'));
  const retrievalQuery = { ...query, sceneContract: { ...contract, learningDelta: 'Trace a package through a transfer process' } };
  const flow = SCENE_EXEMPLARS.find(({ id }) => id === 'flow-transport-01')!;
  assert.ok(exemplarRetrievalProblems(flow, retrievalQuery).some((reason) => reason.includes('lexical near-duplicate')));
  assert.ok(exemplarRetrievalProblems({ ...flow, review: { ...flow.review, license: 'failed' } }, query).some((reason) => reason.includes('failed license review')));
  assert.ok(EXAMPLE_NEAR_DUPLICATE_THRESHOLD > 0.7);
  assert.ok(exemplarRetrievalProblems({ ...flow, goldenId: 'different-evaluation-golden' }, query).some((reason) => reason.includes('evaluation golden')));
  assert.ok(exemplarRetrievalProblems({ ...flow, provenance: { ...flow.provenance, evaluationSplit: 'test' } }, query).some((reason) => reason.includes('held-out evaluation split')));
  assert.ok(exemplarRetrievalProblems({ ...flow, sourceId: 'source_a' }, { ...query, sourceId: 'source_a' }).some((reason) => reason.includes('target source')));
  const context = compileScenePlanningContext(scene, contract, bible, times, 'mechanism', 'catalog-v1', 'source_a', 'attention-heldout');
  assert.deepEqual(context.examples.map(({ exemplar }) => exemplar.id), first.map(({ exemplar }) => exemplar.id));
});

test('E5 can reverse selected-example order and cache identity records the permutation', () => {
  const complexContract: SceneContract = {
    ...contract,
    requiredConceptIds: ['heat', 'pressure', 'x', 'y', 'z'],
    candidateMechanisms: ['chain', 'convergence', 'threshold'],
  };
  const complexScene = { ...scene, teachingContext: { ...scene.teachingContext, concepts: [
    ...scene.teachingContext!.concepts!,
    ...['x', 'y', 'z'].map((id) => ({ id, label: id.toUpperCase(), kind: 'entity', definition: 'Synthetic retrieval query concept', evidenceRefs: [heatRef] })),
  ] } };
  const ranked = compileScenePlanningContext(complexScene, complexContract, bible, times, 'mechanism', 'catalog-v1', 'source_a', 'heldout', 'ranked');
  const reversed = compileScenePlanningContext(complexScene, complexContract, bible, times, 'mechanism', 'catalog-v1', 'source_a', 'heldout', 'reverse');
  const rankedIds = ranked.examples.map(({ exemplar }) => exemplar.id);
  assert.ok(rankedIds.length >= 2);
  const reversedIds = reversed.examples.map(({ exemplar }) => exemplar.id);
  assert.deepEqual(reversedIds, [...rankedIds].reverse());
  assert.notEqual(ranked.contextHash, reversed.contextHash);
  const rankedPrompt = buildScenePlannerPrompt({ ...complexScene, planningContext: ranked }).system;
  const reversedPrompt = buildScenePlannerPrompt({ ...complexScene, planningContext: reversed }).system;
  assert.ok(rankedIds.every((id, index) => index === 0 || rankedPrompt.indexOf(id) > rankedPrompt.indexOf(rankedIds[index - 1]!)));
  assert.ok(reversedIds.every((id, index) => index === 0 || reversedPrompt.indexOf(id) > reversedPrompt.indexOf(reversedIds[index - 1]!)));
  assert.throws(() => compileScenePlanningContext(scene, contract, bible, times, 'zero', 'catalog-v1', 'source_a', 'heldout', 'reverse'), /requires a retrieval prompt arm/);
});

test('S6 exemplar audit record and prompt include every selected field sent to the model', () => {
  const base = {
    id: 'synthetic-example',
    sourceClass: 'hand-authored-example',
    reviewStatus: 'experimental',
    provenance: { source: 'synthetic unit-test data', authoring: 'test fixture', thirdPartyAssets: false, evaluationSplit: 'none' },
    review: { factuality: 'pending', visual: 'pending', license: 'pending', leakage: 'pending', human: 'pending' },
    domain: 'synthetic', teachingSkill: 'mechanism', visualMechanism: 'convergence', complexity: 1, qualityScore: 3,
    requiredCapabilities: [],
    inputIntent: { learningDelta: 'Explain a generic input and outcome' },
    designRationale: ['Show the input before the result'],
    sceneSpec: {
      schemaVersion: 'claude-scene-spec/v1', sceneId: 'synthetic-scene', title: 'Input and outcome',
      titleConceptIds: [], titleEvidenceRefs: [], template: 'chain', elements: [], edges: [],
    },
  } as SceneExemplar;
  const selected = { exemplar: base, score: 0.61 };
  const selectedContext = { ...compileScenePlanningContext(scene, contract, bible, times, 'zero', 'catalog-v1'), examples: [selected] };
  const beforePrompt = buildScenePlannerPrompt({ ...scene, planningContext: selectedContext }).system;
  const beforeHash = sha256(stableJson(exemplarContextRecord(selected)));
  assert.deepEqual(exemplarPromptRecord(selected), {
    id: 'synthetic-example', intent: 'Explain a generic input and outcome', spec: base.sceneSpec,
    rationale: ['Show the input before the result'], provenance: 'hand-authored-example',
  });

  const changed = { ...base, designRationale: ['Reveal the result after its cause'] };
  const changedSelected = { ...selected, exemplar: changed };
  const changedContext = { ...selectedContext, examples: [changedSelected] };
  const afterPrompt = buildScenePlannerPrompt({ ...scene, planningContext: changedContext }).system;
  const afterHash = sha256(stableJson(exemplarContextRecord(changedSelected)));
  assert.notEqual(beforePrompt, afterPrompt);
  assert.notEqual(beforeHash, afterHash);
});

test('exemplar promotion requires provenance and all five offline reviews plus an identified reviewer', () => {
  const candidate = structuredClone(SCENE_EXEMPLARS[0]!);
  candidate.reviewStatus = 'approved';
  assert.match(exemplarPromotionProblems(candidate).join('|'), /factuality review must pass/);
  assert.match(exemplarPromotionProblems(candidate).join('|'), /visual review must pass/);
  assert.match(exemplarPromotionProblems(candidate).join('|'), /license review must pass/);
  assert.match(exemplarPromotionProblems(candidate).join('|'), /leakage review must pass/);
  assert.match(exemplarPromotionProblems(candidate).join('|'), /human review must pass/);
  assert.match(exemplarPromotionProblems(candidate).join('|'), /identified human reviewer/);

  candidate.review = { factuality: 'passed', visual: 'passed', license: 'passed', leakage: 'passed', human: 'passed', reviewer: 'reviewer-1', reviewedAt: '2026-09-24T12:00:00Z' };
  assert.deepEqual(exemplarPromotionProblems(candidate), []);
  candidate.provenance = { ...candidate.provenance, source: '' };
  assert.match(exemplarPromotionProblems(candidate).join('|'), /provenance source/);
});

test('few-shot anti-copy gate rejects copied example labels and values unless target evidence independently supports them', () => {
  const context = compileScenePlanningContext(scene, contract, bible, times, 'mechanism', 'catalog-v1', 'source_a', 'heldout');
  const complexContract = { ...contract, requiredConceptIds: ['heat', 'pressure', 'x', 'y', 'z'], requiredRelations: [...contract.requiredRelations, { from: 'x', to: 'y', type: 'feeds' as const }, { from: 'y', to: 'z', type: 'feeds' as const }, { from: 'z', to: 'x', type: 'feeds' as const }] };
  const selected = selectExemplars({ sceneContract: complexContract, capabilities: ['box', 'operator'], arm: 'mechanism' }).find(({ exemplar }) => exemplar.id === 'converge-sensors-01');
  assert.ok(selected, 'test requires the mechanism-retrieved sensor example');
  const withExample = { ...scene, planningContext: { ...context, examples: [selected] } };
  const copied = structuredClone(selected.exemplar.sceneSpec);
  copied.sceneId = scene.sceneId;
  assert.ok(exemplarCopyProblems(copied, withExample).some((problem) => problem.includes('readings guide a decision')));
  assert.ok(plannerProblems(copied, withExample).some((problem) => problem.includes('readings guide a decision')));
  const independentlySupported = { ...withExample, teachingContext: { ...scene.teachingContext, sourceEvidenceRefs: [{ ...heatRef, quote: selected.exemplar.sceneSpec.title }] } };
  assert.ok(!exemplarCopyProblems(copied, independentlySupported).some((problem) => problem.includes('readings guide a decision')));

  const threshold = SCENE_EXEMPLARS.find((example) => example.id === 'threshold-thermostat-01')!;
  const numericCopy = structuredClone(threshold.sceneSpec);
  numericCopy.sceneId = scene.sceneId;
  const numericContext = { ...context, examples: [{ exemplar: threshold, score: 1 }] };
  assert.ok(exemplarCopyProblems(numericCopy, { ...scene, planningContext: numericContext }).some((problem) => problem.includes('copies unsupported exemplar value "0.7"')));
});

test('few-shot anti-copy gate checks visible container child labels', () => {
  const base = SCENE_EXEMPLARS[0]!;
  const exemplar = structuredClone(base);
  exemplar.sceneSpec = {
    ...base.sceneSpec,
    elements: [{ id: 'group', prim: 'container', children: ['SENSOR READINGS'], style: 'solid', anchor: 'sceneStart', origin: 'illustrative-example' }],
  };
  const input = {
    ...scene,
    planningContext: {
      ...compileScenePlanningContext(scene, contract, bible, times, 'zero', 'catalog-v1'),
      examples: [{ exemplar, score: 1 }],
    },
  };
  const copied: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: scene.sceneId, title: 'Heat Raises Pressure',
    titleConceptIds: ['heat', 'pressure'], titleEvidenceRefs: [heatRef, pressureRef], template: 'chain',
    elements: [
      { id: 'group', prim: 'container', children: ['SENSOR READINGS'], style: 'solid', anchor: 'sceneStart', conceptIds: ['heat'], evidenceRefs: [heatRef] },
      { id: 'pressure', prim: 'box', text: 'PRESSURE', anchor: 'mention:pressure', conceptIds: ['pressure'], evidenceRefs: [pressureRef] },
    ],
    edges: [{ from: 'group', to: 'pressure', evidenceRefs: [relationRef], factualRelation: { fromConceptId: 'heat', toConceptId: 'pressure', type: 'causes', evidenceRefs: [relationRef] } }],
  };
  assert.ok(exemplarCopyProblems(copied, input).some((problem) => problem.includes('copies unsupported exemplar fact "sensor readings"')));
  assert.ok(plannerProblems(copied, input).some((problem) => problem.includes('copies unsupported exemplar fact "sensor readings"')));
});

test('few-shot contract rejects copied facts, values, and relations after topic changes with the template retained', () => {
  const exemplar: SceneExemplar = {
    id: 'synthetic-signal-example', sourceClass: 'hand-authored-example', reviewStatus: 'experimental',
    provenance: { source: 'synthetic unit-test data', authoring: 'test fixture', thirdPartyAssets: false, evaluationSplit: 'none' },
    review: { factuality: 'pending', visual: 'pending', license: 'pending', leakage: 'pending', human: 'pending' },
    domain: 'synthetic', teachingSkill: 'mechanism', visualMechanism: 'chain', complexity: 1, qualityScore: 3,
    requiredCapabilities: ['box', 'meter'],
    inputIntent: { learningDelta: 'Explain when a signal activates a valve' },
    designRationale: ['Show a signal before its response'],
    sceneSpec: {
      schemaVersion: 'claude-scene-spec/v1', sceneId: 'synthetic_signal', title: 'Signal activates a valve',
      titleConceptIds: [], template: 'chain',
      elements: [
        { id: 'signal', prim: 'box', anchor: 'sceneStart', text: 'SENSOR READINGS', origin: 'illustrative-example' },
        { id: 'response', prim: 'meter', anchor: 'sceneStart', values: [0.7], labels: ['70%'], origin: 'illustrative-example' },
      ],
      edges: [{ from: 'signal', to: 'response', label: 'activates a valve', origin: 'illustrative-example' }],
    },
  };
  const selected = { exemplar, score: 0.8 };
  const context = { ...compileScenePlanningContext(scene, contract, bible, times, 'zero', 'catalog-v1'), examples: [selected] };
  const input = { ...scene, planningContext: context };
  const target: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: scene.sceneId, title: 'Heat input', titleConceptIds: ['heat'], titleEvidenceRefs: [heatRef], template: 'chain',
    elements: [
      { id: 'heat_node', prim: 'box', anchor: 'mention:heat', text: 'Heat', conceptIds: ['heat'], evidenceRefs: [heatRef] },
      { id: 'pressure_node', prim: 'box', anchor: 'mention:pressure', text: 'Pressure', conceptIds: ['pressure'], evidenceRefs: [pressureRef] },
    ],
    edges: [{ from: 'heat_node', to: 'pressure_node', evidenceRefs: [relationRef], factualRelation: { fromConceptId: 'heat', toConceptId: 'pressure', type: 'causes', evidenceRefs: [relationRef] } }],
  };
  assert.deepEqual(exemplarCopyProblems(target, input), []);
  assert.deepEqual(plannerProblems(target, input), []);

  const copied = structuredClone(target);
  copied.elements[0] = { ...copied.elements[0]!, prim: 'box', text: 'SENSOR READINGS' };
  copied.elements[1] = { id: 'pressure_node', prim: 'meter', anchor: 'mention:pressure', values: [0.7], labels: ['70%'], conceptIds: ['pressure'], evidenceRefs: [pressureRef] };
  copied.edges[0] = { from: 'heat_node', to: 'pressure_node', label: 'activates a valve', evidenceRefs: [relationRef], factualRelation: { fromConceptId: 'heat', toConceptId: 'pressure', type: 'feeds', evidenceRefs: [relationRef] } };
  assert.equal(copied.template, target.template);
  const copyProblems = exemplarCopyProblems(copied, input).join('|');
  assert.match(copyProblems, /copies unsupported exemplar fact "sensor readings"/);
  assert.match(copyProblems, /copies unsupported exemplar fact "activates a valve"/);
  assert.match(copyProblems, /copies unsupported exemplar value "0.7"/);
  const plannerProblemsFound = plannerProblems(copied, input).join('|');
  assert.match(plannerProblemsFound, /unsupported factual relation/);
  assert.match(plannerProblemsFound, /numeric value "0.7"/);
});

test('a diagnostic fallback with a prior planner failure cannot be promoted', () => {
  assert.equal(deriveRunStatus(1, true, { factualEvidenceComplete: true, alignmentComplete: true }), 'failed');
});

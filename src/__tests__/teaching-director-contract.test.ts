import test from 'node:test';
import assert from 'node:assert/strict';
import { continuityProblems, deriveTeachingPlan, teachingDirectorProblems } from '../plan/contracts.js';
import { TeachingPlanDraftSchema, type ConceptGraph } from '../plan/schemas.js';
import { collectCoercions } from '../structured/coercionLedger.js';

const graph: ConceptGraph = {
  concepts: [
    { id: 'a', label: 'Alpha thing', kind: 'entity', definition: 'd', evidence: [{ spanId: 's1', quote: 'q' }], level: 'one-step' },
    { id: 'b', label: 'Beta thing', kind: 'entity', definition: 'd', evidence: [{ spanId: 's2', quote: 'q' }], level: 'one-step' },
  ],
  relations: [{ from: 'a', to: 'b', type: 'causes', evidence: [{ spanId: 's1', quote: 'q' }] }],
  prerequisites: [],
} as unknown as ConceptGraph;

const section = (id: string, conceptIds: string[], claim: string, extra: Record<string, unknown> = {}) => ({
  id, title: `T ${id}`, goal: `Goal ${id}.`, kind: 'explain' as const, conceptIds, budgetSec: 18, teachingSkill: 'mechanism' as const, candidateMechanisms: ['chain' as const],
  essentialClaims: [{ id: `${id}_c`, statement: claim, conceptIds, relations: conceptIds.length > 1 ? [{ from: 'a', to: 'b', type: 'causes' as const }] : [], evidenceSpanIds: ['s1'] }],
  ...extra,
});
const draft = (sections: unknown[]) => TeachingPlanDraftSchema.parse({ targetDurationSec: 36, intro: { sourceTitle: 'x', sections: [] }, sections, recap: { keyPoints: [] } });
const director = (id: string, conceptIds: string[]) => ({ mentalModel: 'A drives B.', misconceptionRisk: ['B drives A'], semanticVisualIntents: [{ claimId: `${id}_c`, conceptType: 'cause', strategy: 'topology', conceptIds, roles: [] }] });

test('a scene without mentalModel or claim intents gets precise repair messages', () => {
  const plan = deriveTeachingPlan(draft([section('s1', ['a', 'b'], 'Alpha thing drives the beta thing.')]), graph, 'learner');
  const problems = teachingDirectorProblems(plan);
  assert.ok(problems.some((problem) => problem.includes('needs a mentalModel')));
  assert.ok(problems.some((problem) => problem.includes('needs a semanticVisualIntent')));
});

test('a complete Teaching Director scene passes and priorKnowledge is derived from earlier scenes', () => {
  const plan = deriveTeachingPlan(draft([
    section('s1', ['a', 'b'], 'Alpha thing drives the beta thing.', director('s1', ['a', 'b'])),
    section('s2', ['b'], 'Beta thing then settles into a steady level.', director('s2', ['b'])),
  ]), graph, 'learner');
  assert.deepEqual(teachingDirectorProblems(plan), []);
  assert.deepEqual(plan.sections[0]!.contract!.priorKnowledge, []);
  assert.deepEqual(plan.sections[1]!.contract!.priorKnowledge, ['Beta thing']);
  assert.equal(plan.sections[1]!.contract!.mentalModel, 'A drives B.');
});

test('an unverified explanation has no semantic visual intent', () => {
  const unverified = section('s1', ['a', 'b'], 'One possible account is not verified by the supplied source.', {
    essentialClaims: [{ id: 's1_c', statement: 'One possible account is not verified by the supplied source.', epistemicType: 'unverified_explanation', conceptIds: ['a', 'b'], relations: [], evidenceSpanIds: [] }],
    mentalModel: 'A possible account.', semanticVisualIntents: [],
  });
  const plan = deriveTeachingPlan(draft([unverified]), graph, 'learner');
  assert.deepEqual(teachingDirectorProblems(plan), []);

  const withIntent = deriveTeachingPlan(draft([section('s1', ['a', 'b'], 'One possible account is not verified by the supplied source.', {
    ...unverified,
    visualForm: 'process',
    semanticVisualIntents: [{ claimId: 's1_c', conceptType: 'process', strategy: 'diagram', conceptIds: ['a'], roles: [] }],
  })]), graph, 'learner');
  assert.ok(teachingDirectorProblems(withIntent).some((problem) => /unverified explanation claim s1_c must not have a semanticVisualIntent/.test(problem)));
  assert.ok(teachingDirectorProblems(withIntent).some((problem) => /scene containing only unverified explanations must omit visualForm/.test(problem)));
});

test('an intent naming a concept outside its claim or an unknown claim is rejected', () => {
  const bad = director('s1', ['a', 'b']);
  (bad.semanticVisualIntents[0] as { conceptIds: string[] }).conceptIds = ['a', 'zzz'];
  const plan = deriveTeachingPlan(draft([section('s1', ['a', 'b'], 'Alpha thing drives the beta thing.', bad)]), graph, 'learner');
  assert.ok(teachingDirectorProblems(plan).some((problem) => problem.includes('outside the claim')));
});

test('continuity: a later scene that restates an earlier claim is flagged; a new-role claim is not', () => {
  const restated = deriveTeachingPlan(draft([
    section('s1', ['a', 'b'], 'Alpha thing drives the beta thing strongly.', director('s1', ['a', 'b'])),
    section('s2', ['a', 'b'], 'Alpha thing drives the beta thing strongly.', director('s2', ['a', 'b'])),
  ]), graph, 'learner');
  assert.equal(continuityProblems(restated).length, 1);
  const fresh = deriveTeachingPlan(draft([
    section('s1', ['a', 'b'], 'Alpha thing drives the beta thing strongly.', director('s1', ['a', 'b'])),
    section('s2', ['b'], 'Beta thing later limits what happens next.', director('s2', ['b'])),
  ]), graph, 'learner');
  assert.deepEqual(continuityProblems(fresh), []);
});

test('terminology continuity is structural: every scene label comes from the single graph label', () => {
  const plan = deriveTeachingPlan(draft([section('s1', ['a'], 'Alpha thing exists alone here.', director('s1', ['a'])), section('s2', ['a'], 'Alpha thing returns in a new place.', director('s2', ['a']))]), graph, 'learner');
  assert.deepEqual(plan.lessonBible!.terminology.map((term) => term.label), ['Alpha thing']);
});

test('advisory enums are coerced: unknown mechanisms are dropped, unknown strategies follow the conceptType', () => {
  const parsed = TeachingPlanDraftSchema.parse({
    targetDurationSec: 18, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] },
    sections: [{
      ...section('s1', ['a', 'b'], 'Alpha thing drives the beta thing.'), candidateMechanisms: ['made_up', 'cycle', 'cycle'],
      semanticVisualIntents: [{ claimId: 's1_c', conceptType: 'process', strategy: 'process', conceptIds: ['a', 'b'], roles: [] }],
    }],
  });
  assert.deepEqual(parsed.sections[0]!.candidateMechanisms, ['cycle']);
  assert.equal(parsed.sections[0]!.semanticVisualIntents![0]!.strategy, 'diagram');
  const allBad = TeachingPlanDraftSchema.parse({ targetDurationSec: 18, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] }, sections: [{ ...section('s1', ['a'], 'Alpha thing stands alone.'), candidateMechanisms: ['zzz'] }] });
  assert.deepEqual(allBad.sections[0]!.candidateMechanisms, ['focus']);
});

test('visualForm is kept when valid and dropped (not rejected) when unknown; unknown scene kind and skill fall back', () => {
  const parsed = TeachingPlanDraftSchema.parse({
    targetDurationSec: 36, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] },
    sections: [
      { ...section('s1', ['a'], 'Alpha thing stands here alone.'), visualForm: 'array' },
      { ...section('s2', ['b'], 'Beta thing stands here alone.'), visualForm: 'hologram', kind: 'comparison', teachingSkill: 'storytelling' },
    ],
  });
  assert.equal(parsed.sections[0]!.visualForm, 'array');
  assert.equal(parsed.sections[1]!.visualForm, undefined);
  assert.equal(parsed.sections[1]!.kind, 'explain');
  assert.equal(parsed.sections[1]!.teachingSkill, 'mechanism');
  const plan = deriveTeachingPlan(parsed, graph, 'learner');
  assert.equal(plan.sections[0]!.contract!.visualForm, 'array');
});

test('continuity: a recap scene may bring an earlier claim back together', () => {
  const plan = deriveTeachingPlan(draft([
    section('s1', ['a', 'b'], 'Alpha thing drives the beta thing strongly.', director('s1', ['a', 'b'])),
    section('s2', ['a', 'b'], 'Alpha thing drives the beta thing strongly.', { ...director('s2', ['a', 'b']), kind: 'recap' }),
  ]), graph, 'learner');
  assert.deepEqual(continuityProblems(plan), []);
});

test('claim evidence spans the graph does not back are dropped and the graph-backed ones added, both in the coercion ledger', () => {
  const claim = { id: 's1_c', statement: 'Alpha thing drives the beta thing.', conceptIds: ['a', 'b'], relations: [{ from: 'a', to: 'b', type: 'causes' as const }], evidenceSpanIds: ['s1', 'zzz'] };
  const { result: plan, entries } = collectCoercions(() => deriveTeachingPlan(draft([section('s1', ['a', 'b'], 'x', { essentialClaims: [claim] })]), graph, 'learner'));
  assert.deepEqual(plan.sections[0]!.contract!.essentialClaims[0]!.evidenceSpanIds, ['s1', 's2']);
  const byReason = (reason: string) => entries.filter((entry) => entry.reason === reason);
  assert.deepEqual(byReason('claim-evidence-span-not-backed-by-graph').map((entry) => [entry.path, entry.semanticRisk]), [['/essentialClaims/s1_c/evidenceSpanIds/zzz', 'semantic']]);
  assert.deepEqual(byReason('claim-evidence-span-added-from-graph').map((entry) => [entry.path, entry.semanticRisk]), [['/essentialClaims/s1_c/evidenceSpanIds/s2', 'low']]);
});

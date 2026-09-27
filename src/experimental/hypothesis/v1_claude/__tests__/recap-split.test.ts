import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDenseRecapSections } from '../plan/stages.js';
import { analyzeTeachingPlan } from '../plan/analyze.js';
import { teachingContractFindings } from '../plan/contracts.js';
import { TeachingPlanSchema, type ConceptGraph, type TeachingPlan } from '../plan/schemas.js';
import type { SourceEvidenceRef } from '../plan/sourceDoc.js';

/** Domain-neutral fixtures: generic ids/labels only, no lesson topic. */
const ev = (spanId: string): SourceEvidenceRef => ({
  sourceId: 'test-source', spanId, startChar: 0, endChar: 10, startLine: 1, endLine: 1, quote: `words for ${spanId}`,
});

const concept = (id: string, label: string) => ({
  id, label, kind: 'entity' as const, definition: `Definition of ${label}.`,
  level: 'one-step' as const, evidence: [ev(`s_${id}`)],
});

const relation = (from: string, to: string, type: 'causes' | 'produces' | 'feeds' | 'contains') => ({
  from, to, type, evidence: [ev(`s_${from}_${to}`)],
});

const chainGraph = (): ConceptGraph => ({
  concepts: [concept('c1', 'Idea One'), concept('c2', 'Idea Two'), concept('c3', 'Idea Three'), concept('c4', 'Idea Four')],
  relations: [relation('c1', 'c2', 'causes'), relation('c2', 'c3', 'produces'), relation('c3', 'c4', 'feeds')],
  prerequisites: [],
});

/** Three concepts bound by three relations: relation-dense but concept-light. */
const triangleGraph = (): ConceptGraph => ({
  concepts: [concept('c1', 'Idea One'), concept('c2', 'Idea Two'), concept('c3', 'Idea Three')],
  relations: [relation('c1', 'c2', 'causes'), relation('c2', 'c3', 'produces'), relation('c1', 'c3', 'contains')],
  prerequisites: [],
});

const section = (graph: ConceptGraph, o: { id: string; kind: 'explain' | 'recap'; conceptIds: string[]; budgetSec: number; skill: 'definition' | 'recap' }): TeachingPlan['sections'][number] => {
  const goal = `Goal for ${o.id} section`;
  const requiredRelations = graph.relations
    .filter((r) => o.conceptIds.includes(r.from) && o.conceptIds.includes(r.to))
    .map(({ from, to, type }) => ({ from, to, type }));
  const allowed = new Set([
    ...graph.concepts.filter((c) => o.conceptIds.includes(c.id)).flatMap((c) => c.evidence.map((e) => e.spanId)),
    ...graph.relations.filter((r) => o.conceptIds.includes(r.from) && o.conceptIds.includes(r.to)).flatMap((r) => r.evidence.map((e) => e.spanId)),
  ]);
  return {
    id: o.id, title: `Title ${o.id}`, goal, kind: o.kind, conceptIds: [...o.conceptIds], budgetSec: o.budgetSec,
    contract: {
      learningDelta: goal, targetDurationSec: o.budgetSec, requiredConceptIds: [...o.conceptIds],
      requiredRelations, evidenceSpanIds: [...allowed],
      teachingSkill: o.skill, candidateMechanisms: ['chain'],
    },
  };
};

const planWith = (graph: ConceptGraph, sections: TeachingPlan['sections'], persistent: string[] = []): TeachingPlan => ({
  targetDurationSec: sections.reduce((s, x) => s + x.budgetSec, 0),
  intro: { sourceTitle: 'Test source', sections: ['Part one'] },
  lessonBible: {
    audience: 'general learner',
    terminology: graph.concepts.map((c) => ({ conceptId: c.id, label: c.label })),
    persistentConceptIds: [...persistent],
  },
  sections,
  recap: { keyPoints: ['Key point one'] },
});

const spanUnion = (plan: TeachingPlan): string[] =>
  [...new Set(plan.sections.flatMap((s) => s.contract?.evidenceSpanIds ?? []))].sort();

test('dense recap (4 concepts) splits into two valid, boardable, evidence-preserving sections', () => {
  const graph = chainGraph();
  const before = planWith(graph, [
    section(graph, { id: 'open', kind: 'explain', conceptIds: ['c1'], budgetSec: 15, skill: 'definition' }),
    section(graph, { id: 'rec', kind: 'recap', conceptIds: ['c1', 'c2', 'c3', 'c4'], budgetSec: 30, skill: 'recap' }),
  ], ['c1']);
  const after = splitDenseRecapSections(before, graph);
  assert.notEqual(after, before);
  assert.equal(after.sections.length, 3);
  const [open, a, b] = after.sections;
  assert.deepEqual(open, before.sections[1 - 1]);
  assert.equal(a!.id, 'rec_a');
  assert.equal(b!.id, 'rec_b');
  assert.equal(a!.kind, 'recap');
  assert.equal(b!.kind, 'recap');
  // Partitioned concepts: disjoint, union equals the original set.
  assert.deepEqual([...new Set([...a!.conceptIds, ...b!.conceptIds])].sort(), ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(a!.conceptIds.filter((c) => b!.conceptIds.includes(c)).length <= 1, true);
  // Each half independently boardable: at most 3 concepts and 2 relations.
  for (const half of [a!, b!]) {
    assert.ok(new Set(half.conceptIds).size <= 3, `${half.id} concepts`);
    assert.ok((half.contract?.requiredRelations.length ?? 0) <= 2, `${half.id} relations`);
  }
  // Relations preserved across halves (chain c1->c2->c3->c4, cross link kept once).
  const relKeys = after.sections.flatMap((s) => (s.contract?.requiredRelations ?? []).map((r) => `${r.from}|${r.type}|${r.to}`));
  assert.deepEqual([...new Set(relKeys)].sort(), [
    'c1|causes|c2', 'c2|produces|c3', 'c3|feeds|c4',
  ]);
  // Evidence preserved: union of halves covers the original recap spans.
  assert.deepEqual(spanUnion(after), spanUnion(before));
  // Budget sum preserved exactly.
  assert.equal(a!.budgetSec + b!.budgetSec, 30);
  assert.equal(after.targetDurationSec, before.targetDurationSec);
  // Schema, analyser, and contracts all clean on the split plan.
  assert.ok(TeachingPlanSchema.safeParse(JSON.parse(JSON.stringify(after))).success);
  assert.deepEqual(teachingContractFindings(after, graph, 'general learner'), []);
  const analysis = analyzeTeachingPlan(after, graph);
  assert.deepEqual(analysis.findings, [], JSON.stringify(analysis.findings));
});

test('dense recap whose halves would breach the hard floor stays whole with a warn, not an error', () => {
  // Regression: an 18s dense recap halves to 9s/9s, below the 10s hard floor —
  // the split must not trade one boardable scene for two pacing failures.
  // (Observed live: 60s run recap halves at 9s failed the pacing gate.)
  const graph = chainGraph();
  const before = planWith(graph, [
    section(graph, { id: 'open', kind: 'explain', conceptIds: ['c1'], budgetSec: 15, skill: 'definition' }),
    section(graph, { id: 'rec', kind: 'recap', conceptIds: ['c1', 'c2', 'c3', 'c4'], budgetSec: 18, skill: 'recap' }),
  ], ['c1']);
  const after = splitDenseRecapSections(before, graph);
  assert.equal(after, before);
  assert.equal(after.sections.length, 2);
  assert.equal(after.targetDurationSec, before.targetDurationSec);
  // Kept whole: dense but only a warn — never a blocking error.
  const analysis = analyzeTeachingPlan(after, graph);
  assert.equal(analysis.ok, true, JSON.stringify(analysis.findings));
  assert.ok(analysis.findings.some((f) => f.code === 'F-PED' && f.check === 'recap-density' && f.severity === 'warn'), JSON.stringify(analysis.findings));
  assert.ok(!analysis.findings.some((f) => f.severity === 'error'), JSON.stringify(analysis.findings));
});

test('recap at the limit (3 concepts, 2 relations) is untouched', () => {
  const graph = chainGraph();
  const sections = [
    section(graph, { id: 'open', kind: 'explain', conceptIds: ['c1'], budgetSec: 15, skill: 'definition' }),
    section(graph, { id: 'rec', kind: 'recap', conceptIds: ['c1', 'c2', 'c3'], budgetSec: 15, skill: 'recap' }),
  ];
  // Trim the recap contract to 2 relations so it sits exactly at the limit.
  sections[1]!.contract!.requiredRelations = sections[1]!.contract!.requiredRelations.slice(0, 2);
  const before = planWith(graph, sections, ['c1']);
  assert.equal(splitDenseRecapSections(before, graph), before);
});

test('non-recap dense sections are untouched', () => {
  const graph = chainGraph();
  const before = planWith(graph, [
    section(graph, { id: 'big', kind: 'explain', conceptIds: ['c1', 'c2', 'c3', 'c4'], budgetSec: 30, skill: 'definition' }),
  ]);
  const after = splitDenseRecapSections(before, graph);
  assert.equal(after, before);
});

test('split ids stay within the 40-char snake_case contract even for long base ids', () => {
  const graph = chainGraph();
  const longId = 'recap_section_with_a_very_long_name_xyz';
  assert.equal(longId.length, 39);
  const before = planWith(graph, [
    section(graph, { id: longId, kind: 'recap', conceptIds: ['c1', 'c2', 'c3', 'c4'], budgetSec: 30, skill: 'recap' }),
  ]);
  const after = splitDenseRecapSections(before, graph);
  assert.equal(after.sections.length, 2);
  const ids = after.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) {
    assert.ok(id.length <= 40, id);
    assert.match(id, /^[a-z0-9_]+$/);
  }
  assert.deepEqual(teachingContractFindings(after, graph, 'general learner'), []);
});

test('relation-dense recap (3 concepts, 3 relations) splits without losing a relation', () => {
  const graph = triangleGraph();
  const before = planWith(graph, [
    section(graph, { id: 'rec', kind: 'recap', conceptIds: ['c1', 'c2', 'c3'], budgetSec: 30, skill: 'recap' }),
  ]);
  assert.equal(before.sections[0]!.contract!.requiredRelations.length, 3);
  const after = splitDenseRecapSections(before, graph);
  assert.equal(after.sections.length, 2);
  const relKeys = after.sections.flatMap((s) => (s.contract?.requiredRelations ?? []).map((r) => `${r.from}|${r.type}|${r.to}`));
  assert.deepEqual([...new Set(relKeys)].sort(), ['c1|causes|c2', 'c1|contains|c3', 'c2|produces|c3']);
  assert.deepEqual(spanUnion(after), spanUnion(before));
  assert.deepEqual(teachingContractFindings(after, graph, 'general learner'), []);
});

test('full plans stay untouched when splitting would exceed the 40-section cap', () => {
  const graph = chainGraph();
  const sections: TeachingPlan['sections'] = Array.from({ length: 40 }, (_, i) => ({
    id: `s_${i}`, title: `Title ${i}`, goal: `Goal for section number ${i}`,
    kind: 'explain' as const, conceptIds: ['c1'], budgetSec: 15,
  }));
  const before = planWith(graph, sections);
  assert.equal(splitDenseRecapSections(before, graph), before);
});

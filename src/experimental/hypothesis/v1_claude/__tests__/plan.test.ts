import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTeachingPlan, WORDS_PER_SEC, SCENE_SEC, sceneCountFor } from '../plan/analyze.js';
import { validateScript } from '../plan/stages.js';
import { ConceptGraphSchema, ScriptSchema, TeachingPlanSchema, type ConceptGraph, type TeachingPlan } from '../plan/schemas.js';
import { parseCandidates, extractJsonCandidates } from '../llm/structuredCall.js';

const graph: ConceptGraph = {
  concepts: [
    { id: 'loss', label: 'Loss', kind: 'quantity', definition: 'How wrong the model is.', level: 'one-step', evidence: [{ sourceId: 'fixture-source', spanId: 'span_loss', startChar: 0, endChar: 20, startLine: 1, endLine: 1, quote: 'loss evidence quote' }] },
    { id: 'gradient', label: 'Gradient', kind: 'quantity', definition: 'Slope of the loss.', level: 'one-step', evidence: [{ sourceId: 'fixture-source', spanId: 'span_gradient', startChar: 20, endChar: 48, startLine: 2, endLine: 2, quote: 'gradient evidence quote' }] },
    { id: 'update', label: 'Update rule', kind: 'formula', definition: 'Step against the gradient.', latex: '\\theta_{t+1}=\\theta_t-\\eta\\nabla L', level: 'multi-step', evidence: [{ sourceId: 'fixture-source', spanId: 'span_update', startChar: 48, endChar: 72, startLine: 3, endLine: 3, quote: 'update evidence quote' }] },
  ],
  relations: [{ from: 'gradient', to: 'update', type: 'feeds', evidence: [{ sourceId: 'fixture-source', spanId: 'span_relation', startChar: 72, endChar: 100, startLine: 4, endLine: 4, quote: 'relation evidence quote' }] }],
  prerequisites: [{ concept: 'update', needs: 'gradient' }, { concept: 'gradient', needs: 'loss' }],
};

const plan: TeachingPlan = {
  targetDurationSec: 60,
  intro: { sourceTitle: 'Gradient descent', sections: ['Loss', 'Steps', 'Recap'] },
  sections: [
    { id: 'valley', title: 'The Loss Valley', goal: 'See loss as a valley over parameters', kind: 'explain', conceptIds: ['loss'], budgetSec: 16 },
    { id: 'slope', title: 'Follow The Slope', goal: 'Read the gradient as the uphill direction', kind: 'step', conceptIds: ['gradient'], budgetSec: 16 },
    { id: 'rule', title: 'Step Against The Slope', goal: 'Apply the update rule once', kind: 'step', conceptIds: ['update'], budgetSec: 14 },
    { id: 'recap', title: 'Why It Works', goal: 'Summarise repeated shrinking steps', kind: 'recap', conceptIds: [], budgetSec: 14 },
  ],
  recap: { keyPoints: ['Step against the gradient'] },
};

test('plan analyser: a well-ordered, budgeted, stepped plan passes', () => {
  const modelGraph = {
    concepts: graph.concepts.map(({ evidence, ...concept }) => ({ ...concept, evidence: evidence.map(({ spanId, quote }) => ({ spanId, quote })) })),
    relations: graph.relations.map(({ evidence, ...relation }) => ({ ...relation, evidence: evidence.map(({ spanId, quote }) => ({ spanId, quote })) })),
    prerequisites: graph.prerequisites,
  };
  assert.ok(ConceptGraphSchema.safeParse(modelGraph).success);
  assert.ok(TeachingPlanSchema.safeParse(plan).success);
  const a = analyzeTeachingPlan(plan, graph);
  assert.equal(a.ok, true, JSON.stringify(a.findings));
  assert.equal(a.metrics.wordsBudget.valley, Math.round(16 * WORDS_PER_SEC));
});

test('plan analyser: teaching a concept before its prerequisite is a blocking F-PED error', () => {
  const swapped = { ...plan, sections: [plan.sections[1], plan.sections[0], plan.sections[2], plan.sections[3]] };
  const a = analyzeTeachingPlan(swapped, graph);
  assert.equal(a.ok, false);
  assert.ok(a.findings.some((f) => f.code === 'F-PED' && f.check === 'order'));
});

test('plan analyser: budgets that do not sum to the target are rejected', () => {
  const a = analyzeTeachingPlan({ ...plan, sections: plan.sections.map((s) => ({ ...s, budgetSec: 10 })) }, graph);
  assert.ok(a.findings.some((f) => f.check === 'budget' && f.severity === 'error'));
});

test('plan analyser: a multi-step concept squeezed into one scene is rejected', () => {
  const one = { ...plan, sections: plan.sections.map((s) => ({ ...s, kind: s.kind === 'step' ? ('explain' as const) : s.kind })) };
  const a = analyzeTeachingPlan(one, graph);
  assert.ok(a.findings.some((f) => f.check === 'steps' && f.severity === 'error'));
});

test('plan analyser: prerequisite cycles are rejected', () => {
  const a = analyzeTeachingPlan(plan, { ...graph, prerequisites: [...graph.prerequisites, { concept: 'loss', needs: 'update' }] });
  assert.ok(a.findings.some((f) => f.check === 'prerequisites' && f.severity === 'error'));
});

test('pacing constants come from measured Supertonic rate and Simi scene lengths', () => {
  assert.equal(WORDS_PER_SEC, 2.25); // measured 2.287 / 2.293 w/s, phase6-2026-09-27 bicycle+composting
  assert.deepEqual(SCENE_SEC, { min: 14, max: 30 });
  assert.equal(sceneCountFor(60), 3);
  assert.equal(sceneCountFor(75), 4);
  assert.equal(sceneCountFor(300), 17);
});

test('plan analyser: seven thin ~8.6s sections are a blocking F-PED pacing error', () => {
  // Built from the smallest existing plan fixture above, overriding only sections and budgetSec:
  // 60s split across 7 sections (~8.57s each) is exactly the reference-violating shape the
  // measured Simi pacing constants (SCENE_SEC.min = 14s) must now block.
  const thin: TeachingPlan = {
    ...plan,
    sections: Array.from({ length: 7 }, (_, i) => ({
      id: `thin_${i + 1}`,
      title: `Thin Section ${i + 1}`,
      goal: `Cover one small idea in part ${i + 1}`,
      kind: 'explain' as const,
      conceptIds: ['loss'],
      budgetSec: 60 / 7,
    })),
  };
  const a = analyzeTeachingPlan(thin, graph);
  assert.ok(a.findings.some((f) => f.code === 'F-PED' && f.check === 'pacing' && f.severity === 'error'));
});

const words = (n: number, marked: string[]) => {
  const filler = Array.from({ length: Math.max(0, n - marked.length) }, (_, i) => `word${i}`).join(' ');
  return `${marked.map((m) => `[[${m}|${m}]]`).join(' ')} ${filler}.`;
};

test('script validator: correct length and 3-8 unique markers per scene pass', () => {
  const script = { scenes: plan.sections.map((s) => ({ sectionId: s.id, text: words(Math.round(s.budgetSec * WORDS_PER_SEC), ['a', 'b', 'c', 'd']) })) };
  assert.deepEqual(validateScript(script, plan), []);
});

test('script validator: too-short narration (the old 3 s-per-scene problem) is rejected', () => {
  const script = { scenes: plan.sections.map((s) => ({ sectionId: s.id, text: words(10, ['a', 'b', 'c']) })) };
  assert.ok(validateScript(script, plan).some((p) => /spoken words/.test(p)));
});

test('script validator: too few markers, duplicate ids and wrong section order are rejected', () => {
  const script = {
    scenes: plan.sections.map((s, i) => ({ sectionId: i === 0 ? 'wrong' : s.id, text: i === 1 ? words(42, ['a', 'a', 'b']) : words(Math.round(s.budgetSec * WORDS_PER_SEC), ['a']) })),
  };
  const problems = validateScript(script, plan).join(' | ');
  assert.match(problems, /sectionId "valley"/);
  assert.match(problems, /markers, needs 3-8/);
  assert.match(problems, /used twice/);
});

test('structured call: JSON is located inside rambling responses, last valid candidate wins', () => {
  const content = 'Sure! {"scenes":[{"sectionId":"x","text":"bad"}]} wait, let me fix that: {"scenes":[{"sectionId":"x","text":"good"}]}';
  assert.equal(extractJsonCandidates(content).length, 2);
  const r = parseCandidates(content, ScriptSchema, (s) => (s.scenes[0].text === 'good' ? [] : ['not good']));
  assert.ok(r.ok && r.value.scenes[0].text === 'good');
});

test('structured call: a raw control character inside a JSON string is escaped, not rejected (parser robustness only)', async () => {
  const { parseJsonLenient } = await import('../llm/structuredCall.js');
  assert.deepEqual(parseJsonLenient('{"a":"line1\nline2\tx"}'), { a: 'line1\nline2\tx' });
  assert.throws(() => parseJsonLenient('{"a": }'));
});

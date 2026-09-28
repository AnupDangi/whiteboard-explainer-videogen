import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTeachingPlan, teachingContractFindings } from '../plan/contracts.js';
import { TeachingPlanDraftSchema, TeachingPlanSchema, type ConceptGraph, type TeachingPlanDraft } from '../plan/schemas.js';
import { buildConceptGraph, buildTeachingPlan, writeScript } from '../plan/stages.js';
import { resolveSourceEvidence, sourceDocFromText, spanExcerptPrompt } from '../plan/sourceDoc.js';

const response = (payload: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 } }), { status: 200 });

// Two unrelated synthetic vocabularies through the same derivation (topic-swap rule).
for (const words of [{ a: 'heat', b: 'pressure', c: 'volume' }, { a: 'tariff', b: 'price', c: 'demand' }]) {
  const doc = sourceDocFromText(`# Notes\n\n${words.a} raises ${words.b}.\n\n${words.b} lowers ${words.c}.`, 'markdown');
  const [first, second] = doc.spans.filter((span) => span.kind === 'paragraph');
  const ref = (span: typeof first, quote: string) => resolveSourceEvidence(doc, span.id, quote)!;
  const graph: ConceptGraph = {
    concepts: [
      { id: words.a, label: words.a, kind: 'entity', definition: `${words.a}.`, evidence: [ref(first, words.a)], level: 'one-step' },
      { id: words.b, label: words.b, kind: 'quantity', definition: `${words.b}.`, evidence: [ref(first, words.b)], level: 'one-step' },
      { id: words.c, label: words.c, kind: 'quantity', definition: `${words.c}.`, evidence: [ref(second, words.c)], level: 'one-step' },
    ],
    relations: [
      { from: words.a, to: words.b, type: 'causes', evidence: [ref(first, `${words.a} raises ${words.b}`)] },
      { from: words.b, to: words.c, type: 'opposes', evidence: [ref(second, `${words.b} lowers ${words.c}`)] },
    ],
    prerequisites: [],
  };
  const section = (id: string, conceptIds: string[]) => ({ id, title: `About ${id}`, goal: `Explain ${id}.`, kind: 'explain' as const, conceptIds, budgetSec: 18, teachingSkill: 'mechanism' as const, candidateMechanisms: ['chain' as const] });
  const draft = (sections: TeachingPlanDraft['sections']): TeachingPlanDraft => ({ targetDurationSec: 36, intro: { sourceTitle: 'Notes', sections: [] }, sections, recap: { keyPoints: [] } });

  test(`contracts are derived from co-sectioned concepts and the graph (${words.a})`, () => {
    const plan = deriveTeachingPlan(draft([section('s1', [words.a, words.b]), section('s2', [words.b, words.c])]), graph, 'general learner');
    assert.equal(TeachingPlanSchema.safeParse(plan).success, true);
    assert.deepEqual(plan.sections.map((s) => s.contract!.requiredRelations.map((r) => `${r.from}>${r.to}`)), [[`${words.a}>${words.b}`], [`${words.b}>${words.c}`]]);
    assert.deepEqual(plan.sections[1].contract!.evidenceSpanIds.sort(), [first.id, second.id].sort(), 'concept and relation spans');
    assert.deepEqual(plan.lessonBible!.persistentConceptIds, [words.b], 'only the concept taught twice is persistent');
    assert.deepEqual(plan.lessonBible!.terminology.map((t) => t.label), [words.a, words.b, words.c], 'terms are exact graph labels');
    assert.deepEqual(teachingContractFindings(plan, graph, 'general learner'), []);
  });

  test(`splitting related concepts into separate sections still fails as a lost relation (${words.a})`, () => {
    const plan = deriveTeachingPlan(draft([section('s1', [words.a]), section('s2', [words.b, words.c])]), graph, 'general learner');
    assert.deepEqual(teachingContractFindings(plan, graph, 'general learner').map((f) => f.code), ['LESSON_OMITS_SOURCE_RELATION']);
  });

  test(`an unknown concept id is kept and rejected, never dropped (${words.a})`, () => {
    const plan = deriveTeachingPlan(draft([section('s1', [words.a, words.b, 'invented']), section('s2', [words.b, words.c])]), graph, 'general learner');
    assert.ok(teachingContractFindings(plan, graph, 'general learner').some((f) => f.code === 'REQUIRED_CONCEPT_UNKNOWN'));
  });
}

test('the S3 draft schema lifts model-owned fields from an older full-plan response and drops copied ones', () => {
  const parsed = TeachingPlanDraftSchema.parse({
    targetDurationSec: 18, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] },
    lessonBible: { audience: 'anyone', domain: 'physics', terminology: [], persistentConceptIds: [] },
    sections: [{ id: 's1', title: 't', goal: 'g', kind: 'explain', conceptIds: ['a'], budgetSec: 18, contract: { teachingSkill: 'process', candidateMechanisms: ['cycle'], requiredRelations: [{ from: 'a', to: 'b', type: 'contains' }] } }],
  });
  assert.equal(parsed.domain, 'physics');
  assert.deepEqual([parsed.sections[0].teachingSkill, parsed.sections[0].candidateMechanisms], ['process', ['cycle']]);
  assert.ok(!('contract' in parsed.sections[0]));
});

test('model prompts print each span\'s text under its id with no character offsets', () => {
  const doc = sourceDocFromText('# Title\n\nFirst paragraph here.\n\nSecond paragraph here.', 'markdown');
  const payload = JSON.parse(spanExcerptPrompt(doc, { maxChars: 25 })) as { excerpts: Array<Record<string, unknown>>; omittedSpans?: number };
  assert.ok(payload.excerpts.every((excerpt) => typeof excerpt.id === 'string' && typeof excerpt.text === 'string' && !('startChar' in excerpt)));
  assert.equal(payload.excerpts[0].text, '# Title\n', 'span text is exact source bytes');
  assert.equal(payload.omittedSpans, 1, 'spans past the character budget are counted, not silently dropped');
  assert.equal(payload.excerpts.at(-1)!.excerpted, true);
});

test('module S2 checks relation evidence but not the concept quotes the syllabus replaces', async () => {
  const doc = sourceDocFromText('# Notes\n\nThe pump moves water uphill.', 'markdown');
  const span = doc.spans.find((item) => item.kind === 'paragraph')!;
  let user = '';
  const graph = (relationQuote: string) => ({
    concepts: [
      { id: 'pump', label: 'Pump', kind: 'entity', definition: 'x', evidence: [{ spanId: span.id, quote: 'a paraphrase the syllabus replaces' }], level: 'one-step' },
      { id: 'water', label: 'Water', kind: 'entity', definition: 'x', evidence: [], level: 'one-step' },
    ],
    relations: [{ from: 'pump', to: 'water', type: 'transforms', evidence: [{ spanId: span.id, quote: relationQuote }] }],
    prerequisites: [],
  });
  const bodies = [graph('pumps shift fluids'), graph('The pump moves water uphill')];
  const result = await buildConceptGraph({ source: doc.text, sourceDoc: doc, targetDurationSec: 60, conceptScope: [{ id: 'pump', label: 'Pump', definition: 'x' }, { id: 'water', label: 'Water', definition: 'x' }] }, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05,
    fetcher: async (_url, init) => { user ||= JSON.parse(String(init?.body)).messages[1].content; return response(bodies.shift()); },
  });
  assert.equal(result.usage.repairs, 1, 'the invented relation quote costs the repair');
  assert.deepEqual(result.value?.concepts.map((concept) => concept.evidence.length), [0, 0], 'concept evidence comes from the syllabus later');
  assert.equal(result.value?.relations[0].evidence[0].quote, 'The pump moves water uphill');
  assert.match(user, /"excerpts"/);
  assert.doesNotMatch(user, /startChar/);
});

test('each S4 scene sees only its own section\'s evidence spans', async () => {
  const doc = sourceDocFromText('# Notes\n\nAlpha fact sentence.\n\nBeta fact sentence.', 'markdown');
  const [alpha, beta] = doc.spans.filter((span) => span.kind === 'paragraph');
  const graph: ConceptGraph = {
    concepts: [
      { id: 'alpha', label: 'Alpha', kind: 'entity', definition: 'x', evidence: [resolveSourceEvidence(doc, alpha.id, 'Alpha fact sentence.')!], level: 'one-step' },
      { id: 'beta', label: 'Beta', kind: 'entity', definition: 'x', evidence: [resolveSourceEvidence(doc, beta.id, 'Beta fact sentence.')!], level: 'one-step' },
    ],
    relations: [], prerequisites: [],
  };
  const plan = deriveTeachingPlan({ targetDurationSec: 30, intro: { sourceTitle: 'x', sections: [] }, recap: { keyPoints: [] }, sections: [
    { id: 's_alpha', title: 'Alpha', goal: 'x', kind: 'explain', conceptIds: ['alpha'], budgetSec: 15, teachingSkill: 'definition', candidateMechanisms: ['focus'] },
    { id: 's_beta', title: 'Beta', goal: 'x', kind: 'explain', conceptIds: ['beta'], budgetSec: 15, teachingSkill: 'definition', candidateMechanisms: ['focus'] },
  ] }, graph, 'general learner');
  const users: string[] = [];
  await writeScript({ source: doc.text, sourceDoc: doc, targetDurationSec: 30 }, graph, plan, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05,
    fetcher: async (_url, init) => { users.push(JSON.parse(String(init?.body)).messages[1].content); return response({ text: 'x' }); },
  });
  const alphaPrompt = users.find((user) => user.includes('WRITE SCENE 1'))!;
  assert.match(alphaPrompt, /Alpha fact sentence/);
  assert.doesNotMatch(alphaPrompt.slice(alphaPrompt.indexOf('SOURCE')), /Beta fact sentence/);
});

test('a concept graph that cannot support the request never reaches the S3 model', async () => {
  let calls = 0;
  const result = await buildTeachingPlan({ source: 'x', targetDurationSec: 18, instruction: 'Explain how the parts interact.' }, { concepts: [{ id: 'only', label: 'Only', kind: 'entity', definition: 'x', evidence: [], level: 'one-step' }], relations: [], prerequisites: [] }, {
    model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher: async () => { calls++; return response({}); },
  });
  assert.equal(calls, 0);
  assert.equal(result.failures[0]?.code, 'plan-graph-not-relational');
});

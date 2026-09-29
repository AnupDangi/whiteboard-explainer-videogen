import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSyllabus, lessonCostCapUsd, moduleBudgetShape, rebudgetUnwrittenModules, SyllabusOutputSchema, SyllabusSchema, syllabusSourcePrompt, syllabusSystemPrompt, validateSyllabus, type SyllabusModel } from '../plan/hierarchical.js';
import { sourceDocFromText, sourcePrompt } from '../plan/sourceDoc.js';

const concept = (id: string) => ({ id, label: id, definition: `A source-backed definition of ${id}.`, evidence: [{ spanId: `span_${id}`, quote: `Evidence for ${id}.` }] });
const modulePlan = (id: string, budgetSec: number, conceptIds: string[], recallOfModuleIds: string[] = []) => ({ id, title: `Module ${id}`, goal: `Teach distinct objective ${id}.`, budgetSec, conceptIds, evidenceSpanIds: conceptIds.map((value) => `span_${value}`), recallOfModuleIds });
const syllabus = (duration: number): SyllabusModel => {
  const budgets = moduleBudgetShape(duration)!;
  const concepts = budgets.map((_, index) => concept(`topic_${index + 1}`));
  return {
    requestedDurationSec: duration,
    plannedDurationSec: duration,
    coverageReason: 'The supplied source supports this depth.',
    coreGoalSupported: true,
    learningObjective: 'Explain how the documented process works.',
    audienceAssumptions: ['Learner knows basic terms.'],
    concepts,
    prerequisites: [],
    modules: budgets.map((budget, index) => modulePlan(`module_${index + 1}`, budget, [`topic_${index + 1}`])),
  };
};

test('supported lesson durations map to bounded 1-minute or 5-minute modules', () => {
  assert.deepEqual(moduleBudgetShape(60), [60]);
  assert.deepEqual(moduleBudgetShape(300), [300]);
  assert.deepEqual(moduleBudgetShape(600), [300, 300]);
  assert.deepEqual(moduleBudgetShape(1800), [300, 300, 300, 300, 300, 300]);
  assert.equal(moduleBudgetShape(120), undefined);
  assert.deepEqual([60, 300, 600, 1800].map(lessonCostCapUsd), [0.1, 0.5, 0.7, 1]);
});

test('S1 label instruction matches the schema word limit', () => {
  const plan = syllabus(60);
  plan.concepts[0]!.label = 'Concise source concept name';
  assert.equal(SyllabusSchema.safeParse(plan).success, true);
  plan.concepts[0]!.label = 'This label has five words';
  assert.equal(SyllabusSchema.safeParse(plan).success, false);
  assert.match(syllabusSystemPrompt([60, 300]), /at most 4 words/i);
});

test('S1 source payload contains exact text once with citation-relevant span locations and no duplicated retrieval payload', () => {
  const source = '# Optics\n\nLight reflects inside the drop and exits toward the observer.\n\nThe angle of reflection equals the angle of incidence.';
  const doc = sourceDocFromText(source, 'pdf', [{ startChar: 0, endChar: source.length, sourceLocation: { kind: 'pdf-page', page: 12 } }]);
  const firstSpan = doc.spans[0]!;
  doc.retrievalEvidence = [{ rank: 1, score: 0.9, text: 'Duplicated retrieval extract', modality: 'text', retrievalMode: 'local-text', citation: { sourceId: doc.sourceId, spanId: firstSpan.id, startChar: firstSpan.startChar, endChar: firstSpan.endChar, startLine: firstSpan.startLine, endLine: firstSpan.endLine, quote: firstSpan.text, sourceLocation: firstSpan.sourceLocation }, documentSha256: 'sha', documentTitle: 'Optics' }];

  const payload = syllabusSourcePrompt(doc);
  const parsed = JSON.parse(payload) as { text: string; spanIndex: Array<{ id: string; startChar: number; endChar: number; sourceLocation?: { kind: string; page?: number } }>; rankedEvidence?: unknown; embeddedFigures?: unknown };
  assert.equal(parsed.text, source);
  assert.equal(payload.split(JSON.stringify(source).slice(1, -1)).length - 1, 1);
  assert.deepEqual(parsed.spanIndex.map(({ id, startChar, endChar }) => ({ id, startChar, endChar })), doc.spans.map(({ id, startChar, endChar }) => ({ id, startChar, endChar })));
  assert.ok(parsed.spanIndex.every((span) => span.sourceLocation?.kind === 'pdf-page' && span.sourceLocation.page === 12));
  assert.equal(parsed.rankedEvidence, undefined);
  assert.equal(parsed.embeddedFigures, undefined);
  assert.ok(payload.length < sourcePrompt(doc).length);
});

test('long syllabus source payload stays bounded and pairs exact excerpts with their span IDs', () => {
  const source = `# Study\n\n${Array.from({ length: 100 }, (_, index) => `Finding ${index + 1}: ${'A measured result supports the explanation. '.repeat(45)}`).join('\n\n')}`;
  const doc = sourceDocFromText(source, 'pdf');
  const payload = JSON.parse(syllabusSourcePrompt(doc)) as { text?: string; excerpts: Array<{ id: string; text: string; excerpted?: boolean }> };
  assert.equal(payload.text, undefined);
  assert.ok(payload.excerpts.length >= 20);
  assert.ok(payload.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0) <= 48_000);
  assert.ok(payload.excerpts.every((excerpt) => doc.spans.find((span) => span.id === excerpt.id)?.text.startsWith(excerpt.text)));
  assert.ok(payload.excerpts.some((excerpt) => excerpt.excerpted));
  assert.ok(syllabusSourcePrompt(doc).length < source.length / 2);
});

test('syllabus normalizes generated hyphenated IDs consistently but rejects collisions', () => {
  const raw = syllabus(600);
  raw.concepts[0]!.id = 'Topic-1';
  raw.modules[0]!.id = 'Module-1';
  raw.modules[0]!.conceptIds = ['Topic-1'];
  raw.modules[1]!.recallOfModuleIds = ['Module-1'];
  const parsed = SyllabusOutputSchema.parse(raw);
  assert.equal(parsed.concepts[0]!.id, 'topic_1');
  assert.equal(parsed.modules[0]!.id, 'module_1');
  assert.equal(parsed.modules[0]!.conceptIds[0], 'topic_1');
  assert.equal(parsed.modules[1]!.recallOfModuleIds[0], 'module_1');
  assert.deepEqual(validateSyllabus(parsed, 600), []);
  raw.concepts[1]!.id = 'topic-1';
  assert.ok(validateSyllabus(SyllabusOutputSchema.parse(raw), 600).some((issue) => /concept IDs must be unique/.test(issue)));
  raw.concepts[1]!.id = 'topic 2';
  assert.equal(SyllabusOutputSchema.safeParse(raw).success, false);
});

test('syllabus repair keeps a paraphrased evidence quote as a hard failure', async () => {
  const doc = sourceDocFromText('# Study\n\nThe exact source says sunlight heats the water.', 'markdown');
  const paragraph = doc.spans.find((span) => span.kind === 'paragraph')!;
  const raw = syllabus(60);
  raw.concepts[0]!.id = 'sunlight';
  raw.concepts[0]!.evidence = [{ spanId: paragraph.id, quote: 'The sun warms up the water.' }];
  raw.modules[0]!.conceptIds = ['sunlight'];
  raw.modules[0]!.evidenceSpanIds = [paragraph.id];
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 50, cost: 0.001 } }), { status: 200 });
  const result = await buildSyllabus({ source: doc.text, sourceDoc: doc, targetDurationSec: 60 }, { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.1, fetcher });
  assert.equal(result.value, undefined);
  assert.equal(result.usage.repairs, 1);
  assert.match(result.failures[0]?.message ?? '', /evidence quote is absent/);
});

test('syllabus accepts an evidence-supported shorter duration and exact module budgets', () => {
  const shortened = syllabus(300);
  shortened.requestedDurationSec = 1800;
  shortened.coverageReason = 'The sources only support one 5-minute module.';
  assert.deepEqual(validateSyllabus(shortened, 1800), []);
});

test('relational goals keep source-supported components together while definition goals may remain singular', () => {
  const singular = syllabus(60);
  singular.concepts = [concept('central_idea')];
  singular.modules[0]!.conceptIds = ['central_idea'];
  singular.modules[0]!.evidenceSpanIds = ['span_central_idea'];
  assert.deepEqual(validateSyllabus(singular, 60), [], 'a model-generated objective alone does not trigger the explicit-goal structure gate');
  assert.deepEqual(validateSyllabus(singular, 60, 'Define the central idea.'), []);
  assert.ok(validateSyllabus(singular, 60, 'Explain how distinct parts interact.').some((problem) => /fewer than two concepts/.test(problem)));

  singular.concepts.push(concept('related_part'));
  singular.modules[0]!.conceptIds.push('related_part');
  singular.modules[0]!.evidenceSpanIds.push('span_related_part');
  assert.deepEqual(validateSyllabus(singular, 60, 'Explain how distinct parts interact.'), []);
});

test('syllabus rejects wrong module totals, repeated concepts without recall, and reversed prerequisites', () => {
  const plan = syllabus(600);
  plan.modules[1]!.conceptIds = ['topic_1', 'topic_2'];
  plan.modules[1]!.evidenceSpanIds = ['span_topic_1', 'span_topic_2'];
  plan.prerequisites.push({ concept: 'topic_1', needs: 'topic_2' });
  const issues = validateSyllabus(plan, 600);
  assert.ok(issues.some((issue) => /repeats prior concepts/.test(issue)));
  assert.ok(issues.some((issue) => /appears before prerequisite/.test(issue)));
  plan.modules[1]!.recallOfModuleIds = ['module_1'];
  assert.ok(!validateSyllabus(plan, 600).some((issue) => /repeats prior concepts/.test(issue)));
  plan.modules[0]!.budgetSec = 299;
  assert.ok(validateSyllabus(plan, 600).some((issue) => /budgets must sum|must follow/.test(issue)));
});

test('syllabus rejects forward recall targets and recall links that do not teach the repeated concept', () => {
  const plan = syllabus(1800);
  plan.concepts = [concept('topic_1'), concept('topic_2'), concept('topic_3'), concept('topic_4'), concept('topic_5'), concept('topic_6')];
  plan.modules[0]!.conceptIds = ['topic_1'];
  plan.modules[1]!.conceptIds = ['topic_2'];
  plan.modules[2]!.conceptIds = ['topic_3'];
  plan.modules[3]!.conceptIds = ['topic_1', 'topic_4'];
  plan.modules[3]!.evidenceSpanIds = ['span_topic_1', 'span_topic_4'];
  plan.modules[3]!.recallOfModuleIds = ['module_6'];
  plan.modules[4]!.conceptIds = ['topic_5'];
  plan.modules[5]!.conceptIds = ['topic_6'];
  const issues = validateSyllabus(plan, 1800);
  assert.ok(issues.some((issue) => /recall targets must be earlier modules/.test(issue)));
  plan.modules[3]!.recallOfModuleIds = ['module_2'];
  assert.ok(validateSyllabus(plan, 1800).some((issue) => /without recalling a prior module that teaches it/.test(issue)));
  plan.modules[3]!.recallOfModuleIds = ['module_1'];
  assert.ok(!validateSyllabus(plan, 1800).some((issue) => /module_4/.test(issue)));
});

test('syllabus rejects unsupported requested duration instead of drifting to an arbitrary plan', () => {
  assert.ok(validateSyllabus(syllabus(60), 120).some((issue) => /duration must be one of/.test(issue)));
});

test('audio-master re-budget changes only unwritten modules and accounts for measured duration', () => {
  const remaining = rebudgetUnwrittenModules([{ id: 'b', budgetSec: 300 }, { id: 'c', budgetSec: 300 }], 900, 330_000);
  assert.deepEqual(remaining.map((module) => module.budgetSec), [285, 285]);
  assert.deepEqual(rebudgetUnwrittenModules([{ id: 'b', budgetSec: 300 }], 600, 310_000).map((module) => module.budgetSec), [290]);
  assert.deepEqual(rebudgetUnwrittenModules([], 600, 310_000), []);
  assert.deepEqual(rebudgetUnwrittenModules([{ id: 'b', budgetSec: 300 }], 600, 700_000).map((module) => module.budgetSec), [60]);
  assert.throws(() => rebudgetUnwrittenModules([{ id: 'b', budgetSec: 0 }], 600, 10), /positive/);
});

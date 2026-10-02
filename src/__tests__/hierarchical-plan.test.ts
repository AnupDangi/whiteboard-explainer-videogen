import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSyllabus, lessonCostCapUsd, moduleBudgetShape, rebudgetUnwrittenModules, SyllabusOutputSchema, SyllabusSchema, syllabusSourcePrompt, syllabusSystemPrompt, validateSyllabus, type SyllabusModel } from '../plan/hierarchical.js';
import { sourceDocFromText, sourcePrompt } from '../intake/sourceDoc.js';

const concept = (id: string) => ({ id, label: id, definition: `A source-backed definition of ${id}.`, evidence: [{ spanId: `span_${id}`, quote: `Evidence for ${id}.` }] });
const modulePlan = (id: string, budgetSec: number, conceptIds: string[], recallOfModuleIds: string[] = []) => ({ id, title: `Module ${id}`, goal: `Teach distinct objective ${id}.`, budgetSec, conceptIds, evidenceSpanIds: conceptIds.map((value) => `span_${value}`), recallOfModuleIds });
const syllabus = (duration: number): SyllabusModel => {
  const budgets = moduleBudgetShape(duration)!;
  const concepts = budgets.map((_, index) => concept(`topic_${index + 1}`));
  return {
    requestedDurationSec: duration,
    plannedDurationSec: duration,
    coverageReason: 'The supplied source supports this depth.',
    sourceSupport: 'supported',
    learningObjective: 'Explain how the documented process works.',
    audienceAssumptions: ['Learner knows basic terms.'],
    concepts,
    prerequisites: [],
    modules: budgets.map((budget, index) => modulePlan(`module_${index + 1}`, budget, [`topic_${index + 1}`])),
  };
};

test('canonical and numeric lesson durations map to bounded modules', () => {
  assert.deepEqual(moduleBudgetShape(60), [60]);
  assert.deepEqual(moduleBudgetShape(300), [300]);
  assert.deepEqual(moduleBudgetShape(600), [300, 300]);
  assert.deepEqual(moduleBudgetShape(1800), [300, 300, 300, 300, 300, 300]);
  assert.deepEqual(moduleBudgetShape(3600), Array(6).fill(600));
  assert.deepEqual(moduleBudgetShape(120), [120]);
  assert.deepEqual(moduleBudgetShape(601), [301, 300]);
  assert.equal(moduleBudgetShape(59), undefined);
  assert.equal(moduleBudgetShape(3601), undefined);
  assert.deepEqual([60, 300, 600, 1800, 3600].map(lessonCostCapUsd), [0.1, 0.5, 0.7, 1, 1]);
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
  // Behaviour change: ids are references, so a spaced id is normalised to the same slug everywhere instead of failing S1;
  // an id with no usable characters still fails.
  raw.concepts[1]!.id = 'topic 2';
  assert.equal(SyllabusOutputSchema.parse(raw).concepts[1]!.id, 'topic_2');
  raw.concepts[1]!.id = '###';
  assert.equal(SyllabusOutputSchema.safeParse(raw).success, false);
});

test('syllabus repair keeps a paraphrased evidence quote as a hard failure', async () => {
  const doc = sourceDocFromText('# Study\n\nThe exact source says sunlight heats the water.', 'markdown');
  const paragraph = doc.spans.find((span) => span.kind === 'paragraph')!;
  const raw = syllabus(60);
  raw.concepts[0]!.id = 'sunlight';
  // Nothing in it overlaps the span's sentence, so it cannot even be snapped: still a visible hard failure.
  raw.concepts[0]!.evidence = [{ spanId: paragraph.id, quote: 'Wind patterns shift overnight.' }];
  raw.concepts[0]!.label = 'Pattern';
  raw.concepts[0]!.definition = 'Wind shifts';
  raw.modules[0]!.conceptIds = ['sunlight'];
  raw.modules[0]!.evidenceSpanIds = [paragraph.id];
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 50, cost: 0.001 } }), { status: 200 });
  const result = await buildSyllabus({ source: doc.text, sourceDoc: doc, targetDurationSec: 60 }, { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.1, fetcher });
  assert.equal(result.value, undefined);
  // The syllabus gets two repairs (a quote the extraction split is the common cause); a paraphrase still never anchors.
  assert.equal(result.usage.repairs, 2);
  assert.match(result.failures[0]?.message ?? '', /evidence quote is absent/);
});

test('syllabus accepts an evidence-supported shorter duration and exact module budgets', () => {
  const shortened = syllabus(300);
  shortened.requestedDurationSec = 1800;
  shortened.sourceSupport = 'partial';
  shortened.coverageReason = 'The sources only support one 5-minute module.';
  assert.deepEqual(validateSyllabus(shortened, 1800), []);
  const fullDepthPartial = syllabus(1800);
  fullDepthPartial.sourceSupport = 'partial';
  assert.ok(validateSyllabus(fullDepthPartial, 1800).some((problem) => /partial source support must select a shorter/.test(problem)));
  const underfilledSupported = syllabus(300);
  underfilledSupported.requestedDurationSec = 1800;
  assert.ok(validateSyllabus(underfilledSupported, 1800).some((problem) => /supported source support must cover the full requested/.test(problem)));
});

test('syllabus schema records source sufficiency as a tri-state field', () => {
  const value = syllabus(60);
  assert.equal(SyllabusSchema.safeParse({ ...value, sourceSupport: 'insufficient' }).success, true);
  assert.equal(SyllabusSchema.safeParse({ ...value, sourceSupport: 'unknown' }).success, false);
  const { sourceSupport: _support, ...legacy } = value;
  assert.equal(SyllabusSchema.safeParse({ ...legacy, coreGoalSupported: true }).success, false);
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

test('syllabus accepts bounded numeric durations and rejects values outside the supported range', () => {
  assert.deepEqual(validateSyllabus(syllabus(120), 120), []);
  assert.ok(validateSyllabus(syllabus(60), 59).some((issue) => /between 60 and 3600/.test(issue)));
  assert.ok(validateSyllabus(syllabus(60), 3601).some((issue) => /between 60 and 3600/.test(issue)));
});

test('audio-master re-budget changes only unwritten modules and accounts for measured duration', () => {
  const remaining = rebudgetUnwrittenModules([{ id: 'b', budgetSec: 300 }, { id: 'c', budgetSec: 300 }], 900, 330_000);
  assert.deepEqual(remaining.map((module) => module.budgetSec), [285, 285]);
  assert.deepEqual(rebudgetUnwrittenModules([{ id: 'b', budgetSec: 300 }], 600, 310_000).map((module) => module.budgetSec), [290]);
  assert.deepEqual(rebudgetUnwrittenModules([], 600, 310_000), []);
  assert.deepEqual(rebudgetUnwrittenModules([{ id: 'b', budgetSec: 300 }], 600, 700_000).map((module) => module.budgetSec), [60]);
  assert.throws(() => rebudgetUnwrittenModules([{ id: 'b', budgetSec: 0 }], 600, 10), /positive/);
});

import { normalizeConceptLabel } from '../plan/hierarchical.js';

test('an over-long concept label drops filler words, then trailing words; short labels are untouched', () => {
  assert.equal(normalizeConceptLabel('Testing for a right angle'), 'Testing right angle');
  assert.equal(normalizeConceptLabel('Rate of change of velocity over time'), 'Rate change velocity over');
  assert.equal(normalizeConceptLabel('Right angle'), 'Right angle');
});

import { clampText } from '../plan/hierarchical.js';

test('display text over its limit is cut at a word boundary, and a missing recallOfModuleIds becomes an empty list', () => {
  const long = `${'word '.repeat(80)}end`;
  const clamped = clampText(long, 240) as string;
  assert.ok(clamped.length <= 240 && !clamped.endsWith(' '));
  assert.equal(clampText('short', 240), 'short');
  const parsed = SyllabusOutputSchema.safeParse({ requestedDurationSec: 60, plannedDurationSec: 60, coverageReason: long, sourceSupport: 'supported', learningObjective: long, audienceAssumptions: [], concepts: [{ id: 'concept_1', label: 'A thing', definition: 'x', evidence: [{ spanId: 'span_1', quote: 'q' }] }], prerequisites: [], modules: [{ id: 'module_1', title: 'T', goal: long, budgetSec: 60, conceptIds: ['concept_1'], evidenceSpanIds: ['span_1'] }] });
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
});

test('a syllabus quote that stays unanchorable after the model was asked is snapped to the span\'s closest verbatim sentence, and recorded', async () => {
  const doc = sourceDocFromText('# Study\n\nThe exact source says sunlight heats the water. Another sentence talks about wind.', 'markdown');
  const paragraph = doc.spans.find((span) => span.kind === 'paragraph')!;
  const raw = syllabus(60);
  raw.concepts[0]!.id = 'sunlight';
  raw.concepts[0]!.definition = 'Sunlight heats water';
  raw.concepts[0]!.evidence = [{ spanId: paragraph.id, quote: 'sunlight heats up water' }];
  raw.modules[0]!.conceptIds = ['sunlight'];
  raw.modules[0]!.evidenceSpanIds = [paragraph.id];
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 50, cost: 0.001 } }), { status: 200 });
  const result = await buildSyllabus({ source: doc.text, sourceDoc: doc, targetDurationSec: 60 }, { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.1, fetcher });
  assert.ok(result.value, JSON.stringify(result.failures));
  assert.equal(result.value!.concepts[0]!.evidence[0]!.quote, 'The exact source says sunlight heats the water.');
  assert.ok(result.failures.some((failure) => failure.code === 'syllabus-evidence-snapped' && !failure.hard));
  const snap = result.trace.coercions.find((entry) => entry.reason === 'syllabus-evidence-snapped');
  assert.ok(snap, 'the snap is in the coercion ledger');
  assert.equal(snap!.semanticRisk, 'semantic');
  assert.equal(snap!.oldValue, 'sunlight heats up water');
  assert.equal(snap!.newValue, 'The exact source says sunlight heats the water.');
});

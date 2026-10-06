import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonToLiveInput, prepareLesson } from '../run/lesson.js';
import { moduleBudgetShape } from '../plan/hierarchical.js';
import { sourceDocFromText } from '../intake/sourceDoc.js';

test('canonical 1-minute request uses syllabus then bounded module stages and preserves the global bible', async () => {
  const sourceDoc = sourceDocFromText('# Water cycle\n\nSunlight heats water. Water moves into the air, and cooling forms clouds.', 'markdown');
  const span = sourceDoc.spans.find((candidate) => candidate.kind === 'paragraph')!;
  const concepts = [
    { id: 'sunlight', label: 'Sunlight', kind: 'entity', definition: 'Sunlight heats water.', evidence: [{ spanId: span.id, quote: 'Sunlight heats water.' }], level: 'one-step' },
    { id: 'water', label: 'Water', kind: 'entity', definition: 'Water moves into the air.', evidence: [{ spanId: span.id, quote: 'Water moves into the air,' }], level: 'one-step' },
    { id: 'cloud', label: 'Cloud', kind: 'entity', definition: 'Cooling forms clouds.', evidence: [{ spanId: span.id, quote: 'cooling forms clouds.' }], level: 'one-step' },
  ];
  const graph = { concepts, relations: [], prerequisites: [] };
  const sections = concepts.map((concept, index) => ({
    id: `idea_${index + 1}`, title: concept.label, goal: `Explain how ${concept.label} starts this process.`, kind: index === 0 ? 'intro' : 'explain', conceptIds: [concept.id], budgetSec: 20,
    contract: { learningDelta: `Explain how ${concept.label} starts this process.`, targetDurationSec: 20, requiredConceptIds: [concept.id], requiredRelations: [], evidenceSpanIds: [span.id], essentialClaims: [{ id: `idea_${index + 1}_claim`, statement: concept.definition, epistemicType: 'direct_source', conceptIds: [concept.id], relations: [], evidenceSpanIds: [span.id] }], mentalModel: `One idea: ${concept.label}.`, semanticVisualIntents: [{ claimId: `idea_${index + 1}_claim`, conceptType: 'entity', strategy: 'literal', conceptIds: [concept.id], roles: [] }], teachingSkill: 'definition', candidateMechanisms: ['focus'] },
  }));
  const plan = { targetDurationSec: 60, intro: { sourceTitle: 'Water cycle', sections: ['Heating', 'Evaporation', 'Cloud formation'] }, lessonBible: { audience: 'general learner', terminology: concepts.map((concept) => ({ conceptId: concept.id, label: concept.label })), persistentConceptIds: [] }, sections, recap: { keyPoints: ['Sunlight starts the cycle.'] } };
  const syllabus = {
    requestedDurationSec: 60, plannedDurationSec: 60, coverageReason: 'The source supports this one-minute overview.', sourceSupport: 'supported', learningObjective: 'Explain the first steps of the water cycle.', audienceAssumptions: ['Basic science vocabulary.'],
    concepts: concepts.map(({ id, label, definition, evidence }) => ({ id, label, definition, evidence })), prerequisites: [],
    modules: [{ id: 'water_cycle', title: 'The water cycle begins', goal: 'Connect sunlight, water, and cloud formation.', budgetSec: 60, conceptIds: concepts.map((concept) => concept.id), evidenceSpanIds: [span.id], recallOfModuleIds: [] }],
  };
  const payloads: Record<string, unknown> = { lesson_syllabus: syllabus, concept_graph: graph, teaching_plan: plan };
  const seen: Array<{ name: string; user: string; system: string }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } }; messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }> };
    const name = request.response_format?.json_schema?.name;
    assert.ok(name && (payloads[name] || name === 'teaching_beats' || name === 'beat_narration'), `unexpected stage ${name}`);
    const message = request.messages?.find((entry) => entry.role === 'user')?.content;
    const systemMessage = request.messages?.find((entry) => entry.role === 'system')?.content;
    const userText = typeof message === 'string' ? message : message?.map((part) => part.text ?? '').join('') ?? '';
    seen.push({ name, user: userText, system: typeof systemMessage === 'string' ? systemMessage : systemMessage?.map((part) => part.text ?? '').join('') ?? '' });
    const sceneId = /SCENE (\w+)/.exec(userText)?.[1] ?? 'idea_1';
    const concept = concepts[Number(/idea_(\d+)/.exec(sceneId)?.[1] ?? 1) - 1]!;
    const claimId = `${sceneId}_claim`;
    const narrationSentences = [concept.definition, concept.id === 'sunlight' ? 'Water receives heat from sunlight.' : concept.id === 'water' ? 'Water travels into the air.' : 'Clouds result from cooling.'];
    let value: unknown = payloads[name];
    if (name === 'teaching_beats') {
      value = { beats: [0, 1].map((index) => ({
        claimIds: [claimId], learnerDelta: `The learner can explain ${concept.label}.`, learningQuestion: `What happens to ${concept.label.toLowerCase()}?`,
        learnerBefore: `The learner has not explained ${concept.label.toLowerCase()}.`, learnerAfter: `The learner can explain ${concept.label.toLowerCase()}.`, dependsOnOrders: index ? [1] : [],
        beatType: 'demonstrate', cognitiveOperation: 'explain_cause', representationFamily: 'literal_object', entities: [{ identityKey: `${concept.id}_main`, conceptId: concept.id }],
        semanticRevealOrder: index === 0 ? [`${concept.id}_main`] : [], requiredSemanticChanges: [{ identityKey: `${concept.id}_main`, kind: index === 0 ? 'introduce' : 'transform', ...(index === 0 ? {} : { fromState: 'The concept is not yet explained.' }), toState: concept.definition }], relationships: [], misconceptionIds: [],
        narrationGoal: `Explain ${concept.definition}`, visualInvariant: `${concept.label} remains visible.`, mutedMeaning: `${concept.label} is part of the water cycle.`, narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
      })) };
    }
    if (name === 'beat_narration') {
      value = { beats: narrationSentences.map((sentence, index) => ({ beatId: `${sceneId}.b${index + 1}`, sentences: [sentence], claimSentences: [{ claimId, sentenceIndex: 0 }], emphasisTerms: [concept.label] })) };
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 40, cost: 0.001 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const prepared = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 60 }, { model: 'test/hierarchy', apiKey: 'test-only', budgetUsd: 0.1, beats: true, fetcher });
  assert.deepEqual(prepared.failures.filter((failure) => failure.hard), []);
  assert.equal(prepared.requestedDurationSec, 60);
  assert.equal(prepared.plannedDurationSec, 60);
  assert.equal(prepared.modules?.length, 1);
  assert.equal(prepared.modules?.[0]?.plan.sections.length, 3);
  assert.equal(prepared.plan?.lessonBible?.terminology.length, 3);
  assert.deepEqual(seen.filter((item) => item.name === 'lesson_syllabus' || item.name === 'concept_graph' || item.name === 'teaching_plan').map((item) => item.name), ['lesson_syllabus', 'concept_graph', 'teaching_plan']);
  assert.equal(seen.filter((item) => item.name === 'teaching_beats').length, 3);
  assert.equal(seen.filter((item) => item.name === 'beat_narration').length, 3);
  assert.ok(prepared.visualVocabularies?.['01-water_cycle_idea_1']);
  assert.equal(prepared.visualVocabularies?.['01-water_cycle_idea_1']?.concepts.find((item) => item.conceptId === 'sunlight')?.depiction.kind, 'icon');
  const visualDiscoveryIndex = prepared.stageRuns.findIndex((run) => run.stage.startsWith('S3b-visual-discovery'));
  const beatPlanIndex = prepared.stageRuns.findIndex((run) => run.stage.startsWith('S3b-beats'));
  assert.ok(visualDiscoveryIndex >= 0 && visualDiscoveryIndex < beatPlanIndex, 'S3b fixes library pictures before beat-mode teaching and narration');
  assert.match(seen.find((item) => item.name === 'concept_graph')!.system, /sunlight.*water.*cloud/s);
  const live = lessonToLiveInput('water-cycle', prepared);
  assert.equal(live.targetDurationMs, 60_000);
  assert.equal(live.requestedDurationSec, 60);
  assert.equal(live.modules?.[0]?.sceneIds.length, 3);
});

test('an index that cannot teach the requested mechanism stops after S1', async () => {
  const sourceDoc = sourceDocFromText('Soil Biology Primer\nIntroduction to Microbiotic Crusts\nSoil Biology and Land Management', 'pdf');
  const span = sourceDoc.spans.find((candidate) => candidate.kind !== 'heading')!;
  const syllabus = {
    requestedDurationSec: 1800, plannedDurationSec: 60,
    coverageReason: 'The source lists titles but does not explain the soil food web or nutrient cycling.',
    sourceSupport: 'insufficient',
    learningObjective: 'Identify the topics named in the index.', audienceAssumptions: [],
    concepts: [
      { id: 'soil_biology', label: 'Soil biology', definition: 'A named document topic.', evidence: [{ spanId: span.id, quote: 'Soil Biology Primer' }] },
      { id: 'land_management', label: 'Land management', definition: 'A named document topic.', evidence: [{ spanId: span.id, quote: 'Soil Biology and Land Management' }] },
    ],
    prerequisites: [],
    modules: [{ id: 'module_1', title: 'Listed topics', goal: 'Identify listed topics.', budgetSec: 60, conceptIds: ['soil_biology', 'land_management'], evidenceSpanIds: [span.id], recallOfModuleIds: [] }],
  };
  const seen: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } } };
    seen.push(request.response_format?.json_schema?.name ?? 'unknown');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(syllabus) }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 40, cost: 0.001 } }), { status: 200 });
  };
  const prepared = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 1800, instruction: 'Explain how the soil food web and nutrient cycling connect to soil health.' }, { model: 'test/hierarchy', apiKey: 'test-only', budgetUsd: 0.1, fetcher });
  assert.deepEqual(seen, ['lesson_syllabus']);
  assert.equal(prepared.script, undefined);
  assert.ok(prepared.failures.some((failure) => failure.code === 'source-insufficient-for-goal' && failure.hard));
  assert.equal(prepared.stageRuns.find((run) => run.stage === 'S1-goal-sufficiency')?.status, 'failed');
});

test('numeric durations use the source-sufficiency syllabus path, including 120 and 3600 seconds', async () => {
  for (const duration of [120, 3600]) {
    const source = Array.from({ length: 6 }, (_, index) => `Source fact ${index + 1} supports a distinct concept.`).join('\n\n');
    const sourceDoc = sourceDocFromText(source, 'markdown');
    const paragraphSpans = sourceDoc.spans.filter((span) => span.kind === 'paragraph');
    const budgets = moduleBudgetShape(duration)!;
    const concepts = budgets.map((_, index) => ({
      id: `concept_${index + 1}`, label: `Concept ${index + 1}`, definition: `Source-backed concept ${index + 1}.`,
      evidence: [{ spanId: paragraphSpans[index]!.id, quote: paragraphSpans[index]!.text }],
    }));
    const syllabus = {
      requestedDurationSec: duration, plannedDurationSec: duration,
      coverageReason: 'This source does not support the requested teaching goal.', sourceSupport: 'insufficient',
      learningObjective: 'List the source facts.', audienceAssumptions: [], concepts, prerequisites: [],
      modules: budgets.map((budgetSec, index) => ({
        id: `module_${index + 1}`, title: `Module ${index + 1}`, goal: `Teach distinct concept ${index + 1}.`, budgetSec,
        conceptIds: [concepts[index]!.id], evidenceSpanIds: [paragraphSpans[index]!.id], recallOfModuleIds: [],
      })),
    };
    const seen: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } } };
      const name = request.response_format?.json_schema?.name ?? 'unknown';
      seen.push(name);
      assert.equal(name, 'lesson_syllabus');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(syllabus) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 20, cost: 0.001 } }), { status: 200 });
    };
    const prepared = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: duration }, { model: 'test/numeric-duration', apiKey: 'test-only', budgetUsd: 0.1, fetcher });
    assert.deepEqual(seen, ['lesson_syllabus'], `${duration}s must use S1 and stop on unsupported goal`);
    assert.equal(prepared.requestedDurationSec, duration);
    assert.equal(prepared.plannedDurationSec, duration);
    assert.equal(prepared.script, undefined);
    assert.ok(prepared.failures.some((failure) => failure.code === 'source-insufficient-for-goal' && failure.hard));
  }
});

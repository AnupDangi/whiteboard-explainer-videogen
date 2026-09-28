import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonToLiveInput, prepareLesson } from '../pipeline/lesson.js';
import { sourceDocFromText } from '../plan/sourceDoc.js';

test('canonical 1-minute request uses syllabus then bounded module stages and preserves the global bible', async () => {
  const sourceDoc = sourceDocFromText('# Water cycle\n\nSunlight heats water, evaporation moves it into air, and cooling forms clouds.', 'markdown');
  const span = sourceDoc.spans.find((candidate) => candidate.kind === 'paragraph')!;
  const concepts = [
    { id: 'sunlight', label: 'Sunlight', kind: 'quantity', definition: 'Sunlight heats water.', evidence: [{ spanId: span.id, quote: 'Sunlight heats water,' }], level: 'one-step' },
    { id: 'evaporation', label: 'Evaporation', kind: 'process', definition: 'Evaporation moves water into air.', evidence: [{ spanId: span.id, quote: 'evaporation moves it into air,' }], level: 'one-step' },
    { id: 'clouds', label: 'Clouds', kind: 'entity', definition: 'Cooling forms clouds.', evidence: [{ spanId: span.id, quote: 'cooling forms clouds.' }], level: 'one-step' },
  ];
  const graph = { concepts, relations: [], prerequisites: [] };
  const sections = concepts.map((concept, index) => ({
    id: `idea_${index + 1}`, title: concept.label, goal: `Explain how ${concept.label} starts this process.`, kind: index === 0 ? 'intro' : index === 2 ? 'recap' : 'explain', conceptIds: [concept.id], budgetSec: 20,
    contract: { learningDelta: `Explain how ${concept.label} starts this process.`, targetDurationSec: 20, requiredConceptIds: [concept.id], requiredRelations: [], evidenceSpanIds: [span.id], teachingSkill: 'definition', candidateMechanisms: ['focus'] },
  }));
  const plan = { targetDurationSec: 60, intro: { sourceTitle: 'Water cycle', sections: ['Heating', 'Evaporation', 'Cloud formation'] }, lessonBible: { audience: 'general learner', terminology: concepts.map((concept) => ({ conceptId: concept.id, label: concept.label })), persistentConceptIds: [] }, sections, recap: { keyPoints: ['Sunlight starts the cycle.'] } };
  const script = { text: 'First consider [[sunlight|the sunlight]]. It adds energy to [[water|the water]], which helps the next stage begin. This connects [[evaporation|evaporation]] with [[clouds|clouds]], completing one useful part of the water cycle and showing how these changes fit together.' };
  const syllabus = {
    requestedDurationSec: 60, plannedDurationSec: 60, coverageReason: 'The source supports this one-minute overview.', coreGoalSupported: true, learningObjective: 'Explain the first steps of the water cycle.', audienceAssumptions: ['Basic science vocabulary.'],
    concepts: concepts.map(({ id, label, definition, evidence }) => ({ id, label, definition, evidence })), prerequisites: [],
    modules: [{ id: 'water_cycle', title: 'The water cycle begins', goal: 'Connect heating, evaporation, and cloud formation.', budgetSec: 60, conceptIds: concepts.map((concept) => concept.id), evidenceSpanIds: [span.id], recallOfModuleIds: [] }],
  };
  const payloads: Record<string, unknown> = { lesson_syllabus: syllabus, concept_graph: graph, teaching_plan: plan, scene_narration: script };
  const seen: Array<{ name: string; user: string; system: string }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } }; messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }> };
    const name = request.response_format?.json_schema?.name;
    assert.ok(name && payloads[name], `unexpected stage ${name}`);
    const message = request.messages?.find((entry) => entry.role === 'user')?.content;
    const systemMessage = request.messages?.find((entry) => entry.role === 'system')?.content;
    seen.push({ name, user: typeof message === 'string' ? message : message?.map((part) => part.text ?? '').join('') ?? '', system: typeof systemMessage === 'string' ? systemMessage : systemMessage?.map((part) => part.text ?? '').join('') ?? '' });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payloads[name]) }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 40, cost: 0.001 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const prepared = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 60 }, { model: 'test/hierarchy', apiKey: 'test-only', budgetUsd: 0.1, fetcher });
  assert.deepEqual(prepared.failures.filter((failure) => failure.hard), []);
  assert.equal(prepared.requestedDurationSec, 60);
  assert.equal(prepared.plannedDurationSec, 60);
  assert.equal(prepared.modules?.length, 1);
  assert.equal(prepared.modules?.[0]?.plan.sections.length, 3);
  assert.equal(prepared.plan?.lessonBible?.terminology.length, 3);
  assert.deepEqual(seen.map((item) => item.name), ['lesson_syllabus', 'concept_graph', 'teaching_plan', 'scene_narration', 'scene_narration', 'scene_narration']);
  assert.match(seen.find((item) => item.name === 'concept_graph')!.system, /sunlight.*evaporation.*clouds/s);
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
    coreGoalSupported: false,
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

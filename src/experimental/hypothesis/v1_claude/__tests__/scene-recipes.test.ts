import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPE_CARDS, RECIPE_VERSION, recipeSectionBody } from '../planner/recipes.js';
import { TEMPLATE_SLOTS, buildSystemPrompt } from '../planner/prompt.js';
import { SCENE_PROMPT_VERSION, compileScenePlanningContext } from '../planner/context.js';
import type { PlannerSceneInput } from '../planner/prompt.js';
import type { ConceptGraph, SceneContract } from '../plan/schemas.js';
import { exemplarContextRecord } from '../planner/exemplars.js';
import { sha256, stableJson } from '../../shared/artifacts.js';

// Words from G-10 golden topics and the five calibration sources. Recipe text must stay topic-neutral.
const TOPIC_WORDS = /\b(attention|query|keys?|request|zero[- ]trust|gradient|induction|photosynthe\w*|leaf|immune|catalyst|inflation|bill|law|tides?|ocean|moon|bicycle|compost\w*|rainbow|prism|mirror)\b/i;

test('every template has a recipe card', () => {
  assert.deepEqual(Object.keys(RECIPE_CARDS).sort(), Object.keys(TEMPLATE_SLOTS).sort());
});

test('recipe cards are topic-neutral', () => {
  for (const [template, card] of Object.entries(RECIPE_CARDS)) {
    assert.doesNotMatch(`${card.useWhen} ${card.build} ${card.avoid}`, TOPIC_WORDS, template);
  }
});

test('v13 system prompt contains the recipe section and version', () => {
  const prompt = buildSystemPrompt();
  assert.ok(prompt.includes('## Visual recipes'));
  assert.ok(prompt.includes(recipeSectionBody()));
  assert.equal(SCENE_PROMPT_VERSION, 'scene-planner-prompt-v13');
  assert.equal(RECIPE_VERSION, 'visual-recipes/v1');
});

// ---------------------------------------------------------------------------
// Same synthetic ScenePlanningContext fixture as __tests__/scene-context.test.ts
// (its fixture builders are not exported, so the contract/bible/input are
// copied here rather than imported).
// ---------------------------------------------------------------------------

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
const scene: PlannerSceneInput = {
  sceneId: 'heat_pressure', raw: '[[heat|Heat]] raises [[pressure|pressure]].', plainText: 'Heat raises pressure.',
  mentions: [{ id: 'heat', phrase: 'Heat' }, { id: 'pressure', phrase: 'pressure' }],
  teachingContext: { requireEvidence: true, sourceId: 'source_a', displayText: 'Heat Raises Pressure', sourceEvidenceRefs: [heatRef, pressureRef, relationRef],
    concepts: graph.concepts.map((item) => ({ id: item.id, label: item.label, kind: item.kind, definition: item.definition, evidenceRefs: item.evidence })),
    relations: graph.relations.map((item) => ({ from: item.from, to: item.to, type: item.type, evidenceRefs: item.evidence })) },
  candidates: { heat: [], pressure: [] },
};
const times = [{ id: 'heat', startMs: 100, endMs: 300 }, { id: 'pressure', startMs: 1100, endMs: 1600 }];

test('prompt v13 changes the planning context hash', () => {
  const context = compileScenePlanningContext(scene, contract, bible, times, 'zero', 'catalog-v1');
  assert.equal(context.versions.prompt, 'scene-planner-prompt-v13');
  assert.equal(context.versions.recipes, 'visual-recipes/v1');

  // Mirror compileScenePlanningContext's own payload shape exactly (planner/context.ts),
  // reusing the fields it stored on the returned context, with only versions.prompt reverted to v12.
  const payload = {
    sceneContract: context.sceneContract, lessonBible: context.lessonBible, narration: context.narration,
    teachingContext: context.teachingContext, evidence: context.evidence, visualCandidates: context.visualCandidates,
    availableTemplates: context.availableTemplates, mentionTimes: context.mentionTimes, previousElements: context.previousElements,
    promptArm: context.promptArm, exampleOrder: context.exampleOrder, examples: context.examples.map(exemplarContextRecord),
    versions: { ...context.versions, prompt: 'scene-planner-prompt-v12' },
  };
  const v12Hash = sha256(stableJson(payload));
  assert.notEqual(context.contextHash, v12Hash);
});

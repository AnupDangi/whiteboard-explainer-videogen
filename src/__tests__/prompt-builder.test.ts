import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildPrompt, schemaKeywordLeaks } from '../planner/promptBuilder.js';
import { buildSystemPrompt } from '../planner/prompt.js';
import { recipeSectionBody } from '../planner/recipes.js';
import { buildConceptGraph, buildTeachingPlan, type LessonRequest, type StageModel } from '../plan/stages.js';
import { sourceDocFromText, resolveSourceEvidence } from '../intake/sourceDoc.js';
import type { ConceptGraph, TeachingPlan } from '../plan/schemas.js';

// The v12 hash remains an immutable historical record. v15 adds the static
// code primitive and wording; the recipe-free v15 prompt is pinned separately.
const V16_WITHOUT_RECIPES_SHA256 = '0b7e4a1217ec05a8d398df529d187a66fad5e1f0ad81ffcb5fd700b330992efb';

test('buildPrompt joins sections deterministically with titles and per-section hashes', () => {
  const built = buildPrompt([{ id: 'a', title: 'Alpha', body: 'one' }, { id: 'b', body: 'two' }], 'intro');
  assert.equal(built.text, 'intro\n\n## Alpha\none\n\ntwo');
  assert.equal(built.sections.length, 2);
  assert.equal(built.sections[0].sha256, createHash('sha256').update('## Alpha\none').digest('hex'));
  assert.equal(built.sha256, createHash('sha256').update(built.text).digest('hex'));
});

test('buildPrompt rejects duplicate ids and empty bodies', () => {
  assert.throws(() => buildPrompt([{ id: 'a', body: 'x' }, { id: 'a', body: 'y' }]), /duplicate prompt section id a/);
  assert.throws(() => buildPrompt([{ id: 'a', body: '  ' }]), /empty prompt section a/);
});

test('schemaKeywordLeaks finds JSON-Schema keywords used as ids', () => {
  assert.deepEqual(schemaKeywordLeaks(['heat', 'type', 'required', 'relations', 'pressure']), ['type', 'required', 'relations']);
  assert.deepEqual(schemaKeywordLeaks(['heat_type', 'required_input']), []);
});

test('v16 prompt without recipes matches its recorded layout-recipe baseline', () => {
  const v16 = buildSystemPrompt();
  const withoutRecipes = v16.replace(`\n\n## Visual recipes\n${recipeSectionBody()}`, '');
  assert.equal(createHash('sha256').update(withoutRecipes).digest('hex'), V16_WITHOUT_RECIPES_SHA256);
});

// ---------------------------------------------------------------------------
// S2 / S3 schema-keyword guard: a model emitting a JSON-Schema field name
// (e.g. "type") as a concept id must be rejected with a precise repair
// message, consuming exactly one repair.
// ---------------------------------------------------------------------------

const okBody = (content: string) => JSON.stringify({ id: 'gen-t', model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3, cost: 0.0001 } });

test('S2 buildConceptGraph rejects a concept id that is a JSON-Schema keyword, after exactly one repair', async () => {
  const sourceDoc = sourceDocFromText('# Heat and pressure\n\nHeat causes a rise in pressure inside the chamber.', 'text');
  const sourceSpan = sourceDoc.spans.find((span) => span.kind === 'paragraph')!;
  const quote = 'Heat causes a rise in pressure inside the chamber.';
  const evidence = [{ spanId: sourceSpan.id, quote }];
  const leakedGraph = {
    concepts: [
      { id: 'type', label: 'Heat', kind: 'entity', definition: quote, evidence, level: 'one-step' },
      { id: 'pressure', label: 'Pressure', kind: 'quantity', definition: quote, evidence, level: 'one-step' },
    ],
    relations: [{ from: 'type', to: 'pressure', type: 'causes', evidence }],
    prerequisites: [],
  };
  const validGraph = {
    concepts: [
      { id: 'heat', label: 'Heat', kind: 'entity', definition: quote, evidence, level: 'one-step' },
      { id: 'pressure', label: 'Pressure', kind: 'quantity', definition: quote, evidence, level: 'one-step' },
    ],
    relations: [{ from: 'heat', to: 'pressure', type: 'causes', evidence }],
    prerequisites: [],
  };
  const bodies = [leakedGraph, validGraph];
  const requestUsers: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ role: string; content: string }> };
    requestUsers.push(request.messages[1].content);
    const body = bodies.shift();
    return new Response(okBody(JSON.stringify(body)), { status: 200 });
  };
  const req: LessonRequest = { source: sourceDoc.text, sourceDoc, targetDurationSec: 20 };
  const m: StageModel = { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher };
  const result = await buildConceptGraph(req, m);
  assert.equal(result.usage.repairs, 1);
  assert.equal(requestUsers.length, 2);
  assert.match(requestUsers[1], /are JSON field names/);
  assert.ok(result.value);
  assert.deepEqual(result.value!.concepts.map((c) => c.id).sort(), ['heat', 'pressure']);
});

test('S3 buildTeachingPlan rejects a section concept id that is a JSON-Schema keyword, after exactly one repair', async () => {
  const sourceDoc = sourceDocFromText('# Heat and pressure\n\nHeat causes a rise in pressure inside the chamber.', 'text');
  const sourceSpan = sourceDoc.spans.find((span) => span.kind === 'paragraph')!;
  const quote = 'Heat causes a rise in pressure inside the chamber.';
  const evidence = [resolveSourceEvidence(sourceDoc, sourceSpan.id, quote)!];
  const graph: ConceptGraph = {
    concepts: [
      { id: 'heat', label: 'Heat', kind: 'entity', definition: quote, evidence, level: 'one-step' },
      { id: 'pressure', label: 'Pressure', kind: 'quantity', definition: quote, evidence, level: 'one-step' },
    ],
    relations: [{ from: 'heat', to: 'pressure', type: 'causes', evidence }],
    prerequisites: [],
  };
  const basePlan = {
    targetDurationSec: 18,
    intro: { sourceTitle: 'Heat and pressure', sections: ['Rising pressure'] },
    lessonBible: { audience: 'general learner', domain: 'physics', terminology: [{ conceptId: 'heat', label: 'Heat' }, { conceptId: 'pressure', label: 'Pressure' }], persistentConceptIds: [] },
    recap: { keyPoints: ['Heat causes pressure to rise'] },
  };
  const leakedPlan: TeachingPlan = {
    ...basePlan,
    sections: [{
      id: 'rising_pressure', title: 'Rising pressure', goal: 'Explain how heat raises pressure', kind: 'explain', conceptIds: ['type'], budgetSec: 18,
      contract: {
        learningDelta: 'Explain how heat raises pressure', targetDurationSec: 18, requiredConceptIds: ['type'],
        requiredRelations: [], evidenceSpanIds: [sourceSpan.id], teachingSkill: 'mechanism', candidateMechanisms: ['chain'],
        essentialClaims: [{ id: 'heat_pressure', statement: 'Heat raises pressure.', conceptIds: ['type'], relations: [], evidenceSpanIds: [sourceSpan.id] }],
      },
    }],
  };
  const validPlan: TeachingPlan = {
    ...basePlan,
    sections: [{
      id: 'rising_pressure', title: 'Rising pressure', goal: 'Explain how heat raises pressure', kind: 'explain', conceptIds: ['heat', 'pressure'], budgetSec: 18,
      contract: {
        learningDelta: 'Explain how heat raises pressure', targetDurationSec: 18, requiredConceptIds: ['heat', 'pressure'],
        requiredRelations: [{ from: 'heat', to: 'pressure', type: 'causes' }], evidenceSpanIds: [sourceSpan.id], teachingSkill: 'mechanism', candidateMechanisms: ['chain'],
        essentialClaims: [{ id: 'heat_pressure', statement: 'Heat raises pressure.', conceptIds: ['heat', 'pressure'], relations: [{ from: 'heat', to: 'pressure', type: 'causes' }], evidenceSpanIds: [sourceSpan.id] }],
        mentalModel: 'Heat pushes pressure up.',
        semanticVisualIntents: [{ claimId: 'heat_pressure', conceptType: 'cause', strategy: 'state-change', conceptIds: ['heat', 'pressure'], roles: [], relationType: 'causes' }],
      },
    }],
  };
  const bodies = [leakedPlan, validPlan];
  const requestUsers: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ role: string; content: string }> };
    requestUsers.push(request.messages[1].content);
    const body = bodies.shift();
    return new Response(okBody(JSON.stringify(body)), { status: 200 });
  };
  const req: LessonRequest = { source: sourceDoc.text, sourceDoc, targetDurationSec: 18 };
  const m: StageModel = { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher };
  const result = await buildTeachingPlan(req, graph, m);
  assert.equal(result.usage.repairs, 1);
  assert.equal(requestUsers.length, 2);
  assert.match(requestUsers[1], /are JSON field names/);
  assert.ok(result.value);
  assert.deepEqual(result.value!.sections[0]!.conceptIds.sort(), ['heat', 'pressure']);
});

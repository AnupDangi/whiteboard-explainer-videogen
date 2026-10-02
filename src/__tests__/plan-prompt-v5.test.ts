import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeachingPlan, type LessonRequest, type StageModel } from '../plan/stages.js';
import { sourceDocFromText, resolveSourceEvidence } from '../intake/sourceDoc.js';
import type { ConceptGraph, TeachingPlan } from '../plan/schemas.js';

// Regression for the 2026-09-25/26 reliability finding: raw model output showed
// `lessonBible.terminology: []` and every section's `contract.requiredRelations: []`
// on both the initial attempt and the repair, even with real persistentConceptIds
// and real graph relations present. v4's worked example never demonstrated a filled
// `terminology` array and only ever showed the trivial 2-concept/1-relation case for
// `requiredRelations`. v5 keeps v4's rules byte-identical and only expands the worked
// example. This test guards that expansion, not model behavior — the real measurement
// is the `plan:calibrate` harness run against a live model.
test('v5 worked example demonstrates a filled terminology array and a multi-relation section', async () => {
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
  const validPlan: TeachingPlan = {
    targetDurationSec: 18,
    intro: { sourceTitle: 'Heat and pressure', sections: ['Rising pressure'] },
    lessonBible: { audience: 'general learner', domain: 'physics', terminology: [{ conceptId: 'heat', label: 'Heat' }, { conceptId: 'pressure', label: 'Pressure' }], persistentConceptIds: [] },
    recap: { keyPoints: ['Heat causes pressure to rise'] },
    sections: [{
      id: 'rising_pressure', title: 'Rising pressure', goal: 'Explain how heat raises pressure', kind: 'explain', conceptIds: ['heat', 'pressure'], budgetSec: 18,
      contract: {
        learningDelta: 'Explain how heat raises pressure', targetDurationSec: 18, requiredConceptIds: ['heat', 'pressure'],
        requiredRelations: [{ from: 'heat', to: 'pressure', type: 'causes' }], evidenceSpanIds: [sourceSpan.id], essentialClaims: [{ id: 'pressure_rises', statement: 'Heat raises pressure', conceptIds: ['heat', 'pressure'], relations: [{ from: 'heat', to: 'pressure', type: 'causes' }], evidenceSpanIds: [sourceSpan.id] }], teachingSkill: 'mechanism', candidateMechanisms: ['chain'],
      },
    }],
  };
  let capturedUser = '';
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ role: string; content: string }> };
    capturedUser = request.messages[1].content;
    const body = JSON.stringify({ id: 'gen-t', model: 'test/model', choices: [{ message: { content: JSON.stringify(validPlan) }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3, cost: 0.0001 } });
    return new Response(body, { status: 200 });
  };
  const req: LessonRequest = { source: sourceDoc.text, sourceDoc, targetDurationSec: 18 };
  const m: StageModel = { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher };
  const result = await buildTeachingPlan(req, graph, m, 'v5-fully-worked-example');
  assert.equal(result.usage.repairs, 0);
  assert.ok(result.value, 'v5 must still produce a valid plan for an already-valid response');

  // The worked example must show terminology non-empty (v4's gap) ...
  assert.match(capturedUser, /"terminology":\[\{"conceptId":"concept_a"/);
  assert.doesNotMatch(capturedUser, /"terminology":\[\]/);
  // ... and a section with 2+ relations, not just the trivial 1-relation case.
  const relationsMatch = capturedUser.match(/"requiredRelations":\[(\{[^\]]*\})\]/);
  assert.ok(relationsMatch, 'worked example must include a requiredRelations array');
  const relationCount = (relationsMatch![1].match(/"from":/g) ?? []).length;
  assert.ok(relationCount >= 2, `expected 2+ relations in the worked example section, found ${relationCount}`);
});

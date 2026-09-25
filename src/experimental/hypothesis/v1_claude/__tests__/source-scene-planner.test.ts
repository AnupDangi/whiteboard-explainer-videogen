import assert from 'node:assert/strict';
import test from 'node:test';
import { compileScenePlanningContext } from '../planner/context.js';
import { planScene } from '../planner/plan.js';
import type { PlannerSceneInput } from '../planner/prompt.js';
import { resolveSourceEvidence, sourceDocFromText } from '../plan/sourceDoc.js';
import type { SceneSpec } from '../types.js';

function sourcePlannerCase() {
  const sourceDoc = sourceDocFromText('A leaf uses light to build sugar.', 'text');
  const span = sourceDoc.spans.find((item) => item.kind === 'paragraph')!;
  const evidence = resolveSourceEvidence(sourceDoc, span.id, span.text.trim())!;
  const contract = {
    learningDelta: 'Explain how a leaf uses light', targetDurationSec: 8,
    requiredConceptIds: ['leaf'], requiredRelations: [], evidenceSpanIds: [span.id],
    teachingSkill: 'mechanism' as const, candidateMechanisms: ['chain'] as ['chain'],
  };
  const bible = { audience: 'general learner', terminology: [{ conceptId: 'leaf', label: 'Leaf' }], persistentConceptIds: [] };
  const input: PlannerSceneInput = {
    sceneId: 'leaf_mechanism',
    raw: 'A [[leaf|leaf]] uses [[light|light]] to build [[sugar|sugar]].',
    plainText: 'A leaf uses light to build sugar.',
    mentions: [{ id: 'leaf', phrase: 'leaf' }, { id: 'light', phrase: 'light' }, { id: 'sugar', phrase: 'sugar' }],
    teachingContext: {
      displayText: 'Leaf Uses Light', visualIntent: contract.learningDelta, role: 'explain',
      concepts: [{ id: 'leaf', label: 'Leaf', kind: 'entity', definition: span.text.trim(), evidenceRefs: [evidence] }],
      sourceEvidenceRefs: [evidence], requireEvidence: true, sourceId: sourceDoc.sourceId,
    },
  };
  input.planningContext = compileScenePlanningContext(
    input, contract, bible,
    [{ id: 'leaf', startMs: 0, endMs: 1200 }, { id: 'light', startMs: 1500, endMs: 2600 }, { id: 'sugar', startMs: 4000, endMs: 5200 }],
    'zero', 'synthetic-catalog-v1', sourceDoc.sourceId, 'synthetic-source-case',
  );
  const spec: SceneSpec = {
    schemaVersion: 'claude-scene-spec/v1', sceneId: input.sceneId,
    title: 'Leaf Uses Light', titleConceptIds: ['leaf'], titleEvidenceRefs: [evidence], template: 'list_icon',
    elements: [{ id: 'leaf_label', slot: 'item', anchor: 'mention:leaf', prim: 'text', text: 'LEAF', size: 'title', conceptIds: ['leaf'], evidenceRefs: [evidence] }],
    edges: [],
  };
  return { sourceDoc, evidence, input, spec };
}

function responseFor(spec: SceneSpec): typeof fetch {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    const user = request.messages.find((message) => message.role === 'user')?.content ?? '';
    assert.match(user, /Validated scene planning context/);
    assert.match(user, /Explain how a leaf uses light/);
    assert.match(user, /"spanId"/);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(spec) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.001 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('S6 compiles a zero-shot source context and validates the structured planner response', async () => {
  const { input, spec } = sourcePlannerCase();
  const result = await planScene(input, { model: 'test/scene-planner', apiKey: 'test-only', remainingBudgetUsd: 0.03, fallback: false, fetcher: responseFor(spec) });
  assert.deepEqual(result.spec, spec);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.failures, []);
  assert.equal(result.usage.calls, 1);
  assert.equal(result.usage.fallbacks, 0);
  assert.equal(result.rawResponses.length, 1);
});

test('S6 transport failure returns only a hard-failed diagnostic fallback', async () => {
  const { input } = sourcePlannerCase();
  const result = await planScene(input, {
    model: 'test/scene-planner', apiKey: 'test-only', remainingBudgetUsd: 0.03,
    fetcher: async () => new Response('test transport unavailable', { status: 503 }),
  });
  assert.ok(result.spec, 'the fallback remains available for diagnostic rendering');
  assert.equal(result.fallback, true);
  assert.ok(result.failures.some((failure) => failure.code === 'planner-call-failed' && failure.hard));
  assert.ok(result.failures.some((failure) => failure.code === 'planner-fallback' && failure.hard));
  assert.ok(result.failures.some((failure) => failure.code === 'planner-fallback-gate' && failure.hard));
});

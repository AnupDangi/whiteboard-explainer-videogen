import test from 'node:test';
import assert from 'node:assert/strict';
import { runBeatStages } from '../teaching/beat-pipeline.js';
import type { ModelClient } from '../llm/modelClient.js';
import type { ConceptGraph, TeachingPlan } from '../plan/schemas.js';
import { sourceDocFromText } from '../intake/sourceDoc.js';

const doc = sourceDocFromText('# Notes\n\nA call pushes a frame onto the stack. A return pops the top frame. The base case stops the calls after 3 steps.', 'markdown');
const span = doc.spans.find((s) => s.kind === 'paragraph')!;
const ev = [{ spanId: span.id, quote: 'A call pushes a frame onto the stack.', sourceId: doc.sourceId, startChar: 0, endChar: 10 }];
const graph = { concepts: [
  { id: 'frame', label: 'Frame', kind: 'entity', definition: 'A record of one call.', evidence: ev, level: 'one-step' },
  { id: 'stack', label: 'Stack', kind: 'entity', definition: 'Holds frames.', evidence: ev, level: 'one-step' },
], relations: [{ from: 'frame', to: 'stack', type: 'contains', evidence: ev }], prerequisites: [] } as unknown as ConceptGraph;
const claim = (id: string) => ({ id, statement: `Statement ${id} takes 3 steps.`, conceptIds: ['frame', 'stack'], relations: [{ from: 'frame', to: 'stack', type: 'contains' }], evidenceSpanIds: [span.id] });
const section = (id: string) => ({ id, title: `Scene ${id}`, goal: 'g', kind: 'explain', conceptIds: ['frame', 'stack'], budgetSec: 8, contract: {
  learningDelta: 'delta', targetDurationSec: 8, requiredConceptIds: ['frame', 'stack'], requiredRelations: [{ from: 'frame', to: 'stack', type: 'contains' }], evidenceSpanIds: [span.id],
  essentialClaims: [claim(`${id}_c`)], teachingSkill: 'mechanism', candidateMechanisms: ['chain'], mentalModel: 'm', misconceptionRisk: [],
} });
const plan = { targetDurationSec: 24, intro: { sourceTitle: 't', sections: [] }, sections: [section('one'), section('two')], recap: { keyPoints: [] } } as unknown as TeachingPlan;

const beatJson = (sceneClaim: string) => JSON.stringify({ beats: [{
  claimIds: [sceneClaim], learnerDelta: 'sees a push', beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model',
  entities: [{ conceptId: 'frame' }], relationships: [], misconceptionIds: [], narrationGoal: 'say it', visualInvariant: 'a frame', mutedMeaning: 'a pile', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
}] });
const narrationJson = (beatId: string, claimId: string) => JSON.stringify({ beats: [{ beatId, sentences: ['Every call pushes a frame onto the stack, up to 3 steps deep.'], claimSentences: [{ claimId, sentenceIndex: 0 }], emphasisTerms: ['frame'] }] });
const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0.0002 };
function client(handler: (schemaName: string, user: string) => string): ModelClient {
  return { provider: 'fake', chat: async (r) => ({ content: handler(r.schemaName, r.user), finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage }) };
}

test('every scene gets beats and beat narration, keyed by scene id, and the script carries plain text with claim spans', async () => {
  const terminology = [{ term: 'Frame' }, { term: 'Stack' }];
  const c = client((schema, user) => {
    const scene = /SCENE (\w+)/.exec(user)?.[1] ?? '';
    if (schema === 'beat_narration') {
      assert.match(user, /Lesson terminology/);
      assert.match(user, /- Frame/);
      assert.match(user, /- Stack/);
    }
    return schema === 'teaching_beats' ? beatJson(`${scene}_c`) : narrationJson(`${scene}.b1`, `${scene}_c`);
  });
  const result = await runBeatStages({ plan, graph, sourceDoc: doc, terminology }, { language: 'hi', model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client: c });
  assert.ok(result.value, JSON.stringify(result.failures));
  assert.deepEqual(Object.keys(result.value!.beatPlans).sort(), ['one', 'two']);
  assert.equal(result.value!.beatPlans.one![0]!.beatId, 'one.b1');
  assert.equal(result.value!.script.scenes[0]!.sectionId, 'one');
  assert.equal(result.value!.script.scenes[0]!.text, 'Every call pushes a frame onto the stack, up to 3 steps deep.');
  assert.deepEqual(result.value!.script.scenes[0]!.claimSpans, [{ claimId: 'one_c', exactText: 'Every call pushes a frame onto the stack, up to 3 steps deep.' }]);
  assert.equal(result.reports.filter((r) => r.stage === 'beats').length, 2);
  assert.equal(result.reports.filter((r) => r.stage === 'beat-narration').length, 2);
  assert.deepEqual(result.value!.narrationContexts.one!.terminology, terminology);
  assert.equal(result.value!.narrationContexts.one!.speechLanguagePolicy, 'native-plus-english-terms');
});

test('a number the source never states is rejected in narration, and a scene that cannot be written fails the stage instead of being skipped', async () => {
  const c = client((schema, user) => {
    const scene = /SCENE (\w+)/.exec(user)?.[1] ?? '';
    if (schema === 'teaching_beats') return beatJson(`${scene}_c`);
    return JSON.stringify({ beats: [{ beatId: `${scene}.b1`, sentences: ['It takes 99 steps.'], claimSentences: [{ claimId: `${scene}_c`, sentenceIndex: 0 }], emphasisTerms: [] }] });
  });
  const result = await runBeatStages({ plan, graph, sourceDoc: doc }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client: c });
  assert.equal(result.value, undefined);
  assert.ok(result.failures.some((f) => f.hard && /beat-narration/.test(f.code)));
});

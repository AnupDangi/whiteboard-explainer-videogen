import test from 'node:test';
import assert from 'node:assert/strict';
import { runBeatStages } from '../teaching/beat-pipeline.js';
import type { ModelClient } from '../llm/modelClient.js';
import type { ConceptGraph, TeachingPlan } from '../plan/schemas.js';
import type { VisualVocabulary } from '../planner/visualDiscovery.js';
import { sourceDocFromText } from '../intake/sourceDoc.js';

const doc = sourceDocFromText('# Notes\n\nA call pushes a frame onto the stack. A return pops the top frame. The base case stops the calls after 3 steps.', 'markdown');
const span = doc.spans.find((s) => s.kind === 'paragraph')!;
const ev = [{ spanId: span.id, quote: 'A call pushes a frame onto the stack.', sourceId: doc.sourceId, startChar: 0, endChar: 10 }];
const graph = { concepts: [
  { id: 'frame', label: 'Frame', kind: 'entity', definition: 'A record of one call.', evidence: ev, level: 'one-step' },
  { id: 'stack', label: 'Stack', kind: 'entity', definition: 'Holds frames.', evidence: ev, level: 'one-step' },
], relations: [{ from: 'stack', to: 'frame', type: 'contains', evidence: ev }], prerequisites: [] } as unknown as ConceptGraph;
const claim = (id: string) => ({ id, statement: 'The stack contains each call frame, up to 3 steps deep.', conceptIds: ['stack', 'frame'], relations: [{ from: 'stack', to: 'frame', type: 'contains' }], evidenceSpanIds: [span.id] });
const section = (id: string) => ({ id, title: `Scene ${id}`, goal: 'g', kind: 'explain', conceptIds: ['frame', 'stack'], budgetSec: 8, contract: {
  learningDelta: 'delta', targetDurationSec: 8, requiredConceptIds: ['frame', 'stack'], requiredRelations: [{ from: 'stack', to: 'frame', type: 'contains' }], evidenceSpanIds: [span.id],
  essentialClaims: [claim(`${id}_c`)], teachingSkill: 'mechanism', candidateMechanisms: ['chain'], mentalModel: 'm', misconceptionRisk: [],
} });
const plan = { targetDurationSec: 24, intro: { sourceTitle: 't', sections: [] }, sections: [section('one'), section('two')], recap: { keyPoints: [] } } as unknown as TeachingPlan;

const beatJson = (sceneClaim: string) => JSON.stringify({ beats: [{
  claimIds: [sceneClaim], learnerDelta: 'sees a push', learningQuestion: 'What does a call add to the stack?', learnerBefore: 'The learner knows the stack can hold frames.', learnerAfter: 'The learner knows a call adds one frame.', dependsOnOrders: [], beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model',
  entities: [{ identityKey: 'frame_main', conceptId: 'frame' }], semanticRevealOrder: ['frame_main'], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'introduce', toState: 'A frame is shown.' }],
  relationships: [], misconceptionIds: [], narrationGoal: 'say it', visualInvariant: 'a frame', mutedMeaning: 'a pile', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
}] });
const narrationJson = (beatId: string, claimId: string) => JSON.stringify({ beatId, sentences: ['The stack contains each call frame, up to 3 steps deep.'], claimSentences: [{ claimId, sentenceIndex: 0 }], semanticAnchors: [{ semanticEventId: `${beatId}.e1`, sentenceIndex: 0, phrase: 'contains each call frame' }], emphasisTerms: ['frame'] });
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
  assert.equal(result.value!.script.scenes[0]!.text, 'The stack contains each call frame, up to 3 steps deep.');
  assert.deepEqual(result.value!.script.scenes[0]!.claimSpans, [{ claimId: 'one_c', exactText: 'The stack contains each call frame, up to 3 steps deep.' }]);
  assert.equal(result.reports.filter((r) => r.stage === 'beats').length, 2);
  assert.equal(result.reports.filter((r) => r.stage === 'beat-narration').length, 2);
  assert.deepEqual(result.value!.narrationContexts.one!.terminology, terminology);
  assert.equal(result.value!.narrationContexts.one!.speechLanguagePolicy, 'native-plus-english-terms');
});

test('invalid canonical relation identity fails before S3b or S4 provider calls', async () => {
  const calls: string[] = [];
  const invalid = structuredClone(plan);
  invalid.sections[0]!.contract!.essentialClaims[0]!.statement = 'The frame contains the stack, up to 3 steps deep.';
  const result = await runBeatStages({ plan: invalid, graph, sourceDoc: doc }, {
    model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1,
    client: client((schema) => { calls.push(schema); return '{}'; }),
  });
  assert.equal(result.value, undefined);
  assert.deepEqual(calls, []);
  assert.ok(result.failures.some((failure) => failure.code === 'beat-canonical-claim-invalid' && /relation identity conflict/.test(failure.message)));
});

test('a number the source never states is rejected in narration, and a scene that cannot be written fails the stage instead of being skipped', async () => {
  const c = client((schema, user) => {
    const scene = /SCENE (\w+)/.exec(user)?.[1] ?? '';
    if (schema === 'teaching_beats') return beatJson(`${scene}_c`);
    return JSON.stringify({ beatId: `${scene}.b1`, sentences: ['It takes 99 steps.'], claimSentences: [{ claimId: `${scene}_c`, sentenceIndex: 0 }], semanticAnchors: [{ semanticEventId: `${scene}.b1.e1`, sentenceIndex: 0, phrase: '99 steps' }], emphasisTerms: [] });
  });
  const result = await runBeatStages({ plan, graph, sourceDoc: doc }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client: c });
  assert.equal(result.value, undefined);
  assert.ok(result.failures.some((f) => f.hard && /beat-narration/.test(f.code)));
});


test('beat planning and beat-local narration share scene depictions without exposing asset IDs', async () => {
  const visualVocabulary: Record<string, VisualVocabulary> = {
    one: { sceneId: 'one', concepts: [{ conceptId: 'frame', label: 'Frame', conceptKind: 'entity', depiction: { kind: 'icon', entryId: 'private-selected-asset', rung: 'R3-exact' } }] },
    two: { sceneId: 'two', concepts: [{ conceptId: 'stack', label: 'Stack', conceptKind: 'entity', depiction: { kind: 'labelled' } }] },
  };
  const observed: string[] = [];
  const c = client((schema, user) => {
    const scene = /SCENE (\w+)/.exec(user)?.[1] ?? '';
    observed.push(`${schema}:${scene}`);
    assert.match(user, /HOW EACH CONCEPT WILL BE DRAWN/);
    assert.doesNotMatch(user, /private-selected-asset/);
    if (scene === 'one') {
      assert.match(user, /Frame \(entity\): a real picture exists/);
      assert.doesNotMatch(user, /Stack \(entity\): no picture exists/);
    } else {
      assert.match(user, /Stack \(entity\): no picture exists/);
      assert.doesNotMatch(user, /Frame \(entity\): a real picture exists/);
    }
    return schema === 'teaching_beats' ? beatJson(`${scene}_c`) : narrationJson(`${scene}.b1`, `${scene}_c`);
  });
  const result = await runBeatStages({ plan, graph, sourceDoc: doc, visualVocabulary }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client: c });
  assert.ok(result.value, JSON.stringify(result.failures));
  assert.deepEqual(observed.sort(), ['beat_narration:one', 'beat_narration:two', 'teaching_beats:one', 'teaching_beats:two']);
  assert.deepEqual(result.value.narrationContexts.one!.visualVocabulary, visualVocabulary.one);
  assert.deepEqual(result.value.narrationContexts.two!.visualVocabulary, visualVocabulary.two);
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ContentAddressedArtifactStore } from '../artifactCache.js';
import { prepareLesson } from '../pipeline/lesson.js';
import { sourceDocFromText } from '../plan/sourceDoc.js';

test('S1-S4 source lesson preparation carries evidence, blocks relation loss, and resumes from cache', async () => {
  const sourceDoc = sourceDocFromText('# Light and leaves\n\nThe leaf uses light to build sugar.', 'text');
  const sourceSpan = sourceDoc.spans.find((span) => span.kind === 'paragraph')!;
  const evidence = [{ spanId: sourceSpan.id, quote: 'The leaf uses light to build sugar.' }];
  const graph = {
    concepts: [
      { id: 'leaf', label: 'Leaf', kind: 'entity', definition: 'The leaf uses light to build sugar.', evidence, level: 'one-step' },
      { id: 'sugar', label: 'Sugar', kind: 'entity', definition: 'Sugar is built by the leaf using light.', evidence, level: 'one-step' },
    ],
    relations: [{ from: 'leaf', to: 'sugar', type: 'produces', evidence }],
    prerequisites: [],
  };
  const plan = {
    targetDurationSec: 15,
    intro: { sourceTitle: 'Light and leaves', sections: ['Building sugar'] },
    lessonBible: { audience: 'general learner', domain: 'biology', terminology: [{ conceptId: 'leaf', label: 'Leaf' }, { conceptId: 'sugar', label: 'Sugar' }], persistentConceptIds: [] },
    sections: [{
      id: 'build_sugar', title: 'Building sugar', goal: 'Explain how leaves build sugar', kind: 'explain', conceptIds: ['leaf', 'sugar'], budgetSec: 15,
      contract: {
        learningDelta: 'Explain how leaves build sugar', targetDurationSec: 15, requiredConceptIds: ['leaf', 'sugar'],
        requiredRelations: [{ from: 'leaf', to: 'sugar', type: 'produces' }], evidenceSpanIds: [sourceSpan.id],
        teachingSkill: 'mechanism', candidateMechanisms: ['chain'],
      },
    }],
    recap: { keyPoints: ['Leaves use light to build sugar'] },
  };
  const script = { text: 'When [[leaf|a leaf]] receives [[light|light energy]], it uses that energy to build [[sugar|sugar]]. This process makes [[food|food]] the plant can store and use.' };
  const payloads: Record<string, unknown> = { concept_graph: graph, teaching_plan: plan, scene_narration: script };
  const received: string[] = [];
  const requestPrompts = new Map<string, { system: string; user: string }>();
  const fakeProvider: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      response_format?: { json_schema?: { name?: string } };
      messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
    };
    const name = request.response_format?.json_schema?.name;
    assert.ok(name && payloads[name], `unexpected structured stage ${name}`);
    received.push(name);
    const content = (role: string) => {
      const value = request.messages?.find((message) => message.role === role)?.content;
      return typeof value === 'string' ? value : value?.map((part) => part.text ?? '').join('') ?? '';
    };
    requestPrompts.set(name, { system: content('system'), user: content('user') });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payloads[name]) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 80, completion_tokens: 30, cost: 0.001 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const root = await mkdtemp(join(tmpdir(), 'hyp-source-prep-'));
  try {
    const cold = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 15 }, {
      model: 'test/structured-contract', apiKey: 'test-only', budgetUsd: 0.03,
      artifactStore: new ContentAddressedArtifactStore(root, 'cold'), fetcher: fakeProvider,
    });
    assert.deepEqual(received, ['concept_graph', 'teaching_plan', 'scene_narration']);
    assert.match(requestPrompts.get('concept_graph')!.user, new RegExp(sourceDoc.sourceId));
    assert.match(requestPrompts.get('concept_graph')!.user, /The leaf uses light to build sugar\./);
    assert.match(requestPrompts.get('teaching_plan')!.user, /leaf: Leaf/);
    assert.match(requestPrompts.get('teaching_plan')!.user, new RegExp(sourceSpan.id));
    assert.match(requestPrompts.get('scene_narration')!.user, /CONCEPT GRAPH|SOURCE \(facts must come from these source spans/);
    assert.match(requestPrompts.get('scene_narration')!.system, /MENTION MARKERS/);
    assert.deepEqual(cold.failures, []);
    assert.deepEqual(cold.plan?.lessonBible?.terminology.map((t) => t.conceptId).sort(), ['leaf', 'sugar'], 'single-use model-declared terminology must survive validation, not be stripped');
    assert.ok(cold.graph && cold.plan && cold.script);
    assert.equal(cold.usage.calls, 3);
    assert.deepEqual(cold.plan.sections[0]?.contract?.evidenceSpanIds, [sourceSpan.id]);
    assert.ok(cold.graph.concepts.every((concept) => concept.evidence[0]?.sourceId === sourceDoc.sourceId));
    assert.equal(cold.script.scenes[0]?.sectionId, 'build_sugar');
    const coldSceneRun = cold.stageRuns.find((stage) => stage.stage === 'S4-narration-script:build_sugar');
    assert.ok(coldSceneRun?.startedAt && coldSceneRun.completedAt, 'scene API call records its wall-clock interval');
    assert.equal(coldSceneRun?.apiCostUsd, 0.001, 'per-scene provider spend is retained');

    const warm = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 15 }, {
      model: 'test/structured-contract', apiKey: 'test-only', budgetUsd: 0.03,
      artifactStore: new ContentAddressedArtifactStore(root, 'warm'),
      fetcher: async () => { throw new Error('cache hit must not call the provider'); },
    });
    assert.deepEqual(warm.failures, []);
    assert.deepEqual(warm.cacheHits, ['S2-concepts', 'S3-teaching-plan', 'S4-narration-script']);
    assert.equal(warm.usage.calls, 0);
    assert.equal(warm.script?.scenes[0]?.text, script.text);
    const warmSceneRun = warm.stageRuns.find((stage) => stage.stage === 'S4-narration-script:build_sugar');
    assert.equal(warmSceneRun?.cacheHit, true);
    assert.equal(warmSceneRun?.apiCostUsd, 0);
    assert.equal(warmSceneRun?.artifactApiCostUsd, 0.001, 'cached scene records distinguish current spend from original artifact spend');
    assert.equal(warmSceneRun?.durationMs, 0);

    const relationOmittingPlan = structuredClone(plan);
    relationOmittingPlan.sections[0]!.contract!.requiredRelations = [];
    payloads.teaching_plan = relationOmittingPlan;
    received.length = 0;
    const rejected = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 15 }, {
      model: 'test/structured-contract', apiKey: 'test-only', budgetUsd: 0.03,
      artifactStore: new ContentAddressedArtifactStore(join(root, 'relation-omission'), 'cold'), fetcher: fakeProvider,
    });
    assert.deepEqual(received, ['concept_graph', 'teaching_plan', 'teaching_plan'], 'S3 gets one repair but never proceeds to S4');
    assert.equal(rejected.script, undefined);
    assert.ok(rejected.failures.some((failure) => failure.hard && /omits source relation leaf\|produces\|sugar/.test(failure.message)));
    assert.equal(rejected.stageRuns.find((stage) => stage.stage === 'S3-teaching-plan')?.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('S3 rejects a model plan that omits a SceneContract, after exactly one repair', async () => {
  const sourceDoc = sourceDocFromText('# Light and leaves\n\nThe leaf uses light to build sugar.', 'text');
  const sourceSpan = sourceDoc.spans.find((span) => span.kind === 'paragraph')!;
  const evidence = [{ spanId: sourceSpan.id, quote: 'The leaf uses light to build sugar.' }];
  const graph = {
    concepts: [
      { id: 'leaf', label: 'Leaf', kind: 'entity', definition: 'The leaf uses light to build sugar.', evidence, level: 'one-step' },
      { id: 'sugar', label: 'Sugar', kind: 'entity', definition: 'Sugar is built by the leaf using light.', evidence, level: 'one-step' },
    ],
    relations: [{ from: 'leaf', to: 'sugar', type: 'produces', evidence }],
    prerequisites: [],
  };
  const planMissingContract = {
    targetDurationSec: 15,
    intro: { sourceTitle: 'Light and leaves', sections: ['Building sugar'] },
    lessonBible: { audience: 'general learner', domain: 'biology', terminology: [{ conceptId: 'leaf', label: 'Leaf' }, { conceptId: 'sugar', label: 'Sugar' }], persistentConceptIds: [] },
    sections: [{ id: 'build_sugar', title: 'Building sugar', goal: 'Explain how leaves build sugar', kind: 'explain', conceptIds: ['leaf', 'sugar'], budgetSec: 15 }],
    recap: { keyPoints: ['Leaves use light to build sugar'] },
  };
  const payloads: Record<string, unknown> = { concept_graph: graph, teaching_plan: planMissingContract };
  const received: string[] = [];
  const fakeProvider: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } } };
    const name = request.response_format?.json_schema?.name;
    assert.ok(name && payloads[name], `unexpected structured stage ${name}`);
    received.push(name);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payloads[name]) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 80, completion_tokens: 30, cost: 0.001 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const root = await mkdtemp(join(tmpdir(), 'hyp-source-prep-missing-contract-'));
  try {
    const rejected = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 15 }, {
      model: 'test/structured-contract', apiKey: 'test-only', budgetUsd: 0.03,
      artifactStore: new ContentAddressedArtifactStore(root, 'cold'), fetcher: fakeProvider,
    });
    assert.deepEqual(received, ['concept_graph', 'teaching_plan', 'teaching_plan'], 'S3 gets exactly one repair but never proceeds to S4');
    assert.equal(rejected.script, undefined);
    assert.ok(rejected.failures.some((failure) => failure.hard && /lacks a SceneContract/.test(failure.message)));
    assert.equal(rejected.stageRuns.find((stage) => stage.stage === 'S3-teaching-plan')?.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('S3 rejects a model plan that invents an unsupported relation, after exactly one repair', async () => {
  const sourceDoc = sourceDocFromText('# Light and leaves\n\nThe leaf uses light to build sugar.', 'text');
  const sourceSpan = sourceDoc.spans.find((span) => span.kind === 'paragraph')!;
  const evidence = [{ spanId: sourceSpan.id, quote: 'The leaf uses light to build sugar.' }];
  const graph = {
    concepts: [
      { id: 'leaf', label: 'Leaf', kind: 'entity', definition: 'The leaf uses light to build sugar.', evidence, level: 'one-step' },
      { id: 'sugar', label: 'Sugar', kind: 'entity', definition: 'Sugar is built by the leaf using light.', evidence, level: 'one-step' },
    ],
    relations: [{ from: 'leaf', to: 'sugar', type: 'produces', evidence }],
    prerequisites: [],
  };
  const planUnsupportedRelation = {
    targetDurationSec: 15,
    intro: { sourceTitle: 'Light and leaves', sections: ['Building sugar'] },
    lessonBible: { audience: 'general learner', domain: 'biology', terminology: [{ conceptId: 'leaf', label: 'Leaf' }, { conceptId: 'sugar', label: 'Sugar' }], persistentConceptIds: [] },
    sections: [{
      id: 'build_sugar', title: 'Building sugar', goal: 'Explain how leaves build sugar', kind: 'explain', conceptIds: ['leaf', 'sugar'], budgetSec: 15,
      contract: {
        // "contains" is a valid RELATION_TYPES enum value, but the graph only declares "produces"
        // between leaf and sugar: this relation is not grounded in the graph and must be rejected.
        learningDelta: 'Explain how leaves build sugar', targetDurationSec: 15, requiredConceptIds: ['leaf', 'sugar'],
        requiredRelations: [{ from: 'leaf', to: 'sugar', type: 'contains' }], evidenceSpanIds: [sourceSpan.id],
        teachingSkill: 'mechanism', candidateMechanisms: ['chain'],
      },
    }],
    recap: { keyPoints: ['Leaves use light to build sugar'] },
  };
  const payloads: Record<string, unknown> = { concept_graph: graph, teaching_plan: planUnsupportedRelation };
  const received: string[] = [];
  const fakeProvider: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } } };
    const name = request.response_format?.json_schema?.name;
    assert.ok(name && payloads[name], `unexpected structured stage ${name}`);
    received.push(name);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payloads[name]) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 80, completion_tokens: 30, cost: 0.001 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const root = await mkdtemp(join(tmpdir(), 'hyp-source-prep-unsupported-relation-'));
  try {
    const rejected = await prepareLesson({ source: sourceDoc.text, sourceDoc, targetDurationSec: 15 }, {
      model: 'test/structured-contract', apiKey: 'test-only', budgetUsd: 0.03,
      artifactStore: new ContentAddressedArtifactStore(root, 'cold'), fetcher: fakeProvider,
    });
    assert.deepEqual(received, ['concept_graph', 'teaching_plan', 'teaching_plan'], 'S3 gets exactly one repair but never proceeds to S4');
    assert.equal(rejected.script, undefined);
    assert.ok(rejected.failures.some((failure) => failure.hard && /has unsupported relation leaf\|contains\|sugar/.test(failure.message)));
    assert.equal(rejected.stageRuns.find((stage) => stage.stage === 'S3-teaching-plan')?.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTeachingPlan, S3_MAX_REPAIRS } from '../plan/stages.js';
import { resolveSourceEvidence, sourceDocFromText } from '../plan/sourceDoc.js';
import type { ConceptGraph, TeachingPlan } from '../plan/schemas.js';

const okBody = (content: string) =>
  JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 50, completion_tokens: 50, cost: 0.001 },
  });

/** Domain-neutral two-concept graph with one relation; generic labels only. */
const fixture = () => {
  const sourceDoc = sourceDocFromText(
    '# Test source\n\nFirst idea states the core claim clearly.\n\nSecond idea builds on the first claim directly.\n\nThe link between them is stated here plainly.',
    'text',
  );
  const paras = sourceDoc.spans.filter((candidate) => candidate.kind === 'paragraph')!;
  const ev1 = resolveSourceEvidence(sourceDoc, paras[0]!.id, 'First idea states the core claim clearly.')!;
  const ev2 = resolveSourceEvidence(sourceDoc, paras[1]!.id, 'Second idea builds on the first claim directly.')!;
  const evR = resolveSourceEvidence(sourceDoc, paras[2]!.id, 'The link between them is stated here plainly.')!;
  const graph: ConceptGraph = {
    concepts: [
      { id: 'c1', label: 'Idea One', kind: 'entity', definition: 'First idea states the core claim.', level: 'one-step', evidence: [ev1] },
      { id: 'c2', label: 'Idea Two', kind: 'entity', definition: 'Second idea builds on the first.', level: 'one-step', evidence: [ev2] },
    ],
    relations: [{ from: 'c1', to: 'c2', type: 'causes', evidence: [evR] }],
    prerequisites: [],
  };
  const section = (
    id: string,
    kind: 'explain' | 'recap',
    conceptIds: string[],
    evidenceSpanIds: string[],
    withRelation: boolean,
  ): TeachingPlan['sections'][number] => {
    const goal = `Goal for ${id} section`;
    return {
      id, title: `Title ${id}`, goal, kind, conceptIds: [...conceptIds], budgetSec: 20,
      contract: {
        learningDelta: goal, targetDurationSec: 20, requiredConceptIds: [...conceptIds],
        requiredRelations: withRelation ? [{ from: 'c1', to: 'c2', type: 'causes' as const }] : [],
        evidenceSpanIds: [...evidenceSpanIds], teachingSkill: 'mechanism', candidateMechanisms: ['chain'],
      },
    };
  };
  const valid: TeachingPlan = {
    targetDurationSec: 60,
    intro: { sourceTitle: 'Test source', sections: ['Part one'] },
    lessonBible: {
      audience: 'general learner',
      terminology: [
        { conceptId: 'c1', label: 'Idea One' },
        { conceptId: 'c2', label: 'Idea Two' },
      ],
      persistentConceptIds: ['c1', 'c2'],
    },
    sections: [
      section('sec_1', 'explain', ['c1'], [ev1.spanId], false),
      section('sec_2', 'explain', ['c2'], [ev2.spanId], false),
      section('sec_3', 'recap', ['c1', 'c2'], [ev1.spanId, ev2.spanId, evR.spanId], true),
    ],
    recap: { keyPoints: ['Key point one'] },
  };
  return { sourceDoc, graph, valid, spanIds: { ev1: ev1.spanId, ev2: ev2.spanId, evR: evR.spanId } };
};



test('S3 uses exactly two phased repairs', () => {
  assert.equal(S3_MAX_REPAIRS, 2);
});

test('S3 two-defect plan (bad enum + omitted span) passes after two phased repairs', async () => {
  const { sourceDoc, graph, valid, spanIds } = fixture();
  const badEnum = structuredClone(valid);
  (badEnum.sections[2] as unknown as Record<string, unknown>).kind = 'lecture';
  const missingSpan = structuredClone(valid);
  missingSpan.sections[2]!.contract!.evidenceSpanIds = [spanIds.ev1, spanIds.ev2];
  const bodies: unknown[] = [badEnum, missingSpan, valid];
  const users: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String((init as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    users.push(request.messages[1]!.content);
    return new Response(okBody(JSON.stringify(bodies.shift())), { status: 200 });
  };
  const result = await buildTeachingPlan(
    { source: sourceDoc.text, sourceDoc, targetDurationSec: 60 },
    graph,
    { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher },
  );
  assert.ok(result.value, JSON.stringify(result.failures));
  assert.equal(result.usage.repairs, 2);
  assert.equal(users.length, 3, 'initial attempt plus exactly two repairs');
  assert.match(users[1]!, /Phase 1\/2 — schema and enum validity/);
  assert.match(users[2]!, /Phase 2\/2 — contract and span coverage/);
  assert.deepEqual(result.value!.sections[2]!.contract!.evidenceSpanIds.sort(), [spanIds.ev1, spanIds.ev2, spanIds.evR].sort());
});

test('S3 fails honestly after two repairs when the defect is truly unfixable', async () => {
  const { sourceDoc, graph, valid } = fixture();
  const badEnum = structuredClone(valid);
  (badEnum.sections[2] as unknown as Record<string, unknown>).kind = 'lecture';
  const bodies: unknown[] = [badEnum, badEnum, badEnum];
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(okBody(JSON.stringify(bodies.shift())), { status: 200 });
  };
  const result = await buildTeachingPlan(
    { source: sourceDoc.text, sourceDoc, targetDurationSec: 60 },
    graph,
    { model: 'test/model', apiKey: 'test-only', remainingBudgetUsd: 0.05, fetcher },
  );
  assert.equal(result.value, undefined);
  assert.equal(result.usage.repairs, 2);
  assert.equal(calls, 3, 'initial attempt plus exactly two repairs, then an honest failure');
  assert.ok(result.failures.some((failure) => failure.hard && failure.code === 'plan-repair-failed'));
});

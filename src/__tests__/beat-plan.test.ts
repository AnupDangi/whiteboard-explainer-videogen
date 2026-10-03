import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatPlanDraftSchema, BEAT_TYPES, REPRESENTATION_FAMILIES, type BeatPlanDraft } from '../teaching/beat-plan/types.js';
import { beatContextFor, beatCountRange, validateBeatPlan, type BeatContext } from '../teaching/beat-plan/validate.js';
import { compileBeatPlan, beatPlanMetrics } from '../teaching/beat-plan/compile.js';
import { buildBeatPrompt } from '../teaching/beat-plan/prompt.js';
import { planSceneBeats } from '../teaching/beat-plan/plan.js';
import type { ModelClient } from '../llm/modelClient.js';
import type { SceneContract, ConceptGraph } from '../plan/schemas.js';

const ctx: BeatContext = {
  sceneId: 'stack_scene',
  conceptIds: ['call', 'stack', 'frame'],
  claims: [
    { id: 'c1', statement: 'Each call adds a frame to the stack.', conceptIds: ['call', 'frame', 'stack'], relations: [{ from: 'call', to: 'frame', type: 'produces' }], evidenceSpanIds: ['s1'] },
    { id: 'c2', statement: 'Returning removes the top frame.', conceptIds: ['frame', 'stack'], relations: [], evidenceSpanIds: ['s2'] },
  ],
  relations: [{ from: 'call', to: 'frame', type: 'produces' }],
  misconceptionIds: ['m1'],
  durationSec: 20,
};

const beat = (over: Record<string, unknown> = {}) => ({
  claimIds: ['c1'], learnerDelta: 'The learner sees that a call creates a new frame.', beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model',
  entities: [{ conceptId: 'frame', role: 'new item', count: 1 }], relationships: [{ from: 'call', to: 'frame', type: 'produces' }],
  stateBefore: { description: 'The stack is empty.' }, stateAfter: { description: 'One frame sits on the stack.', quantities: [{ label: 'frames', value: 1 }] },
  misconceptionIds: [], narrationGoal: 'Say that each call pushes a frame.', visualInvariant: 'A frame is visible on the stack.', mutedMeaning: 'Calling something puts a box on a pile.',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'micro', ...over,
});
const draft = (beats: unknown[]): BeatPlanDraft => BeatPlanDraftSchema.parse({ beats });

test('the beat schema is strict: unknown enum values and extra keys are rejected, not coerced', () => {
  assert.ok(BEAT_TYPES.includes('counterexample'));
  assert.ok(REPRESENTATION_FAMILIES.includes('feedback_loop'));
  assert.equal(BeatPlanDraftSchema.safeParse({ beats: [beat({ beatType: 'wow' })] }).success, false);
  assert.equal(BeatPlanDraftSchema.safeParse({ beats: [beat({ extra: 1 })] }).success, false);
  assert.equal(BeatPlanDraftSchema.safeParse({ beats: [] }).success, false);
  assert.equal(BeatPlanDraftSchema.safeParse({ beats: [beat()] }).success, true);
});

test('a complete plan that covers every claim is valid', () => {
  assert.deepEqual(validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], beatType: 'transform', cognitiveOperation: 'transform', learnerDelta: 'The learner sees returning remove the top frame.' })]), ctx), []);
});

test('problems carry JSON pointers so a repair patches only the failing location', () => {
  const problems = validateBeatPlan(draft([
    beat({ claimIds: ['c1', 'ghost'], entities: [{ conceptId: 'nope' }], relationships: [{ from: 'frame', to: 'call', type: 'produces' }], misconceptionIds: ['m9'], mutedMeaning: '  ', visualInvariant: '' }),
  ]), ctx);
  const byPath = Object.fromEntries(problems.map((p) => [(p as { path: string }).path, (p as { message: string }).message]));
  assert.match(byPath['/beats/0/claimIds/1']!, /unknown claim/);
  assert.match(byPath['/beats/0/entities/0/conceptId']!, /not a concept of this scene/);
  assert.match(byPath['/beats/0/relationships/0']!, /not backed by the concept graph/);
  assert.match(byPath['/beats/0/misconceptionIds/0']!, /unknown misconception/);
  assert.match(byPath['/beats/0/mutedMeaning']!, /muted/);
  assert.match(byPath['/beats/0/visualInvariant']!, /visualInvariant/);
  assert.match(byPath['/beats']!, /claim c2 is not covered/);
  assert.ok(problems.every((p) => typeof p !== 'string'));
});

test('a narration-only beat may omit its muted meaning, a visual beat may not', () => {
  const base = [beat(), beat({ claimIds: ['c2'], narrationOnly: true, mutedMeaning: '' })];
  assert.deepEqual(validateBeatPlan(draft(base), ctx), []);
  const visual = [beat(), beat({ claimIds: ['c2'], narrationOnly: false, mutedMeaning: '' })];
  assert.ok(validateBeatPlan(draft(visual), ctx).some((p) => (p as { path: string }).path === '/beats/1/mutedMeaning'));
});

test('beat count follows scene duration and stays bounded', () => {
  assert.deepEqual(beatCountRange(10), { min: 1, max: 2 });
  assert.deepEqual(beatCountRange(20), { min: 2, max: 4 });
  assert.deepEqual(beatCountRange(60), { min: 6, max: 8 });
  const many = Array.from({ length: 9 }, () => beat());
  assert.equal(BeatPlanDraftSchema.safeParse({ beats: many }).success, false);
  const tooFew = validateBeatPlan(draft([beat({ claimIds: ['c1'] }), beat({ claimIds: ['c2'] })]), { ...ctx, durationSec: 60 });
  assert.ok(tooFew.some((p) => /at least 6 beats/.test((p as { message: string }).message)));
});

test('compile assigns stable beat ids in order and derives evidence spans from the claims, never from the model', () => {
  const beats = compileBeatPlan(draft([beat(), beat({ claimIds: ['c2'] }), beat({ claimIds: ['c1', 'c2'] })]), ctx);
  assert.deepEqual(beats.map((b) => b.beatId), ['stack_scene.b1', 'stack_scene.b2', 'stack_scene.b3']);
  assert.deepEqual(beats.map((b) => b.order), [1, 2, 3]);
  assert.deepEqual(beats[0]!.evidenceSpanIds, ['s1']);
  assert.deepEqual(beats[2]!.evidenceSpanIds, ['s1', 's2']);
  assert.ok(beats.every((b) => b.sceneId === 'stack_scene'));
});

test('exit metrics: every claim covered, every beat has delta, family, invariant, muted meaning on visual beats, no dangling ids', () => {
  const beats = compileBeatPlan(draft([beat(), beat({ claimIds: ['c2'] })]), ctx);
  assert.deepEqual(beatPlanMetrics([{ ctx, beats }]), { majorClaims: 2, claimsCovered: 2, beats: 2, beatsWithLearnerDelta: 2, beatsWithFamily: 2, beatsWithInvariant: 2, visualBeats: 2, visualBeatsWithMutedMeaning: 2, danglingClaimIds: 0, unsupportedEvidenceIds: 0 });
  const dangling = beatPlanMetrics([{ ctx, beats: [{ ...beats[0]!, claimIds: ['ghost'] }] }]);
  assert.equal(dangling.danglingClaimIds, 1);
  assert.equal(dangling.claimsCovered, 0);
});

test('the prompt states the scene contract, claim ids, misconception ids and the beat budget without any topic knowledge', () => {
  const { system, user } = buildBeatPrompt(ctx, { title: 'Stack scene', goal: 'Show push and pop.', learningDelta: 'Calls push, returns pop.', mentalModel: 'A pile of plates.', misconceptionRisk: ['A return keeps the frame.'], priorKnowledge: [] }, [{ id: 'call', label: 'Call', kind: 'event', definition: 'x' }, { id: 'stack', label: 'Stack', kind: 'entity', definition: 'x' }, { id: 'frame', label: 'Frame', kind: 'entity', definition: 'x' }]);
  assert.match(system, /beat/i);
  assert.match(user, /c1/);
  assert.match(user, /m1/);
  assert.match(user, /2-5 beats/);
  assert.match(user, /Calls push, returns pop\./);
});

const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0, costUsd: 0.0002 };
const scripted = (replies: string[]): { client: ModelClient; requests: Array<{ schemaName: string; user: string }> } => {
  const requests: Array<{ schemaName: string; user: string }> = [];
  return { requests, client: { provider: 'fake', chat: async (r) => { requests.push({ schemaName: r.schemaName, user: r.user }); return { content: replies[requests.length - 1] ?? '{}', finishReason: 'stop', temperatureApplied: true, schemaConstrained: true, usage }; } } };
};
const section = { id: 'stack_scene', title: 'Stack scene', goal: 'Show push and pop.', kind: 'explain' as const, conceptIds: ['call', 'stack', 'frame'], budgetSec: 20 };
const contract = (): SceneContract => ({
  learningDelta: 'Calls push, returns pop.', targetDurationSec: 20, requiredConceptIds: ['call', 'stack', 'frame'], requiredRelations: [{ from: 'call', to: 'frame', type: 'produces' }], evidenceSpanIds: ['s1', 's2'],
  essentialClaims: ctx.claims.map((c) => ({ ...c })), teachingSkill: 'mechanism', candidateMechanisms: ['chain'], mentalModel: 'A pile of plates.', misconceptionRisk: ['A return keeps the frame.'],
} as unknown as SceneContract);
const graph = { concepts: [{ id: 'call', label: 'Call', kind: 'event', definition: 'x', evidence: [], level: 'one-step' }, { id: 'stack', label: 'Stack', kind: 'entity', definition: 'x', evidence: [], level: 'one-step' }, { id: 'frame', label: 'Frame', kind: 'entity', definition: 'x', evidence: [], level: 'one-step' }], relations: [{ from: 'call', to: 'frame', type: 'produces', evidence: [] }], prerequisites: [] } as unknown as ConceptGraph;

test('beatContextFor reads the scene contract and the concept graph, nothing else', () => {
  const built = beatContextFor({ ...section, contract: contract() } as never, graph);
  assert.deepEqual(built.conceptIds, ['call', 'stack', 'frame']);
  assert.deepEqual(built.misconceptionIds, ['m1']);
  assert.equal(built.durationSec, 20);
  assert.equal(built.claims.length, 2);
});

test('planSceneBeats returns compiled beats on a valid first response', async () => {
  const { client } = scripted([JSON.stringify({ beats: [beat(), beat({ claimIds: ['c2'] })] })]);
  const result = await planSceneBeats({ section: { ...section, contract: contract() } as never, graph }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.deepEqual(result.value?.map((b) => b.beatId), ['stack_scene.b1', 'stack_scene.b2']);
  assert.equal(result.reports[0]!.stage, 'beats');
  assert.equal(result.reports[0]!.firstTryValid, true);
});

test('an uncovered claim is repaired by a patch that adds the missing beat, not by regenerating the plan', async () => {
  const addBeat = { op: 'add', path: '/beats/1', valueJson: JSON.stringify(beat({ claimIds: ['c2'] })) };
  const { client, requests } = scripted([JSON.stringify({ beats: [beat()] }), JSON.stringify({ patches: [addBeat] })]);
  const result = await planSceneBeats({ section: { ...section, contract: contract() } as never, graph }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.equal(result.value?.length, 2);
  assert.equal(requests[1]!.schemaName, 'json_patch');
  assert.equal(result.trace.repairs[0]!.mode, 'patch');
});

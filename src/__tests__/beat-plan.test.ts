import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatPlanDraftSchema, BEAT_TYPES, REPRESENTATION_FAMILIES, semanticEntityId, type BeatPlanDraft } from '../teaching/beat-plan/types.js';
import { beatContextFor, beatCountRange, validateBeatPlan, type BeatContext } from '../teaching/beat-plan/validate.js';
import { compileBeatPlan, beatPlanMetrics } from '../teaching/beat-plan/compile.js';
import { buildBeatPrompt } from '../teaching/beat-plan/prompt.js';
import { REPRESENTATION_REGISTRY, representationSelectionProblems } from '../teaching/beat-plan/representationRegistry.js';
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
  claimIds: ['c1'], learnerDelta: 'The learner sees that a call creates a new frame.', learningQuestion: 'What does a call add to the stack?', learnerBefore: 'The learner knows the stack can hold frames.', learnerAfter: 'The learner knows a call adds one frame.', dependsOnOrders: [], beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'spatial_model',
  entities: [{ identityKey: 'frame_main', conceptId: 'frame', role: 'new item', count: 1 }], semanticRevealOrder: ['frame_main'], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'introduce', toState: 'One frame sits on the stack.' }], relationships: [{ from: 'call', to: 'frame', type: 'produces' }],
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

test('representation selection is topic-independent, registered, and checked against the beat operation', () => {
  assert.deepEqual(Object.keys(REPRESENTATION_REGISTRY).sort(), [...REPRESENTATION_FAMILIES].sort());
  assert.ok(Object.values(REPRESENTATION_REGISTRY).every((provider) => provider.suitableOperations.length > 0));
  assert.deepEqual(representationSelectionProblems({ learningQuestion: 'How does the state change?', cognitiveOperation: 'trace', representationFamily: 'state_transition' }), []);
  assert.deepEqual(representationSelectionProblems({ learningQuestion: 'How does the state change?', cognitiveOperation: 'trace', representationFamily: 'material_flow' }), []);
  const mismatch = validateBeatPlan(draft([beat({ representationFamily: 'literal_object' }), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] })]), ctx);
  assert.ok(mismatch.some((problem) => (problem as { path: string }).path === '/beats/0/representationFamily' && /literal_object is not registered for trace/.test((problem as { message: string }).message)));
  assert.ok(representationSelectionProblems({ learningQuestion: 'What changes?', cognitiveOperation: 'trace', representationFamily: 'topic_specific_board' }).some((message) => /unknown representation family/.test(message)));
  const prompt = buildBeatPrompt(ctx, { title: 'T', goal: 'G', learningDelta: 'D', misconceptionRisk: [], priorKnowledge: [] }, []);
  for (const [family, spec] of Object.entries(REPRESENTATION_REGISTRY)) assert.ok(prompt.user.includes(`- ${family}: ${spec.suitableOperations.join(', ')}`));
  assert.match(prompt.system, /entity.state within 80 characters/);
  assert.match(prompt.system, /omit an irrelevant retained entity instead of changing its conceptId/);

});

test('a complete plan that covers every claim is valid', () => {
  assert.deepEqual(validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }], beatType: 'transform', cognitiveOperation: 'transform', learnerDelta: 'The learner sees returning remove the top frame.' })]), ctx), []);
});

test('semantic events in multi-claim beats require explicit exact claim bindings', () => {
  const ambiguous = validateBeatPlan(draft([beat({ claimIds: ['c1', 'c2'] })]), ctx);
  assert.ok(ambiguous.some((problem) => /multi-claim beat must name the exact claim ids/u.test((problem as { message: string }).message)));

  const specificallyBound = beat({
    claimIds: ['c1', 'c2'],
    requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'introduce', claimIds: ['c1'], toState: 'One frame sits on the stack.' }],
  });
  const validProblems = validateBeatPlan(draft([specificallyBound]), ctx);
  assert.ok(!validProblems.some((problem) => /semantic change claim ids/u.test((problem as { message: string }).message)), validProblems.map((problem) => (problem as { message: string }).message).join('\n'));

  const outsideBeat = beat({
    claimIds: ['c2'], relationships: [],
    requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'introduce', claimIds: ['c1'], toState: 'One frame sits on the stack.' }],
  });
  const outsideProblems = validateBeatPlan(draft([outsideBeat]), ctx);
  assert.ok(outsideProblems.some((problem) => /semantic change claim c1 is not listed by this beat/u.test((problem as { message: string }).message)));
});

test('learner state transitions and persistent semantic entities resolve only to earlier stable beat ids', () => {
  const planned = draft([beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }], dependsOnOrders: [1] })]);
  assert.deepEqual(validateBeatPlan(planned, ctx), []);
  const compiled = compileBeatPlan(planned, ctx);
  assert.deepEqual(compiled[1]!.dependsOnBeatIds, ['stack_scene.b1']);
  assert.deepEqual(compiled[0]!.dependsOnBeatIds, []);
  assert.equal(compiled[0]!.entities[0]!.entityId, compiled[1]!.entities[0]!.entityId, 'the same identity key compiles to the same semantic id across beats');
  assert.match(compiled[0]!.entities[0]!.entityId, /^se_[0-9a-f]{24}$/u, 'the persisted id is deterministic and separate from model keys and renderer ids');
  assert.deepEqual(compiled[0]!.persistentEntityIds, compiled[1]!.persistentEntityIds);
  assert.deepEqual(compiled[0]!.semanticRevealOrder, [compiled[0]!.entities[0]!.entityId]);
  assert.equal(compiled[1]!.semanticRevealOrder.length, 0, 'an existing entity is not revealed a second time');
  assert.equal(compiled[1]!.requiredSemanticChanges[0]!.entityId, compiled[1]!.entities[0]!.entityId);
  assert.equal(beatPlanMetrics([{ ctx, beats: compiled }]).dependencyLinks, 1);
  assert.equal(beatPlanMetrics([{ ctx, beats: compiled }]).danglingDependencyIds, 0);

  const selfDependency = validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }], dependsOnOrders: [2] })]), ctx);
  assert.ok(selfDependency.some((problem) => /must reference an earlier beat order/.test((problem as { message: string }).message)));
  const repeatedDependency = validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }], dependsOnOrders: [1, 1] })]), ctx);
  assert.ok(repeatedDependency.some((problem) => /listed more than once/.test((problem as { message: string }).message)));
  const unchangedState = validateBeatPlan(draft([beat({ learnerAfter: 'The learner knows the stack can hold frames.' }), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] })]), ctx);
  assert.ok(unchangedState.some((problem) => /different from learnerBefore/.test((problem as { message: string }).message)));
  const nonQuestion = validateBeatPlan(draft([beat({ learningQuestion: 'A call adds a frame.' }), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] })]), ctx);
  assert.ok(nonQuestion.some((problem) => /phrased as a question/.test((problem as { message: string }).message)));
  const identityDrift = validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], entities: [{ identityKey: 'frame_main', conceptId: 'stack' }], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The stack is now empty.' }] })]), ctx);
  assert.ok(identityDrift.some((problem) => /persistent identity frame_main changes concept/u.test((problem as { message: string }).message)));
  const missingReveal = validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], entities: [{ identityKey: 'top_frame', conceptId: 'frame' }], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'top_frame', kind: 'introduce', toState: 'The top frame is visible.' }] })]), ctx);
  assert.ok(missingReveal.some((problem) => /must appear in its first-reveal order/u.test((problem as { message: string }).message)));
  const stateChangeWithoutBefore = validateBeatPlan(draft([beat({ requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'move', toState: 'Frame is at the top.' }] })]), ctx);
  assert.ok(stateChangeWithoutBefore.some((problem) => /move requires a fromState/u.test((problem as { message: string }).message)));
});

test('a separate change reveals two or more new result entities in declared order', () => {
  const separated = beat({
    claimIds: ['c2'], relationships: [], beatType: 'transform', cognitiveOperation: 'transform', representationFamily: 'state_transition',
    entities: [
      { identityKey: 'frame_main', conceptId: 'frame', state: 'one frame' },
      { identityKey: 'daughter_left', conceptId: 'frame', state: 'daughter frame' },
      { identityKey: 'daughter_right', conceptId: 'frame', state: 'daughter frame' },
    ],
    semanticRevealOrder: ['daughter_left', 'daughter_right'],
    requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'separate', fromState: 'one frame', toState: 'two daughter frames' }],
    learnerDelta: 'The learner sees one frame become two daughter frames.',
    learnerBefore: 'The learner sees one frame.', learnerAfter: 'The learner sees two daughter frames.',
    visualInvariant: 'Two distinct daughter frames are visible.', mutedMeaning: 'One frame became two frames.',
  });
  const planned = draft([beat(), separated]);
  assert.deepEqual(validateBeatPlan(planned, ctx), []);
  const compiled = compileBeatPlan(planned, ctx);
  assert.deepEqual(compiled[1]!.semanticRevealOrder, [
    semanticEntityId('daughter_left', ctx.sceneId), semanticEntityId('daughter_right', ctx.sceneId),
  ]);
  assert.equal(compiled[1]!.requiredSemanticChanges[0]!.entityId, compiled[0]!.entities[0]!.entityId);

  const oneResult = validateBeatPlan(draft([beat(), { ...separated, entities: separated.entities.slice(0, 2), semanticRevealOrder: ['daughter_left'] }]), ctx);
  assert.ok(oneResult.some((problem) => /needs 2 through 6 newly revealed result entities/.test((problem as { message: string }).message)));
});

test('a merge names active source identities explicitly and compiles them to stable entity ids', () => {
  const mergeContext: BeatContext = {
    sceneId: 'merge_scene', conceptIds: ['frame', 'stack'],
    claims: [{ id: 'merge_claim', statement: 'A frame and stack join into one structure.', conceptIds: ['frame', 'stack'], relations: [], evidenceSpanIds: ['s1'] }],
    relations: [], misconceptionIds: [], durationSec: 8,
  };
  const inputBeat = beat({
    claimIds: ['merge_claim'], beatType: 'introduce', cognitiveOperation: 'transform', representationFamily: 'state_transition',
    entities: [{ identityKey: 'left_part', conceptId: 'frame' }, { identityKey: 'right_part', conceptId: 'stack' }],
    semanticRevealOrder: ['left_part', 'right_part'],
    requiredSemanticChanges: [
      { identityKey: 'left_part', kind: 'introduce', toState: 'left part' },
      { identityKey: 'right_part', kind: 'introduce', toState: 'right part' },
    ], relationships: [], visualInvariant: 'Both parts are visible.', mutedMeaning: 'Two parts are visible.',
  });
  const mergeBeat = beat({
    claimIds: ['merge_claim'], beatType: 'transform', cognitiveOperation: 'transform', representationFamily: 'state_transition',
    entities: [
      { identityKey: 'left_part', conceptId: 'frame', state: 'left part' },
      { identityKey: 'right_part', conceptId: 'stack', state: 'right part' },
      { identityKey: 'combined', conceptId: 'frame', state: 'one combined structure' },
    ],
    semanticRevealOrder: ['combined'],
    requiredSemanticChanges: [{
      identityKey: 'combined', kind: 'merge', mergeInputIdentityKeys: ['left_part', 'right_part'],
      toState: 'one combined structure',
    }], relationships: [], visualInvariant: 'One combined structure is visible.', mutedMeaning: 'The two parts joined.',
  });
  const planned = draft([inputBeat, mergeBeat]);
  assert.deepEqual(validateBeatPlan(planned, mergeContext), []);
  const compiled = compileBeatPlan(planned, mergeContext);
  assert.deepEqual(compiled[1]!.requiredSemanticChanges[0]!.mergeInputEntityIds, [
    semanticEntityId('left_part', mergeContext.sceneId), semanticEntityId('right_part', mergeContext.sceneId),
  ]);

  // Inputs introduced and then transformed earlier in this beat are active at merge time.
  const sameBeat = beat({
    ...mergeBeat,
    entities: mergeBeat.entities.map((entity) => entity.identityKey === 'left_part' ? { ...entity, state: 'ready left part' } : entity),
    semanticRevealOrder: ['left_part', 'right_part', 'combined'],
    requiredSemanticChanges: [
      ...inputBeat.requiredSemanticChanges,
      { identityKey: 'left_part', kind: 'transform', fromState: 'left part', toState: 'ready left part' },
      ...mergeBeat.requiredSemanticChanges,
    ],
  });
  assert.deepEqual(validateBeatPlan(draft([sameBeat]), mergeContext), []);
  const staleInput = { ...sameBeat, entities: mergeBeat.entities };
  assert.ok(validateBeatPlan(draft([staleInput]), mergeContext).some((problem) => /state must match its current semantic state/.test((problem as { message: string }).message)));
  const mergePrompt = buildBeatPrompt(mergeContext, { title: 'Join parts', goal: 'Explain joining', learningDelta: 'Understand joining', misconceptionRisk: [], priorKnowledge: [] }, []);
  assert.match(mergePrompt.system, /Omit fromState on a merge/);
  assert.doesNotMatch(mergePrompt.system, /separation, merge, quantity/);

  const undeclaredInput = draft([inputBeat, beat({
    ...mergeBeat, requiredSemanticChanges: [{ ...mergeBeat.requiredSemanticChanges[0]!, mergeInputIdentityKeys: ['left_part', 'unknown_part'] }],
    entities: [...mergeBeat.entities, { identityKey: 'unknown_part', conceptId: 'frame' }],
  })]);
  const problems = validateBeatPlan(undeclaredInput, mergeContext);
  assert.ok(problems.some((problem) => /merge input unknown_part must be active before this event/.test((problem as { message: string }).message)));
});

test('problems carry JSON pointers so a repair patches only the failing location', () => {
  const problems = validateBeatPlan(draft([
    beat({ claimIds: ['c1', 'ghost'], entities: [{ identityKey: 'unknown_main', conceptId: 'nope' }], semanticRevealOrder: ['unknown_main'], requiredSemanticChanges: [{ identityKey: 'unknown_main', kind: 'introduce', toState: 'Unknown entity appears.' }], relationships: [{ from: 'frame', to: 'call', type: 'produces' }], misconceptionIds: ['m9'], mutedMeaning: '  ', visualInvariant: '' }),
  ]), ctx);
  const byPath = Object.fromEntries(problems.map((p) => [(p as { path: string }).path, (p as { message: string }).message]));
  assert.match(byPath['/beats/0/claimIds/1']!, /unknown claim/);
  assert.match(byPath['/beats/0/entities/0/conceptId']!, /not a concept of this scene/);
  assert.match(byPath['/beats/0/relationships/0']!, /not asserted by any cited claim/);
  assert.match(byPath['/beats/0/misconceptionIds/0']!, /unknown misconception/);
  assert.match(byPath['/beats/0/mutedMeaning']!, /muted/);
  assert.match(byPath['/beats/0/visualInvariant']!, /visualInvariant/);
  assert.match(byPath['/beats']!, /claim c2 is not covered/);
  assert.ok(problems.every((p) => typeof p !== 'string'));
});

test('entities must be linked to a claim cited by the same beat, even when they are known scene concepts', () => {
  const problems = validateBeatPlan(draft([
    beat({ claimIds: ['c2'], entities: [{ identityKey: 'call_main', conceptId: 'call' }], semanticRevealOrder: ['call_main'], requiredSemanticChanges: [{ identityKey: 'call_main', kind: 'introduce', toState: 'A call appears.' }], relationships: [] }),
    beat({ claimIds: ['c1'], relationships: [] }),
  ]), ctx);
  const issue = problems.find((p) => (p as { path: string }).path === '/beats/0/entities/0/conceptId') as { path: string; message: string } | undefined;
  assert.ok(issue);
  assert.match(issue.message, /not linked to any cited claim/);
  assert.match(issue.message, /c2/);
});

test('relationships must match a directed relation on a claim cited by that beat', () => {
  const otherClaimRelation = { from: 'frame', to: 'stack', type: 'contains' } as const;
  const linkedContext: BeatContext = {
    ...ctx,
    claims: [
      ctx.claims[0]!,
      { ...ctx.claims[1]!, relations: [otherClaimRelation] },
    ],
    relations: [...ctx.relations, otherClaimRelation],
  };
  const problems = validateBeatPlan(draft([
    beat({ relationships: [{ from: 'frame', to: 'call', type: 'produces' }] }),
    beat({ claimIds: ['c1'], relationships: [otherClaimRelation] }),
  ]), linkedContext);
  const byPath = Object.fromEntries(problems.map((p) => [(p as { path: string }).path, (p as { message: string }).message]));
  assert.match(byPath['/beats/0/relationships/0']!, /not asserted by any cited claim/);
  assert.match(byPath['/beats/1/relationships/0']!, /not asserted by any cited claim/);
  assert.match(byPath['/beats/1/relationships/0']!, /c1/);
});

test('a narration-only beat may omit its muted meaning, a visual beat may not', () => {
  const base = [beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [], narrationOnly: true, mutedMeaning: '' })];
  assert.deepEqual(validateBeatPlan(draft(base), ctx), []);
  const visual = [beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }], narrationOnly: false, mutedMeaning: '' })];
  assert.ok(validateBeatPlan(draft(visual), ctx).some((p) => (p as { path: string }).path === '/beats/1/mutedMeaning'));
});

test('an unverified explanation is isolated in one narration-only beat', () => {
  const openClaim = {
    id: 'open', statement: 'One possible explanation is not verified by the supplied source.', conceptIds: ['frame'], relations: [], evidenceSpanIds: [],
    epistemicType: 'unverified_explanation' as const, verificationStatus: 'unverified' as const,
  };
  const openCtx: BeatContext = { ...ctx, claims: [...ctx.claims, openClaim] };
  const openBeat = beat({ claimIds: ['open'], entities: [], semanticRevealOrder: [], requiredSemanticChanges: [], relationships: [], narrationOnly: true, mutedMeaning: '' });
  assert.deepEqual(validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] }), openBeat]), openCtx), []);

  const mixed = validateBeatPlan(draft([beat({ claimIds: ['c1', 'open'] }), beat({ claimIds: ['c2'], relationships: [] })]), openCtx);
  assert.ok(mixed.some((problem) => /unverified explanation must be isolated/.test((problem as { message: string }).message)));
  const visual = validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] }), { ...openBeat, narrationOnly: false }]), openCtx);
  assert.ok(visual.some((problem) => /must be narration-only/.test((problem as { message: string }).message)));
  const depicted = validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] }), { ...openBeat, entities: [{ identityKey: 'frame_main', conceptId: 'frame' }] }]), openCtx);
  assert.ok(depicted.some((problem) => /cannot depict entities/.test((problem as { message: string }).message)));
  const repeated = validateBeatPlan(draft([beat(), beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] }), openBeat, openBeat]), openCtx);
  assert.ok(repeated.some((problem) => /exactly one isolated narration-only beat/.test((problem as { message: string }).message)));
});

test('beat count follows scene duration and stays bounded', () => {
  assert.deepEqual(beatCountRange(10), { min: 1, max: 2 });
  assert.deepEqual(beatCountRange(20), { min: 2, max: 5 });
  assert.deepEqual(beatCountRange(60), { min: 6, max: 8 });
  const many = Array.from({ length: 9 }, () => beat());
  assert.equal(BeatPlanDraftSchema.safeParse({ beats: many }).success, false);
  const tooFew = validateBeatPlan(draft([beat({ claimIds: ['c1'] }), beat({ claimIds: ['c2'], relationships: [] })]), { ...ctx, durationSec: 60 });
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

test('semantic entity ids are scoped to their independently planned scene', () => {
  const sceneOne = compileBeatPlan(draft([beat({ entities: [{ identityKey: 'main', conceptId: 'frame' }], semanticRevealOrder: ['main'], requiredSemanticChanges: [{ identityKey: 'main', kind: 'introduce', toState: 'A frame is visible.' }] })]), { ...ctx, sceneId: 'scene_one' });
  const sceneTwo = compileBeatPlan(draft([beat({ entities: [{ identityKey: 'main', conceptId: 'stack' }], semanticRevealOrder: ['main'], requiredSemanticChanges: [{ identityKey: 'main', kind: 'introduce', toState: 'A stack is visible.' }] })]), { ...ctx, sceneId: 'scene_two' });
  assert.equal(sceneOne[0]!.entities[0]!.identityKey, sceneTwo[0]!.entities[0]!.identityKey);
  assert.notEqual(sceneOne[0]!.entities[0]!.entityId, sceneTwo[0]!.entities[0]!.entityId);
  assert.equal(sceneOne[0]!.entities[0]!.entityId, semanticEntityId('main', 'scene_one'));
  assert.equal(sceneTwo[0]!.entities[0]!.entityId, semanticEntityId('main', 'scene_two'));
});

test('exit metrics: every claim covered, learner transitions and visual meaning complete, no dangling ids', () => {
  const beats = compileBeatPlan(draft([beat(), beat({ claimIds: ['c2'], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] })]), ctx);
  assert.deepEqual(beatPlanMetrics([{ ctx, beats }]), { majorClaims: 2, claimsCovered: 2, beats: 2, beatsWithLearningQuestion: 2, beatsWithLearnerStateTransition: 2, beatsWithSemanticEntities: 2, beatsWithRequiredSemanticChanges: 2, beatsWithRevealOrder: 1, persistentEntityReferences: 2, dependencyLinks: 0, danglingDependencyIds: 0, beatsWithLearnerDelta: 2, beatsWithFamily: 2, beatsWithInvariant: 2, visualBeats: 2, visualBeatsWithMutedMeaning: 2, danglingClaimIds: 0, unsupportedEvidenceIds: 0 });
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
  assert.match(system, /learningQuestion/);
  assert.match(system, /learnerBefore and learnerAfter/);
  assert.match(system, /dependsOnOrders/);
  assert.match(system, /learningQuestion for its cognitiveOperation/);
  assert.match(system, /Never branch on.*topic names, source names, case IDs, or benchmark labels/);
  assert.match(system, /separate change introduces its two to six newly revealed result entities/);
});

test('the beat prompt makes unverified explanations visibly isolated and non-visual', () => {
  const openClaim = { id: 'open', statement: 'One possible explanation is not verified by the supplied source.', conceptIds: ['frame'], relations: [], evidenceSpanIds: [], epistemicType: 'unverified_explanation' as const, verificationStatus: 'unverified' as const };
  const prompt = buildBeatPrompt({ ...ctx, claims: [...ctx.claims, openClaim] }, { title: 'Stack scene', goal: 'Explain.', learningDelta: 'A possibility.', misconceptionRisk: [], priorKnowledge: [] }, []);
  assert.match(prompt.system, /only claim on exactly one narrationOnly beat/i);
  assert.match(prompt.system, /must not become .* visual/i);
  assert.match(prompt.user, /unverified_explanation/);
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
  const secondBeat = beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] });
  const { client } = scripted([JSON.stringify({ beats: [beat(), secondBeat] })]);
  const result = await planSceneBeats({ section: { ...section, contract: contract() } as never, graph }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.deepEqual(result.value?.map((b) => b.beatId), ['stack_scene.b1', 'stack_scene.b2']);
  assert.equal(result.reports[0]!.stage, 'beats');
  assert.equal(result.reports[0]!.firstTryValid, true);
});

test('an uncovered claim is repaired by a patch that adds the missing beat, not by regenerating the plan', async () => {
  const addBeat = { op: 'add', path: '/beats/1', valueJson: JSON.stringify(beat({ claimIds: ['c2'], relationships: [], semanticRevealOrder: [], requiredSemanticChanges: [{ identityKey: 'frame_main', kind: 'transform', fromState: 'The frame is on top.', toState: 'The top frame has been removed.' }] })) };
  const { client, requests } = scripted([JSON.stringify({ beats: [beat()] }), JSON.stringify({ patches: [addBeat] })]);
  const result = await planSceneBeats({ section: { ...section, contract: contract() } as never, graph }, { model: 'google/x', apiKey: 'k', remainingBudgetUsd: 1, client });
  assert.equal(result.value?.length, 2);
  assert.equal(requests[1]!.schemaName, 'json_patch');
  assert.equal(result.trace.repairs[0]!.mode, 'patch');
});

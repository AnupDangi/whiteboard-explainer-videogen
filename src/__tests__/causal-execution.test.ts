import assert from 'node:assert/strict';
import test from 'node:test';
import { BeatPlanDraftSchema } from '../teaching/beat-plan/types.js';
import { compileBeatPlan } from '../teaching/beat-plan/compile.js';
import { validateBeatPlan, type BeatContext } from '../teaching/beat-plan/validate.js';
import { compileSceneNarration } from '../narration/beat-narration/compile.js';
import { SceneNarrationDraftSchema } from '../narration/beat-narration/types.js';
import { executeSemanticScene } from '../pipeline-v2/semanticExecution.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { BoardContext } from '../visual-v2/ops-plan/validate.js';

// This checks typed execution contracts only. It is not visual-quality evidence.
const sceneId = 'mixed_cause';
const claim = { id: 'cause_claim', statement: 'Alpha causes Beta.', conceptIds: ['alpha', 'beta'], relations: [{ from: 'alpha', to: 'beta', type: 'causes' as const }], evidenceSpanIds: ['source_span'] };
const unrelated = { id: 'context_claim', statement: 'Alpha and Beta are concepts.', conceptIds: ['alpha', 'beta'], relations: [], evidenceSpanIds: ['source_span'] };
const ctx: BeatContext = { sceneId, conceptIds: ['alpha', 'beta'], claims: [claim, unrelated], relations: [claim.relations[0]!], misconceptionIds: [], durationSec: 8 };

function plan(): ReturnType<typeof compileBeatPlan> {
  const draft = BeatPlanDraftSchema.parse({ beats: [
    {
      claimIds: ['cause_claim', 'context_claim'], learnerDelta: 'Alpha and Beta enter the board.', learningQuestion: 'Which entities appear first?', learnerBefore: 'Neither entity is visible.', learnerAfter: 'Alpha and Beta are visible.', dependsOnOrders: [], beatType: 'introduce', cognitiveOperation: 'trace', representationFamily: 'state_transition',
      entities: [{ identityKey: 'alpha', conceptId: 'alpha', state: 'active' }, { identityKey: 'beta', conceptId: 'beta', state: 'present' }], semanticRevealOrder: ['alpha', 'beta'],
      requiredSemanticChanges: [
        { identityKey: 'alpha', kind: 'introduce', claimIds: ['cause_claim'], toState: 'active' },
        { identityKey: 'beta', kind: 'introduce', claimIds: ['cause_claim'], toState: 'present' },
      ], relationships: [], misconceptionIds: [], narrationGoal: 'Reveal the two entities.', visualInvariant: 'Both entities remain visible.', mutedMeaning: 'Alpha and Beta are visible.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
    },
    {
      claimIds: ['cause_claim', 'context_claim'], learnerDelta: 'Alpha points to Beta as its effect.', learningQuestion: 'What does Alpha cause?', learnerBefore: 'The relation is unknown.', learnerAfter: 'Alpha causes Beta.', dependsOnOrders: [1], beatType: 'connect', cognitiveOperation: 'explain_cause', representationFamily: 'causal_chain',
      entities: [{ identityKey: 'alpha', conceptId: 'alpha', state: 'active' }, { identityKey: 'beta', conceptId: 'beta', state: 'present' }], semanticRevealOrder: [],
      requiredSemanticChanges: [{ identityKey: 'alpha', kind: 'cause', claimIds: ['cause_claim'], fromState: 'active', toState: 'the pinned cause relation is visible' }],
      relationships: [{ from: 'alpha', to: 'beta', type: 'causes' }], misconceptionIds: [], narrationGoal: 'Show the directed cause.', visualInvariant: 'Alpha points to Beta.', mutedMeaning: 'Alpha causes Beta.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
    },
  ] });
  return compileBeatPlan(draft, ctx);
}

test('beat validator binds a causal event to the exact claim asserting its directed edge', () => {
  const valid = BeatPlanDraftSchema.parse({ beats: [
    { claimIds: ['cause_claim'], learnerDelta: 'Both entities are visible.', learningQuestion: 'Which entities appear?', learnerBefore: 'Neither entity is visible.', learnerAfter: 'Alpha and Beta are visible.', dependsOnOrders: [], beatType: 'demonstrate', cognitiveOperation: 'trace', representationFamily: 'state_transition',
      entities: [{ identityKey: 'alpha', conceptId: 'alpha', state: 'active' }, { identityKey: 'beta', conceptId: 'beta', state: 'present' }], semanticRevealOrder: ['alpha', 'beta'],
      requiredSemanticChanges: [{ identityKey: 'alpha', kind: 'introduce', claimIds: ['cause_claim'], toState: 'active' }, { identityKey: 'beta', kind: 'introduce', claimIds: ['cause_claim'], toState: 'present' }], relationships: [], misconceptionIds: [], narrationGoal: 'Reveal both entities.', visualInvariant: 'Both remain visible.', mutedMeaning: 'Both are visible.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none' },
    { claimIds: ['cause_claim', 'context_claim'], learnerDelta: 'Alpha causes Beta.', learningQuestion: 'What does Alpha cause?', learnerBefore: 'The relation is unknown.', learnerAfter: 'Alpha causes Beta.', dependsOnOrders: [1], beatType: 'connect', cognitiveOperation: 'explain_cause', representationFamily: 'causal_chain',
      entities: [{ identityKey: 'alpha', conceptId: 'alpha', state: 'active' }, { identityKey: 'beta', conceptId: 'beta', state: 'present' }], semanticRevealOrder: [],
      requiredSemanticChanges: [{ identityKey: 'alpha', kind: 'cause', claimIds: ['cause_claim'], fromState: 'active', toState: 'the pinned cause relation is visible' }], relationships: [{ from: 'alpha', to: 'beta', type: 'causes' }], misconceptionIds: [], narrationGoal: 'Show why.', visualInvariant: 'Alpha points to Beta.', mutedMeaning: 'Alpha causes Beta.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none' },
  ] });
  assert.deepEqual(validateBeatPlan(valid, ctx), []);
  const wrongClaim = structuredClone(valid);
  wrongClaim.beats[1]!.requiredSemanticChanges[0]!.claimIds = ['context_claim'];
  assert.ok(validateBeatPlan(wrongClaim, ctx).some((problem) => typeof problem !== 'string' && /does not assert the cause event's exact directed relation/.test(problem.message)));
  const wrongSource = structuredClone(valid);
  wrongSource.beats[1]!.requiredSemanticChanges[0]!.identityKey = 'beta';
  const sourceProblem = validateBeatPlan(wrongSource, ctx).find((problem) => typeof problem !== 'string' && /exactly one outgoing causes relation/.test(problem.message));
  assert.equal(sourceProblem && typeof sourceProblem !== 'string' ? sourceProblem.path : undefined, '/beats/1/requiredSemanticChanges/0', 'a cause source/kind correction is limited to the one event record');
});

test('mixed state-transition and causal-chain beats dispatch and replay with per-beat provider identity', () => {
  const beats = plan();
  const narration = compileSceneNarration(sceneId, SceneNarrationDraftSchema.parse({ beats: [
    { beatId: beats[0]!.beatId, sentences: ['Alpha appears as an active entity.', 'Beta appears as a present entity.'], claimSentences: [{ claimId: 'cause_claim', sentenceIndex: 0 }],
      semanticAnchors: [{ semanticEventId: `${beats[0]!.beatId}.e1`, sentenceIndex: 0, phrase: 'Alpha appears' }, { semanticEventId: `${beats[0]!.beatId}.e2`, sentenceIndex: 1, phrase: 'Beta appears' }], emphasisTerms: [] },
    { beatId: beats[1]!.beatId, sentences: ['Alpha causes Beta.'], claimSentences: [{ claimId: 'cause_claim', sentenceIndex: 0 }],
      semanticAnchors: [{ semanticEventId: `${beats[1]!.beatId}.e1`, sentenceIndex: 0, phrase: 'Alpha causes Beta' }], emphasisTerms: [] },
  ] }), beats);
  const beatTimings = narration.beatSpans.map((span, index) => ({
    beatId: span.beatId, startMs: index * 3000, endMs: index * 3000 + 2900,
    sentences: span.sentenceSpans.map((sentence, sentenceIndex) => ({ startMs: index * 3000 + sentenceIndex * 1000, endMs: index * 3000 + (sentenceIndex + 1) * 1000 })),
    semanticAnchors: narration.semanticAnchors.filter((anchor) => anchor.beatId === span.beatId).map((anchor) => {
      const sentenceIndex = span.sentenceSpans.findIndex((sentence) => anchor.charStart >= sentence.charStart && anchor.charStart < sentence.charEnd);
      return { semanticEventId: anchor.semanticEventId, phrase: anchor.phrase, startMs: index * 3000 + sentenceIndex * 1000 + 10, endMs: index * 3000 + sentenceIndex * 1000 + 400 };
    }),
  }));
  const context: BoardContext = {
    sceneId, title: 'Causal test', beats, claims: [claim, unrelated],
    narration: narration.beatSpans.map((span) => ({ beatId: span.beatId, sentences: span.sentenceSpans.map((sentence) => narration.text.slice(sentence.charStart, sentence.charEnd)) })),
    concepts: [{ id: 'alpha', label: 'Alpha', kind: 'entity' }, { id: 'beta', label: 'Beta', kind: 'entity' }], initial: emptyBoardState(),
  };
  const result = executeSemanticScene({ context, narration, beatTimings });
  const error = result.status === 'failed' ? result.problems.join('\n') : '';
  assert.equal(result.status, 'compiled', error);
  if (result.status !== 'compiled') return;
  assert.equal(result.record.schemaVersion, 'v2-representation-execution/v5');
  assert.equal(result.record.providerVersion, undefined, 'mixed families do not claim one scene-wide provider version');
  assert.deepEqual(result.record.beats.map((beat) => [beat.family, beat.providerVersion, beat.providerSource]), [
    ['state_transition', 'state-transition/v4', 'family-fallback'], ['causal_chain', 'causal-chain/v1', 'family-fallback'],
  ]);
  assert.deepEqual(result.record.semanticOperations.map((operation) => operation.type), ['introduce', 'introduce', 'cause']);
  assert.ok(result.operations.some((operation) => operation.op === 'connect' && operation.relation === 'causes'));
});

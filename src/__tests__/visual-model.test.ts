import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileVisualModel } from '../visual-v2/intent/compile.js';
import { validateSceneBoard, type BoardContext } from '../visual-v2/ops-plan/validate.js';
import { buildBoardPrompt } from '../visual-v2/ops-plan/prompt.js';
import { SceneBoardDraftSchema, type SceneBoardDraft } from '../visual-v2/ops-plan/types.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';

/** T7 gates: models derive from beats+moves; mechanism treatment without state change fails; prompt honors treatment. */

const beat: TeachingBeat = {
  beatId: 'sc.b1', sceneId: 'sc', order: 1, claimIds: ['c1'], evidenceSpanIds: ['S1'],
  learnerDelta: 'Learner traces the push.', beatType: 'demonstrate', cognitiveOperation: 'trace',
  representationFamily: 'sequence', entities: [{ conceptId: 'frame', role: 'pushed' }], relationships: [{ from: 'frame', to: 'stack', type: 'contains' }],
  stateBefore: { description: 'Pile of one.' }, stateAfter: { description: 'Pile of two.' },
  misconceptionIds: [], narrationGoal: 'Show the push.', visualInvariant: 'Two frames piled.',
  mutedMeaning: 'The pile grows by one.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
};

const moves = [{ move: 'TraceMechanism' as const, note: 'Walk causes in order.' }];
const movesPlain = [{ move: 'RevealDefinition' as const, note: 'Define it.' }];

const ctx: BoardContext = {
  sceneId: 'sc', title: 'Stack scene', beats: [beat],
  narration: [{ beatId: 'sc.b1', sentences: ['Each call pushes a frame.'] }],
  concepts: [{ id: 'frame', label: 'Frame' }, { id: 'stack', label: 'Stack' }],
  initial: emptyBoardState(), moves,
};

const bindings = { conceptIds: ['frame'], claimIds: ['c1'] };
const addOnly = (): unknown => ({
  transition: { mode: 'clean' },
  ops: [
    { op: 'add', opId: 'o1', beatId: 'sc.b1', id: 'f1', element: { type: 'entity', conceptId: 'frame', label: 'frame', provenance: 'source', bindings }, at: { region: 'center' }, cue: 0 },
    { op: 'add', opId: 'o2', beatId: 'sc.b1', id: 's1', element: { type: 'entity', conceptId: 'stack', label: 'stack', provenance: 'source', bindings: { conceptIds: ['stack'], claimIds: ['c1'] } }, at: { region: 'right' }, cue: 0 },
  ],
});
const withChange = (): unknown => ({
  transition: { mode: 'clean' },
  ops: [
    ...(addOnly() as { ops: unknown[] }).ops,
    { op: 'move', opId: 'o3', beatId: 'sc.b1', target: 'f1', to: { region: 'right' }, cue: 0 },
  ],
});
const draft = (value: unknown): SceneBoardDraft => SceneBoardDraftSchema.parse(value);

describe('visual teaching model', () => {
  it('derives question, reveal order, states and moves from the beat', () => {
    const model = compileVisualModel(beat, moves);
    assert.equal(model.learningQuestion, 'Show the push.');
    assert.deepEqual(model.claimIds, ['c1']);
    assert.deepEqual(model.teachingMoves, ['TraceMechanism']);
    assert.deepEqual(model.semanticRevealOrder, ['frame', 'stack']);
    assert.equal(model.states.length, 2);
    assert.equal(model.visualInvariant, 'Two frames piled.');
  });
});

describe('mechanism treatment gate', () => {
  it('add-only board under TraceMechanism fails; with a state change it passes the gate', () => {
    const failures = validateSceneBoard(draft(addOnly()), ctx) as Array<{ path: string; message: string }>;
    assert.ok(failures.some((f) => /only adds or connects/.test(f.message)));
    const rest = validateSceneBoard(draft(withChange()), ctx) as Array<{ path: string; message: string }>;
    assert.ok(!rest.some((f) => /only adds or connects/.test(f.message)));
  });

  it('definition treatment never triggers the mechanism gate', () => {
    const failures = validateSceneBoard(draft(addOnly()), { ...ctx, moves: movesPlain }) as Array<{ path: string; message: string }>;
    assert.ok(!failures.some((f) => /only adds or connects/.test(f.message)));
  });

  it('the board prompt renders the treatment before the concepts', () => {
    const { user } = buildBoardPrompt(ctx);
    assert.match(user, /TraceMechanism/);
    assert.match(user, /never only add boxes and arrows/);
  });
});

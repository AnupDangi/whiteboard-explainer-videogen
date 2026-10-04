import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneBoard, type BoardContext } from '../visual-v2/ops-plan/validate.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import { emptyBoardState } from '../visual-v2/board-state/reducer.js';
import { SceneBoardDraftSchema } from '../visual-v2/ops-plan/types.js';
function SceneDraft(value: unknown) { return SceneBoardDraftSchema.parse(value); }

describe('error contrast reaches the board', () => {
  it('misconception beats carry their divergence into the board prompt', async () => {
    const { buildBoardPrompt } = await import('../visual-v2/ops-plan/prompt.js');
    const contrastBeat: TeachingBeat = {
      beatId: 'sc.b1', sceneId: 'sc', order: 1, claimIds: ['c1'], learnerDelta: 'd',
      beatType: 'contrast', cognitiveOperation: 'compare', representationFamily: 'comparison',
      entities: [{ conceptId: 'charge' }], relationships: [], misconceptionIds: ['m1'],
      narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm', narrationOnly: false,
      persistence: 'scene', pauseIntent: 'none', evidenceSpanIds: ['S1'],
      errorContrast: {
        misconceptionId: 'm1', problem: { problem: 'Which way?' },
        sharedPrefix: [{ step: 'Water spreads.' }],
        divergence: {
          decision: 'Which side gains?', wrongStep: { step: 'Salt pulls.' }, correctStep: { step: 'Crowding eases.' },
          whyWrongSeemsPlausible: 'Salt seems active.', violatedInvariant: 'Water follows its gradient.',
        },
        repair: { explanation: 'Track the water.', repairedStep: { step: 'Water leaves.' } },
      },
    };
    const withContrast = { ...ctx, beats: [contrastBeat] };
    const { user } = buildBoardPrompt(withContrast);
    assert.match(user, /WRONG "Salt pulls\."/);
  });
});

/** Representation-family mapping + lesson-vocabulary gates (reviewer defects 3+5). */

const beat = (over: Partial<TeachingBeat> = {}): TeachingBeat => ({
  beatId: 'sc.b1', sceneId: 'sc', order: 1, claimIds: ['c1'], learnerDelta: 'd',
  beatType: 'demonstrate', cognitiveOperation: 'quantify', representationFamily: 'plot',
  entities: [{ conceptId: 'charge' }], relationships: [], misconceptionIds: [],
  narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'none', evidenceSpanIds: ['S1'], ...over,
});
const ctx: BoardContext = {
  sceneId: 'sc', title: 'T', beats: [beat()],
  narration: [{ beatId: 'sc.b1', sentences: ['Charge builds on the capacitor plates.'] }],
  concepts: [{ id: 'charge', label: 'Charge' }, { id: 'plate', label: 'Plate' }],
  initial: emptyBoardState(),
};

let n = 0;
const add = (element: unknown, extra: Record<string, unknown> = {}) => ({
  op: 'add', opId: `o${++n}`, beatId: 'sc.b1', id: `e${n}`, element, at: { region: 'center' }, cue: 0, ...extra,
});

const bindings = { conceptIds: ['charge'], claimIds: ['c1'] };

describe('representation family mapping', () => {
  it('a plot beat drawn as boxes fails; with an axes-plot it passes the gate', () => {
    const boxes = { transition: { mode: 'clean' }, ops: [add({ type: 'token', text: 'charge', provenance: 'illustrative', bindings })] };
    const boxProblems = validateSceneBoard(SceneDraft(boxes), ctx) as Array<{ message: string }>;
    assert.ok(boxProblems.some((p) => /representation family plot/.test(p.message)));
    const plotted = { transition: { mode: 'clean' }, ops: [add({ type: 'kit', kit: 'axes-plot', paramsJson: '{"fn":"linear","params":[1],"domain":[0,1]}', provenance: 'illustrative', bindings })] };
    const plotProblems = validateSceneBoard(SceneDraft(plotted), { ...ctx, geometryCheck: () => [] }) as Array<{ message: string }>;
    assert.ok(!plotProblems.some((p) => /representation family/.test(p.message)));
  });
});

describe('lesson vocabulary gate', () => {
  it('invented shorthand fails; spoken words pass', () => {
    const bad = { transition: { mode: 'clean' }, ops: [add({ type: 'token', text: 'chg', provenance: 'illustrative', bindings })] };
    const badProblems = validateSceneBoard(SceneDraft(bad), ctx) as Array<{ message: string }>;
    assert.ok(badProblems.some((p) => /not lesson vocabulary/.test(p.message)));
    const good = { transition: { mode: 'clean' }, ops: [add({ type: 'token', text: 'charge', provenance: 'illustrative', bindings })] };
    const goodProblems = validateSceneBoard(SceneDraft(good), ctx) as Array<{ message: string }>;
    assert.ok(!goodProblems.some((p) => /not lesson vocabulary/.test(p.message)));
  });
});

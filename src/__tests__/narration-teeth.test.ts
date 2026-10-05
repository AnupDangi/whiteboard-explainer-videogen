import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePedagogy } from '../harness/pedagogy.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';

/** Simi-level speech dimensions, measured per scene with lesson context. */

const beat: TeachingBeat = {
  beatId: 's.b1', sceneId: 's', order: 1, claimIds: ['c1'], evidenceSpanIds: ['S1'],
  learnerDelta: 'd', beatType: 'introduce', cognitiveOperation: 'identify',
  representationFamily: 'process', entities: [{ conceptId: 't' }], relationships: [],
  misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
};
const narrate = (texts: string[]): CompiledSceneNarration => ({
  sceneId: 's', text: texts.join(' '),
  beats: texts.map((text, i) => ({ beatId: `s.b${i + 1}`, sentenceIds: [`s.b${i + 1}.s1`], text })),
  beatSpans: [], claimSpans: [],
});
const beatsFor = (n: number): TeachingBeat[] =>
  Array.from({ length: n }, (_, i) => ({ ...beat, beatId: `s.b${i + 1}`, order: i + 1 }));
const messages = (texts: string[], extra: Record<string, unknown> = {}) =>
  evaluatePedagogy({ beats: beatsFor(texts.length), narration: narrate(texts), ...extra })
    .map((f) => f.message);

describe('lesson speech dimensions', () => {
  it('first scene needs a hook; middle scenes need address', () => {
    const first = { lesson: { sceneIndex: 0, sceneCount: 3 } };
    assert.ok(messages(['Water moves across the membrane.'], first).some((m) => /without a hook/.test(m)));
    assert.ok(!messages(['Why does water cross the membrane?'], first).some((m) => /hook/.test(m)));
    assert.ok(!messages(['You watch water cross the membrane.'], first).some((m) => /hook/.test(m)));
    const mid = { lesson: { sceneIndex: 1, sceneCount: 3 } };
    assert.ok(messages(['Water moves across the membrane.'], mid).some((m) => /addresses the learner/.test(m)));
    assert.ok(!messages(['You see water move across.'], mid).some((m) => /addresses/.test(m)));
  });

  it('verbatim bridge repeats fail; paraphrase passes', () => {
    const prev = 'That loop stays through the whole lesson here';
    const mid = { lesson: { sceneIndex: 1, sceneCount: 3 }, previousTakeaway: prev };
    assert.ok(messages(['That loop stays through the lesson.'], mid).some((m) => /verbatim/.test(m)));
    assert.ok(!messages(['The same loop keeps working.'], mid).some((m) => /verbatim/.test(m)));
  });

  it('prediction moves require ask-and-answer with a declarative close', () => {
    const moves = [{ move: 'PredictNextStep' as const, note: 'Ask.' }];
    const mid = { lesson: { sceneIndex: 1, sceneCount: 3 }, moves };
    assert.ok(messages(['You watch water move across.'], mid).some((m) => /never asks/.test(m)));
    assert.ok(messages(['Which way goes first?', 'Water moves across.'], mid).filter((m) => /never asks|unanswered/.test(m)).length === 0);
    assert.ok(messages(['Water moves across.', 'Which way next?'], mid).some((m) => /unanswered/.test(m)));
  });

  it('final scenes close on capability', () => {
    const last = { lesson: { sceneIndex: 2, sceneCount: 3 } };
    assert.ok(messages(['Water moves across the membrane.'], last).some((m) => /capability/.test(m)));
    assert.ok(!messages(['You can now predict the flow.'], last).some((m) => /capability/.test(m)));
  });

  it('unit fixtures without lesson context skip every lesson dimension', () => {
    const findings = evaluatePedagogy({ beats: beatsFor(1), narration: narrate(['Water moves.']) });
    const dims = new Set(findings.map((f) => f.dimension));
    for (const d of ['lesson-hook', 'learner-address', 'scene-bridge', 'ask-and-answer', 'recap-capability'] as const) {
      assert.ok(!dims.has(d), d);
    }
  });
});

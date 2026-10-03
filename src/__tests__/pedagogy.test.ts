import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePedagogy, pedagogyPasses, type PedagogyFinding } from '../harness/pedagogy.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';
import type { CompiledSceneNarration } from '../narration/beat-narration/types.js';

/** T1 gate: a competent lesson passes, each weak variant fails its own dimension. Separation, not absolute scores. */

let n = 0;
const beat = (over: Partial<TeachingBeat> = {}): TeachingBeat => ({
  beatId: `b${++n}`, sceneId: 's1', order: n, claimIds: ['c1'], evidenceSpanIds: ['S1'],
  learnerDelta: 'Learner can state what happens.', beatType: 'introduce', cognitiveOperation: 'identify',
  representationFamily: 'process', entities: [{ conceptId: 'water' }], relationships: [],
  misconceptionIds: [], narrationGoal: 'Say what happens.', visualInvariant: 'Water sits left of the membrane.',
  mutedMeaning: 'Water waits on one side.', narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
  ...over,
});

const narrationFor = (texts: string[]): CompiledSceneNarration => ({
  sceneId: 's1', text: texts.join(' '),
  beats: texts.map((text, i) => ({ beatId: `b${i + 1}`, sentenceIds: [`b${i + 1}.s1`], text })),
  beatSpans: [], claimSpans: [],
});

const dims = (findings: PedagogyFinding[]): string[] => [...new Set(findings.map((f) => f.dimension))];

describe('pedagogy evals: competent lesson passes', () => {
  it('clean motivate/demonstrate/summarize arc with states, muted meanings and continuous speech', () => {
    n = 0;
    const beats = [
      beat({ beatId: 'b1', beatType: 'motivate', mutedMeaning: 'A puzzle: water moves on its own.' }),
      beat({ beatId: 'b2', beatType: 'demonstrate', cognitiveOperation: 'trace', entities: [{ conceptId: 'water' }, { conceptId: 'membrane' }], stateBefore: { description: 'Water left.' }, stateAfter: { description: 'Water spread evenly.' }, mutedMeaning: 'Water spreads across.' }),
      beat({ beatId: 'b3', beatType: 'summarize', mutedMeaning: 'Even spread is the takeaway.' }),
    ];
    const narration = narrationFor([
      'Why does water cross the membrane without anyone pushing it?',
      'Because crowded water spreads out, so it drifts across until both sides match.',
      'So osmosis is just crowding easing itself out.',
    ]);
    const findings = evaluatePedagogy({ beats, narration });
    assert.deepEqual(findings, []);
    assert.equal(pedagogyPasses(findings), true);
  });
});

describe('pedagogy evals: weak variants fail their own dimension', () => {
  it('demonstrate without stateAfter fails worked-example', () => {
    n = 0;
    const beats = [beat({ beatId: 'b1', beatType: 'demonstrate', stateBefore: { description: 'Water left.' } })];
    const findings = evaluatePedagogy({ beats, narration: narrationFor(['Water sits left.']) });
    assert.ok(dims(findings).includes('worked-example'));
    assert.equal(pedagogyPasses(findings), false);
  });

  it('misconception beat with no visible repair fails misconception-repair', () => {
    n = 0;
    const beats = [beat({ beatId: 'b1', beatType: 'introduce', misconceptionIds: ['m1'], mutedMeaning: '' })];
    const findings = evaluatePedagogy({ beats, narration: narrationFor(['Some think salt pulls water.']) });
    assert.ok(dims(findings).includes('misconception-repair'));
  });

  it('contrast with one entity fails divergence-clarity', () => {
    n = 0;
    const beats = [beat({ beatId: 'b1', beatType: 'contrast', entities: [{ conceptId: 'water' }] })];
    const findings = evaluatePedagogy({ beats, narration: narrationFor(['Water differs.']) });
    assert.ok(dims(findings).includes('divergence-clarity'));
  });

  it('visual beat with empty mutedMeaning fails muted-comprehension', () => {
    n = 0;
    const beats = [beat({ beatId: 'b1', mutedMeaning: '' })];
    const findings = evaluatePedagogy({ beats, narration: narrationFor(['Water moves.']) });
    assert.ok(dims(findings).includes('muted-comprehension'));
  });

  it('verbatim repeat across beats fails narration-continuity', () => {
    n = 0;
    const beats = [beat({ beatId: 'b1' }), beat({ beatId: 'b2', beatType: 'summarize' })];
    const narration = narrationFor(['Water crosses the thin membrane slowly.', 'Water crosses the thin membrane slowly.']);
    const findings = evaluatePedagogy({ beats, narration });
    assert.ok(dims(findings).includes('narration-continuity'));
  });

  it('"in this video" fails narration-continuity', () => {
    n = 0;
    const beats = [beat({ beatId: 'b1' })];
    const findings = evaluatePedagogy({ beats, narration: narrationFor(['In this video we show water.']) });
    assert.ok(dims(findings).includes('narration-continuity'));
  });
});

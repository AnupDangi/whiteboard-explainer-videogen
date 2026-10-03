import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorContrastSchema, type ErrorContrast } from '../teaching/error-contrast/types.js';
import { validateErrorContrast } from '../teaching/error-contrast/validate.js';
import { validateBeatPlan, type BeatContext } from '../teaching/beat-plan/validate.js';
import type { BeatPlanDraft } from '../teaching/beat-plan/types.js';

/** T5 gates: contrasts validate structurally; beats carry them; identical wrong/correct steps fail. */

const contrast = (over: Partial<ErrorContrast> = {}): ErrorContrast => ({
  misconceptionId: 'm1',
  problem: { problem: 'Which way does water move?' },
  sharedPrefix: [{ step: 'Water spreads from crowded to open.' }],
  divergence: {
    decision: 'Which side gains water?',
    wrongStep: { step: 'Salt pulls the water.' },
    correctStep: { step: 'Crowding eases itself out.' },
    whyWrongSeemsPlausible: 'Salt seems active.',
    violatedInvariant: 'Water moves down its own gradient.',
  },
  repair: { explanation: 'Track the water, not the salt.', repairedStep: { step: 'Water leaves the crowded side.' } },
  ...over,
});

describe('error contrast', () => {
  it('a complete contrast validates clean', () => {
    assert.deepEqual(validateErrorContrast(contrast(), ['m1', 'm2']), []);
    assert.ok(ErrorContrastSchema.safeParse(contrast()).success);
  });

  it('identical wrong and correct steps fail', () => {
    const bad = contrast({ divergence: { ...contrast().divergence, correctStep: { step: 'Salt pulls the water.' } } });
    assert.ok(validateErrorContrast(bad, ['m1']).some((m) => /no divergence/.test(m)));
  });

  it('a contrast for another beat id fails', () => {
    assert.ok(validateErrorContrast(contrast(), ['m2']).some((m) => /not one of this beat/.test(m)));
  });

  it('empty shared prefix fails schema', () => {
    assert.ok(validateErrorContrast(contrast({ sharedPrefix: [] })).length > 0);
  });

  it('beat validation checks attached contrasts against the beat ids', () => {
    const ctx: BeatContext = {
      sceneId: 's1', conceptIds: ['water'], claims: [{ id: 'c1', statement: 'Water spreads.', conceptIds: ['water'], relations: [], evidenceSpanIds: ['S1'] }],
      relations: [], misconceptionIds: ['m1'], durationSec: 20,
    };
    const plan: BeatPlanDraft = { beats: [{
      claimIds: ['c1'], learnerDelta: 'd', beatType: 'contrast', cognitiveOperation: 'compare',
      representationFamily: 'comparison', entities: [{ conceptId: 'water' }], relationships: [],
      misconceptionIds: ['m1'], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm',
      narrationOnly: false, persistence: 'scene', pauseIntent: 'none', errorContrast: contrast(),
    }] };
    assert.deepEqual(validateBeatPlan(plan, ctx).filter((p) => typeof p !== 'string' && p.path.includes('errorContrast')), []);
    const wrongId = structuredClone(plan);
    wrongId.beats[0]!.errorContrast!.misconceptionId = 'm9';
    assert.ok(validateBeatPlan(wrongId, ctx).some((p) => typeof p !== 'string' && p.path.includes('errorContrast')));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneNarration, type NarrationContext } from '../narration/beat-narration/validate.js';
import { verifyEquation } from '../visual-v2/provenance/verify.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';

/**
 * Regression fixtures for reviewer-flagged removals: contrastive prose must
 * keep passing (the semicolon ban was deleted for exactly this shape), repair
 * guidance must favor splitting, and chained equality must hold past 3 segments.
 */

const beat: TeachingBeat = {
  beatId: 's.b1', sceneId: 's', order: 1, claimIds: ['c1'], evidenceSpanIds: ['S1'],
  learnerDelta: 'd', beatType: 'introduce', cognitiveOperation: 'identify',
  representationFamily: 'process', entities: [{ conceptId: 't' }], relationships: [],
  misconceptionIds: [], narrationGoal: 'g', visualInvariant: 'v', mutedMeaning: 'm',
  narrationOnly: false, persistence: 'scene', pauseIntent: 'none',
};
const ctx: NarrationContext = {
  sceneId: 's', beats: [beat], allowedNumbers: new Set(), durationSec: 60, emphasisCandidates: [],
};
const draft = (sentences: string[]) => ({
  beats: [{ beatId: 's.b1', sentences, claimSentences: [{ claimId: 'c1', sentenceIndex: 0 }], emphasisTerms: [] }],
});
const messages = (sentences: string[], durationSec = 60) =>
  validateSceneNarration(draft(sentences), { ...ctx, durationSec }).map((p) => (typeof p === 'string' ? p : p.message));
describe('reviewer regression fixtures', () => {
  it('contrastive prose with semicolons passes: no list-glue rule exists', () => {
    const findings = messages(['The denominator counts all equal parts, not just parts taken; the numerator counts parts taken.']);
    assert.ok(!findings.some((m) => /semicolon|colon list/i.test(m)));
  });

  it('over-budget repair guidance favors splitting, never merging', () => {
    const long = ['Water moves across the thin membrane from the dilute side toward the concentrated side very slowly indeed today.'];
    const budget = messages(long, 8).find((m) => /too long/.test(m));
    assert.ok(budget, 'expected an over-budget finding');
    assert.ok(/split/i.test(budget!));
    assert.ok(!/merge/i.test(budget!));
  });

  it('four-segment numeric chains verify; mixed rationals hold', () => {
    assert.equal(verifyEquation('1+2=3=6/2=1.5*2').status, 'verified');
    assert.equal(verifyEquation('1/2+1/3=5/6=10/12').status, 'verified');
    const broken = verifyEquation('1+2=3=7=7');
    assert.equal(broken.status, 'refuted');
    assert.match(broken.detail, /segment 3/);
  });
});

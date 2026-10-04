import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneNarration, type NarrationContext } from '../narration/beat-narration/validate.js';
import type { TeachingBeat } from '../teaching/beat-plan/types.js';

/** Isolated Greek math symbols fail; Greek prose passes; spoken names pass. */

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
const check = (sentence: string) => validateSceneNarration(
  { beats: [{ beatId: 's.b1', sentences: [sentence], claimSentences: [{ claimId: 'c1', sentenceIndex: 0 }], emphasisTerms: [] }] },
  ctx,
).filter((p) => typeof p !== 'string' && /Greek|tau/.test(p.message));

describe('spoken symbols', () => {
  it('isolated tau in English speech is rejected', () => {
    assert.ok(check('So τ equals RC, in seconds, is the charging time.').length > 0);
    assert.ok(check('More resistance raises τ and lengthens charging.').length > 0);
    assert.ok(check('At 5τ the charge is near full.').length > 0);
  });

  it('spoken names and Greek prose pass', () => {
    assert.deepEqual(check('So tau equals RC, in seconds, is the charging time.'), []);
    assert.deepEqual(check('Η αντίσταση μεγαλώνει με τον χρόνο.'), []);
  });
});

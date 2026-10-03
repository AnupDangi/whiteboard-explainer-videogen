import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileMovePlan, movesForStrategy } from '../teaching/moves/compile.js';
import { TEACHING_MOVES } from '../teaching/moves/types.js';
import { TEACHING_STRATEGIES, type TeachingStrategy } from '../teaching/strategy/types.js';

/** T3 gates: every strategy compiles to moves; error path forks and repairs; moves carry no execution content. */

describe('teaching move library', () => {
  it('defines the 21 canonical moves', () => {
    assert.equal(TEACHING_MOVES.length, 21);
  });

  it('every strategy maps to at least one move', () => {
    for (const strategy of TEACHING_STRATEGIES) {
      const moves = movesForStrategy(strategy);
      assert.ok(moves.length >= 1, strategy);
      const plan = compileMovePlan('s1', strategy);
      assert.equal(plan.sceneId, 's1');
      assert.equal(plan.policyVersion, 'moves-policy/v1');
      assert.ok(plan.moves.every((m) => m.note.length > 0));
    }
  });

  it('erroneous-example exposes, forks, explains divergence, then repairs', () => {
    assert.deepEqual(movesForStrategy('erroneous-example'), [
      'ExposeMisconception', 'ForkCorrectIncorrect', 'ExplainDivergence', 'RepairMisconception',
    ]);
  });

  it('predict-reveal asks before tracing; faded worked examples fade support', () => {
    const moves = movesForStrategy('predict-reveal' as TeachingStrategy);
    assert.equal(moves[0], 'PredictNextStep');
    assert.ok(movesForStrategy('faded-worked-example' as TeachingStrategy).includes('FadeSupport'));
  });

  it('move notes never issue drawing instructions', () => {
    const banned = /\b(draw|pixel|coordinate|arrow|box|color|svg|font)\b/i;
    for (const strategy of TEACHING_STRATEGIES) {
      for (const m of compileMovePlan('s1', strategy).moves) assert.ok(!banned.test(m.note), `${strategy}/${m.move}`);
    }
  });
});

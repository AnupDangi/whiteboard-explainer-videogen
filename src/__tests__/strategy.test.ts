import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectStrategy } from '../teaching/strategy/select.js';
import { compileStrategyPlan } from '../teaching/strategy/plan.js';
import { TEACHING_STRATEGIES, type StrategyInput } from '../teaching/strategy/types.js';

/** T2 gates: plain scenes may choose NO example; each pressure selects its treatment; selection is deterministic. */

const base: StrategyInput = {
  sceneId: 's1', teachingSkill: 'definition', sectionKind: 'explain',
  misconceptionCount: 0, newConceptCount: 1, claimCount: 1, budgetSec: 12,
  hasMentalModel: false, hasBoundaryClaim: false, hasStateChange: false,
};

describe('S3b strategy selection', () => {
  it('plain definition scene selects direct: examples are never forced', () => {
    const sel = selectStrategy(base);
    assert.equal(sel.strategy, 'direct');
    assert.ok(sel.reasons.length >= 1);
  });

  it('mechanism misconception selects erroneous-example', () => {
    const sel = selectStrategy({ ...base, teachingSkill: 'mechanism', misconceptionCount: 1, hasMentalModel: true });
    assert.equal(sel.strategy, 'erroneous-example');
  });

  it('definition misconception selects contrastive-example', () => {
    const sel = selectStrategy({ ...base, misconceptionCount: 2 });
    assert.equal(sel.strategy, 'contrastive-example');
  });

  it('derivation selects worked-example; application selects transfer-example', () => {
    assert.equal(selectStrategy({ ...base, teachingSkill: 'derivation' }).strategy, 'worked-example');
    assert.equal(selectStrategy({ ...base, teachingSkill: 'application' }).strategy, 'transfer-example');
  });

  it('mechanism with state change and budget selects predict-reveal, without budget mechanism-trace', () => {
    assert.equal(selectStrategy({ ...base, teachingSkill: 'mechanism', hasStateChange: true, budgetSec: 30 }).strategy, 'predict-reveal');
    assert.equal(selectStrategy({ ...base, teachingSkill: 'mechanism', hasStateChange: true, budgetSec: 10 }).strategy, 'mechanism-trace');
  });

  it('boundary claim selects boundary-case; novel concepts select intuition-example; intro selects motivation', () => {
    assert.equal(selectStrategy({ ...base, hasBoundaryClaim: true }).strategy, 'boundary-case');
    assert.equal(selectStrategy({ ...base, newConceptCount: 3 }).strategy, 'intuition-example');
    assert.equal(selectStrategy({ ...base, sectionKind: 'intro' }).strategy, 'motivation');
  });

  it('recap selects direct', () => {
    assert.equal(selectStrategy({ ...base, sectionKind: 'recap', misconceptionCount: 0 }).strategy, 'direct');
  });

  it('selection is deterministic and the plan validates', () => {
    const a = compileStrategyPlan(base);
    const b = compileStrategyPlan(base);
    assert.deepEqual(a, b);
    assert.equal(a.policyVersion, 'strategy-policy/v1');
  });

  it('all 13 canonical strategies are valid plan values', () => {
    assert.equal(TEACHING_STRATEGIES.length, 13);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStrategySignals } from '../teaching/strategy/signals.js';
import type { ConceptGraph, SceneContract } from '../plan/schemas.js';

/** Strategy signals derive from contract + graph fields, highest precedence first. */

const graph: ConceptGraph = {
  concepts: [
    { id: 'water', label: 'Water', kind: 'entity', level: 'one-step', definition: 'd', evidence: [] },
    { id: 'flow', label: 'Flow', kind: 'process', level: 'multi-step', definition: 'd', evidence: [] },
  ],
  relations: [],
  prerequisites: [],
};
const contract = (over: Record<string, unknown> = {}): SceneContract => ({
  learningDelta: 'd', targetDurationSec: 20, requiredConceptIds: ['water'],
  requiredRelations: [], evidenceSpanIds: ['S1'],
  essentialClaims: [{ id: 'c1', statement: 'Water spreads.', conceptIds: ['water'], relations: [], evidenceSpanIds: ['S1'] }],
  teachingSkill: 'definition', candidateMechanisms: ['chain'],
  ...over,
} as unknown as SceneContract);

describe('strategy signals', () => {
  it('no signals on a plain definition scene', () => {
    assert.deepEqual(deriveStrategySignals(contract(), graph, ['water']), { hasBoundaryClaim: false, hasStateChange: false, rules: [] });
  });

  it('threshold mechanism fires the boundary rule', () => {
    const s = deriveStrategySignals(contract({ candidateMechanisms: ['threshold'] }), graph, ['water']);
    assert.equal(s.hasBoundaryClaim, true);
    assert.match(s.rules[0]!, /threshold/);
  });

  it('excepts relations and threshold claim text fire boundary rules', () => {
    const rel = deriveStrategySignals(contract({ requiredRelations: [{ from: 'a', to: 'b', type: 'excepts' }] }), graph, ['water']);
    assert.equal(rel.hasBoundaryClaim, true);
    const text = deriveStrategySignals(contract({ essentialClaims: [{ id: 'c1', statement: 'Beyond 5 units it breaks down.', conceptIds: ['water'], relations: [], evidenceSpanIds: ['S1'] }] }), graph, ['water']);
    assert.equal(text.hasBoundaryClaim, true);
  });

  it('state-change intents, transforms relations, and process kinds fire state rules', () => {
    const intent = deriveStrategySignals(contract({ semanticVisualIntents: [{ claimId: 'c1', conceptType: 'process', strategy: 'state-change', conceptIds: ['flow'], roles: [] }] }), graph, ['flow']);
    assert.equal(intent.hasStateChange, true);
    const rel = deriveStrategySignals(contract({ requiredRelations: [{ from: 'a', to: 'b', type: 'transforms' }] }), graph, ['water']);
    assert.equal(rel.hasStateChange, true);
    const kind = deriveStrategySignals(contract(), graph, ['flow']);
    assert.equal(kind.hasStateChange, true);
  });

  it('missing contract yields no signals', () => {
    assert.deepEqual(deriveStrategySignals(undefined, graph, ['water']), { hasBoundaryClaim: false, hasStateChange: false, rules: [] });
  });
});

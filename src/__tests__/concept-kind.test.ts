import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conceptKindProblems } from '../plan/contracts.js';
import type { TeachingPlan } from '../plan/schemas.js';

/** Literal-drawable intents require entity-kind concepts. */

const plan = (intents: Array<{ claimId: string; conceptType: 'entity' | 'process'; strategy: 'literal' | 'diagram'; conceptIds: string[] }>): TeachingPlan => ({
  targetDurationSec: 60,
  intro: { sourceTitle: 'T', sections: ['s1'] },
  sections: [{
    id: 's1', title: 'T', goal: 'g', kind: 'explain', conceptIds: ['c1'], budgetSec: 60,
    contract: {
      learningDelta: 'd', targetDurationSec: 60, requiredConceptIds: ['c1'], requiredRelations: [],
      evidenceSpanIds: ['S1'],
      essentialClaims: [{ id: 'c1', statement: 'Water spreads.', conceptIds: ['c1'], relations: [], evidenceSpanIds: ['S1'] }],
      teachingSkill: 'definition', candidateMechanisms: ['chain'],
      semanticVisualIntents: intents.map((i) => ({ ...i, roles: [] })),
    },
  }],
  recap: { keyPoints: [] },
} as unknown as TeachingPlan);

describe('concept kind gate', () => {
  it('literal intents on non-entity concepts fail with the kind fix', () => {
    const problems = conceptKindProblems(
      plan([{ claimId: 'c1', conceptType: 'entity', strategy: 'literal', conceptIds: ['c1'] }]),
      new Map([['c1', 'process']]),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /change the concept kind to entity/);
  });

  it('entity concepts and non-literal intents pass', () => {
    const kinds = new Map([['c1', 'entity']]);
    assert.deepEqual(conceptKindProblems(
      plan([{ claimId: 'c1', conceptType: 'entity', strategy: 'literal', conceptIds: ['c1'] }]), kinds,
    ), []);
    assert.deepEqual(conceptKindProblems(
      plan([{ claimId: 'c1', conceptType: 'process', strategy: 'diagram', conceptIds: ['c1'] }]),
      new Map([['c1', 'process']]),
    ), []);
  });

  it('unknown kinds (absent from map) are not flagged', () => {
    assert.deepEqual(conceptKindProblems(
      plan([{ claimId: 'c1', conceptType: 'entity', strategy: 'literal', conceptIds: ['c9'] }]),
      new Map(),
    ), []);
  });
});

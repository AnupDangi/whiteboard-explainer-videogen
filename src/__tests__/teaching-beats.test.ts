import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutHintFor } from '../planner/board.js';

test('the contract picks a matching layout; topic words are never consulted', () => {
  assert.equal(layoutHintFor({ teachingSkill: 'comparison', candidateMechanisms: ['chain'] }), 'compare');
  assert.equal(layoutHintFor({ teachingSkill: 'mechanism', candidateMechanisms: ['cycle', 'chain'] }), 'cycle');
  assert.equal(layoutHintFor({ teachingSkill: 'mechanism', candidateMechanisms: ['fan_out'] }), 'fan_out');
  assert.equal(layoutHintFor({ teachingSkill: 'mechanism', candidateMechanisms: ['chain'] }), 'flow');
  assert.equal(layoutHintFor({ teachingSkill: 'definition', candidateMechanisms: ['focus'] }), undefined);
  assert.equal(layoutHintFor(undefined), undefined);
});

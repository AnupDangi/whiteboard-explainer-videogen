import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSpokenSentences } from '../narration/sentences.js';

test('abbreviations, initials, acronyms and decimals do not end a sentence', () => {
  assert.deepEqual(splitSpokenSentences('Dr. Lee measured 3.5 grams, e.g. of salt. Water moves in. It equilibrates vs. the outside.'), [
    'Dr. Lee measured 3.5 grams, e.g. of salt.',
    'Water moves in.',
    'It equilibrates vs. the outside.',
  ]);
  assert.deepEqual(splitSpokenSentences('J. Smith used the U.S. method. Done!'), ['J. Smith used the U.S. method.', 'Done!']);
});

test('question and exclamation marks still split and trailing text is kept', () => {
  assert.deepEqual(splitSpokenSentences('Why does it move? Because of pressure! Then it stops'), ['Why does it move?', 'Because of pressure!', 'Then it stops']);
});

import { boundedIconReferent } from '../planner/board.js';
test('long referents sharing a prefix stay distinct and bounded', () => {
  const a = boundedIconReferent('the rate at which water crosses the selectively permeable membrane of a plant root cell');
  const b = boundedIconReferent('the rate at which water crosses the selectively permeable membrane of an animal blood vessel');
  assert.notEqual(a, b);
  assert.ok(a.length <= 48 && b.length <= 48);
  assert.equal(boundedIconReferent('Water!'), 'water');
});

import { rebalanceSceneBudgets, minBudgetForClaims } from '../plan/analyze.js';
test('dense scene borrows seconds from slack scenes and keeps the total', () => {
  const sections = [{ id: 'a', budgetSec: 25, n: 1 }, { id: 'b', budgetSec: 25, n: 1 }, { id: 'recap', budgetSec: 10, n: 4 }];
  const out = rebalanceSceneBudgets(sections, (s) => s.n);
  assert.equal(out.reduce((t, s) => t + s.budgetSec, 0), 60);
  assert.ok(out[2].budgetSec >= minBudgetForClaims(4));
  assert.ok(out[0].budgetSec >= 10 && out[1].budgetSec >= 10);
  assert.deepEqual(rebalanceSceneBudgets([{ id: 'x', budgetSec: 20, n: 1 }], (s) => s.n).map((s) => s.budgetSec), [20]);
});

import { materializeClaimSpans } from '../plan/stages.js';
test('an exact quote outranks a miscounted sentenceIndex', () => {
  const text = 'Dr. Lee starts here. Water moves across the membrane. It stops at balance.';
  const [span] = materializeClaimSpans(text, [{ claimId: 'c1', sentenceIndex: 2, exactText: 'Water moves across the membrane.' }]);
  assert.equal(span!.exactText, 'Water moves across the membrane.');
  // A quote that names no sentence no longer fails the script: the selected index stands and the claim gates judge the pick.
  assert.equal(materializeClaimSpans(text, [{ claimId: 'c1', sentenceIndex: 2, exactText: 'Not in speech.' }])[0]!.exactText, 'It stops at balance.');
});

import { dropRedundantInstances } from '../planner/board.js';
test('excess and duplicate instances are dropped and targets follow the kept node', () => {
  const node = (id: string, concept: string, mention: string, label: string) => ({ id, concept, mention, label, representation: { kind: 'literal' }, role: 'item' });
  const board = {
    nodes: [node('n1', 'c1', 'm1', 'a'), node('n2', 'c1', 'm2', 'b'), node('n3', 'c1', 'm3', 'c'), node('n4', 'c1', 'm4', 'd'), node('n5', 'c2', 'm5', 'e'), node('n6', 'c2', 'm5', 'f')],
    visualIntents: [{ claimId: 'k', strategy: 'literal', targets: [{ kind: 'element', elementId: 'n4', evidenceSpanIds: ['s'] }, { kind: 'element', elementId: 'n1', evidenceSpanIds: ['s'] }, { kind: 'element', elementId: 'n6', evidenceSpanIds: ['s'] }] }],
  } as never;
  const out = dropRedundantInstances(board) as unknown as { nodes: Array<{ id: string }>; visualIntents: Array<{ targets: Array<{ elementId: string }> }> };
  assert.deepEqual(out.nodes.map((n) => n.id), ['n1', 'n2', 'n3', 'n5']);
  assert.deepEqual(out.visualIntents[0]!.targets.map((t) => t.elementId), ['n1', 'n5']);
});

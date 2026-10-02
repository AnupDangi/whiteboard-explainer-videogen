import test from 'node:test';
import assert from 'node:assert/strict';
import { CONCEPT_STRUCTURE_GUIDANCE, PLAN_COMPONENT_GUIDANCE, SYLLABUS_COMPONENT_GUIDANCE, relationalGoalNeedsComponents, relationalGraphProblems } from '../plan/goalShape.js';

test('relational learning requests require distinct concepts and a source-backed graph relation', () => {
  for (const request of [
    'Compare the alternatives.',
    'Explain how the parts interact.',
    'Explain why the outcome changes.',
  ]) assert.equal(relationalGoalNeedsComponents(request), true, request);

  assert.deepEqual(relationalGraphProblems('Define one central term.', 1, 0), []);
  assert.match(relationalGraphProblems('Explain how the parts interact.', 1, 0)[0]!, /fewer than two concepts/);
  assert.deepEqual(relationalGraphProblems('Explain how the parts interact.', 1, 0, true), [], 'a scoped module may teach one component of the broader course objective');
  assert.match(relationalGraphProblems('Compare the alternatives.', 2, 0)[0]!, /no evidence-backed relation/);
  assert.deepEqual(relationalGraphProblems('Explain why the outcome changes.', 2, 1), []);
  assert.equal(relationalGoalNeedsComponents('Explain how to solve a single equation.'), false);
});

test('S2, syllabus, and S3 prompts preserve supported components without decomposing definitions', () => {
  for (const guidance of [CONCEPT_STRUCTURE_GUIDANCE, SYLLABUS_COMPONENT_GUIDANCE, PLAN_COMPONENT_GUIDANCE]) {
    assert.match(guidance, /source-supported|independently supported|source-backed/);
    assert.match(guidance, /umbrella (?:event|concept)/);
    assert.match(guidance, /define one idea|definition goal/);
  }
});

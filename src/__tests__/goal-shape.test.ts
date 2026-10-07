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
  assert.match(SYLLABUS_COMPONENT_GUIDANCE, /physical participant.*component.*material or substrate.*input.*product\/output/i);
  assert.match(SYLLABUS_COMPONENT_GUIDANCE, /own stable concept.*source term and evidence/i);
  assert.match(SYLLABUS_COMPONENT_GUIDANCE, /do not use its label as a substitute.*or infer.*not supported by evidence/i);
  assert.match(SYLLABUS_COMPONENT_GUIDANCE, /source noun for that thing.*do not append its production, release, or transformation action/i);
  assert.match(CONCEPT_STRUCTURE_GUIDANCE, /entity is a source-named object.*identity distinct from the action/i);
  assert.match(CONCEPT_STRUCTURE_GUIDANCE, /process or event names the action, change, transformation, or occurrence/i);
  assert.match(CONCEPT_STRUCTURE_GUIDANCE, /never classify an action or process label as an entity just to make it drawable/i);
});

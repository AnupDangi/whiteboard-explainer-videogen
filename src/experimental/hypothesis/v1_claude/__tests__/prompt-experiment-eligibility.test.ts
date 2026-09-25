import test from 'node:test';
import assert from 'node:assert/strict';
import { promptExperimentEligibilityProblems } from '../harness/promptExperimentEligibility.js';
import type { PromptArm } from '../planner/exemplars.js';

const validRun = {
  runClass: 'generated-lesson',
  sourceDoc: { schemaVersion: 'source-doc/v2', sourceId: 'src_test', format: 'text', text: 'A source long enough for a source document.', spans: [] },
  scenes: [{
    sceneContract: { learningDelta: 'explain a mechanism', targetDurationSec: 20, requiredConceptIds: ['mechanism'], requiredRelations: [], evidenceSpanIds: ['span_mechanism'], teachingSkill: 'mechanism', candidateMechanisms: ['focus'] },
    lessonBible: { audience: 'learner', terminology: [], persistentConceptIds: [] },
  }],
};

test('E5 retrieval treatments require source-generated planner input, not fixtures or hand-authored specs', () => {
  assert.deepEqual(promptExperimentEligibilityProblems(validRun, 'mechanism', 'ranked'), []);
  assert.match(promptExperimentEligibilityProblems({ ...validRun, runClass: 'renderer-fixture' }, 'mechanism', 'ranked').join('|'), /explicit generated-lesson provenance/);
  assert.match(promptExperimentEligibilityProblems({ ...validRun, scenes: [{ ...validRun.scenes[0], spec: {} }] }, 'mechanism', 'ranked').join('|'), /hand-authored SceneSpec/);
  assert.match(promptExperimentEligibilityProblems({ ...validRun, sourceDoc: undefined }, 'mechanism', 'ranked').join('|'), /require the source document/);
  assert.match(promptExperimentEligibilityProblems({ ...validRun, scenes: [{ lessonBible: validRun.scenes[0].lessonBible }] }, 'mechanism', 'ranked').join('|'), /lacks a schema-valid SceneContract/);
  assert.match(promptExperimentEligibilityProblems({ ...validRun, scenes: [{ ...validRun.scenes[0], sceneContract: { learningDelta: 'only a goal' } }] }, 'mechanism', 'ranked').join('|'), /lacks a schema-valid SceneContract/);
});

test('E5 order permutations cannot be mislabeled as a zero-shot run', () => {
  assert.deepEqual(promptExperimentEligibilityProblems(validRun, 'zero', 'ranked'), []);
  assert.match(promptExperimentEligibilityProblems(validRun, 'zero', 'reverse').join('|'), /requires a retrieval prompt arm/);
  assert.match(promptExperimentEligibilityProblems(validRun, 'invalid' as PromptArm, 'ranked').join('|'), /unknown prompt arm/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { teachingPlanTokenBudget } from '../plan/stages.js';

test('S3 completion allowance grows with scene and graph size while staying bounded', () => {
  const oneScene = teachingPlanTokenBudget(1, 7, 6);
  const fiveMinutePlan = teachingPlanTokenBudget(12, 7, 6);
  const largerGraph = teachingPlanTokenBudget(12, 10, 10);
  assert.ok(fiveMinutePlan > oneScene, 'each scene carries a schema-validated contract');
  assert.ok(largerGraph > fiveMinutePlan, 'more concepts and relations require more contract output');
  assert.ok(fiveMinutePlan > 4_500, 'the observed 7-concept, 6-relation plan must no longer be cut at 4,500 tokens');
  assert.equal(teachingPlanTokenBudget(1_000, 14, 24), 10_000, 'large plans are capped');
  assert.throws(() => teachingPlanTokenBudget(0, 1, 1), /at least one scene/);
});

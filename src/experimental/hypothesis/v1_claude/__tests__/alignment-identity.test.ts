import test from 'node:test';
import assert from 'node:assert/strict';
import { S5_STAGE_VERSION, S5_MODEL_ID } from '../pipeline/versions.js';

test('S5 cache identity names the repair-capable aligner stack', () => {
  assert.equal(S5_STAGE_VERSION, 'voice-align-4-repair-identity');
  assert.match(S5_MODEL_ID, /repair/);
});

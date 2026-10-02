import test from 'node:test';
import assert from 'node:assert/strict';
import { TEACHING_COMPILER_VERSION, V2_FLAGS, resolveFeatureFlags } from '../run/featureFlags.js';

test('the compiler version defaults to v1 and every V2 flag defaults off', () => {
  assert.equal(TEACHING_COMPILER_VERSION === 'v1' || TEACHING_COMPILER_VERSION === 'v2', true);
  const flags = resolveFeatureFlags({});
  assert.equal(flags.version, 'v1');
  for (const name of V2_FLAGS) assert.equal(flags.enabled[name], false, name);
});

test('a flag turns on only when named, independent of the others', () => {
  const flags = resolveFeatureFlags({ TEACHING_BEATS_V2: '1', BOARD_OPS_V2: 'true' });
  assert.equal(flags.enabled.TEACHING_BEATS_V2, true);
  assert.equal(flags.enabled.BOARD_OPS_V2, true);
  assert.equal(flags.enabled.PERSISTENT_BOARD_V2, false);
  assert.equal(flags.enabled.RENDER_PLAN_V2, false);
});

test('version v2 does not silently enable flags and an unknown version is rejected', () => {
  const flags = resolveFeatureFlags({ TEACHING_COMPILER_VERSION: 'v2' });
  assert.equal(flags.version, 'v2');
  assert.equal(Object.values(flags.enabled).some(Boolean), false);
  assert.throws(() => resolveFeatureFlags({ TEACHING_COMPILER_VERSION: 'v3' }), /TEACHING_COMPILER_VERSION/);
});

test('flag values other than 1/true/0/false/empty are rejected rather than guessed', () => {
  assert.throws(() => resolveFeatureFlags({ LAYOUT_V2: 'yes please' }), /LAYOUT_V2/);
});

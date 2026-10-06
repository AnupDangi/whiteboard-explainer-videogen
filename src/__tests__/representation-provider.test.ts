import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { REPRESENTATION_FAMILIES, semanticEventId, type TeachingBeat } from '../teaching/beat-plan/types.js';
import {
  createRepresentationProviderRegistry,
  defineRepresentationProvider,
  type MechanismRequirement,
} from '../teaching/representation/providerRegistry.js';

const beat = {
  beatId: 'scene.b1',
  requiredSemanticChanges: [{ kind: 'transform', entityId: 'entity_a' }],
} as unknown as TeachingBeat;

function testProvider(options: { mechanisms?: boolean; suitability?: number } = {}) {
  return defineRepresentationProvider({
    family: 'state_transition',
    version: 'state-transition/test-v1',
    modelSchema: z.object({ step: z.string().min(1) }).strict(),
    suitability: () => options.suitability ?? 0.9,
    validateModel: () => [],
    mechanismRequirements: (_model, context) => options.mechanisms === false ? [] : context.requiredSemanticChanges.map((change, index): MechanismRequirement => ({
      eventId: semanticEventId(context.beatId, index),
      kind: change.kind,
      entityIds: [change.entityId],
      description: 'The visible state changes from the declared before state to the declared after state.',
    })),
    compile: (model) => [`transition:${model.step}`],
    fallback: () => ({ step: 'deterministic-fallback' }),
  });
}

test('unimplemented families are explicit and fail closed without a generic BoardOps substitute', () => {
  const registry = createRepresentationProviderRegistry<null, string>([]);
  assert.deepEqual(registry.statuses.map((status) => status.family), REPRESENTATION_FAMILIES);
  assert.ok(registry.statuses.every((status) => status.status === 'not_implemented'));
  const result = registry.compile('state_transition', { step: 'model' }, null, beat);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'provider_unavailable');
    assert.match(result.problems[0]!.message, /generic BoardOps fallback is not permitted/);
  }
  const fallback = registry.compileFallback('state_transition', null, beat);
  assert.equal(fallback.ok, false);
  if (!fallback.ok) assert.equal(fallback.code, 'provider_unavailable');
});

test('provider runtime validates model shape, required mechanisms, and explicit deterministic fallback', () => {
  const provider = testProvider();
  const registry = createRepresentationProviderRegistry<null, string>([provider]);
  assert.deepEqual(registry.statuses.find((status) => status.family === 'state_transition'), {
    family: 'state_transition', status: 'implemented', version: 'state-transition/test-v1',
  });

  const valid = registry.compile('state_transition', { step: 'split' }, null, beat);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.deepEqual(valid.operations, ['transition:split']);
    assert.equal(valid.source, 'model');
    assert.equal(valid.mechanisms[0]!.eventId, 'scene.b1.e1');
  }

  const invalid = registry.compile('state_transition', { step: '' }, null, beat);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'invalid_model');

  const fallback = registry.compileFallback('state_transition', null, beat);
  assert.equal(fallback.ok, true);
  if (fallback.ok) {
    assert.deepEqual(fallback.operations, ['transition:deterministic-fallback']);
    assert.equal(fallback.source, 'fallback');
  }
});

test('provider refuses to compile when a required beat change lacks a declared visible mechanism', () => {
  const registry = createRepresentationProviderRegistry<null, string>([testProvider({ mechanisms: false })]);
  const result = registry.compile('state_transition', { step: 'split' }, null, beat);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'missing_mechanism');
    assert.match(result.problems[0]!.message, /no declared visible mechanism/);
  }
});

test('provider rejects out-of-range suitability and duplicate family registrations', () => {
  const low = createRepresentationProviderRegistry<null, string>([testProvider({ suitability: 0 })]);
  const rejected = low.compile('state_transition', { step: 'split' }, null, beat);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, 'unsuitable');

  const provider = testProvider();
  assert.throws(() => createRepresentationProviderRegistry<null, string>([provider, provider]), /duplicate representation provider/);
});

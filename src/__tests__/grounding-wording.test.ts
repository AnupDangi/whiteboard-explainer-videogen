import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEquation } from '../visual-v2/provenance/verify.js';
import { sourceEdgeProblem } from '../visual-v2/provenance/ground.js';

/** Relation wording tolerance + chained numeric equality. */

const grounding = {
  verify: (spanId: string, quote: string) => (spanId === 'S1' ? quote : undefined),
};

describe('edge relation wording', () => {
  const quote = 'When the switch closes, current flows and the capacitor charges.';
  it('process verbs ground on endpoint order without the literal verb', () => {
    assert.equal(
      sourceEdgeProblem('switch', 'causes', 'capacitor charges', { spanId: 'S1', quote }, grounding),
      undefined,
    );
    assert.equal(
      sourceEdgeProblem('current', 'feeds', 'capacitor charge', { spanId: 'S1', quote: 'Current feeds the capacitor charge.' }, grounding),
      undefined,
    );
  });

  it('reversed endpoints still fail; negated clauses still fail', () => {
    assert.match(
      sourceEdgeProblem('capacitor charges', 'causes', 'switch', { spanId: 'S1', quote }, grounding) ?? '',
      /directed subject–object sequence/,
    );
    assert.match(
      sourceEdgeProblem('switch', 'causes', 'capacitor charges', { spanId: 'S1', quote: 'The switch does not cause capacitor charges.' }, grounding) ?? '',
      /negated or qualified/,
    );
  });

  it('contrast relations keep the strict word requirement', () => {
    assert.match(
      sourceEdgeProblem('cold water', 'opposes', 'heat flow', { spanId: 'S1', quote: 'Cold water meets heat flow.' }, grounding) ?? '',
      /absent from its cited quote/,
    );
  });
});

describe('chained numeric equality', () => {
  it('A=B=C verifies when every pair computes', () => {
    assert.equal(verifyEquation('1+2=3=6/2').status, 'verified');
  });

  it('a broken link refutes with its position', () => {
    const verdict = verifyEquation('1+2=4=8/2');
    assert.equal(verdict.status, 'refuted');
    assert.match(verdict.detail, /segment 1/);
  });

  it('two-part equalities behave exactly as before', () => {
    assert.equal(verifyEquation('3^2+4^2=5^2').status, 'verified');
    assert.equal(verifyEquation('3^2+4^2=6^2').status, 'refuted');
  });
});

describe('multi-word relation grounding', () => {
  it('grounds word by word in order, not as one literal phrase', async () => {
    const { sourceEdgeProblem } = await import('../visual-v2/provenance/ground.js');
    const grounding = { verify: (spanId: string, quote: string) => (spanId === 'S1' ? quote : undefined) };
    const quote = 'Osmosis drives net flow of water toward the dense side.';
    assert.equal(
      sourceEdgeProblem('osmosis', 'net flow toward', 'dense side', { spanId: 'S1', quote }, grounding),
      undefined,
    );
  });

  it('scrambled word order still fails', async () => {
    const { sourceEdgeProblem } = await import('../visual-v2/provenance/ground.js');
    const grounding = { verify: (spanId: string, quote: string) => (spanId === 'S1' ? quote : undefined) };
    assert.match(
      sourceEdgeProblem('dense side', 'net flow toward', 'osmosis', { spanId: 'S1', quote: 'Osmosis drives net flow of water toward the dense side.' }, grounding) ?? '',
      /directed subject–relation–object sequence/,
    );
  });
});

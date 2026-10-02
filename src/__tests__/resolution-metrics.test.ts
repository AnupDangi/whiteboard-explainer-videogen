import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalResolutionCounts } from '../assets/resolutionMetrics.js';
import type { ResolutionRecord, ResolutionStrategy } from '../shared/types.js';

test('resolver telemetry reports every canonical rung independently of legacy numeric confidence', () => {
  const strategies: ResolutionStrategy[] = [
    'R0-verified-pin', 'R1-diagram', 'R2-semantic-core', 'R3-house-literal',
    'R4-curated-flaticon', 'R5-approved-metaphor', 'R6-typed-streamline',
    'R7-technical-brand', 'R8-ontology-fallback', 'R9-state-topology',
    'R10-labelled-primitive', 'R11-minimal-text',
  ];
  const resolutions = strategies.map((strategy) => ({ strategy, rung: 2 } as ResolutionRecord));
  const counts = canonicalResolutionCounts(resolutions);
  assert.equal(Object.keys(counts).length, 12);
  strategies.forEach((strategy, index) => assert.equal(counts[`resolver.R${index}`], 1, strategy));
  assert.equal(canonicalResolutionCounts([])['resolver.R11'], 0, 'zero-use rungs are explicit in each run');
});

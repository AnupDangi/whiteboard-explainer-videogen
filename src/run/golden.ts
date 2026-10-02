import type { GoldenCase, RunClass } from '../shared/contracts.js';
import { goldenById } from '../shared/fixtures.js';

/**
 * Golden targets belong to explicit benchmark/script paths, never to
 * source-generated input IDs. Only the fixture CLIs call this; the live
 * pipeline receives the result as `HypothesisLiveInput.golden`.
 */
export function goldenForRun(input: { caseId: string; runClass?: RunClass }): GoldenCase | undefined {
  if (input.runClass === 'generated-lesson') return undefined;
  try {
    return goldenById(input.caseId);
  } catch {
    return undefined;
  }
}

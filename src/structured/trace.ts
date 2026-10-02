import type { CoercionEntry } from './coercionLedger.js';

/** One failed validation of one attempt, with each zod issue as a JSON pointer where the issue carries a path. */
export interface ValidationErrorRecord {
  attempt: number;
  error: string;
  issues: Array<{ path: string; message: string }>;
}

/** One repair attempt: which pointers it targeted and what it changed (or why it was unusable). */
export interface RepairRecord {
  repairIndex: number;
  /** patch = only the failing pointers were rewritten; full = the whole document was regenerated (no pointer to patch). */
  mode: 'patch' | 'full';
  targets: string[];
  patches: Array<{ op: 'replace' | 'add' | 'remove'; path: string; value?: unknown }>;
  /** Set when the repair output itself was unusable (bad patch, unresolved pointer). */
  error?: string;
}

/** What a model call did to reach (or fail to reach) a valid value; everything is retained, nothing overwritten. */
export interface StructuredTrace {
  validationErrors: ValidationErrorRecord[];
  /** Coercions made on the ACCEPTED attempt only. */
  coercions: CoercionEntry[];
  repairs: RepairRecord[];
}

export const emptyTrace = (): StructuredTrace => ({ validationErrors: [], coercions: [], repairs: [] });

export function mergeTraces(traces: readonly StructuredTrace[]): StructuredTrace {
  return { validationErrors: traces.flatMap((t) => t.validationErrors), coercions: traces.flatMap((t) => t.coercions), repairs: traces.flatMap((t) => t.repairs) };
}

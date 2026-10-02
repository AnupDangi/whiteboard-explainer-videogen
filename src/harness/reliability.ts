import { prepareLesson } from '../run/lesson.js';
import { loadSourceDoc } from '../intake/sourceIntake.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';

/** Cold S1-S4 reliability measurement. It never changes what counts as a pass. */
export interface ReliabilityAttempt {
  sourceId: string;
  durationSec: number;
  attempt: number;
  reached: 'S2' | 'S3' | 'S4' | 'done';
  passed: boolean;
  failureCodes: string[];
  transportRetries: number;
  anchoredEvidence: boolean;
  costUsd: number;
  durationMs: number;
}

export interface ReliabilityReport {
  generatedAt: string;
  model: string;
  attempts: ReliabilityAttempt[];
  byStage: { s2PassRate: number; s3PassRate: number; s4PassRate: number; endToEndPassRate: number };
  failureCodeCounts: Record<string, number>;
  totalCostUsd: number;
}

const rate = (numerator: number, denominator: number): number => denominator ? numerator / denominator : 0;

export function summarizeReliability(attempts: ReliabilityAttempt[]): Pick<ReliabilityReport, 'byStage' | 'failureCodeCounts' | 'totalCostUsd'> {
  const reachedS3 = attempts.filter((attempt) => attempt.reached !== 'S2').length;
  const reachedS4 = attempts.filter((attempt) => attempt.reached === 'S4' || attempt.reached === 'done').length;
  const done = attempts.filter((attempt) => attempt.reached === 'done').length;
  const failureCodeCounts: Record<string, number> = {};
  for (const attempt of attempts) for (const code of attempt.failureCodes) failureCodeCounts[code] = (failureCodeCounts[code] ?? 0) + 1;
  return {
    byStage: {
      s2PassRate: rate(reachedS3, attempts.length),
      s3PassRate: rate(reachedS4, reachedS3),
      s4PassRate: rate(done, reachedS4),
      endToEndPassRate: rate(done, attempts.length),
    },
    failureCodeCounts: Object.fromEntries(Object.entries(failureCodeCounts).sort(([left], [right]) => left.localeCompare(right))),
    totalCostUsd: attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
  };
}

export async function runReliability(opts: {
  sources: Array<{ id: string; path: string }>;
  durationsSec: number[];
  repeats: number;
  model: string;
  apiKey: string;
  budgetUsd: number;
  budgetLedger: PersistentBudgetLedger;
  fetcher?: typeof fetch;
}): Promise<ReliabilityReport> {
  const attempts: ReliabilityAttempt[] = [];
  for (const source of opts.sources) {
    const sourceDoc = await loadSourceDoc(source.path);
    for (const durationSec of opts.durationsSec) {
      for (let attempt = 1; attempt <= opts.repeats; attempt++) {
        const started = Date.now();
        const prepared = await prepareLesson(
          { source: sourceDoc.text, sourceDoc, sourceFormat: sourceDoc.format, targetDurationSec: durationSec },
          { model: opts.model, apiKey: opts.apiKey, budgetUsd: opts.budgetUsd, budgetLedger: opts.budgetLedger, fetcher: opts.fetcher },
        );
        const hard = prepared.failures.filter((failure) => failure.hard);
        const reached: ReliabilityAttempt['reached'] = !prepared.graph
          ? 'S2'
          : !prepared.plan || hard.some((failure) => failure.stage === 'plan')
            ? 'S3'
            : !prepared.script
              ? 'S4'
              : 'done';
        attempts.push({
          sourceId: source.id,
          durationSec,
          attempt,
          reached,
          passed: reached === 'done' && hard.length === 0,
          failureCodes: [...new Set(hard.map((failure) => failure.code))].sort(),
          transportRetries: prepared.failures.filter((failure) => failure.code.endsWith('-transport-retry')).length,
          anchoredEvidence: prepared.failures.some((failure) => failure.code === 'concepts-evidence-anchored'),
          costUsd: prepared.usage.costUsd,
          durationMs: Date.now() - started,
        });
      }
    }
  }
  return { generatedAt: new Date().toISOString(), model: opts.model, attempts, ...summarizeReliability(attempts) };
}

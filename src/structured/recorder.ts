import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StageFailure } from '../shared/types.js';
import type { StructuredCallAttemptRecord, StructuredCallReport } from '../llm/structuredCall.js';
import type { StructuredTrace } from './trace.js';
import type { ReplayFixture } from './replayClient.js';

/**
 * Raw-output retention (V2 plan Phase 1.2). Every model call writes, under its run directory and never over an
 * earlier call: the raw model output (every attempt, verbatim), the validation errors, the repair patches, the
 * validated output, the coercions, the call report and a replay fixture.
 */
export interface RecordedCall {
  stage: string;
  subject: string;
  model: string;
  provider: string;
  schemaName: string;
  value: unknown;
  rawResponses: StructuredCallAttemptRecord[];
  trace: StructuredTrace;
  report: StructuredCallReport;
  failures: StageFailure[];
}

export interface CallRecorder { record(call: RecordedCall): Promise<void> }

const ambient = new AsyncLocalStorage<CallRecorder | undefined>();
export const withCallRecorder = <T>(recorder: CallRecorder | undefined, fn: () => T): T => ambient.run(recorder, fn);
/** For a long-lived run entry point (CLI main): record every call made by the rest of this async chain. */
export const setAmbientCallRecorder = (recorder: CallRecorder | undefined): void => ambient.enterWith(recorder);
export const currentCallRecorder = (): CallRecorder | undefined => ambient.getStore();

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'call';

export class FileCallRecorder implements CallRecorder {
  private readonly counters = new Map<string, number>();
  private readonly seen: StructuredCallReport[] = [];
  constructor(private readonly runDir: string) {}

  /** Every call report this recorder saw, in call order. The objects are shared, so `retained` is final once the call returned. */
  reports(): StructuredCallReport[] { return [...this.seen]; }

  private async claimDirectory(stage: string, subject: string): Promise<string> {
    const stageDir = path.join(this.runDir, 'structured', slug(stage));
    await mkdir(stageDir, { recursive: true });
    for (;;) {
      const n = (this.counters.get(stage) ?? 0) + 1;
      this.counters.set(stage, n);
      const dir = path.join(stageDir, `${String(n).padStart(4, '0')}-${slug(subject)}`);
      try { await mkdir(dir); return dir; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
  }

  async record(call: RecordedCall): Promise<void> {
    this.seen.push(call.report);
    const dir = await this.claimDirectory(call.stage, call.subject);
    const write = (file: string, value: unknown) => writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    const header = { schemaVersion: 'structured-call/v1', stage: call.stage, subject: call.subject, model: call.model };
    await write('raw-model-output.json', { ...header, responses: call.rawResponses.map((response) => ({ ...response })) });
    await write('validation-errors.json', { ...header, errors: call.trace.validationErrors });
    await write('repair-patches.json', { ...header, repairs: call.trace.repairs });
    await write('coercions.json', { ...header, coercions: call.trace.coercions });
    await write('validated-output.json', call.value !== undefined ? call.value : { validated: false });
    const fixture: ReplayFixture = {
      schemaVersion: 'structured-replay/v1', stage: call.stage, subject: call.subject, model: call.model, provider: call.provider, schemaName: call.schemaName,
      responses: call.rawResponses.map((response) => ({ content: response.content, finishReason: response.finishReason ?? 'stop', usage: { ...response.usage }, schemaConstrained: response.schemaConstrained === true, requestHash: response.requestHash ?? '' })),
    };
    await write('replay-fixture.json', fixture);
    // Written last: its presence means every other file landed.
    await write('report.json', { ...call.report, retained: { raw: true, replayFixture: true }, failures: call.failures.map(({ code, message, hard }) => ({ code, message, hard })) });
  }
}

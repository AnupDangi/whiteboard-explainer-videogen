import { z } from 'zod';
import { maxPriceForCallBudget, priceCeilingForModel, ProviderNotDispatchedError, RETRYABLE_NOT_DISPATCHED, worstCaseCallUsd, type ModelPricing } from './openrouter.js';
import { openRouterClient, type ModelClient } from './modelClient.js';
import type { StageFailure } from '../shared/types.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';
import { PIPELINE } from '../run/config.js';
import { createHash } from 'node:crypto';
import { compileProviderSchema, providerForModel, type CompiledSchema, type SchemaProvider } from '../structured/providerSchema.js';
import { normalizeNullable } from '../structured/normalizeNullable.js';
import { silentSemanticCoercions } from '../harness/structuredMetrics.js';
import { collectCoercions, countCoercions, type CoercionCounts, type CoercionEntry } from '../structured/coercionLedger.js';
import { currentCallRecorder, type CallRecorder } from '../structured/recorder.js';
import { requestHashOf } from '../structured/replayClient.js';
import { emptyTrace, type RepairRecord, type StructuredTrace } from '../structured/trace.js';
import { pointerFromPath, applyPatches, buildPatchRepairPrompt, decodePatchResponse, patchOutsideTargets, patchResponseJsonSchema } from '../structured/jsonPointerRepair.js';

/**
 * One validated LLM call for every model stage in this track (S1b syllabus,
 * S2 concepts, S3 teaching plan, S4 script, S6 Scene Planner): a ModelClient
 * call (OpenRouter by default) with a JSON schema generated from the stage's
 * zod schema, temperature 0, one repair by default that feeds the
 * validator's error back, real token/cost accounting, a per-call timeout, and
 * a budget check. Exhausting the configured repairs returns a hard StageFailure — never
 * converted into a fabricated success (AGENTS.md #7).
 *
 * Budget: when the model's published prices are known, the worst-case cost
 * of the call is checked against the remaining budget before sending (a model
 * that cannot fit fails as `model-too-expensive-for-budget`) and reserved in
 * the shared ledger; `max_price` pins routing to that model's own price.
 * Otherwise a budget-split price ceiling applies.
 *
 * Truncation: a response cut off at `maxTokens` (finish_reason "length") is
 * reported with its own code, and the repair gets a larger token allowance.
 */
export interface CallUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
  repairs: number;
}

export const emptyUsage = (): CallUsage => ({ calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, repairs: 0 });

export function addUsage(into: CallUsage, from: CallUsage): void {
  into.calls += from.calls;
  into.promptTokens += from.promptTokens;
  into.completionTokens += from.completionTokens;
  into.cachedTokens += from.cachedTokens;
  into.costUsd += from.costUsd;
  into.repairs += from.repairs;
}

/** A semantic problem. A pointer lets the repair patch just that location; a bare string needs a full-document repair. */
export type ValidatorProblem = string | { path: string; message: string };
const problemText = (problem: ValidatorProblem): string => (typeof problem === 'string' ? problem : `${problem.path || '(root)'}: ${problem.message}`);

export interface StructuredCallOptions<T> {
  stage: string;
  /** Used in failure messages and logs. */
  subject: string;
  model: string;
  apiKey: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  /** Semantic checks beyond the zod shape; return a list of problems (empty = valid). */
  validate?: (value: T) => ValidatorProblem[];
  /** Semantic repair attempts after the first response. Defaults to one for all existing stages. */
  maxRepairs?: 1 | 2;
  /** `patch` (default): a failure with JSON pointers is repaired by patching those pointers only. `full` regenerates the document. Failures without a pointer always use the full prompt. */
  repairMode?: 'patch' | 'full';
  /** Widens the area a patch may touch for a rejected pointer (default: the pointer itself). A fix often belongs to the same operation or beat, not the exact field the validator named. */
  repairScope?: (pointer: string) => string;
  /** Where this call's raw output, errors, patches and replay fixture are retained; defaults to the run's ambient recorder. */
  recorder?: CallRecorder;
  /** Stage-specific guidance; the full schema and validator still run after every response. */
  repairPrompt?: (args: { originalUserPrompt: string; invalidOutput: string; validatorError: string; repairIndex: number; truncated: boolean }) => string;
  maxTokens?: number;
  temperature?: number;
  effort?: 'low' | 'medium' | 'high';
  remainingBudgetUsd: number;
  /** Shared across preparation and live stages for durable, serialized spend checks. */
  budgetLedger?: PersistentBudgetLedger;
  /** Optional transport injection for deterministic request-contract tests. */
  fetcher?: typeof fetch;
  /** Model provider; defaults to OpenRouter with `apiKey` and `fetcher`. */
  client?: ModelClient;
  /** Known per-token prices; otherwise asked from the client. */
  modelPricing?: ModelPricing;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Retries after a ProviderNotDispatchedError. These are transport retries, never the semantic repair. Default 2. */
  transportRetries?: number;
  /** Base delay; retry n waits n × this value. Default 5000 ms. */
  transportRetryDelayMs?: number;
  /** Test seam for retry waits. */
  sleep?: (ms: number) => Promise<void>;
}

/** What one validated call proves about itself (V2 plan Phase 1.1 / 1.5): provider, constraint truth, first-try validity. */
export interface StructuredCallReport {
  stage: string;
  subject: string;
  provider: SchemaProvider;
  clientProvider: string;
  model: string;
  schemaName: string;
  /** SHA-256 of the exact wire schema sent. */
  schemaHash: string;
  /** Every attempt ran under provider-enforced decoding for the whole schema. */
  schemaConstrained: boolean;
  /** The wire schema was compiled for strict decoding. */
  strict: boolean;
  droppedKeywords: Array<{ path: string; keyword: string }>;
  attempts: number;
  repairs: number;
  /** The very first response parsed and validated without a repair. */
  firstTryValid: boolean;
  /** The call produced a validated value. */
  succeeded: boolean;
  /** Code-side coercions on the accepted attempt (V2 plan Phase 1.4). */
  coercions: CoercionCounts;
  /** Raw output / replay fixture were written to disk (V2 plan Phase 1.2). */
  retained: { raw: boolean; replayFixture: boolean };
  /** Semantic differences between the model's JSON and the validated value that no ledger entry covers (target: 0). */
  silentSemanticCoercions: number;
}

export interface StructuredCallResult<T> {
  value?: T;
  usage: CallUsage;
  failures: StageFailure[];
  rawResponses: StructuredCallAttemptRecord[];
  /** One report per model call made (a stage that fans out per scene concatenates them). */
  reports: StructuredCallReport[];
  trace: StructuredTrace;
}

export interface StructuredCallAttemptRecord {
  attempt: number;
  model: string;
  content: string;
  requestPriceCeiling?: { prompt: number; completion: number };
  /** Provider finish reason ("stop", "length" = cut off at maxTokens, ...). */
  finishReason?: string;
  maxTokens?: number;
  /** The provider enforced the schema while decoding this response. */
  schemaConstrained?: boolean;
  /** SHA-256 of system + prompt + schema name sent for this attempt; replay verifies it. */
  requestHash?: string;
  routing?: { generationId?: string; selectedModel?: string; selectedProvider?: string; strategy?: string; attempt?: number };
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number; costUsd: number };
}

/**
 * Every top-level `{...}` region in `content` (string-literal aware). Flash
 * models sometimes emit a JSON object, second-guess themselves in prose, and
 * emit a corrected one; this only locates what the model actually wrote.
 */
export function extractJsonCandidates(content: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(content.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

/**
 * JSON.parse, retrying once with raw control characters inside string
 * literals escaped (models sometimes emit a literal newline/tab inside a
 * string). Only escaping changes; no content is added or removed.
 */
export function parseJsonLenient(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (!/control character/i.test(error instanceof Error ? error.message : '')) throw error;
    let out = '';
    let inString = false;
    let escape = false;
    for (const ch of raw) {
      if (inString) {
        if (escape) { escape = false; out += ch; continue; }
        if (ch === '\\') { escape = true; out += ch; continue; }
        if (ch === '"') { inString = false; out += ch; continue; }
        const code = ch.charCodeAt(0);
        if (code < 0x20) { out += ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : ch === '\r' ? '\\r' : `\\u${code.toString(16).padStart(4, '0')}`; continue; }
        out += ch;
      } else {
        if (ch === '"') inString = true;
        out += ch;
      }
    }
    return JSON.parse(out);
  }
}

/** Try candidates last-first (a self-correcting model settles on its final block); each must pass full validation. */
export function parseCandidates<T>(content: string, schema: z.ZodType<T>, validate?: (value: T) => ValidatorProblem[], optionalPaths: readonly string[] = []): { ok: true; value: T; coercions: CoercionEntry[]; input: unknown } | { ok: false; error: string; issues: Array<{ path: string; message: string }>; json?: unknown } {
  const candidates = extractJsonCandidates(content);
  if (candidates.length === 0) return { ok: false, error: 'response contained no JSON object ({...}) at all', issues: [] };
  let lastError = 'no candidate JSON object validated';
  // Repairs target the FIRST evaluated candidate (the model's final block), so its document and pointers are kept.
  let firstJson: unknown;
  let firstIssues: Array<{ path: string; message: string }> | undefined;
  for (let i = candidates.length - 1; i >= 0; i--) {
    let json: unknown;
    try {
      json = parseJsonLenient(candidates[i]);
    } catch (error) {
      lastError = `[candidate ${i + 1}/${candidates.length}] invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    const normalized = normalizeNullable(json, optionalPaths);
    // Coercers run inside zod preprocess and inside the stage validator; both write to this candidate's ledger scope.
    const { result: outcome, entries } = collectCoercions(() => {
      const parsed = schema.safeParse(normalized);
      if (!parsed.success) return { kind: 'schema' as const, issues: parsed.error.issues };
      return { kind: 'checked' as const, data: parsed.data, problems: validate?.(parsed.data) ?? [] };
    });
    if (outcome.kind === 'schema') {
      lastError = `[candidate ${i + 1}/${candidates.length}] ${outcome.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`;
      if (firstIssues === undefined) { firstJson = json; firstIssues = outcome.issues.map((x) => ({ path: pointerFromPath(x.path), message: x.message })); }
      continue;
    }
    if (outcome.problems.length > 0) {
      lastError = `[candidate ${i + 1}/${candidates.length}] ${outcome.problems.map(problemText).join('; ')}`;
      // Patchable only when EVERY problem names a location; otherwise some problem would survive a pointer patch.
      if (firstIssues === undefined) { firstJson = json; firstIssues = outcome.problems.every((problem) => typeof problem !== 'string') ? outcome.problems.map((problem) => ({ path: (problem as { path: string }).path, message: (problem as { message: string }).message })) : []; }
      continue;
    }
    return { ok: true, value: outcome.data, coercions: entries, input: normalized };
  }
  return { ok: false, error: lastError, issues: firstIssues ?? [], ...(firstJson !== undefined ? { json: firstJson } : {}) };
}

/** Generic fetch/network failures never reached a model endpoint, so they retry as transport (donor RETRYABLE set covers only typed rejections). Aborts/timeouts are excluded: the request may have dispatched. */
const NETWORK_FAILURE_MESSAGE = /fetch failed|failed to fetch|network request failed|load failed|socket hang up|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EPIPE|\bterminated\b|other side closed|UND_ERR_SOCKET/i;
const ABORT_MESSAGE = /\bAbortError\b|\bTimeoutError\b|operation was aborted|operation timed out/i;
function isNetworkTransportError(error: unknown): boolean {
  if (error instanceof ProviderNotDispatchedError) return false;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (ABORT_MESSAGE.test(text)) return false;
  return NETWORK_FAILURE_MESSAGE.test(text);
}

export const buildRepairPrompt = (originalUserPrompt: string, invalidOutput: string, validatorError: string, truncated = false): string => `${originalUserPrompt}
Your previous response was NOT valid and was rejected by the validator. This is your one allowed repair attempt — produce a corrected JSON object that fixes every issue below. Do not repeat the same mistake.${truncated ? '\nYour previous response was cut off at the output token limit before the JSON was complete. Write the complete object more concisely: shorter strings, no commentary.' : ''}

Your previous (INVALID) response:
${invalidOutput}

Validator error(s):
${validatorError}

Respond with ONLY the corrected JSON object.`;

interface CallTrack { firstTryValid: boolean; trace: StructuredTrace; /** The accepted model JSON after null normalization (before any coercer). */ acceptedInput?: unknown }

/**
 * One validated model call. The wrapper compiles the zod schema for the model's provider class, runs the call,
 * and attaches a report that states what the call actually proved (constraint, first-try validity, repairs).
 */
export async function structuredCall<T>(opts: StructuredCallOptions<T>): Promise<StructuredCallResult<T>> {
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  const provider = providerForModel(opts.model);
  const client = opts.client ?? openRouterClient(opts.apiKey, opts.fetcher);
  let compiled: CompiledSchema;
  try {
    compiled = compileProviderSchema(jsonSchema, provider);
  } catch (error) {
    const failure: StageFailure = { code: `${opts.stage}-schema-compile-failed`, stage: opts.stage, message: `${opts.subject}: ${error instanceof Error ? error.message : String(error)}`, hard: true };
    return { usage: emptyUsage(), failures: [failure], rawResponses: [], reports: [{ stage: opts.stage, subject: opts.subject, provider, clientProvider: client.provider, model: opts.model, schemaName: opts.schemaName, schemaHash: '', schemaConstrained: false, strict: false, droppedKeywords: [], attempts: 0, repairs: 0, firstTryValid: false, succeeded: false, coercions: { total: 0, low: 0, semantic: 0 }, retained: { raw: false, replayFixture: false }, silentSemanticCoercions: 0 }], trace: emptyTrace() };
  }
  const track: CallTrack = { firstTryValid: false, trace: emptyTrace() };
  const result = await runStructuredCall(opts, compiled, jsonSchema, client, track, provider);
  const attempts = result.rawResponses.length;
  const report: StructuredCallReport = {
    stage: opts.stage, subject: opts.subject, provider, clientProvider: client.provider, model: opts.model, schemaName: opts.schemaName,
    schemaHash: createHash('sha256').update(JSON.stringify(compiled.schema)).digest('hex'),
    schemaConstrained: attempts > 0 && result.rawResponses.every((record) => record.schemaConstrained === true),
    strict: compiled.strict, droppedKeywords: compiled.droppedKeywords, attempts, repairs: result.usage.repairs,
    firstTryValid: track.firstTryValid, succeeded: result.value !== undefined, coercions: countCoercions(track.trace.coercions),
    retained: { raw: false, replayFixture: false },
    silentSemanticCoercions: result.value !== undefined && track.acceptedInput !== undefined ? silentSemanticCoercions(track.acceptedInput, result.value, track.trace.coercions) : 0,
  };
  const recorder = opts.recorder ?? currentCallRecorder();
  if (recorder) {
    try {
      await recorder.record({ stage: opts.stage, subject: opts.subject, model: opts.model, provider: client.provider, schemaName: opts.schemaName, value: result.value, rawResponses: result.rawResponses, trace: track.trace, report, failures: result.failures });
      report.retained = { raw: true, replayFixture: true };
    } catch (error) {
      result.failures.push({ code: `${opts.stage}-record-failed`, stage: opts.stage, message: `${opts.subject}: could not retain raw output (${error instanceof Error ? error.message : String(error)}); this call has no replay fixture`, hard: false });
    }
  }
  return { ...result, reports: [report], trace: track.trace };
}

async function runStructuredCall<T>(opts: StructuredCallOptions<T>, compiled: CompiledSchema, originalSchema: Record<string, unknown>, client: ModelClient, track: CallTrack, provider: SchemaProvider): Promise<Omit<StructuredCallResult<T>, 'reports' | 'trace'>> {
  const jsonSchema = compiled.schema;
  const usage = emptyUsage();
  const failures: StageFailure[] = [];
  const rawResponses: StructuredCallResult<T>['rawResponses'] = [];

  const pricing = opts.modelPricing ?? await client.pricing?.(opts.model).catch(() => undefined);

  interface Wire { schema: Record<string, unknown>; schemaName: string; strictSchema: boolean; limitSchema?: Record<string, unknown> }
  const call = async (userPrompt: string, attempt: number, maxTokens: number, wire?: Wire): Promise<{ content: string; finishReason: string } | null> => {
    if (usage.costUsd >= opts.remainingBudgetUsd) {
      failures.push({ code: 'cost-ceiling', stage: opts.stage, message: `${opts.subject}: skipped call #${attempt} — remaining clip budget ($${opts.remainingBudgetUsd.toFixed(4)}) exhausted`, hard: true });
      return null;
    }
    const promptBytes = Buffer.byteLength(`${opts.system}\n${userPrompt}`, 'utf8');
    const stageRemainingUsd = Math.max(0, opts.remainingBudgetUsd - usage.costUsd);
    const worstCaseUsd = pricing ? worstCaseCallUsd(pricing, promptBytes, maxTokens) : undefined;
    if (worstCaseUsd !== undefined && worstCaseUsd > stageRemainingUsd) {
      failures.push({ code: 'model-too-expensive-for-budget', stage: opts.stage, message: `${opts.subject}: call #${attempt} to ${opts.model} could cost up to $${worstCaseUsd.toFixed(4)} (${maxTokens} output tokens) but only $${stageRemainingUsd.toFixed(4)} remains; choose a cheaper model or raise the budget`, hard: true });
      return null;
    }
    const invoke = async (requestBudgetUsd: number) => {
      // Known prices pin routing to this model's own price; unknown prices fall back to a budget split.
      const requestPriceCeiling = pricing ? priceCeilingForModel(pricing) : maxPriceForCallBudget(requestBudgetUsd, promptBytes, maxTokens);
      const response = await client.chat({
        model: opts.model,
        system: opts.system,
        user: userPrompt,
        schema: wire?.schema ?? jsonSchema,
        strictSchema: wire ? wire.strictSchema : compiled.strict,
        ...(wire ? (wire.limitSchema ? { limitSchema: wire.limitSchema } : {}) : (compiled.droppedKeywords.length ? { limitSchema: originalSchema } : {})),
        schemaName: wire?.schemaName ?? opts.schemaName,
        maxTokens,
        temperature: opts.temperature ?? 0,
        maxPriceUsdPerMillionTokens: requestPriceCeiling,
        effort: opts.effort,
        // A live run once saw a call hang ~20 minutes; flash reasoning models can take 1-2 minutes on a full
        // teaching plan. The timeout starts when the request gets a provider slot, not while it queues.
        timeoutMs: opts.timeoutMs ?? PIPELINE.providerTimeoutMs,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      return { ...response, requestPriceCeiling };
    };
    const result = opts.budgetLedger
      ? await opts.budgetLedger.call(stageRemainingUsd, async (allowedUsd) => {
          const response = await invoke(allowedUsd);
          return { value: response, costUsd: response.usage.costUsd };
        }, { ...(worstCaseUsd !== undefined ? { reserveUsd: worstCaseUsd } : {}) }).then((entry) => {
          if (!entry.allowed) {
            failures.push(entry.reason === 'reservation-exceeds-budget'
              ? { code: 'model-too-expensive-for-budget', stage: opts.stage, message: `${opts.subject}: call #${attempt} could cost up to $${worstCaseUsd!.toFixed(4)}, more than the persistent budget ledger has left (spent $${entry.spentUsd.toFixed(4)} of $${opts.budgetLedger!.budgetUsd.toFixed(4)})`, hard: true }
              : { code: 'cost-ceiling', stage: opts.stage, message: `${opts.subject}: persistent budget ledger exhausted ($${entry.spentUsd.toFixed(4)} of $${opts.budgetLedger!.budgetUsd.toFixed(4)})`, hard: true });
            return null;
          }
          return entry.value;
        })
      : await invoke(stageRemainingUsd);
    if (result === null) return null;
    usage.calls += 1;
    usage.promptTokens += result.usage.promptTokens;
    usage.completionTokens += result.usage.completionTokens;
    usage.cachedTokens += result.usage.cachedTokens;
    usage.costUsd += result.usage.costUsd;
    if (usage.costUsd > opts.remainingBudgetUsd) {
      failures.push({ code: 'cost-ceiling-exceeded', stage: opts.stage, message: `${opts.subject}: provider returned $${usage.costUsd.toFixed(4)} against $${opts.remainingBudgetUsd.toFixed(4)} remaining for this call`, hard: true });
    }
    if (opts.budgetLedger) {
      const ledger = await opts.budgetLedger.snapshot();
      if (ledger.spentUsd > ledger.budgetUsd) failures.push({ code: 'persistent-budget-exceeded', stage: opts.stage, message: `${opts.subject}: actual spend is $${ledger.spentUsd.toFixed(4)} against the persistent $${ledger.budgetUsd.toFixed(4)} ceiling`, hard: true });
    }
    rawResponses.push({
      attempt,
      model: opts.model,
      content: result.content,
      finishReason: result.finishReason,
      maxTokens,
      schemaConstrained: result.schemaConstrained,
      requestHash: requestHashOf(opts.system, userPrompt, wire?.schemaName ?? opts.schemaName),
      ...(result.requestPriceCeiling ? { requestPriceCeiling: result.requestPriceCeiling } : {}),
      ...(result.routing ? { routing: result.routing } : {}),
      usage: { ...result.usage },
    });
    return { content: result.content, finishReason: result.finishReason };
  };

  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const callWithTransportRetry = async (userPrompt: string, attempt: number, maxTokens: number, wire?: Wire): Promise<{ content: string; finishReason: string } | null> => {
    for (let retry = 0; ; retry++) {
      try {
        return await call(userPrompt, attempt, maxTokens, wire);
      } catch (error) {
        // Only route/throttle rejections can succeed on an identical retry; a rejected request (auth, credit, bad parameters) cannot.
        // Generic fetch/network failures (undici `TypeError: fetch failed`) also never reached a model, so they retry as transport too.
        const retryableNotDispatched = error instanceof ProviderNotDispatchedError && RETRYABLE_NOT_DISPATCHED.includes(error.code);
        if ((!retryableNotDispatched && !isNetworkTransportError(error)) || retry >= (opts.transportRetries ?? 3)) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        failures.push({ code: `${opts.stage}-transport-retry`, stage: opts.stage, message: `${opts.subject} attempt ${attempt}: ${detail}; transport retry ${retry + 1} (no completion was produced; this is not a repair)`, hard: false });
        await sleep((opts.transportRetryDelayMs ?? 5000) * (retry + 1));
      }
    }
  };
  const parseSafely = (content: string) => {
    try {
      return parseCandidates(content, opts.schema, opts.validate, compiled.optionalPaths);
    } catch (error) {
      return { threw: error } as const;
    }
  };
  const validatorThrew = (error: unknown) => failures.push({ code: `${opts.stage}-validator-threw`, stage: opts.stage, message: `${opts.subject}: validation code threw (a pipeline bug, not a model failure): ${error instanceof Error ? error.message : String(error)}`, hard: true });

  const maxTokens = opts.maxTokens ?? 4000;
  let first: { content: string; finishReason: string } | null;
  try {
    first = await callWithTransportRetry(opts.user, 1, maxTokens);
  } catch (error) {
    failures.push({ code: `${opts.stage}-call-failed`, stage: opts.stage, message: `${opts.subject} attempt 1: ${error instanceof Error ? error.message : String(error)}`, hard: true });
    return { usage, failures, rawResponses };
  }
  if (first === null) return { usage, failures, rawResponses };
  const parsed = parseSafely(first.content);
  if ('threw' in parsed) { validatorThrew(parsed.threw); return { usage, failures, rawResponses }; }
  if (parsed.ok) { track.firstTryValid = true; track.trace.coercions = parsed.coercions; track.acceptedInput = parsed.input; return { value: parsed.value, usage, failures, rawResponses }; }

  // Each response is fully validated. A failure at JSON pointers is repaired by patching those pointers only; a failure with
  // no pointer (a validator problem about the whole document) uses the stage's full-document repair prompt.
  track.trace.validationErrors.push({ attempt: 1, error: parsed.error, issues: parsed.issues });
  let invalid = first;
  let invalidError = parsed.error;
  let invalidJson = parsed.json;
  let invalidIssues = parsed.issues;
  let invalidMaxTokens = maxTokens;
  let patchWire: Wire | undefined;
  const initialError = first.finishReason === 'length' ? `response was cut off at the ${maxTokens}-token output limit (${parsed.error})` : parsed.error;
  for (let repairIndex = 1; repairIndex <= (opts.maxRepairs ?? 1); repairIndex++) {
    const truncated = invalid.finishReason === 'length';
    const error = truncated ? `response was cut off at the ${invalidMaxTokens}-token output limit (${invalidError})` : invalidError;
    if (truncated && repairIndex === 1) failures.push({ code: `${opts.stage}-truncated`, stage: opts.stage, message: `${opts.subject} attempt 1: ${error}`, hard: false });
    const repairMaxTokens = truncated ? Math.ceil(invalidMaxTokens * 1.5) : maxTokens;
    const patchable = opts.repairMode !== 'full' && !truncated && invalidJson !== undefined && invalidIssues.length > 0;
    if (patchable && !patchWire) {
      const patchCompiled = compileProviderSchema(patchResponseJsonSchema(), provider);
      patchWire = { schema: patchCompiled.schema, schemaName: 'json_patch', strictSchema: patchCompiled.strict, ...(patchCompiled.droppedKeywords.length ? { limitSchema: patchResponseJsonSchema() } : {}) };
    }
    const userPrompt = patchable
      ? buildPatchRepairPrompt({ originalUserPrompt: opts.user, invalidDocument: invalidJson, issues: invalidIssues, schema: originalSchema })
      : opts.repairPrompt?.({ originalUserPrompt: opts.user, invalidOutput: invalid.content, validatorError: error, repairIndex, truncated })
        ?? buildRepairPrompt(opts.user, invalid.content, error, truncated);
    usage.repairs += 1;
    let response: { content: string; finishReason: string } | null;
    try {
      response = await callWithTransportRetry(userPrompt, repairIndex + 1, repairMaxTokens, patchable ? patchWire : undefined);
    } catch (callError) {
      failures.push({ code: `${opts.stage}-repair-call-failed`, stage: opts.stage, message: `${opts.subject}: invalid (${error}); repair call failed: ${callError instanceof Error ? callError.message : String(callError)}`, hard: true });
      return { usage, failures, rawResponses };
    }
    if (response === null) {
      failures.push({ code: `${opts.stage}-invalid`, stage: opts.stage, message: `${opts.subject}: invalid (${error}); repair skipped (budget)`, hard: true });
      return { usage, failures, rawResponses };
    }
    const record: RepairRecord = { repairIndex, mode: patchable ? 'patch' : 'full', targets: patchable ? [...new Set(invalidIssues.map((issue) => opts.repairScope?.(issue.path) ?? issue.path))] : [], patches: [] };
    track.trace.repairs.push(record);
    let candidate = response;
    if (patchable) {
      try {
        record.patches = decodePatchResponse(response.content, originalSchema as Record<string, unknown>);
        const stray = patchOutsideTargets(record.patches, record.targets);
        if (stray) throw new Error(`patch ${stray.path} is outside the rejected fields (${record.targets.join(', ')}); accepted content must not change`);
        candidate = { content: JSON.stringify(applyPatches(invalidJson, record.patches)), finishReason: 'stop' };
      } catch (patchError) {
        // The document is unchanged; the unusable patch still cost this repair.
        record.error = patchError instanceof Error ? patchError.message : String(patchError);
        invalidError = `repair patch unusable: ${record.error} (still invalid: ${invalidError})`;
        continue;
      }
    }
    const repaired = parseSafely(candidate.content);
    if ('threw' in repaired) { validatorThrew(repaired.threw); return { usage, failures, rawResponses }; }
    if (repaired.ok) { track.trace.coercions = repaired.coercions; track.acceptedInput = repaired.input; return { value: repaired.value, usage, failures, rawResponses }; }
    track.trace.validationErrors.push({ attempt: repairIndex + 1, error: repaired.error, issues: repaired.issues });
    invalid = candidate;
    invalidError = repaired.error;
    invalidJson = repaired.json;
    invalidIssues = repaired.issues;
    invalidMaxTokens = repairMaxTokens;
  }
  const finalError = invalid.finishReason === 'length' ? `response was cut off at the ${invalidMaxTokens}-token output limit (${invalidError})` : invalidError;
  failures.push({ code: invalid.finishReason === 'length' ? `${opts.stage}-truncated-after-repair` : `${opts.stage}-repair-failed`, stage: opts.stage, message: `${opts.subject}: still invalid after ${usage.repairs} repair${usage.repairs === 1 ? '' : 's'} — initial: ${initialError} | after repair: ${finalError}`, hard: true });
  return { usage, failures, rawResponses };
}

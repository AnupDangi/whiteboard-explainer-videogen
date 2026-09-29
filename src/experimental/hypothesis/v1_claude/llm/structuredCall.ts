import { z } from 'zod';
import { maxPriceForCallBudget, priceCeilingForModel, ProviderNotDispatchedError, RETRYABLE_NOT_DISPATCHED, worstCaseCallUsd, type ModelPricing } from './openrouter.js';
import { openRouterClient, type ModelClient } from './modelClient.js';
import type { StageFailure } from '../types.js';
import type { PersistentBudgetLedger } from '../pipeline/budgetLedger.js';
import { PIPELINE } from '../config.js';

/**
 * One validated LLM call for every model stage in this track (S1b syllabus,
 * S2 concepts, S3 teaching plan, S4 script, S6 Scene Planner): a ModelClient
 * call (OpenRouter by default) with a JSON schema generated from the stage's
 * zod schema, temperature 0, EXACTLY ONE repair attempt that feeds the
 * validator's error back, real token/cost accounting, a per-call timeout, and
 * a budget check. A second failure is returned as a hard StageFailure — never
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
  validate?: (value: T) => string[];
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

export interface StructuredCallResult<T> {
  value?: T;
  usage: CallUsage;
  failures: StageFailure[];
  rawResponses: StructuredCallAttemptRecord[];
}

export interface StructuredCallAttemptRecord {
  attempt: number;
  model: string;
  content: string;
  requestPriceCeiling?: { prompt: number; completion: number };
  /** Provider finish reason ("stop", "length" = cut off at maxTokens, ...). */
  finishReason?: string;
  maxTokens?: number;
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
export function parseCandidates<T>(content: string, schema: z.ZodType<T>, validate?: (value: T) => string[]): { ok: true; value: T } | { ok: false; error: string } {
  const candidates = extractJsonCandidates(content);
  if (candidates.length === 0) return { ok: false, error: 'response contained no JSON object ({...}) at all' };
  let lastError = 'no candidate JSON object validated';
  for (let i = candidates.length - 1; i >= 0; i--) {
    let json: unknown;
    try {
      json = parseJsonLenient(candidates[i]);
    } catch (error) {
      lastError = `[candidate ${i + 1}/${candidates.length}] invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      lastError = `[candidate ${i + 1}/${candidates.length}] ${parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`;
      continue;
    }
    const problems = validate?.(parsed.data) ?? [];
    if (problems.length > 0) {
      lastError = `[candidate ${i + 1}/${candidates.length}] ${problems.join('; ')}`;
      continue;
    }
    return { ok: true, value: parsed.data };
  }
  return { ok: false, error: lastError };
}

/** Generic fetch/network failures never reached a model endpoint, so they retry as transport (donor RETRYABLE set covers only typed rejections). Aborts/timeouts are excluded: the request may have dispatched. */
const NETWORK_FAILURE_MESSAGE = /fetch failed|failed to fetch|network request failed|load failed|socket hang up|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EPIPE/i;
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

export async function structuredCall<T>(opts: StructuredCallOptions<T>): Promise<StructuredCallResult<T>> {
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  const usage = emptyUsage();
  const failures: StageFailure[] = [];
  const rawResponses: StructuredCallResult<T>['rawResponses'] = [];

  const client = opts.client ?? openRouterClient(opts.apiKey, opts.fetcher);
  const pricing = opts.modelPricing ?? await client.pricing?.(opts.model).catch(() => undefined);

  const call = async (userPrompt: string, attempt: number, maxTokens: number): Promise<{ content: string; finishReason: string } | null> => {
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
        schema: jsonSchema,
        schemaName: opts.schemaName,
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
      ...(result.requestPriceCeiling ? { requestPriceCeiling: result.requestPriceCeiling } : {}),
      ...(result.routing ? { routing: result.routing } : {}),
      usage: { ...result.usage },
    });
    return { content: result.content, finishReason: result.finishReason };
  };

  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const callWithTransportRetry = async (userPrompt: string, attempt: number, maxTokens: number): Promise<{ content: string; finishReason: string } | null> => {
    for (let retry = 0; ; retry++) {
      try {
        return await call(userPrompt, attempt, maxTokens);
      } catch (error) {
        // Only route/throttle rejections can succeed on an identical retry; a rejected request (auth, credit, bad parameters) cannot.
        // Generic fetch/network failures (undici `TypeError: fetch failed`) also never reached a model, so they retry as transport too.
        const retryableNotDispatched = error instanceof ProviderNotDispatchedError && RETRYABLE_NOT_DISPATCHED.includes(error.code);
        if ((!retryableNotDispatched && !isNetworkTransportError(error)) || retry >= (opts.transportRetries ?? 2)) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        failures.push({ code: `${opts.stage}-transport-retry`, stage: opts.stage, message: `${opts.subject} attempt ${attempt}: ${detail}; transport retry ${retry + 1} (no completion was produced; this is not a repair)`, hard: false });
        await sleep((opts.transportRetryDelayMs ?? 5000) * (retry + 1));
      }
    }
  };
  const parseSafely = (content: string) => {
    try {
      return parseCandidates(content, opts.schema, opts.validate);
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
  if (parsed.ok) return { value: parsed.value, usage, failures, rawResponses };

  // Output cut off at the token limit: report it as such and give the repair more room.
  const firstTruncated = first.finishReason === 'length';
  const firstError = firstTruncated ? `response was cut off at the ${maxTokens}-token output limit (${parsed.error})` : parsed.error;
  if (firstTruncated) failures.push({ code: `${opts.stage}-truncated`, stage: opts.stage, message: `${opts.subject} attempt 1: ${firstError}`, hard: false });
  const repairMaxTokens = firstTruncated ? Math.ceil(maxTokens * 1.5) : maxTokens;
  usage.repairs += 1;
  let second: { content: string; finishReason: string } | null;
  try {
    second = await callWithTransportRetry(buildRepairPrompt(opts.user, first.content, firstError, firstTruncated), 2, repairMaxTokens);
  } catch (error) {
    failures.push({ code: `${opts.stage}-repair-call-failed`, stage: opts.stage, message: `${opts.subject}: invalid (${firstError}); repair call failed: ${error instanceof Error ? error.message : String(error)}`, hard: true });
    return { usage, failures, rawResponses };
  }
  if (second === null) {
    failures.push({ code: `${opts.stage}-invalid`, stage: opts.stage, message: `${opts.subject}: invalid (${firstError}); repair skipped (budget)`, hard: true });
    return { usage, failures, rawResponses };
  }
  const repaired = parseSafely(second.content);
  if ('threw' in repaired) { validatorThrew(repaired.threw); return { usage, failures, rawResponses }; }
  if (repaired.ok) return { value: repaired.value, usage, failures, rawResponses };
  const secondError = second.finishReason === 'length' ? `response was cut off at the ${repairMaxTokens}-token output limit (${repaired.error})` : repaired.error;
  failures.push({ code: second.finishReason === 'length' ? `${opts.stage}-truncated-after-repair` : `${opts.stage}-repair-failed`, stage: opts.stage, message: `${opts.subject}: still invalid after one repair — initial: ${firstError} | after repair: ${secondError}`, hard: true });
  return { usage, failures, rawResponses };
}

/**
 * Experimental OpenRouter chat client for this track's structured calls.
 *
 * Mirrors the production `gateway/openrouter-provider.ts` request shape
 * (json_schema response format, usage.cost accounting, 429 retry-after), with
 * two differences the Claude-track model split needs, kept here so the
 * production gateway is not modified:
 *  - `reasoning.max_tokens` is only sent to hidden-reasoning "flash" models
 *    (qwen/deepseek), where it stops the reasoning trace from eating the
 *    whole completion budget. Anthropic endpoints reject that parameter
 *    combined with temperature 0 + strict schema (observed: HTTP 404 "No
 *    endpoints found that can handle the requested parameters").
 *  - For anthropic/* models the system prompt is sent as a cacheable content
 *    block (Anthropic prompt caching), since every scene of a lesson shares
 *    the same long planner system prompt.
 *  - Current Anthropic endpoints do not accept `temperature` (with
 *    require_parameters the request is filtered out; without it the value
 *    would be silently dropped). The spec asks for "temperature zero where
 *    supported", so it is omitted for anthropic/* and `temperatureApplied`
 *    reports that honestly.
 */
import { withHostResourcePermit } from '../../shared/hostResourcePool.js';

export interface ChatRequest {
  model: string;
  system: string;
  user: string;
  schema: object;
  schemaName: string;
  maxTokens: number;
  temperature: number;
  /** Provider per-million-token ceilings derived from the remaining stage budget. */
  maxPriceUsdPerMillionTokens?: { prompt: number; completion: number };
  /** Anthropic thinking effort (OpenRouter `reasoning.effort`); adaptive thinking otherwise spends ~3k tokens per scene. */
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  finishReason: string;
  temperatureApplied: boolean;
  /** false when the schema was too large for constrained decoding and only prompt + client validation applied. */
  schemaConstrained: boolean;
  /** Actual OpenRouter route metadata, when the response includes it. */
  routing?: { generationId?: string; selectedModel?: string; selectedProvider?: string; strategy?: string; attempt?: number };
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number; costUsd: number };
}

function routingTrace(data: { id?: unknown; model?: unknown; openrouter_metadata?: unknown }): ChatResult['routing'] {
  const meta = data.openrouter_metadata && typeof data.openrouter_metadata === 'object' ? data.openrouter_metadata as Record<string, unknown> : {};
  const endpoints = meta.endpoints && typeof meta.endpoints === 'object' ? (meta.endpoints as Record<string, unknown>).available : undefined;
  const selected = Array.isArray(endpoints) ? endpoints.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).selected === true) as Record<string, unknown> | undefined : undefined;
  const trace = {
    ...(typeof data.id === 'string' ? { generationId: data.id } : {}),
    ...(typeof data.model === 'string' ? { selectedModel: data.model } : {}),
    ...(typeof selected?.provider === 'string' ? { selectedProvider: selected.provider } : {}),
    ...(typeof meta.strategy === 'string' ? { strategy: meta.strategy } : {}),
    ...(Number.isInteger(meta.attempt) ? { attempt: meta.attempt as number } : {}),
  };
  return Object.keys(trace).length ? trace : undefined;
}

function requiredUsageNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`OpenRouter response omitted or returned invalid usage.${field}; refusing to record unverified spend`);
  }
  return parsed;
}

// Routes whose hidden reasoning counts against max_tokens; they get a bounded reasoning allowance (gemini-3.8-flash spent ~2.2k of 2.5k S6 tokens thinking and truncated its JSON, 2026-09-26).
const HIDDEN_REASONING = ['qwen/', 'deepseek/', 'inclusionai/', 'google/'];
const configuredProviderConcurrency = Number(process.env.HYPOTHESIS_PROVIDER_CONCURRENCY);
const PROVIDER_CONCURRENCY = Number.isInteger(configuredProviderConcurrency) && configuredProviderConcurrency >= 1
  ? Math.min(32, configuredProviderConcurrency)
  : 2;

/**
 * Split most of the remaining call budget across prompt and completion, with
 * headroom for provider framing/request charges. UTF-8 byte length is a
 * conservative text-token upper bound for byte-pair tokenizers; the fixed
 * framing margin covers chat wrapper tokens. OpenRouter enforces these
 * per-million-token price ceilings before routing a request.
 *
 * P5 bakeoff escape hatches (env-configurable, defaults unchanged — unset or
 * invalid reads behave exactly as before):
 * - HYPOTHESIS_MAX_PRICE_MULTIPLIER scales both ceilings (default 1). >1
 *   unblocks models whose cheapest opted-in endpoint sits above our tight
 *   lesson-derived ceiling (observed: google/gemini-3.8-flash 404 "No
 *   endpoints found that satisfy the max price", 2026-09-26).
 * - HYPOTHESIS_MAX_PRICE_OVERRIDE_JSON is a longest-prefix-matched per-model
 *   raise-only floor, e.g. {"google/gemini-3.8-flash":{"prompt":2,
 *   "completion":8}}. It can only raise a ceiling, never lower one.
 */
export function maxPriceMultiplier(): number {
  const raw = Number(process.env.HYPOTHESIS_MAX_PRICE_MULTIPLIER);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function modelMaxPriceFloor(model: string): { prompt: number; completion: number } | undefined {
  const raw = process.env.HYPOTHESIS_MAX_PRICE_OVERRIDE_JSON;
  if (!raw || !raw.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    let best: { prompt: number; completion: number } | undefined;
    let bestLen = -1;
    for (const [prefix, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!model.startsWith(prefix) || prefix.length <= bestLen) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const rec = value as Record<string, unknown>;
      const prompt = Number(rec.prompt);
      const completion = Number(rec.completion);
      if (Number.isFinite(prompt) && prompt >= 0 && Number.isFinite(completion) && completion >= 0) {
        best = { prompt, completion };
        bestLen = prefix.length;
      }
    }
    return best;
  } catch {
    return undefined; // malformed JSON fails closed: no override, exactly like today
  }
}

export function maxPriceForCallBudget(remainingUsd: number, promptUtf8Bytes: number, maxTokens: number, model?: string): { prompt: number; completion: number } | undefined {
  if (!Number.isFinite(remainingUsd) || remainingUsd <= 0 || !Number.isFinite(promptUtf8Bytes) || promptUtf8Bytes < 0 || !Number.isFinite(maxTokens) || maxTokens <= 0) return undefined;
  const tokenBudgetUsd = remainingUsd * 0.9;
  const promptTokenUpperBound = promptUtf8Bytes + 2048;
  const promptBudgetUsd = tokenBudgetUsd * 0.5;
  const completionBudgetUsd = tokenBudgetUsd * 0.5;
  const floorUsdPerMillion = (usd: number, tokens: number) => Math.floor((usd * 1_000_000 / tokens) * 1_000_000) / 1_000_000;
  let prompt = floorUsdPerMillion(promptBudgetUsd, promptTokenUpperBound);
  let completion = floorUsdPerMillion(completionBudgetUsd, maxTokens);
  const multiplier = maxPriceMultiplier();
  if (multiplier !== 1) {
    const scale = (v: number) => Math.floor(v * multiplier * 1_000_000) / 1_000_000;
    prompt = scale(prompt);
    completion = scale(completion);
  }
  if (model) {
    const floor = modelMaxPriceFloor(model);
    if (floor) {
      prompt = Math.max(prompt, floor.prompt);
      completion = Math.max(completion, floor.completion);
    }
  }
  return { prompt, completion };
}

/**
 * Tier-row opt-in for OpenRouter routing (P5). The routing funnel excludes
 * tier endpoint rows unless the request opts in ("Excluded tier endpoint
 * rows the request did not opt into", gemini bakeoff 2026-09-26); opt-in is
 * via the top-level `service_tier` parameter, `:nitro`/`:floor` variants, or
 * tier endpoint slugs (openrouter.ai/docs/guides/features/service-tiers).
 * OPENROUTER_ALLOW_TIER_ROWS unset/0/false = nothing sent (today).
 * 1/true = "priority" (tier endpoints tried first, falls back to standard —
 * admission only, never a restriction). An explicit flex|priority|fast value
 * requests that tier directly. Anything else fails closed to unset.
 */
const SERVICE_TIERS = new Set(['flex', 'priority', 'fast']);

export function openrouterServiceTier(): 'flex' | 'priority' | 'fast' | undefined {
  const raw = (process.env.OPENROUTER_ALLOW_TIER_ROWS ?? '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return undefined;
  if (SERVICE_TIERS.has(raw)) return raw as 'flex' | 'priority' | 'fast';
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return 'priority';
  return undefined;
}

const DROP_FOR_ANTHROPIC = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'format']);

/**
 * OpenRouter answered before any model endpoint ran: no endpoint satisfied the
 * request (routing or `max_price` filter), or throttling persisted after the
 * built-in 429 waits. No completion and no usage exist, so the budget ledger
 * records it as a preflight failure instead of an uncertain charge.
 */
export class ProviderNotDispatchedError extends Error {
  readonly status: number;
  readonly code: 'PROVIDER_NO_ENDPOINT' | 'PROVIDER_RATE_LIMITED';
  constructor(status: number, code: 'PROVIDER_NO_ENDPOINT' | 'PROVIDER_RATE_LIMITED', detail: string) {
    super(`OpenRouter HTTP ${status}${detail ? ` — ${detail.slice(0, 400)}` : ''}`, { cause: { code } });
    this.name = 'ProviderNotDispatchedError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Cause codes that prove a call never reached a model endpoint: DNS and
 * connection failures happen before an HTTP request can be sent, and the
 * provider's no-endpoint/rate-limit rejections mean no endpoint ran. Shared
 * by the transport retry (structuredCall) and the ledger preflight path
 * (budgetLedger) so the two can never disagree about what is retryable.
 */
export const PREFLIGHT_CAUSE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE',
  'PROVIDER_NO_ENDPOINT', 'PROVIDER_RATE_LIMITED',
]);

/** First string `code` found walking the error `cause` chain (undici nests it). */
export function transportCauseCode(error: unknown): string {
  let cursor: unknown = error;
  const seen = new Set<unknown>();
  while (cursor && (typeof cursor === 'object' || typeof cursor === 'function') && !seen.has(cursor)) {
    seen.add(cursor);
    const record = cursor as { code?: unknown; cause?: unknown };
    if (typeof record.code === 'string' && record.code) return record.code;
    cursor = record.cause;
  }
  return '';
}

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = error;
  const seen = new Set<unknown>();
  while (cursor && (typeof cursor === 'object' || typeof cursor === 'function') && !seen.has(cursor)) {
    seen.add(cursor);
    const record = cursor as { name?: unknown; message?: unknown; cause?: unknown };
    if (typeof record.name === 'string' && record.name) parts.push(record.name);
    if (typeof record.message === 'string' && record.message) parts.push(record.message);
    cursor = record.cause;
  }
  if (parts.length === 0) parts.push(String(error));
  return parts.join(' | ');
}

// Undici surfaces network failures as `TypeError: fetch failed` (sometimes
// with no cause code); the RAG sidecar surfaces its own provider throttling
// as a plain `RateLimitError ... 429 ...` message with no cause at all.
const NETWORK_FAILURE_MESSAGE = /fetch failed|failed to fetch|network request failed|load failed|socket hang up|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EPIPE/i;
const RATE_LIMIT_MESSAGE = /\b429\b|rate.?limit|too many requests/i;

/**
 * True when the failure happened before any model endpoint could run: a
 * typed not-dispatched rejection, a DNS/connection network failure, or a
 * throttling signal. Aborts and per-call timeouts are deliberately excluded:
 * the request may have dispatched, so spend is uncertain and fail-closed
 * handling must apply.
 */
export function isTransportError(error: unknown): boolean {
  if (error instanceof ProviderNotDispatchedError) return true;
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return false;
  const text = errorChainText(error);
  if (/\bAbortError\b|\bTimeoutError\b|operation was aborted|operation timed out/i.test(text)) return false;
  if (PREFLIGHT_CAUSE_CODES.has(transportCauseCode(error))) return true;
  return NETWORK_FAILURE_MESSAGE.test(text) || RATE_LIMIT_MESSAGE.test(text);
}

/**
 * Anthropic structured outputs accept a JSON-Schema subset: `anyOf` but not
 * `oneOf`, no numeric/string-length constraints, no complex array
 * constraints (tuples), and `additionalProperties: false` on every object.
 * The shape is kept; dropped constraints are still enforced client-side by
 * the stage's zod schema (structuredCall validates every response and gives
 * the model its one repair on any violation).
 */
/** Anthropic compiles strict schemas to a grammar and rejects those with too many optional parameters (observed: 79 -> HTTP 400). */
export const ANTHROPIC_MAX_OPTIONAL = 24;

export function countOptional(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((s, n) => s + countOptional(n), 0);
  if (!node || typeof node !== 'object') return 0;
  const o = node as Record<string, unknown>;
  let n = 0;
  if (o.properties && typeof o.properties === 'object') {
    const req = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
    n += Object.keys(o.properties).filter((k) => !req.has(k)).length;
  }
  for (const v of Object.values(o)) n += countOptional(v);
  return n;
}

export function toAnthropicSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toAnthropicSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (DROP_FOR_ANTHROPIC.has(k)) continue;
    if (k === 'oneOf') { out.anyOf = toAnthropicSchema(v); continue; }
    if (k === 'prefixItems' && Array.isArray(v)) {
      // Tuples become homogeneous arrays of the first item's type; zod re-checks the arity.
      out.items = toAnthropicSchema(v[0]);
      continue;
    }
    out[k] = toAnthropicSchema(v);
  }
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

/**
 * OpenAI strict structured outputs require every property to be listed in
 * `required` (observed: HTTP 400 "Missing 'latex'" for our optional fields).
 * Those routes get the same schema non-strict; the caller's zod validation and
 * one repair still enforce the full contract, so nothing is accepted unchecked.
 */
const STRICT_NEEDS_ALL_REQUIRED = ['openai/', '~openai/'];

/**
 * A non-strict route does not enforce length or count limits while decoding,
 * so state them: one line per constrained field, derived from the schema
 * itself (e.g. "intro.sections[]: at most 80 characters").
 */
export function schemaLimitLines(node: unknown, path = ''): string[] {
  if (!node || typeof node !== 'object') return [];
  const o = node as Record<string, unknown>;
  const lines: string[] = [];
  const where = path || '(root)';
  if (typeof o.maxLength === 'number') lines.push(`${where}: at most ${o.maxLength} characters`);
  if (typeof o.maxItems === 'number') lines.push(`${where}: at most ${o.maxItems} items`);
  if (typeof o.minItems === 'number' && o.minItems > 0) lines.push(`${where}: at least ${o.minItems} items`);
  if (o.properties && typeof o.properties === 'object') {
    for (const [key, value] of Object.entries(o.properties as Record<string, unknown>)) lines.push(...schemaLimitLines(value, path ? `${path}.${key}` : key));
  }
  if (o.items) lines.push(...schemaLimitLines(o.items, `${path}[]`));
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) if (Array.isArray(o[key])) for (const branch of o[key] as unknown[]) lines.push(...schemaLimitLines(branch, path));
  return [...new Set(lines)];
}

export async function chatStructured(apiKey: string, req: ChatRequest, fetcher: typeof fetch = fetch): Promise<ChatResult> {
  const reasoningModel = HIDDEN_REASONING.some((p) => req.model.startsWith(p));
  const anthropic = req.model.startsWith('anthropic/');
  const anthropicSchema = anthropic ? toAnthropicSchema(req.schema) : undefined;
  // Too large for Anthropic's grammar compiler: fall back to the prompt's JSON contract; the caller
  // still validates the full zod schema and gets its one repair, so nothing is accepted unchecked.
  const constrained = !anthropic || countOptional(anthropicSchema) <= ANTHROPIC_MAX_OPTIONAL;
  const strict = !STRICT_NEEDS_ALL_REQUIRED.some((prefix) => req.model.startsWith(prefix));
  const limits = strict ? [] : schemaLimitLines(req.schema);
  const system = limits.length ? `${req.system}\n\nField limits (validated; a response that breaks one is rejected):\n${limits.map((line) => `- ${line}`).join('\n')}` : req.system;
  const serviceTier = openrouterServiceTier();
  const body = {
    model: req.model,
    ...(serviceTier ? { service_tier: serviceTier } : {}),
    ...(anthropic ? {} : { temperature: req.temperature }),
    max_tokens: req.maxTokens,
    ...(reasoningModel ? { reasoning: { max_tokens: Math.min(1200, Math.max(200, Math.round(req.maxTokens / 4))) } } : {}),
    // Effort is honoured by Anthropic and OpenAI reasoning routes; without it gpt-6-luna S6 calls ranged 9-70 s (2026-09-26).
    ...((anthropic || !strict) && req.effort ? { reasoning: { effort: req.effort } } : {}),
    ...(constrained ? { response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict, schema: anthropicSchema ?? req.schema } } } : {}),
    ...(req.maxPriceUsdPerMillionTokens || reasoningModel || !constrained ? {
      provider: {
        ...(reasoningModel || !constrained ? { require_parameters: true } : {}),
        ...(req.maxPriceUsdPerMillionTokens ? { max_price: req.maxPriceUsdPerMillionTokens } : {}),
      },
    } : {}),
    messages: [
      anthropic
        ? { role: 'system', content: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] }
        : { role: 'system', content: system },
      { role: 'user', content: req.user },
    ],
    usage: { include: true },
  };
  const init: RequestInit = { method: 'POST', signal: req.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-OpenRouter-Metadata': 'enabled' }, body: JSON.stringify(body) };
  let response!: Response;
  for (let throttle = 0; ; throttle++) {
    response = await withHostResourcePermit('provider', PROVIDER_CONCURRENCY, () => fetcher('https://openrouter.ai/api/v1/chat/completions', init), { signal: req.signal });
    if (response.status !== 429 || throttle >= 2) break;
    const seconds = Number(response.headers.get('retry-after')) || [15, 30][throttle] || 30;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, seconds * 1000);
      req.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(req.signal?.reason ?? new Error('Aborted')); }, { once: true });
    });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 404 && /no endpoints found/i.test(text)) throw new ProviderNotDispatchedError(404, 'PROVIDER_NO_ENDPOINT', text);
    if (response.status === 429) throw new ProviderNotDispatchedError(429, 'PROVIDER_RATE_LIMITED', text);
    throw new Error(`OpenRouter HTTP ${response.status}${text ? ` — ${text.slice(0, 400)}` : ''}`);
  }
  const data = (await response.json()) as {
    id?: unknown;
    model?: unknown;
    openrouter_metadata?: unknown;
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; cached_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  // An empty completion (e.g. a reasoning model spending its whole budget thinking) is invalid OUTPUT, not a
  // transport failure: return it so the caller's validator rejects it and the stage gets its one repair.
  const raw = data.choices?.[0]?.message?.content;
  const content = typeof raw === 'string' ? raw : '';
  const promptTokens = requiredUsageNumber(data.usage?.prompt_tokens, 'prompt_tokens');
  const completionTokens = requiredUsageNumber(data.usage?.completion_tokens, 'completion_tokens');
  const costUsd = requiredUsageNumber(data.usage?.cost, 'cost');
  return {
    content,
    finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
    temperatureApplied: !anthropic,
    schemaConstrained: constrained,
    ...(routingTrace(data) ? { routing: routingTrace(data) } : {}),
    usage: {
      promptTokens,
      completionTokens,
      cachedTokens: Number(data.usage?.cached_tokens ?? data.usage?.prompt_tokens_details?.cached_tokens) || 0,
      costUsd,
    },
  };
}

/** One vision call (VLM judge): prompt + images, JSON requested by prompt; returns raw text + usage. */
export async function chatVision(apiKey: string, req: { model: string; prompt: string; imagesPng: Buffer[]; maxTokens: number; signal?: AbortSignal }, fetcher: typeof fetch = fetch): Promise<Omit<ChatResult, 'schemaConstrained' | 'temperatureApplied'>> {
  const reasoningModel = HIDDEN_REASONING.some((p) => req.model.startsWith(p));
  const serviceTier = openrouterServiceTier();
  const body = {
    model: req.model,
    ...(serviceTier ? { service_tier: serviceTier } : {}),
    max_tokens: req.maxTokens,
    ...(req.model.startsWith('anthropic/') ? {} : { temperature: 0 }),
    ...(reasoningModel ? { reasoning: { max_tokens: Math.min(800, Math.round(req.maxTokens / 3)) } } : {}),
    messages: [{ role: 'user', content: [{ type: 'text', text: req.prompt }, ...req.imagesPng.map((png) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }))] }],
    usage: { include: true },
  };
  const response = await withHostResourcePermit('provider', PROVIDER_CONCURRENCY, () => fetcher('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: req.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { signal: req.signal });
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status} — ${(await response.text().catch(() => '')).slice(0, 300)}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
  const raw = data.choices?.[0]?.message?.content;
  return {
    content: typeof raw === 'string' ? raw : '',
    finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
    usage: { promptTokens: Number(data.usage?.prompt_tokens) || 0, completionTokens: Number(data.usage?.completion_tokens) || 0, cachedTokens: 0, costUsd: Number(data.usage?.cost) || 0 },
  };
}

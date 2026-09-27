/**
 * Experimental OpenRouter chat client for this track's structured calls.
 *
 * Requests use a strict json_schema response format, read billed cost from
 * `usage.cost`, honour 429 retry-after, and handle provider differences:
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
import { PIPELINE } from '../config.js';

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
  /** Per-request timeout. It starts when the request gets a provider slot, not while it queues. */
  timeoutMs?: number;
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

let baseUrl = 'https://openrouter.ai/api/v1';

/** Point every call at a different OpenRouter-compatible endpoint (OPENROUTER_BASE_URL). */
export function setOpenRouterBaseUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') throw new Error('OPENROUTER_BASE_URL must use https (or a localhost test server)');
  baseUrl = url.replace(/\/+$/, '');
}

export const openRouterBaseUrl = (): string => baseUrl;

/** Published per-token prices for one model (USD per token). */
export interface ModelPricing { promptUsdPerToken: number; completionUsdPerToken: number }

const pricingCache = new Map<string, Promise<Map<string, ModelPricing>>>();

/**
 * Per-token prices from `GET {base}/models`, fetched once per endpoint per
 * process. Returns undefined for an unknown model or when the listing cannot
 * be read; callers then fall back to a budget-split price ceiling.
 */
export async function fetchModelPricing(model: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<ModelPricing | undefined> {
  const url = `${baseUrl}/models`;
  let listing = pricingCache.get(url);
  if (!listing) {
    listing = (async () => {
      const prices = new Map<string, ModelPricing>();
      try {
        const response = await fetcher(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
        if (!response.ok) return prices;
        const data = (await response.json()) as { data?: Array<{ id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }> };
        for (const entry of Array.isArray(data.data) ? data.data : []) {
          const prompt = Number(entry.pricing?.prompt);
          const completion = Number(entry.pricing?.completion);
          if (typeof entry.id === 'string' && Number.isFinite(prompt) && prompt >= 0 && Number.isFinite(completion) && completion >= 0) prices.set(entry.id, { promptUsdPerToken: prompt, completionUsdPerToken: completion });
        }
      } catch {
        // An unreadable listing only disables price-aware routing; the budget-split ceiling still applies.
      }
      return prices;
    })();
    pricingCache.set(url, listing);
  }
  return (await listing).get(model);
}

/**
 * Conservative prompt-token estimate from UTF-8 bytes: English and JSON run at
 * about 3-4.5 bytes per token, so bytes/2 plus chat framing stays above the
 * real count for ordinary text without excluding models by a 3-5x margin the
 * way one-token-per-byte did (the 2026-09-26 Gemini "no endpoints within max
 * price" 404s). The durable ledger still records actual billed spend.
 */
export const promptTokenEstimate = (promptUtf8Bytes: number): number => Math.ceil(promptUtf8Bytes / 2) + 1024;

/** Worst-case USD for one call at a model's own prices, if it uses every completion token. */
export function worstCaseCallUsd(pricing: ModelPricing, promptUtf8Bytes: number, maxTokens: number): number {
  return promptTokenEstimate(promptUtf8Bytes) * pricing.promptUsdPerToken + maxTokens * pricing.completionUsdPerToken;
}

/** max_price for a model with known prices: its own price plus 25% headroom, so routing may not pick a pricier endpoint. */
export function priceCeilingForModel(pricing: ModelPricing): { prompt: number; completion: number } {
  const perMillion = (usdPerToken: number) => Math.ceil(usdPerToken * 1.25 * 1e12) / 1e6;
  return { prompt: perMillion(pricing.promptUsdPerToken), completion: perMillion(pricing.completionUsdPerToken) };
}

/**
 * Fallback when a model's prices are unknown: split most of the remaining call budget across prompt and completion, with
 * headroom for provider framing/request charges (see promptTokenEstimate).
 * OpenRouter enforces these per-million-token price ceilings before routing a
 * request.
 */
export function maxPriceForCallBudget(remainingUsd: number, promptUtf8Bytes: number, maxTokens: number): { prompt: number; completion: number } | undefined {
  if (!Number.isFinite(remainingUsd) || remainingUsd <= 0 || !Number.isFinite(promptUtf8Bytes) || promptUtf8Bytes < 0 || !Number.isFinite(maxTokens) || maxTokens <= 0) return undefined;
  const tokenBudgetUsd = remainingUsd * 0.9;
  const promptTokenUpperBound = promptTokenEstimate(promptUtf8Bytes);
  const promptBudgetUsd = tokenBudgetUsd * 0.5;
  const completionBudgetUsd = tokenBudgetUsd * 0.5;
  const floorUsdPerMillion = (usd: number, tokens: number) => Math.floor((usd * 1_000_000 / tokens) * 1_000_000) / 1_000_000;
  return {
    prompt: floorUsdPerMillion(promptBudgetUsd, promptTokenUpperBound),
    completion: floorUsdPerMillion(completionBudgetUsd, maxTokens),
  };
}

const DROP_FOR_ANTHROPIC = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'format']);

/**
 * No model endpoint ran, so no completion and no charge exist and the budget
 * ledger records a preflight failure instead of an uncertain charge:
 * - PROVIDER_NO_ENDPOINT: no endpoint satisfied routing or `max_price` (retryable);
 * - PROVIDER_RATE_LIMITED: throttling persisted after the built-in 429 waits (retryable);
 * - PROVIDER_REJECTED: a 4xx the request itself caused (auth, credit, bad parameters, unknown model);
 * - PROVIDER_NOT_SENT: the caller aborted while the request was still queued.
 */
export type NotDispatchedCode = 'PROVIDER_NO_ENDPOINT' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_REJECTED' | 'PROVIDER_NOT_SENT';
export const RETRYABLE_NOT_DISPATCHED: readonly NotDispatchedCode[] = ['PROVIDER_NO_ENDPOINT', 'PROVIDER_RATE_LIMITED'];

export class ProviderNotDispatchedError extends Error {
  readonly status: number;
  readonly code: NotDispatchedCode;
  constructor(status: number, code: NotDispatchedCode, detail: string) {
    super(`OpenRouter ${status ? `HTTP ${status}` : 'request not sent'}${detail ? ` — ${detail.slice(0, 400)}` : ''}`, { cause: { code } });
    this.name = 'ProviderNotDispatchedError';
    this.status = status;
    this.code = code;
  }
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

/**
 * POST to `{base}/chat/completions` under the host provider permit, retrying a
 * 429 up to twice. The timeout starts when the request first holds a permit
 * (queue time is not charged to it) and also covers reading the body, because
 * the returned response keeps the same abort signal.
 */
async function sendChat(body: unknown, apiKey: string, fetcher: typeof fetch, opts: { signal?: AbortSignal; timeoutMs?: number; metadata?: boolean }): Promise<Response> {
  let requestSignal: AbortSignal | undefined;
  const signalForSend = () => {
    if (!requestSignal) {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? PIPELINE.providerTimeoutMs);
      requestSignal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    }
    return requestSignal;
  };
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(opts.metadata ? { 'X-OpenRouter-Metadata': 'enabled' } : {}) };
  let sent = false;
  let response!: Response;
  try {
    for (let throttle = 0; ; throttle++) {
      response = await withHostResourcePermit('provider', PROVIDER_CONCURRENCY, () => {
        sent = true;
        return fetcher(`${baseUrl}/chat/completions`, { method: 'POST', signal: signalForSend(), headers, body: JSON.stringify(body) });
      }, { signal: opts.signal });
      if (response.status !== 429 || throttle >= 2) break;
      const seconds = Number(response.headers.get('retry-after')) || [15, 30][throttle] || 30;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, seconds * 1000);
        opts.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(opts.signal?.reason ?? new Error('Aborted')); }, { once: true });
      });
    }
  } catch (error) {
    if (!sent) throw new ProviderNotDispatchedError(0, 'PROVIDER_NOT_SENT', error instanceof Error ? error.message : String(error));
    throw error;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 404 && /no endpoints found/i.test(text)) throw new ProviderNotDispatchedError(404, 'PROVIDER_NO_ENDPOINT', text);
    if (response.status === 429) throw new ProviderNotDispatchedError(429, 'PROVIDER_RATE_LIMITED', text);
    // Any other 4xx except a request timeout is caused by the request itself; no model ran.
    if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new ProviderNotDispatchedError(response.status, 'PROVIDER_REJECTED', text);
    throw new Error(`OpenRouter HTTP ${response.status}${text ? ` — ${text.slice(0, 400)}` : ''}`);
  }
  return response;
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
  const reasoning = {
    ...(reasoningModel ? { max_tokens: Math.min(1200, Math.max(200, Math.round(req.maxTokens / 4))) } : {}),
    ...((anthropic || !strict) && req.effort ? { effort: req.effort } : {}),
  };
  const body = {
    model: req.model,
    ...(anthropic ? {} : { temperature: req.temperature }),
    max_tokens: req.maxTokens,
    // Hidden-reasoning routes get a bounded thinking allowance; effort is honoured by Anthropic and OpenAI
    // reasoning routes (without it gpt-6-luna S6 calls ranged 9-70 s, 2026-09-26). One object, never overwritten.
    ...(Object.keys(reasoning).length ? { reasoning } : {}),
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
  const response = await sendChat(body, apiKey, fetcher, { signal: req.signal, timeoutMs: req.timeoutMs, metadata: true });
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
  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.model.startsWith('anthropic/') ? {} : { temperature: 0 }),
    ...(reasoningModel ? { reasoning: { max_tokens: Math.min(800, Math.round(req.maxTokens / 3)) } } : {}),
    messages: [{ role: 'user', content: [{ type: 'text', text: req.prompt }, ...req.imagesPng.map((png) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }))] }],
    usage: { include: true },
  };
  const response = await sendChat(body, apiKey, fetcher, { signal: req.signal });
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
  const raw = data.choices?.[0]?.message?.content;
  return {
    content: typeof raw === 'string' ? raw : '',
    finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
    // Same fail-closed rule as chatStructured: a missing cost is an error, never $0.
    usage: { promptTokens: requiredUsageNumber(data.usage?.prompt_tokens, 'prompt_tokens'), completionTokens: requiredUsageNumber(data.usage?.completion_tokens, 'completion_tokens'), cachedTokens: 0, costUsd: requiredUsageNumber(data.usage?.cost, 'cost') },
  };
}

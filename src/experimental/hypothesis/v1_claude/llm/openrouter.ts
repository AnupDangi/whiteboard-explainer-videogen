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

const HIDDEN_REASONING = ['qwen/', 'deepseek/', 'inclusionai/'];

/**
 * Split most of the remaining call budget across prompt and completion, with
 * headroom for provider framing/request charges. UTF-8 byte length is a
 * conservative text-token upper bound for byte-pair tokenizers; the fixed
 * framing margin covers chat wrapper tokens. OpenRouter enforces these
 * per-million-token price ceilings before routing a request.
 */
export function maxPriceForCallBudget(remainingUsd: number, promptUtf8Bytes: number, maxTokens: number): { prompt: number; completion: number } | undefined {
  if (!Number.isFinite(remainingUsd) || remainingUsd <= 0 || !Number.isFinite(promptUtf8Bytes) || promptUtf8Bytes < 0 || !Number.isFinite(maxTokens) || maxTokens <= 0) return undefined;
  const tokenBudgetUsd = remainingUsd * 0.9;
  const promptTokenUpperBound = promptUtf8Bytes + 2048;
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

export async function chatStructured(apiKey: string, req: ChatRequest, fetcher: typeof fetch = fetch): Promise<ChatResult> {
  const reasoningModel = HIDDEN_REASONING.some((p) => req.model.startsWith(p));
  const anthropic = req.model.startsWith('anthropic/');
  const anthropicSchema = anthropic ? toAnthropicSchema(req.schema) : undefined;
  // Too large for Anthropic's grammar compiler: fall back to the prompt's JSON contract; the caller
  // still validates the full zod schema and gets its one repair, so nothing is accepted unchecked.
  const constrained = !anthropic || countOptional(anthropicSchema) <= ANTHROPIC_MAX_OPTIONAL;
  const body = {
    model: req.model,
    ...(anthropic ? {} : { temperature: req.temperature }),
    max_tokens: req.maxTokens,
    ...(reasoningModel ? { reasoning: { max_tokens: Math.min(1200, Math.max(200, Math.round(req.maxTokens / 4))) } } : {}),
    ...(anthropic && req.effort ? { reasoning: { effort: req.effort } } : {}),
    ...(constrained ? { response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: !STRICT_NEEDS_ALL_REQUIRED.some((prefix) => req.model.startsWith(prefix)), schema: anthropicSchema ?? req.schema } } } : {}),
    ...(req.maxPriceUsdPerMillionTokens || reasoningModel || !constrained ? {
      provider: {
        ...(reasoningModel || !constrained ? { require_parameters: true } : {}),
        ...(req.maxPriceUsdPerMillionTokens ? { max_price: req.maxPriceUsdPerMillionTokens } : {}),
      },
    } : {}),
    messages: [
      anthropic
        ? { role: 'system', content: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }] }
        : { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    usage: { include: true },
  };
  const init: RequestInit = { method: 'POST', signal: req.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-OpenRouter-Metadata': 'enabled' }, body: JSON.stringify(body) };
  let response!: Response;
  for (let throttle = 0; ; throttle++) {
    response = await fetcher('https://openrouter.ai/api/v1/chat/completions', init);
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
  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.model.startsWith('anthropic/') ? {} : { temperature: 0 }),
    ...(reasoningModel ? { reasoning: { max_tokens: Math.min(800, Math.round(req.maxTokens / 3)) } } : {}),
    messages: [{ role: 'user', content: [{ type: 'text', text: req.prompt }, ...req.imagesPng.map((png) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }))] }],
    usage: { include: true },
  };
  const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: req.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status} — ${(await response.text().catch(() => '')).slice(0, 300)}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
  const raw = data.choices?.[0]?.message?.content;
  return {
    content: typeof raw === 'string' ? raw : '',
    finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
    usage: { promptTokens: Number(data.usage?.prompt_tokens) || 0, completionTokens: Number(data.usage?.completion_tokens) || 0, cachedTokens: 0, costUsd: Number(data.usage?.cost) || 0 },
  };
}

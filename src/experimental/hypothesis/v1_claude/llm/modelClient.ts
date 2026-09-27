import { chatStructured, fetchModelPricing, type ChatRequest, type ChatResult, type ModelPricing } from './openrouter.js';

/**
 * The seam between pipeline stages and a model provider. Stages depend only on
 * this interface (via llm/structuredCall.ts), so a new provider is one adapter:
 * implement `chat` (structured JSON completion with billed usage) and,
 * optionally, `pricing` (published per-token prices for budget preflight).
 *
 * Adapter rules: throw ProviderNotDispatchedError when no model ran (nothing
 * billed), a plain Error when the outcome is uncertain, and never report a
 * missing cost as $0.
 */
export interface ModelClient {
  /** Provider name recorded with each call. */
  readonly provider: string;
  chat(request: ChatRequest): Promise<ChatResult>;
  pricing?(model: string): Promise<ModelPricing | undefined>;
}

/**
 * OpenRouter adapter. Published prices are read from `GET /models` only when
 * the default network transport is used; an injected test transport gets no
 * pricing lookup, so request-contract tests see exactly the calls they make.
 */
export function openRouterClient(apiKey: string, fetcher?: typeof fetch): ModelClient {
  return {
    provider: 'openrouter',
    chat: (request) => chatStructured(apiKey, request, fetcher),
    ...(fetcher ? {} : { pricing: (model: string) => fetchModelPricing(model, apiKey) }),
  };
}

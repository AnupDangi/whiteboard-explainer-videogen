import { compileOpenAiStrict, type CompiledSchema } from './openaiStrict.js';

export type { CompiledSchema } from './openaiStrict.js';
export type SchemaProvider = 'openai-strict' | 'anthropic' | 'generic';

/** Provider class from the OpenRouter model route (the same prefixes llm/openrouter.ts already branches on). */
export function providerForModel(model: string): SchemaProvider {
  if (model.startsWith('openai/') || model.startsWith('~openai/')) return 'openai-strict';
  if (model.startsWith('anthropic/')) return 'anthropic';
  return 'generic';
}

/**
 * The wire schema for one provider class. Anthropic keeps its own grammar conversion in llm/openrouter.ts
 * (it can refuse a schema with too many optional fields); generic routes receive the schema unchanged.
 */
export function compileProviderSchema(jsonSchema: Record<string, unknown>, provider: SchemaProvider): CompiledSchema {
  if (provider === 'openai-strict') return compileOpenAiStrict(jsonSchema);
  return { schema: jsonSchema, strict: true, optionalPaths: [], droppedKeywords: [] };
}

import { canonicalWarnings, canonicalizeText, newCanonicalCounts } from './blocks.js';
import type { SourceExtraction, SourceExtractor } from './types.js';

/**
 * Plain text, Markdown and JSON. JSON is pretty-printed so its values fall on
 * separate lines. A URL text source gets one `web-url` location for the whole text.
 */
export const textExtractor: SourceExtractor = {
  id: 'text-utf8',
  version: '2',
  kinds: ['text', 'markdown', 'json'],
  async available() { return { ok: true }; },
  async extract(input): Promise<SourceExtraction> {
    const raw = new TextDecoder('utf-8').decode(input.bytes);
    const isJson = /\.json$/i.test(input.name) || /application\/json/i.test(input.contentType ?? '');
    const isMarkdown = /\.(?:md|markdown)$/i.test(input.name) || /text\/markdown/i.test(input.contentType ?? '');
    const counts = newCanonicalCounts();
    const text = canonicalizeText(isJson ? JSON.stringify(JSON.parse(raw), null, 2) : raw, counts);
    return {
      format: isMarkdown ? 'markdown' : 'text',
      text,
      nativeLocations: input.url ? [{ startChar: 0, endChar: text.length, sourceLocation: { kind: 'web-url', url: input.url } }] : [],
      figures: [],
      warnings: canonicalWarnings(counts),
    };
  },
};

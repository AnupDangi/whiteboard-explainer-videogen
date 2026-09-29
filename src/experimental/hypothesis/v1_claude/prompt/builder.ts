import { sha256 } from '../../shared/artifacts.js';

/**
 * Deterministic prompt assembly. Sections render in the given order as
 * "## title\nbody" (or body alone), joined by one blank line. Each section and
 * the whole prompt get a SHA-256, so prompt experiments can report which
 * section changed. No model writes prompt text.
 */
export interface PromptSection { id: string; title?: string; body: string }
export interface BuiltPrompt { text: string; sha256: string; sections: Array<{ id: string; sha256: string; chars: number }> }

export function buildPrompt(sections: PromptSection[], preamble?: string): BuiltPrompt {
  const seen = new Set<string>();
  const rendered = sections.map((section) => {
    if (seen.has(section.id)) throw new Error(`duplicate prompt section id ${section.id}`);
    seen.add(section.id);
    if (!section.body.trim()) throw new Error(`empty prompt section ${section.id}`);
    const text = section.title ? `## ${section.title}\n${section.body}` : section.body;
    return { id: section.id, text };
  });
  const text = [...(preamble ? [preamble] : []), ...rendered.map((r) => r.text)].join('\n\n');
  return { text, sha256: sha256(text), sections: rendered.map((r) => ({ id: r.id, sha256: sha256(r.text), chars: r.text.length })) };
}

/** JSON-Schema vocabulary plus top-level container names that must never appear as data ids. */
export const SCHEMA_KEYWORDS = ['type', 'required', 'properties', 'items', 'enum', 'anyof', 'oneof', 'allof', 'additionalproperties', '$schema', 'description', 'concepts', 'relations', 'prerequisites', 'sections', 'schema'] as const;

export function schemaKeywordLeaks(ids: string[]): string[] {
  const keywords = new Set<string>(SCHEMA_KEYWORDS);
  return ids.filter((id) => keywords.has(id.trim().toLowerCase()));
}

/**
 * null → absent at the paths a strict-schema compile made nullable (V2 plan Phase 1.1). A null anywhere else is
 * left alone so zod rejects it; this is the only value-level change made before validation. Input is not mutated.
 */
interface Trie { optional: boolean; children: Map<string, Trie> }

function buildTrie(paths: readonly string[]): Trie {
  const root: Trie = { optional: false, children: new Map() };
  for (const path of paths) {
    let node = root;
    for (const segment of path.split('/').filter(Boolean)) {
      let next = node.children.get(segment);
      if (!next) { next = { optional: false, children: new Map() }; node.children.set(segment, next); }
      node = next;
    }
    node.optional = true;
  }
  return root;
}

function walk(value: unknown, trie: Trie): unknown {
  if (Array.isArray(value)) {
    const item = trie.children.get('*');
    return item ? value.map((element) => walk(element, item)) : value;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const sub = trie.children.get(key);
      if (sub?.optional && child === null) continue;
      out[key] = sub ? walk(child, sub) : child;
    }
    return out;
  }
  return value;
}

export function normalizeNullable(value: unknown, optionalPaths: readonly string[]): unknown {
  if (optionalPaths.length === 0) return value;
  return walk(value, buildTrie(optionalPaths));
}

/**
 * OpenAI strict structured-output compiler (V2 plan Phase 1.1).
 *
 * OpenAI strict mode requires every object property in `required`, `additionalProperties: false`
 * at every depth, and rejects a few keywords. The pipeline's zod schemas have optional fields, so
 * each optional field becomes nullable on the wire (`anyOf: [T, null]`) and `normalizeNullable`
 * turns the null back into an absent key before zod validates. Nothing is relaxed: zod still
 * enforces every dropped bound, and the dropped keywords are reported so the prompt can state them.
 */
type Node = Record<string, unknown>;

export interface CompiledSchema {
  schema: Node;
  /** true when the provider decodes under this schema (the model cannot emit off-schema JSON). */
  strict: boolean;
  /** JSON-pointer-like paths of fields that were optional (`*` = any array item); null at these paths means absent. */
  optionalPaths: string[];
  /** Keywords removed because the provider rejects them; zod still enforces them client-side. */
  droppedKeywords: Array<{ path: string; keyword: string }>;
}

/** Keywords OpenAI strict mode does not accept. Array bounds, numeric bounds, pattern and enum are accepted. */
const OPENAI_DROPPED = ['minLength', 'maxLength', 'format', 'default', 'uniqueItems', 'propertyNames', 'patternProperties'] as const;

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && !Array.isArray(value);

function nullable(child: Node): Node {
  const branches = Array.isArray(child.anyOf) ? (child.anyOf as Node[]) : [child];
  if (branches.some((branch) => branch.type === 'null')) return { anyOf: branches };
  return { anyOf: [...branches, { type: 'null' }] };
}

export function compileOpenAiStrict(root: Node): CompiledSchema {
  if (root.type !== 'object') throw new Error('OpenAI strict mode needs an object at the schema root');
  const optionalPaths: string[] = [];
  const droppedKeywords: CompiledSchema['droppedKeywords'] = [];

  const visit = (node: Node, path: string): Node => {
    // JSON Schema allows `true` / `false` as whole schemas; they carry no keywords to rewrite.
    if (typeof node !== 'object' || node === null) return node;
    if ('$ref' in node || 'definitions' in node || '$defs' in node) throw new Error(`OpenAI strict compile: unresolved $ref/$defs at ${path || '/'}`);
    const out: Node = {};
    for (const [key, value] of Object.entries(node)) {
      if ((OPENAI_DROPPED as readonly string[]).includes(key)) { droppedKeywords.push({ path: path || '/', keyword: key }); continue; }
      if (key === 'properties' || key === 'required' || key === 'items' || key === 'prefixItems' || key === 'anyOf' || key === 'oneOf' || key === 'allOf' || key === 'additionalProperties') continue;
      out[key] = value;
    }
    if (isNode(node.properties)) {
      const requiredSet = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      const properties: Node = {};
      for (const [key, value] of Object.entries(node.properties)) {
        const childPath = `${path}/${key}`;
        let child = visit(value as Node, childPath);
        if (!requiredSet.has(key)) { optionalPaths.push(childPath); child = nullable(child); }
        properties[key] = child;
      }
      out.properties = properties;
      out.required = Object.keys(properties);
      out.additionalProperties = false;
    } else if (node.type === 'object') {
      out.properties = {};
      out.required = [];
      out.additionalProperties = false;
    }
    if (node.items !== undefined) out.items = visit(node.items as Node, `${path}/*`);
    if (Array.isArray(node.prefixItems)) out.items = visit((node.prefixItems as Node[])[0] as Node, `${path}/*`);
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      if (!Array.isArray(node[key])) continue;
      const branches = (node[key] as Node[]).map((branch) => visit(branch, path));
      out[key === 'oneOf' ? 'anyOf' : key] = branches;
    }
    return out;
  };

  return { schema: visit(root, ''), strict: true, optionalPaths: [...new Set(optionalPaths)], droppedKeywords };
}

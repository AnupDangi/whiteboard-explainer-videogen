import { z } from 'zod';

/**
 * JSON-pointer repair (V2 plan Phase 1.3). A failing document is repaired by patching only the pointers that
 * failed, never by asking the model to regenerate the whole object (which re-rolls every field that was fine).
 * The patch wire format keeps `value` as JSON text (`valueJson`) so it fits provider strict schemas, which cannot
 * express "any JSON value".
 */
export interface RepairPatch { op: 'replace' | 'add' | 'remove'; path: string; value?: unknown }

export const MAX_PATCHES_PER_REPAIR = 40;

export const JsonPatchResponseSchema = z.object({
  patches: z.array(z.object({
    op: z.enum(['replace', 'add', 'remove']),
    path: z.string().min(1).max(300),
    valueJson: z.string().max(6000).nullish(),
  }).strict()).min(1).max(MAX_PATCHES_PER_REPAIR),
}).strict();

const escapeSegment = (segment: string | number): string => String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
const unescapeSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~');

export const pointerFromPath = (path: ReadonlyArray<string | number | symbol>): string => path.map((segment) => `/${escapeSegment(String(segment))}`).join('');

function segmentsOf(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`pointer ${pointer} must start with "/"`);
  return pointer.slice(1).split('/').map(unescapeSegment);
}

export function valueAtPointer(doc: unknown, pointer: string): unknown {
  let node: unknown = doc;
  for (const segment of segmentsOf(pointer)) {
    if (Array.isArray(node)) node = /^(0|[1-9]\d*)$/.test(segment) ? node[Number(segment)] : undefined;
    else if (node && typeof node === 'object') node = (node as Record<string, unknown>)[segment];
    else return undefined;
  }
  return node;
}

/** Apply patches to a deep copy. `replace` and `remove` need an existing target; `add` needs an existing parent (`/-` appends to an array). */
export function applyPatches(doc: unknown, patches: readonly RepairPatch[]): unknown {
  const root = structuredClone(doc);
  const holder: { v: unknown } = { v: root };
  for (const patch of patches) {
    const segments = segmentsOf(patch.path);
    if (segments.length === 0) { if (patch.op === 'remove') throw new Error('cannot remove the document root'); holder.v = patch.value; continue; }
    const parentPointer = `/${segments.slice(0, -1).map(escapeSegment).join('/')}`.replace(/^\/$/, '');
    const parent = segments.length === 1 ? holder.v : valueAtPointer(holder.v, parentPointer);
    const key = segments[segments.length - 1]!;
    const resolveError = () => new Error(`patch path ${patch.path} does not resolve`);
    if (Array.isArray(parent)) {
      // RFC 6901 array index: canonical decimal digits, or `-` (one past the end) for an add only.
      const append = key === '-' && patch.op === 'add';
      if (!append && !/^(0|[1-9]\d*)$/.test(key)) throw resolveError();
      const index = append ? parent.length : Number(key);
      if (patch.op === 'add') { if (index > parent.length) throw resolveError(); parent.splice(index, 0, patch.value); }
      else { if (index >= parent.length) throw resolveError(); if (patch.op === 'replace') parent[index] = patch.value; else parent.splice(index, 1); }
    } else if (parent && typeof parent === 'object') {
      const record = parent as Record<string, unknown>;
      if (patch.op !== 'add' && !(key in record)) throw resolveError();
      if (patch.op === 'remove') delete record[key]; else record[key] = patch.value;
    } else throw resolveError();
  }
  return holder.v;
}

/** A patch may only touch a rejected pointer or something beneath it; ancestors and siblings hold accepted content. */
export function patchOutsideTargets(patches: readonly RepairPatch[], targets: readonly string[]): RepairPatch | undefined {
  const allowed = targets.map(segmentsOf);
  return patches.find((patch) => {
    const path = segmentsOf(patch.path);
    return !allowed.some((target) => target.length <= path.length && target.every((segment, i) => segment === path[i]));
  });
}

/** Decode a patch response: valueJson text becomes a value; a missing or non-JSON valueJson on replace/add is rejected. */
export function decodePatchResponse(content: string, schema?: Record<string, unknown>): RepairPatch[] {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { throw new Error('patch response is not JSON'); }
  const parsed = JsonPatchResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`patch response invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  return parsed.data.patches.map((patch) => {
    if (patch.op === 'remove') return { op: 'remove', path: patch.path };
    if (patch.valueJson == null) throw new Error(`patch ${patch.path}: valueJson is required for ${patch.op}`);
    try { return { op: patch.op, path: patch.path, value: JSON.parse(patch.valueJson) as unknown }; } catch {
      // A model often writes a replacement sentence as bare text. When the schema says this pointer holds a string, bare text is the string.
      if (schema && schemaAtPointer(schema, patch.path)?.type === 'string' && patch.valueJson.trim() && !/^[[{]/.test(patch.valueJson.trim())) return { op: patch.op, path: patch.path, value: patch.valueJson.trim().replace(/^"|"$/g, '') };
      throw new Error(`patch ${patch.path}: valueJson is not valid JSON text`);
    }
  });
}

type SchemaNode = Record<string, unknown>;
/** The JSON-schema fragment governing a pointer, when it can be found (best effort; used only to guide the model). */
export function schemaAtPointer(schema: SchemaNode, pointer: string): SchemaNode | undefined {
  let node: SchemaNode | undefined = schema;
  for (const segment of segmentsOf(pointer)) {
    if (!node) return undefined;
    const branches: SchemaNode[] = [node, ...(['anyOf', 'oneOf', 'allOf'] as const).flatMap((key) => (Array.isArray(node![key]) ? (node![key] as SchemaNode[]) : []))];
    let next: SchemaNode | undefined;
    for (const branch of branches) {
      const props = branch.properties as Record<string, SchemaNode> | undefined;
      if (props && segment in props) { next = props[segment]; break; }
      if (branch.items && /^\d+$/.test(segment)) { next = branch.items as SchemaNode; break; }
    }
    node = next;
  }
  return node;
}

export interface PatchPromptInput {
  originalUserPrompt: string;
  invalidDocument: unknown;
  issues: ReadonlyArray<{ path: string; message: string }>;
  schema: SchemaNode;
}

export function buildPatchRepairPrompt(input: PatchPromptInput): string {
  const lines = input.issues.map((issue) => {
    const current = JSON.stringify(valueAtPointer(input.invalidDocument, issue.path));
    const fragment = schemaAtPointer(input.schema, issue.path);
    return `- ${issue.path || '(root)'}: ${issue.message}\n  current value: ${current === undefined ? '(missing)' : current.slice(0, 400)}${fragment ? `\n  schema here: ${JSON.stringify(fragment).slice(0, 400)}` : ''}`;
  });
  return `${input.originalUserPrompt}
Your previous document was rejected by the validator at the locations below. Do NOT rewrite the document. Return ONLY a JSON patch for these locations:
{"patches":[{"op":"replace"|"add"|"remove","path":"<JSON pointer from the list>","valueJson":"<the new value as JSON text, omitted for remove>"}]}
Every other part of the document is accepted as it is.

Rejected locations:
${lines.join('\n')}`;
}

export const patchResponseJsonSchema = (): SchemaNode => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(JsonPatchResponseSchema) as SchemaNode;
  return rest;
};

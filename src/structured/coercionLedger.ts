import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

/**
 * Coercion ledger (V2 plan Phase 1.4). Every code-side change to a model's JSON before or during validation is
 * recorded with its path, old and new value, reason and semantic risk. Allowed silent normalization is limited to
 * whitespace, id slug formatting and null -> absent; everything else must appear here.
 *
 * Coercers run inside zod `preprocess` steps, so they cannot take a ledger argument. `ledgerPreprocess` wraps one and
 * records the structural diff of what it changed into the ledger scope opened by `collectCoercions` (structuredCall
 * opens one per parse attempt and keeps only the accepted attempt's entries).
 */
export type SemanticRisk = 'none' | 'low' | 'semantic';
export interface CoercionEntry { path: string; oldValue: unknown; newValue: unknown; reason: string; semanticRisk: SemanticRisk }

const scope = new AsyncLocalStorage<CoercionEntry[]>();

export function recordCoercion(entry: CoercionEntry): void {
  scope.getStore()?.push(entry);
}

/** Run `fn` with a fresh ledger; entries recorded inside (and only inside) are returned beside its result. */
export function collectCoercions<T>(fn: () => T): { result: T; entries: CoercionEntry[] } {
  const entries: CoercionEntry[] = [];
  const result = scope.run(entries, fn);
  return { result, entries };
}

function preview(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  if (value && typeof value === 'object') { const text = JSON.stringify(value); return text.length > 300 ? `${text.slice(0, 300)}…` : value; }
  return value;
}

const isPlain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isEmptyDefault = (value: unknown): boolean => value === '' || (Array.isArray(value) && value.length === 0) || (isPlain(value) && Object.keys(value).length === 0);
const collapse = (text: string): string => text.trim().replace(/\s+/g, ' ');
const slug = (text: string): string => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function isSubsequence(small: string[], big: string[]): boolean {
  let i = 0;
  for (const word of big) if (i < small.length && small[i] === word) i++;
  return i === small.length;
}

function stringRisk(before: string, after: string): SemanticRisk | undefined {
  if (collapse(before) === collapse(after)) return undefined;
  if (slug(before) === after) return undefined;
  if (after.length < before.length && (before.startsWith(after) || isSubsequence(after.split(/\s+/), before.split(/\s+/)))) return 'low';
  return 'semantic';
}

/** Structural diff of one coercer's input and output, as ledger entries (paths are JSON pointers). */
export function diffCoercions(before: unknown, after: unknown, reason: string): CoercionEntry[] {
  const out: CoercionEntry[] = [];
  const add = (path: string, oldValue: unknown, newValue: unknown, semanticRisk: SemanticRisk): void => {
    out.push({ path: path || '/', oldValue: preview(oldValue), newValue: preview(newValue), reason, semanticRisk });
  };
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Object.is(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${path}/${i}`);
      for (let i = b.length; i < a.length; i++) add(`${path}/${i}`, a[i], undefined, 'semantic');
      for (let i = a.length; i < b.length; i++) add(`${path}/${i}`, undefined, b[i], 'semantic');
      return;
    }
    if (isPlain(a) && isPlain(b)) {
      for (const key of Object.keys(a)) {
        if (!(key in b) || b[key] === undefined) { if (a[key] !== undefined) add(`${path}/${key}`, a[key], undefined, 'semantic'); }
        else walk(a[key], b[key], `${path}/${key}`);
      }
      for (const key of Object.keys(b)) if (!(key in a) && b[key] !== undefined) add(`${path}/${key}`, undefined, b[key], isEmptyDefault(b[key]) ? 'low' : 'semantic');
      return;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      const risk = stringRisk(a, b);
      if (risk) add(path, a, b, risk);
      return;
    }
    add(path, a, b, 'semantic');
  };
  walk(before, after, '');
  return out;
}

/** `z.preprocess` whose coercer's changes are written to the ledger. */
export function ledgerPreprocess<S extends z.ZodType>(reason: string, fn: (raw: unknown) => unknown, schema: S) {
  return z.preprocess((raw) => {
    const out = fn(raw);
    for (const entry of diffCoercions(raw, out, reason)) recordCoercion(entry);
    return out;
  }, schema);
}

export interface CoercionCounts { total: number; low: number; semantic: number }
export function countCoercions(entries: readonly CoercionEntry[]): CoercionCounts {
  return { total: entries.length, low: entries.filter((e) => e.semanticRisk === 'low').length, semantic: entries.filter((e) => e.semanticRisk === 'semantic').length };
}

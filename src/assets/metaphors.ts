import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEMANTIC_ROLES, SEMANTIC_TOPOLOGIES } from '../render/semanticCore.js';

/**
 * R5 approved metaphors (final_plan/02 §16). A metaphor is only approved when it states the
 * STRUCTURE it preserves (Simi benchmark §39) and the real term the lesson must reconnect to (§40).
 * Entries map an abstract concept to a semantic-core role or topology drawing; they never pick assets.
 */
export interface ApprovedMetaphor {
  concept: string;
  role?: string;
  topology?: string;
  asset?: string;
  structure: string;
  reconnectTerm: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_SRC = `${sep}dist${sep}src${sep}`;
const DATA = resolve(HERE.includes(DIST_SRC) ? HERE.replace(DIST_SRC, `${sep}src${sep}`) : HERE, 'data', 'metaphors.v1.json');

export function validateMetaphors(entries: unknown): { ok: ApprovedMetaphor[]; problems: string[] } {
  const problems: string[] = [];
  const ok: ApprovedMetaphor[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of (Array.isArray(entries) ? entries : []).entries()) {
    const entry = raw as Partial<ApprovedMetaphor>;
    const name = `entry ${index} (${String(entry?.concept)})`;
    if (!entry || typeof entry.concept !== 'string' || !entry.concept.trim()) { problems.push(`${name}: missing concept`); continue; }
    if (seen.has(entry.concept.toLowerCase())) { problems.push(`${name}: duplicate concept`); continue; }
    if (typeof entry.structure !== 'string' || entry.structure.trim().length < 12) { problems.push(`${name}: must state the preserved structure`); continue; }
    if (typeof entry.reconnectTerm !== 'string' || !entry.reconnectTerm.trim()) { problems.push(`${name}: must name the real term to reconnect to`); continue; }
    const targets = [entry.role, entry.topology, entry.asset].filter(Boolean).length;
    if (targets !== 1) { problems.push(`${name}: exactly one of role, topology or asset`); continue; }
    if (entry.role && !(SEMANTIC_ROLES as readonly string[]).includes(entry.role)) { problems.push(`${name}: unknown role ${entry.role}`); continue; }
    if (entry.topology && !(SEMANTIC_TOPOLOGIES as readonly string[]).includes(entry.topology)) { problems.push(`${name}: unknown topology ${entry.topology}`); continue; }
    seen.add(entry.concept.toLowerCase());
    ok.push(entry as ApprovedMetaphor);
  }
  return { ok, problems };
}

export function loadApprovedMetaphors(): Record<string, ApprovedMetaphor> {
  const { ok, problems } = validateMetaphors((JSON.parse(readFileSync(DATA, 'utf8')) as { entries: unknown }).entries);
  if (problems.length) throw new Error(`approved metaphors rejected: ${problems.join('; ')}`);
  return Object.fromEntries(ok.map((entry) => [entry.concept.toLowerCase(), entry]));
}

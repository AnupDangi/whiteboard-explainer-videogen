import { resolveObject } from '../../assets/ladder.js';
import { rankConcepts, allCatalogEntries, type Candidate } from '../../assets/semantic.js';
import type { QueryEmbeddingCache } from '../../assets/queryEmbeddingCache.js';
import { selectDepictions, isNumericReferent, type DirectorItem } from '../../assets/depictionDirector.js';
import type { ModelClient } from '../../llm/modelClient.js';
import type { PersistentBudgetLedger } from '../../run/budgetLedger.js';
import { emptyUsage, type CallUsage } from '../../llm/structuredCall.js';
import type { StageFailure } from '../../shared/types.js';
import type { ConceptInfo, EntityResolver } from './typeGate.js';
import type { BoardOp } from '../board-ops/types.js';

/**
 * Approved-picture resolver (S7 in the V2 loop). The depiction director
 * approves referent → catalog-entry picks per scene (memoized lesson-wide);
 * this module turns picks into rendering and ops:
 * - approvedResolver: EntityResolver that serves validated entries, falling
 *   back to the default literal path for anything unapproved.
 * - upgradeTokensToEntities: deterministic token → entity rewrite for tokens
 *   whose text exactly matches an approved referent bound to an entity-kind
 *   concept. The caller re-validates the rewritten ops; dirty upgrades never
 *   reach the timeline.
 */
export interface ApprovedPick {
  entryId: string;
  noun: string;
  referent: string;
  conceptId?: string;
}

const norm = (text: string): string => text.trim().toLowerCase();

export function pickFor(conceptId: string | undefined, label: string, picks: ReadonlyMap<string, ApprovedPick>): ApprovedPick | undefined {
  if (conceptId) {
    for (const pick of picks.values()) if (pick.conceptId === conceptId) return pick;
  }
  return picks.get(norm(label));
}

export function approvedResolver(picks: ReadonlyMap<string, ApprovedPick>): EntityResolver {
  return (label, size, conceptId) => {
    const pick = pickFor(conceptId, label, picks);
    if (!pick) {
      const fallback = resolveObject(label, { label, size, ...(conceptId ? { conceptId } : {}), visualStrategy: 'literal' });
      return { visual: fallback.visual, resolution: fallback.resolution };
    }
    const res = resolveObject(label, { label, size, ...(conceptId ? { conceptId } : {}), validatedAssetId: pick.entryId, visualStrategy: 'literal' });
    return { visual: res.visual, resolution: res.resolution };
  };
}

const ENTITY_KINDS = new Set(['entity']);

/** Rewrite tokens whose text is an approved referent into entity elements. Pure; caller re-validates. */
export function upgradeTokensToEntities(
  ops: readonly BoardOp[],
  picks: ReadonlyMap<string, ApprovedPick>,
  concepts: ReadonlyMap<string, ConceptInfo>,
): { ops: BoardOp[]; upgraded: string[] } {
  if (picks.size === 0) return { ops: [...ops], upgraded: [] };
  const upgraded: string[] = [];
  const out = ops.map((op): BoardOp => {
    if ((op.op !== 'add' && op.op !== 'replace') || op.element.type !== 'token') return op;
    const conceptId = op.element.bindings?.conceptIds?.[0];
    const concept = conceptId ? concepts.get(conceptId) : undefined;
    if (!concept || !ENTITY_KINDS.has(concept.kind)) return op;
    const pick = pickFor(conceptId, op.element.text, picks);
    if (!pick) return op;
    upgraded.push(op.op === 'add' ? op.id : op.target);    const entity = {
      type: 'entity' as const,
      conceptId: concept.id,
      label: op.element.text,
      provenance: op.element.provenance,
      ...(op.element.evidence ? { evidence: op.element.evidence } : {}),
      bindings: op.element.bindings,
    };
    return { ...op, element: entity };
  });
  return { ops: out, upgraded };
}

export const DEPICTION_VERSION = 'v2-depiction/v1';

/**
 * Approve pictures for a scene's entity-kind concepts (S7 in the V2 loop).
 * Retrieval is offline/local (embedding rank); only novel referents cost the
 * 2 director/judge LLM calls, and the lesson memo makes repeats free.
 * Deterministic given the same catalog + memo order: scenes run in lesson
 * order with shared takenEntries/takenNouns sets. Never throws: retrieval or
 * director trouble becomes a soft skip, never a failed scene.
 */
export async function approveSceneDepictions(args: {
  concepts: ReadonlyArray<{ id: string; label: string; kind: string }>;
  sceneTitle: string;
  cache: QueryEmbeddingCache;
  model: string;
  apiKey: string;
  remainingBudgetUsd: number;
  budgetLedger?: PersistentBudgetLedger;
  client?: ModelClient;
  takenEntries: Set<string>;
  takenNouns: Set<string>;
  memo: Map<string, ApprovedPick | null>;
}): Promise<{ picks: Map<string, ApprovedPick>; usage: CallUsage; failures: StageFailure[] }> {
  const usage = emptyUsage();
  const failures: StageFailure[] = [];
  const picks = new Map<string, ApprovedPick>();
  try {
    const fresh = args.concepts.filter((c) => c.kind === 'entity');
    const referents = [...new Set(fresh.map((c) => c.label.trim().toLowerCase()).filter(Boolean))];
    const novel = referents.filter((r) => !args.memo.has(r) && !isNumericReferent(r));
    if (novel.length) {
      const ranked = await rankConcepts(novel, 30, args.cache);
      const items: DirectorItem[] = [];
      for (const referent of novel) {
        const seen = new Set<string>();
        const vocabulary = (ranked.get(referent) ?? [])
          .filter((c: Candidate) => c.score >= 0.25 && !seen.has(c.name) && (seen.add(c.name), true))
          .map((c: Candidate) => c.name);
        const concept = fresh.find((c) => c.label.trim().toLowerCase() === referent);
        items.push({ referent, context: `${concept?.label ?? referent} (scene: ${args.sceneTitle})`, vocabulary });
      }
      if (items.length) {
        const result = await selectDepictions({
          items, catalog: allCatalogEntries(), model: args.model, apiKey: args.apiKey,
          remainingBudgetUsd: args.remainingBudgetUsd,
          ...(args.budgetLedger ? { budgetLedger: args.budgetLedger } : {}),
          takenEntries: args.takenEntries, takenNouns: args.takenNouns,
        });
        usage.calls += result.usage.calls; usage.promptTokens += result.usage.promptTokens;
        usage.completionTokens += result.usage.completionTokens; usage.cachedTokens += result.usage.cachedTokens;
        usage.costUsd += result.usage.costUsd; usage.repairs += result.usage.repairs;
        failures.push(...result.failures);
        for (const item of items) {
          const pick = result.picks.get(item.referent);
          const concept = fresh.find((c) => c.label.trim().toLowerCase() === item.referent);
          args.memo.set(item.referent, pick ? { entryId: pick.entryId, noun: pick.noun, referent: item.referent, conceptId: concept?.id } : null);
        }
      }
    }
    for (const [referent, pick] of args.memo) if (pick) picks.set(referent, pick);
  } catch (error) {
    failures.push({ code: 'v2-depiction-skipped', stage: 'depiction', message: `pictorial depiction skipped: ${error instanceof Error ? error.message : String(error)}`, hard: false });
  }
  return { picks, usage, failures };
}

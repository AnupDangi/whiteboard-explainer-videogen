import { z } from 'zod';
import { structuredCall, type CallUsage, emptyUsage } from '../llm/structuredCall.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';
import type { StageFailure } from '../shared/types.js';

/**
 * Semantic validation of icon candidates (final_plan/02 §18: a choice is only trusted after
 * semantic validation). Embedding retrieval proposes candidates; a cheap model answers, per
 * depicted referent, which candidate — if any — IS that thing. "none" is always allowed and is
 * the safe default (a wrong icon is worse than no icon, Simi benchmark §6). The result is
 * treated as a curated exact match by the resolver and is locked with the lesson.
 */
export interface IconValidationItem {
  /** Lower-cased spoken referent, the key the resolver looks up. */
  concept: string;
  /** What the lesson says this referent is (concept label / definition), for disambiguation. */
  context: string;
  candidates: Array<{ id: string; name: string; score?: number }>;
}

const tokensOf = (value: string): Set<string> => new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 2).map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)));

/**
 * Deterministic second opinion on a model pick (a cheap model approves too easily): the icon's name must share a word
 * with the referent or its context, or retrieval must have scored it highly. Unrelated picks are dropped.
 */
export const STRONG_RETRIEVAL_SCORE = 0.62;
export function pickIsCorroborated(item: IconValidationItem, pickId: string): boolean {
  const candidate = item.candidates.find((entry) => entry.id === pickId);
  if (!candidate) return false;
  if ((candidate.score ?? 0) >= STRONG_RETRIEVAL_SCORE) return true;
  const wanted = tokensOf(item.concept);
  return [...tokensOf(candidate.name)].some((token) => wanted.has(token));
}

const SCHEMA = z.object({
  choices: z.array(z.object({ concept: z.string().min(1).max(120), pick: z.string().min(1).max(200).nullable() }).strict()).max(40),
}).strict();

export const ICON_VALIDATION_VERSION = 'icon-validation-v1';

export async function validateIconCandidates(args: {
  items: IconValidationItem[];
  model: string;
  apiKey: string;
  remainingBudgetUsd: number;
  budgetLedger?: PersistentBudgetLedger;
  fetcher?: typeof fetch;
}): Promise<{ picks: Map<string, string>; usage: CallUsage; failures: StageFailure[] }> {
  const usage = emptyUsage();
  const picks = new Map<string, string>();
  const items = args.items.filter((item) => item.candidates.length > 0).slice(0, 40);
  if (!items.length) return { picks, usage, failures: [] };
  const listing = items.map((item, index) => `${index + 1}. referent: "${item.concept}" (${item.context})\n   candidates: ${item.candidates.map((candidate) => `"${candidate.name}" [${candidate.id}]`).join('; ')}`).join('\n');
  const result = await structuredCall({
    stage: 'icon-validation', subject: 'icon candidate validation', model: args.model, apiKey: args.apiKey,
    system: 'You validate icon choices for a whiteboard teaching video. For each referent, pick the candidate icon that literally depicts that exact thing, or null. Pick null when the candidate is only related, a different object, an abstract idea drawn as an unrelated picture, a brand, a flag, or merely shares a word. A wrong icon is worse than none. Return JSON only.',
    user: `Return {"choices":[{"concept":"<referent exactly as given>","pick":"<candidate id or null>"}]} with one entry per referent.\n\n${listing}`,
    schema: SCHEMA, schemaName: 'icon_validation', maxTokens: 1500,
    validate: (value) => {
      const problems: string[] = [];
      for (const choice of value.choices) {
        const item = items.find((candidate) => candidate.concept === choice.concept);
        if (!item) problems.push(`unknown referent "${choice.concept}"`);
        else if (choice.pick !== null && !item.candidates.some((candidate) => candidate.id === choice.pick)) problems.push(`pick "${choice.pick}" is not a candidate for "${choice.concept}"`);
      }
      return problems;
    },
    remainingBudgetUsd: args.remainingBudgetUsd,
    ...(args.budgetLedger ? { budgetLedger: args.budgetLedger } : {}),
    ...(args.fetcher ? { fetcher: args.fetcher } : {}),
  });
  if (result.usage) { usage.calls += result.usage.calls; usage.promptTokens += result.usage.promptTokens; usage.completionTokens += result.usage.completionTokens; usage.cachedTokens += result.usage.cachedTokens; usage.costUsd += result.usage.costUsd; usage.repairs += result.usage.repairs; }
  // One icon depicts one referent: a pick already given to an earlier referent is dropped, and uncorroborated picks are dropped.
  const taken = new Set<string>();
  if (result.value) for (const choice of result.value.choices) {
    const item = items.find((candidate) => candidate.concept === choice.concept);
    if (!choice.pick || !item || taken.has(choice.pick) || !pickIsCorroborated(item, choice.pick)) continue;
    taken.add(choice.pick);
    picks.set(choice.concept, choice.pick);
  }
  return { picks, usage, failures: result.failures ?? [] };
}

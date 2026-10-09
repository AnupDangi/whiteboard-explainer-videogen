import { z } from 'zod';
import { structuredCall, emptyUsage, type CallUsage } from '../llm/structuredCall.js';
import type { PersistentBudgetLedger } from '../run/budgetLedger.js';
import type { StageFailure } from '../shared/types.js';
import type { CatalogEntry } from './catalog.js';
import { referentKeys } from './referent.js';
import { domainMatches, similarityAdmissible } from './ladder.js';
import { FAMILY_ORDER, isExemptFamily } from './sceneFamily.js';

/**
 * Depiction Director: how a teacher decides what to DRAW for an idea. Whiteboard explainers (see the Lamina reference
 * frames) give almost every idea a picture: "trapped energy" is a lightning bolt, "tension" a bolt with a warning sign,
 * "tokens" a stack of layers. A model is good at that association; a library is good at exact lookup. So the model
 * names up to three concrete, single drawable nouns per referent (preferring names from the retrieved vocabulary), and
 * code resolves each noun by EXACT name or alias against the approved library, family-locked and domain-ranked. The
 * model never sees or returns asset IDs; a noun the library lacks simply yields no icon (a label or role is used).
 */
export interface DirectorItem {
  /** Lower-cased spoken referent; the key the resolver looks up. */
  referent: string;
  /** What the lesson says it is, plus the sentence it appears in. */
  context: string;
  /** Concept/icon names retrieved for this referent (vocabulary the library really has). */
  vocabulary: string[];
  /**
   * Embedding-retrieved catalog candidates for this referent, best first. Used only as a
   * guarded fallback when the model's proposed nouns match no exact catalog name, so a
   * correct-enough picture can still be chosen instead of a labelled box. The
   * `similarityAdmissible` guard rejects look-alikes (flags, siblings, antonyms).
   */
  candidates?: Array<{ id: string; name: string; score: number }>;
}

const SCHEMA = z.object({
  items: z.array(z.object({ referent: z.string().min(1).max(120), nouns: z.array(z.string().min(1).max(40)).max(3) }).strict()).max(40),
}).strict();

export const DIRECTOR_VERSION = 'depiction-director-v1';

export async function proposeDepictionNouns(args: {
  items: DirectorItem[];
  model: string;
  apiKey: string;
  remainingBudgetUsd: number;
  budgetLedger?: PersistentBudgetLedger;
  fetcher?: typeof fetch;
}): Promise<{ nouns: Map<string, string[]>; usage: CallUsage; failures: StageFailure[] }> {
  const usage = emptyUsage();
  const nouns = new Map<string, string[]>();
  const items = args.items.slice(0, 40);
  if (!items.length) return { nouns, usage, failures: [] };
  const listing = items.map((item, index) => `${index + 1}. referent: "${item.referent}"\n   meaning: ${item.context}\n   vocabulary: ${item.vocabulary.slice(0, 30).join(', ') || '(none)'}`).join('\n');
  const result = await structuredCall({
    stage: 'depiction-director', subject: 'depiction nouns', model: args.model, apiKey: args.apiKey,
    system: 'You are the illustrator of a whiteboard explainer (flat icons with a black outline, like a teacher sketching). For each referent, name up to 3 simple drawable nouns, best first, that a teacher would sketch to stand for it. Use concrete things (leaf, sun, flask, robot, building, brain, coin, clock, wrench, droplet, magnet, cell) and well-known pictograms or visual metaphors (energy -> lightning bolt, time -> clock, security -> shield, balance -> scale, selection -> funnel, growth -> plant, transfer -> arrow, barrier -> wall or fence, attention -> spotlight, probability -> dice, gradient -> slope, cache -> box). Prefer to name a noun from the given vocabulary whenever one is at all plausible, because those nouns have a real picture. Return an empty list ONLY for numbers and amounts that have no object meaning. For an abstract idea, name the standard symbol or metaphor a teacher would sketch when one would read correctly beside the label; leave the list empty only when no such symbol exists and a labelled box is genuinely better. One picture never stands for two different referents. Return JSON only. Example OUTPUT: {"items":[{"referent":"energy","nouns":["lightning bolt","battery"]},{"referent":"temperature","nouns":["thermometer"]},{"referent":"gradient","nouns":[]}]}',
    user: `Return {"items":[{"referent":"<referent exactly as given>","nouns":["noun1","noun2"]}]} with one entry per referent.\n\n${listing}`,
    schema: SCHEMA, schemaName: 'depiction_nouns', maxTokens: 2000,
    validate: (value) => value.items.flatMap((entry) => (items.some((item) => item.referent === entry.referent) ? [] : [`unknown referent "${entry.referent}"`])),
    remainingBudgetUsd: args.remainingBudgetUsd,
    ...(args.budgetLedger ? { budgetLedger: args.budgetLedger } : {}),
    ...(args.fetcher ? { fetcher: args.fetcher } : {}),
  });
  usage.calls += result.usage.calls; usage.promptTokens += result.usage.promptTokens; usage.completionTokens += result.usage.completionTokens; usage.cachedTokens += result.usage.cachedTokens; usage.costUsd += result.usage.costUsd; usage.repairs += result.usage.repairs;
  if (result.value) for (const entry of result.value.items) nouns.set(entry.referent, [...new Set(entry.nouns.map((noun) => noun.trim().toLowerCase()).filter(Boolean))]);
  return { nouns, usage, failures: result.failures.map((failure) => ({ ...failure, hard: false })) };
}

const familyRank = (family: string | undefined): number => {
  const index = (FAMILY_ORDER as readonly string[]).indexOf(family ?? '');
  return index < 0 ? FAMILY_ORDER.length : index;
};

/** Every normalised name an entry answers to: its name plus the aliases carried as tags. */
export const entryNames = (entry: CatalogEntry): Set<string> => new Set([...entry.names, ...entry.tags].map((name) => referentKeys(name)[0] ?? '').filter(Boolean));

export interface NounResolution { entryId: string; noun: string; /** Normalised noun key (for per-lesson de-duplication). */ nounKey: string; houseFamily?: string }

/**
 * Resolve proposed nouns to library entries by exact name/alias, first noun that has a usable asset wins.
 * Filters (family, already-used icons) apply before ranking; ties break by domain match, family order, then id.
 */
export function resolveNouns(
  nouns: readonly string[],
  catalog: readonly CatalogEntry[],
  options: { sceneFamily?: string; lessonDomain?: string; avoid?: ReadonlySet<string>; /** Normalised nouns already drawn in this lesson. */ avoidNouns?: ReadonlySet<string> } = {},
): NounResolution | undefined {
  for (const noun of nouns) {
    const key = referentKeys(noun)[0];
    if (!key || options.avoidNouns?.has(key)) continue;
    const matches = catalog
      .filter((entry) => !options.avoid?.has(entry.id) && entryNames(entry).has(key)
        && (!options.sceneFamily || isExemptFamily(entry.houseFamily) || entry.houseFamily === options.sceneFamily))
      .sort((a, b) => Number(domainMatches(b, options.lessonDomain)) - Number(domainMatches(a, options.lessonDomain)) || familyRank(a.houseFamily) - familyRank(b.houseFamily) || a.strokePaths - b.strokePaths || a.id.localeCompare(b.id));
    const best = matches[0];
    if (best) return { entryId: best.id, noun, nounKey: key, ...(best.houseFamily ? { houseFamily: best.houseFamily } : {}) };
  }
  return undefined;
}

const NUMBER_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'plus', 'minus', 'times', 'equals', 'half', 'quarter', 'third']);

/** True when a referent is only numbers or number words (an amount, not a thing): it is shown as text, never as a picture. */
export function isNumericReferent(referent: string): boolean {
  const tokens = referent.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => /^[0-9.]+$/.test(token) || NUMBER_WORDS.has(token));
}

/**
 * Second opinion on proposed pictures (cheap, strict). The director is allowed to be inventive; the judge approves a
 * picture only when a learner who sees it next to the label would connect them without explanation. Rejecting is always
 * safe: the referent becomes a label, a role or a diagram instead.
 */
export async function judgeDepictions(args: {
  pairs: Array<{ referent: string; context: string; picture: string }>;
  model: string;
  apiKey: string;
  remainingBudgetUsd: number;
  budgetLedger?: PersistentBudgetLedger;
  fetcher?: typeof fetch;
}): Promise<{ approved: Set<string>; usage: CallUsage; failures: StageFailure[] }> {
  const usage = emptyUsage();
  const approved = new Set<string>();
  if (!args.pairs.length) return { approved, usage, failures: [] };
  const key = (pair: { referent: string; picture: string }) => `${pair.referent}\u0000${pair.picture}`;
  const listing = args.pairs.map((pair, index) => `${index + 1}. label: "${pair.referent}" (${pair.context}) -> picture: ${pair.picture}`).join('\n');
  const schema = z.object({ verdicts: z.array(z.object({ index: z.number().int().min(1).max(60), keep: z.boolean() }).strict()).max(60) }).strict();
  const result = await structuredCall({
    stage: 'depiction-judge', subject: 'depiction approval', model: args.model, apiKey: args.apiKey,
    system: 'You review picture choices for a whiteboard explainer, where a teacher sketches a small icon beside each label. Keep a picture when it is a natural illustration of the label\'s subject: the thing itself, an actor, object or place typical of it, or a common symbol for the idea (a price tag for price, a scale for balance, a shield for protection, a cart for buying). The label carries the exact meaning; the picture only has to point the learner the right way. For an abstract technical component (a layer, operation, mechanism, data or step of software or mathematics) accept only a standard diagram symbol for that very thing; a decorative object (an onion, a mask, a dumbbell) is never acceptable. Reject a picture when a learner would likely read it as something else, when it suggests the opposite or an unrelated idea, when it is a specific brand or person, or when it would look silly or confusing. Return JSON only.',
    user: `Return {"verdicts":[{"index":1,"keep":true}]} with one verdict per numbered pair.\n\n${listing}`,
    schema, schemaName: 'depiction_verdicts', maxTokens: 1500,
    validate: (value) => value.verdicts.flatMap((verdict) => (verdict.index <= args.pairs.length ? [] : [`unknown index ${verdict.index}`])),
    remainingBudgetUsd: args.remainingBudgetUsd,
    ...(args.budgetLedger ? { budgetLedger: args.budgetLedger } : {}),
    ...(args.fetcher ? { fetcher: args.fetcher } : {}),
  });
  usage.calls += result.usage.calls; usage.promptTokens += result.usage.promptTokens; usage.completionTokens += result.usage.completionTokens; usage.cachedTokens += result.usage.cachedTokens; usage.costUsd += result.usage.costUsd; usage.repairs += result.usage.repairs;
  if (result.value) for (const verdict of result.value.verdicts) if (verdict.keep) approved.add(key(args.pairs[verdict.index - 1]!));
  return { approved, usage, failures: result.failures.map((failure) => ({ ...failure, hard: false })) };
}

export const depictionPairKey = (pair: { referent: string; picture: string }): string => `${pair.referent}\u0000${pair.picture}`;

/**
 * Direct, resolve and judge in one place (shared by lesson-level discovery and per-scene referents):
 * nouns from the director -> exact library entries (family/domain/uniqueness aware) -> strict approval.
 * Returns the approved entry per referent; everything else is left to labels, roles and diagrams.
 */
export async function selectDepictions(args: {
  items: DirectorItem[];
  catalog: readonly CatalogEntry[];
  model: string;
  apiKey: string;
  remainingBudgetUsd: number;
  budgetLedger?: PersistentBudgetLedger;
  fetcher?: typeof fetch;
  sceneFamily?: string;
  lessonDomain?: string;
  takenEntries: Set<string>;
  takenNouns: Set<string>;
  propose?: typeof proposeDepictionNouns;
  judge?: typeof judgeDepictions;
}): Promise<{ picks: Map<string, NounResolution>; usage: CallUsage; failures: StageFailure[] }> {
  const usage = emptyUsage();
  const failures: StageFailure[] = [];
  const add = (u: CallUsage) => { usage.calls += u.calls; usage.promptTokens += u.promptTokens; usage.completionTokens += u.completionTokens; usage.cachedTokens += u.cachedTokens; usage.costUsd += u.costUsd; usage.repairs += u.repairs; };
  const picks = new Map<string, NounResolution>();
  if (!args.items.length) return { picks, usage, failures };
  const base = { model: args.model, apiKey: args.apiKey, ...(args.budgetLedger ? { budgetLedger: args.budgetLedger } : {}), ...(args.fetcher ? { fetcher: args.fetcher } : {}) };
  const directed = await (args.propose ?? proposeDepictionNouns)({ items: args.items, remainingBudgetUsd: args.remainingBudgetUsd, ...base });
  add(directed.usage); failures.push(...directed.failures);
  // Candidate pictures per referent: each proposed noun that has an exact asset, in the director's order.
  const candidates = new Map<string, NounResolution[]>();
  const pairs: Array<{ referent: string; context: string; picture: string }> = [];
  const claimed = new Set<string>();
  for (const item of args.items) {
    const list: NounResolution[] = [];
    const avoid = new Set([...args.takenEntries, ...claimed]);
    for (const noun of directed.nouns.get(item.referent) ?? []) {
      const found = resolveNouns([noun], args.catalog, { ...(args.sceneFamily ? { sceneFamily: args.sceneFamily } : {}), ...(args.lessonDomain ? { lessonDomain: args.lessonDomain } : {}), avoid, avoidNouns: args.takenNouns });
      if (found && !list.some((entry) => entry.nounKey === found.nounKey)) { list.push(found); pairs.push({ referent: item.referent, context: item.context, picture: found.noun }); }
    }
    // Fallback when the model's nouns match no exact catalog name: use the embedding-retrieved
    // candidates, but only one that passes the same near-synonym guard (no flags/siblings/antonyms)
    // and the scene-family/domain constraints. A wrong picture is still worse than a label.
    if (!list.length && item.candidates?.length) {
      const admissible = item.candidates
        .map((candidate) => ({ candidate, entry: args.catalog.find((entry) => entry.id === candidate.id) }))
        .filter((pair): pair is { candidate: { id: string; name: string; score: number }; entry: NonNullable<typeof pair.entry> } => Boolean(pair.entry))
        .filter(({ candidate, entry }) => !avoid.has(entry.id)
          && !args.takenNouns.has(referentKeys(candidate.name)[0] ?? '')
          && (!args.sceneFamily || entry.houseFamily === undefined || isExemptFamily(entry.houseFamily) || entry.houseFamily === args.sceneFamily)
          && similarityAdmissible([item.referent, ...referentKeys(item.referent)], entry.names, candidate.score))
        .sort((a, b) => Number(domainMatches(b.entry, args.lessonDomain)) - Number(domainMatches(a.entry, args.lessonDomain)) || b.candidate.score - a.candidate.score);
      for (const { candidate, entry } of admissible.slice(0, 2)) {
        const nounKey = referentKeys(candidate.name)[0] ?? candidate.name;
        if (list.some((existing) => existing.nounKey === nounKey)) continue;
        list.push({ entryId: entry.id, noun: candidate.name, nounKey, ...(entry.houseFamily ? { houseFamily: entry.houseFamily } : {}) });
        pairs.push({ referent: item.referent, context: item.context, picture: candidate.name });
      }
    }
    if (list.length) candidates.set(item.referent, list);
  }
  const judged = await (args.judge ?? judgeDepictions)({ pairs, remainingBudgetUsd: args.remainingBudgetUsd, ...base });
  add(judged.usage); failures.push(...judged.failures);
  for (const item of args.items) {
    const chosen = (candidates.get(item.referent) ?? []).find((entry) => judged.approved.has(depictionPairKey({ referent: item.referent, picture: entry.noun })) && !args.takenEntries.has(entry.entryId) && !args.takenNouns.has(entry.nounKey));
    if (!chosen) continue;
    picks.set(item.referent, chosen);
    args.takenEntries.add(chosen.entryId);
    args.takenNouns.add(chosen.nounKey);
  }
  return { picks, usage, failures };
}

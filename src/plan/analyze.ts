import type { ConceptGraph, TeachingPlan } from './schemas.js';

/**
 * Deterministic teaching-plan analyser (plan Phase 4). It runs on every
 * generated plan before any narration is written, and records findings with
 * the F-PED code from the failure taxonomy (hypothesis/v1_claude/03 §6).
 * `error` findings block the lesson; `warn` findings are recorded.
 *
 * Pacing from measurement: Supertonic speaks 2.29 words/s (phase6-2026-09-27
 * bicycle 158 w / 68.9 s, composting 159 w / 69.5 s); Lamina scenes run
 * 10.5-28.5 s, mean 18.6 s (harness/reference/lamina/index.json).
 */
export const WORDS_PER_SEC = 2.25;

/** Spoken words per second by language: Devanagari-script speech uses more, shorter words per second than English. Default is English. */
const WORDS_PER_SEC_BY_LANGUAGE: Record<string, number> = { hi: 3.0, ne: 2.7, mr: 2.7, bn: 2.6, es: 2.7, fr: 2.6, pt: 2.6, it: 2.6 };
export const wordsPerSec = (language?: string): number => WORDS_PER_SEC_BY_LANGUAGE[(language ?? 'en').toLowerCase()] ?? WORDS_PER_SEC;
// Hard pacing bounds from measurement: harness/reference/lamina/index.json
// (n=33 scenes) runs 10.5-28.5 s, mean 18.6 s — the 10.5 s and 13.5 s scenes
// sit below the old 14 s hard floor, so the hard minimum is 10 s. Scenes
// below the 14-30 s ideal band still draw a warn (tight scene), never an
// error, so short-but-measured pacing stays boardable.
export const SCENE_SEC = { min: 10, max: 30 };
/** Ideal band: scenes read best here; below it warns, outside hard bounds errors. */
export const SCENE_IDEAL_SEC = { min: 14, max: 30 };
/**
 * Recap density limit shared with the plan-time split (plan/stages.ts):
 * a recap above either count wants two boards. A dense recap that survives
 * unsplit (halving would breach the hard floor) is a warn, never an error.
 */
export const RECAP_SPLIT_MAX_CONCEPTS = 3;
export const RECAP_SPLIT_MAX_RELATIONS = 2;
export const BUDGET_TOLERANCE = 0.05;
/** Seconds a scene needs to speak its essential claims: one short sentence per claim plus lead-in. */
export const minBudgetForClaims = (claimCount: number): number => Math.min(SCENE_SEC.max, Math.max(SCENE_IDEAL_SEC.min, 4 * claimCount + 6));

/**
 * Deterministic budget rebalance: a scene whose claims cannot be spoken in its budget
 * borrows whole seconds from scenes with slack (largest slack first), keeping the total.
 * A dense recap at the hard floor is the usual case. Scenes already at their minimum are untouched.
 */
export function rebalanceSceneBudgets<T extends { id: string; budgetSec: number }>(sections: readonly T[], claimCountOf: (section: T) => number): T[] {
  const out = sections.map((section) => ({ ...section }));
  const need = (section: T): number => minBudgetForClaims(claimCountOf(section));
  for (const short of out) {
    let deficit = need(short) - short.budgetSec;
    while (deficit > 0) {
      const donor = out.filter((other) => other !== short && other.budgetSec - need(other) > 0).sort((a, b) => (b.budgetSec - need(b)) - (a.budgetSec - need(a)))[0];
      if (!donor) break;
      donor.budgetSec -= 1;
      short.budgetSec += 1;
      deficit -= 1;
    }
  }
  return out;
}
/**
 * Section budgets must add up to the lesson target (within the plan's tolerance). A model that is a few seconds off is
 * corrected here, one second at a time: seconds are added to the sections with the most claims and taken from the sections
 * with the most slack, never past a section's minimum for its claims or the scene length bounds.
 */
export function fitBudgetsToTarget<T extends { id: string; budgetSec: number }>(sections: readonly T[], targetSec: number, claimCountOf: (section: T) => number): T[] {
  const out = sections.map((section) => ({ ...section }));
  if (!out.length) return out;
  const total = () => out.reduce((sum, section) => sum + section.budgetSec, 0);
  const floor = (section: T): number => Math.max(SCENE_SEC.min, minBudgetForClaims(claimCountOf(section)));
  let guard = 0;
  while (total() !== targetSec && guard++ < 600) {
    if (total() < targetSec) {
      const grow = out.filter((section) => section.budgetSec < SCENE_SEC.max).sort((a, b) => a.budgetSec / Math.max(1, claimCountOf(a)) - b.budgetSec / Math.max(1, claimCountOf(b)))[0];
      if (!grow) break;
      grow.budgetSec += 1;
    } else {
      const shrink = out.filter((section) => section.budgetSec > floor(section)).sort((a, b) => (b.budgetSec - floor(b)) - (a.budgetSec - floor(a)))[0];
      if (!shrink) break;
      shrink.budgetSec -= 1;
    }
  }
  return out;
}

/** One scene per ~18s of reference Simi pacing (harness/reference/lamina/index.json mean scene length). */
export const sceneCountFor = (targetSec: number): number => Math.max(1, Math.round(targetSec / 18));

export interface PlanFinding {
  code: 'F-PED';
  severity: 'error' | 'warn';
  check: string;
  message: string;
}

export interface PlanAnalysis {
  ok: boolean;
  findings: PlanFinding[];
  metrics: {
    sectionCount: number;
    totalBudgetSec: number;
    targetDurationSec: number;
    wordsBudget: Record<string, number>;
    multiStepConcepts: string[];
    stepSections: number;
    conceptCoverage: number;
  };
}

export function analyzeTeachingPlan(plan: TeachingPlan, graph: ConceptGraph): PlanAnalysis {
  const findings: PlanFinding[] = [];
  const add = (severity: PlanFinding['severity'], check: string, message: string) => findings.push({ code: 'F-PED', severity, check, message });
  const conceptIds = new Set(graph.concepts.map((c) => c.id));

  // Every section has a real goal and (unless intro/recap) at least one known concept.
  const firstSection = new Map<string, number>();
  plan.sections.forEach((s, i) => {
    if (s.goal.trim().split(/\s+/).length < 3) add('error', 'goal', `section ${s.id} has no usable learning goal`);
    if ((s.kind === 'explain' || s.kind === 'step' || s.kind === 'example') && s.conceptIds.length === 0) add('error', 'concepts', `section ${s.id} (${s.kind}) teaches no concept`);
    for (const c of s.conceptIds) {
      if (!conceptIds.has(c)) add('error', 'concepts', `section ${s.id} references unknown concept ${c}`);
      else if (!firstSection.has(c)) firstSection.set(c, i);
    }
  });
  const seenIds = new Set<string>();
  for (const s of plan.sections) {
    if (seenIds.has(s.id)) add('error', 'ids', `duplicate section id ${s.id}`);
    seenIds.add(s.id);
  }

  // Prerequisites: acyclic, and every needed concept is taught no later than the concept needing it.
  const needs = new Map<string, string[]>();
  for (const p of graph.prerequisites) needs.set(p.concept, [...(needs.get(p.concept) ?? []), p.needs]);
  const state = new Map<string, number>();
  const cyclic = (n: string): boolean => {
    state.set(n, 1);
    for (const m of needs.get(n) ?? []) {
      if (state.get(m) === 1) return true;
      if (!state.has(m) && cyclic(m)) return true;
    }
    state.set(n, 2);
    return false;
  };
  for (const n of needs.keys()) if (!state.has(n) && cyclic(n)) { add('error', 'prerequisites', `prerequisite cycle through ${n}`); break; }
  for (const p of graph.prerequisites) {
    const a = firstSection.get(p.concept);
    const b = firstSection.get(p.needs);
    if (a === undefined) continue;
    if (b === undefined) add('warn', 'prerequisites', `${p.concept} needs ${p.needs}, which no section teaches`);
    else if (b > a) add('error', 'order', `${p.concept} (section ${a + 1}) is taught before its prerequisite ${p.needs} (section ${b + 1})`);
  }

  // Time budget.
  const total = plan.sections.reduce((s, x) => s + x.budgetSec, 0);
  if (Math.abs(total - plan.targetDurationSec) > plan.targetDurationSec * BUDGET_TOLERANCE) {
    add('error', 'budget', `section budgets sum to ${total}s, target is ${plan.targetDurationSec}s (±${BUDGET_TOLERANCE * 100}%)`);
  }
  for (const s of plan.sections) {
    if (s.budgetSec < SCENE_SEC.min || s.budgetSec > SCENE_SEC.max) add('error', 'pacing', `section ${s.id} is ${s.budgetSec}s; scenes must be ${SCENE_SEC.min}-${SCENE_SEC.max}s`);
    else if (s.budgetSec < SCENE_IDEAL_SEC.min) add('warn', 'pacing', `section ${s.id} is ${s.budgetSec}s; scenes read best at ${SCENE_IDEAL_SEC.min}-${SCENE_IDEAL_SEC.max}s`);
  }
  // Dense recaps that survive unsplit (the split guard keeps a recap whole
  // when halving would breach the hard floor) stay a warn, never an error:
  // one crowded board beats two unboardable thin scenes.
  for (const s of plan.sections) {
    if (s.kind !== 'recap') continue;
    const distinct = new Set(s.conceptIds).size;
    const rels = s.contract?.requiredRelations.length ?? 0;
    if (distinct > RECAP_SPLIT_MAX_CONCEPTS || rels > RECAP_SPLIT_MAX_RELATIONS) {
      add('warn', 'recap-density', `section ${s.id} reviews ${distinct} concepts with ${rels} relations in ${s.budgetSec}s; halving would breach the ${SCENE_SEC.min}s hard floor so it stays whole`);
    }
    if (plan.sections.at(-1)?.id !== s.id) add('error', 'recap-order', `recap section ${s.id} must be the final teaching scene`);
    const delta = normalizeTeachingText(s.contract?.learningDelta ?? s.goal);
    if (plan.sections.some((earlier) => earlier.id !== s.id && normalizeTeachingText(earlier.contract?.learningDelta ?? earlier.goal) === delta)) {
      add('error', 'recap-delta', `recap section ${s.id} must have a distinct learner delta from earlier scenes`);
    }
    const recapClaims = s.contract?.essentialClaims;
    if (recapClaims) {
      const priorClaims = plan.sections.filter((earlier) => earlier.id !== s.id).flatMap((earlier) => earlier.contract?.essentialClaims ?? []);
      const hasIntegration = recapClaims.some((claim) => new Set(claim.conceptIds).size >= 2 || claim.relations.length > 0);
      if (!hasIntegration) add('error', 'recap-integration', `recap section ${s.id} needs at least one claim that synthesizes two concepts or a source-backed relation`);
      for (const claim of recapClaims) {
        const normalized = normalizeTeachingText(claim.statement);
        if (priorClaims.some((prior) => normalizeTeachingText(prior.statement) === normalized)) {
          add('error', 'recap-restatement', `recap claim ${claim.id} repeats an earlier essential claim instead of synthesizing it`);
        }
      }
    }
  }

  // Multi-step ideas get a scene per step; longer lessons end with a recap.
  const multi = graph.concepts.filter((c) => c.level === 'multi-step').map((c) => c.id);
  const stepSections = plan.sections.filter((s) => s.kind === 'step').length;
  if (multi.length > 0 && stepSections < 2) add('error', 'steps', `multi-step concept(s) ${multi.join(', ')} need at least 2 step scenes, plan has ${stepSections}`);
  if (plan.targetDurationSec >= 45 && !plan.sections.some((s) => s.kind === 'recap')) add('warn', 'recap', 'lessons of 45s or more should end with a recap scene');

  const covered = graph.concepts.filter((c) => firstSection.has(c.id)).length;
  const coverage = covered / Math.max(1, graph.concepts.length);
  if (coverage < 0.6) add('warn', 'coverage', `only ${covered}/${graph.concepts.length} concepts are taught`);

  return {
    ok: !findings.some((f) => f.severity === 'error'),
    findings,
    metrics: {
      sectionCount: plan.sections.length,
      totalBudgetSec: total,
      targetDurationSec: plan.targetDurationSec,
      wordsBudget: Object.fromEntries(plan.sections.map((s) => [s.id, Math.round(s.budgetSec * WORDS_PER_SEC)])),
      multiStepConcepts: multi,
      stepSections,
      conceptCoverage: coverage,
    },
  };
}

function normalizeTeachingText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

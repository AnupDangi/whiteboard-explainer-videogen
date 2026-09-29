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

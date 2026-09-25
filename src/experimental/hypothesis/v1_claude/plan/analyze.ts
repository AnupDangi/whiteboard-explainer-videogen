import type { ConceptGraph, TeachingPlan } from './schemas.js';

/**
 * Deterministic teaching-plan analyser (plan Phase 4). It runs on every
 * generated plan before any narration is written, and records findings with
 * the F-PED code from the failure taxonomy (hypothesis/v1_claude/03 §6).
 * `error` findings block the lesson; `warn` findings are recorded.
 *
 * Pacing numbers come from the Lamina reference pack: scenes run ~10-28 s
 * (median ~18 s), and a 2.6 words/s speaking rate matches the local TTS.
 */
export const WORDS_PER_SEC = 2.6;
export const SCENE_SEC = { min: 8, max: 30 };
export const BUDGET_TOLERANCE = 0.05;

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
    if (s.budgetSec < SCENE_SEC.min || s.budgetSec > SCENE_SEC.max) add('warn', 'pacing', `section ${s.id} is ${s.budgetSec}s; scenes read best at ${SCENE_SEC.min}-${SCENE_SEC.max}s`);
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

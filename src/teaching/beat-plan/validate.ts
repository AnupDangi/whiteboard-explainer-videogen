import type { ConceptGraph, SceneContract } from '../../plan/schemas.js';
import type { ValidatorProblem } from '../../llm/structuredCall.js';
import { validateErrorContrast } from '../error-contrast/validate.js';
import type { BeatPlanDraft, RelationSpec } from './types.js';

export interface BeatContext {
  sceneId: string;
  conceptIds: string[];
  claims: Array<{ id: string; statement: string; conceptIds: string[]; relations: RelationSpec[]; evidenceSpanIds: string[] }>;
  /** Graph-backed relations among this scene's concepts. */
  relations: RelationSpec[];
  /** m1, m2 ... one per scene misconceptionRisk entry. */
  misconceptionIds: string[];
  durationSec: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** One beat is about one thought, 4-10 s of speech: the range follows scene length and is the same for every topic. The max assumes ~5 s per beat because a beat needs at least one claim-covering sentence (~10+ words); shorter beats cannot fit exact spoken budgets. */
export function beatCountRange(durationSec: number): { min: number; max: number } {
  const max = clamp(Math.floor(durationSec / 5), 2, 8);
  return { min: clamp(Math.ceil(durationSec / 10), 1, max), max };
}

const relationKey = (r: { from: string; to: string; type: string }): string => `${r.from}|${r.type}|${r.to}`;

export function beatContextFor(section: { id: string; conceptIds: string[]; budgetSec: number; contract?: SceneContract }, graph: ConceptGraph): BeatContext {
  const contract = section.contract;
  if (!contract) throw new Error(`section ${section.id} has no scene contract; beats are planned from the S3 contract`);
  const conceptIds = [...new Set([...section.conceptIds, ...contract.requiredConceptIds])];
  const inScene = new Set(conceptIds);
  return {
    sceneId: section.id,
    conceptIds,
    claims: contract.essentialClaims.map((claim) => ({ id: claim.id, statement: claim.statement, conceptIds: claim.conceptIds, relations: claim.relations, evidenceSpanIds: claim.evidenceSpanIds })),
    relations: graph.relations.filter((r) => inScene.has(r.from) && inScene.has(r.to)).map(({ from, to, type }) => ({ from, to, type })),
    misconceptionIds: (contract.misconceptionRisk ?? []).map((_, index) => `m${index + 1}`),
    durationSec: contract.targetDurationSec || section.budgetSec,
  };
}

/** Deterministic checks of a beat plan. Every problem names its JSON pointer so the repair can patch just that location. */
export function validateBeatPlan(plan: BeatPlanDraft, ctx: BeatContext): ValidatorProblem[] {
  const problems: ValidatorProblem[] = [];
  const claimIds = new Set(ctx.claims.map((claim) => claim.id));
  const concepts = new Set(ctx.conceptIds);
  const relations = new Set(ctx.relations.map(relationKey));
  const misconceptions = new Set(ctx.misconceptionIds);
  const covered = new Set<string>();
  plan.beats.forEach((beat, i) => {
    const at = `/beats/${i}`;
    beat.claimIds.forEach((claimId, j) => { if (!claimIds.has(claimId)) problems.push({ path: `${at}/claimIds/${j}`, message: `unknown claim ${claimId}; use one of: ${[...claimIds].join(', ')}` }); else covered.add(claimId); });
    beat.entities.forEach((entity, j) => { if (!concepts.has(entity.conceptId)) problems.push({ path: `${at}/entities/${j}/conceptId`, message: `${entity.conceptId} is not a concept of this scene; use one of: ${ctx.conceptIds.join(', ')}` }); });
    beat.relationships.forEach((relation, j) => { if (!relations.has(relationKey(relation))) problems.push({ path: `${at}/relationships/${j}`, message: `${relation.from} -[${relation.type}]-> ${relation.to} is not backed by the concept graph; use a listed relation or remove it` }); });
    beat.misconceptionIds.forEach((misconceptionId, j) => { if (!misconceptions.has(misconceptionId)) problems.push({ path: `${at}/misconceptionIds/${j}`, message: `unknown misconception ${misconceptionId}; use one of: ${ctx.misconceptionIds.join(', ') || '(none: leave the list empty)'}` }); });
    if (!beat.visualInvariant.trim()) problems.push({ path: `${at}/visualInvariant`, message: 'visualInvariant must say what is visible when the beat ends' });
    if (!beat.narrationOnly && !beat.mutedMeaning.trim()) problems.push({ path: `${at}/mutedMeaning`, message: 'a visual beat needs a muted meaning: what a viewer with the sound off should conclude from the board' });
    if (beat.errorContrast) {
      for (const message of validateErrorContrast(beat.errorContrast, beat.misconceptionIds)) problems.push({ path: `${at}/errorContrast`, message });
    }
  });
  const range = beatCountRange(ctx.durationSec);
  if (plan.beats.length < range.min) problems.push({ path: '/beats', message: `a ${ctx.durationSec}s scene needs at least ${range.min} beats, got ${plan.beats.length}` });
  if (plan.beats.length > range.max) problems.push({ path: '/beats', message: `a ${ctx.durationSec}s scene allows at most ${range.max} beats, got ${plan.beats.length}` });
  for (const claim of ctx.claims) if (!covered.has(claim.id)) problems.push({ path: '/beats', message: `claim ${claim.id} is not covered by any beat; add a beat whose claimIds include it` });
  return problems;
}

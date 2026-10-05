import type { ConceptGraph, SceneContract } from '../../plan/schemas.js';
import type { ValidatorProblem } from '../../llm/structuredCall.js';
import type { BeatPlanDraft, RelationSpec } from './types.js';
import type { ClaimSemantics } from '../../evidence/claims.js';
import type { ClaimVerificationStatus, EpistemicType } from '../../evidence/ledger.js';

export interface BeatContext {
  sceneId: string;
  conceptIds: string[];
  claims: Array<{ id: string; statement: string; conceptIds: string[]; relations: RelationSpec[]; evidenceSpanIds: string[]; semantics?: ClaimSemantics; epistemicType?: EpistemicType; verificationStatus?: ClaimVerificationStatus }>;
  /** Graph-backed relations among this scene's concepts. */
  relations: RelationSpec[];
  /** m1, m2 ... one per scene misconceptionRisk entry. */
  misconceptionIds: string[];
  durationSec: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** One beat is about one thought, 4-10 s of speech: the range follows scene length and is the same for every topic. */
export function beatCountRange(durationSec: number): { min: number; max: number } {
  const max = clamp(Math.floor(durationSec / 4), 2, 8);
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
    claims: contract.essentialClaims.map((claim) => ({ id: claim.id, statement: claim.statement, conceptIds: claim.conceptIds, relations: claim.relations, evidenceSpanIds: claim.evidenceSpanIds, ...(claim.semantics ? { semantics: claim.semantics } : {}), ...(claim.epistemicType ? { epistemicType: claim.epistemicType } : {}), ...(claim.verificationStatus ? { verificationStatus: claim.verificationStatus } : {}) })),
    relations: graph.relations.filter((r) => inScene.has(r.from) && inScene.has(r.to)).map(({ from, to, type }) => ({ from, to, type })),
    misconceptionIds: (contract.misconceptionRisk ?? []).map((_, index) => `m${index + 1}`),
    durationSec: contract.targetDurationSec || section.budgetSec,
  };
}

/** Deterministic checks of a beat plan. Every problem names its JSON pointer so the repair can patch just that location. */
export function validateBeatPlan(plan: BeatPlanDraft, ctx: BeatContext): ValidatorProblem[] {
  const problems: ValidatorProblem[] = [];
  const claimsById = new Map(ctx.claims.map((claim) => [claim.id, claim]));
  const claimIds = new Set(claimsById.keys());
  const concepts = new Set(ctx.conceptIds);
  const misconceptions = new Set(ctx.misconceptionIds);
  const covered = new Set<string>();
  const beatCountByClaim = new Map<string, number>();
  plan.beats.forEach((beat, i) => {
    const at = `/beats/${i}`;
    beat.claimIds.forEach((claimId, j) => {
      if (!claimIds.has(claimId)) problems.push({ path: `${at}/claimIds/${j}`, message: `unknown claim ${claimId}; use one of: ${[...claimIds].join(', ')}` });
      else { covered.add(claimId); beatCountByClaim.set(claimId, (beatCountByClaim.get(claimId) ?? 0) + 1); }
    });
    const citedClaims = beat.claimIds.flatMap((claimId) => {
      const claim = claimsById.get(claimId);
      return claim ? [claim] : [];
    });
    const unverifiedClaims = citedClaims.filter((claim) => claim.epistemicType === 'unverified_explanation' || claim.verificationStatus === 'unverified');
    if (unverifiedClaims.length) {
      if (beat.claimIds.length !== 1 || beat.claimIds[0] !== unverifiedClaims[0]!.id) problems.push({ path: `${at}/claimIds`, message: 'an unverified explanation must be isolated in a beat that cites only that one claim' });
      if (!beat.narrationOnly) problems.push({ path: `${at}/narrationOnly`, message: 'an unverified explanation must be narration-only and cannot be visualized' });
      if (beat.relationships.length) problems.push({ path: `${at}/relationships`, message: 'an unverified explanation cannot introduce a graph relation' });
      if (beat.entities.length) problems.push({ path: `${at}/entities`, message: 'an unverified explanation beat cannot depict entities' });
    }
    beat.entities.forEach((entity, j) => {
      const path = `${at}/entities/${j}/conceptId`;
      if (!concepts.has(entity.conceptId)) {
        problems.push({ path, message: `${entity.conceptId} is not a concept of this scene; use one of: ${ctx.conceptIds.join(', ')}` });
        return;
      }
      if (!citedClaims.some((claim) => claim.conceptIds.includes(entity.conceptId))) {
        problems.push({ path, message: `${entity.conceptId} is not linked to any cited claim (${beat.claimIds.join(', ')}); cite a claim containing this concept or remove the entity` });
      }
    });
    beat.relationships.forEach((relation, j) => {
      if (!citedClaims.some((claim) => claim.relations.some((claimedRelation) => relationKey(claimedRelation) === relationKey(relation)))) {
        problems.push({ path: `${at}/relationships/${j}`, message: `${relation.from} -[${relation.type}]-> ${relation.to} is not asserted by any cited claim (${beat.claimIds.join(', ')}); cite a claim that lists this directed relation or remove/revise it` });
      }
    });
    beat.misconceptionIds.forEach((misconceptionId, j) => { if (!misconceptions.has(misconceptionId)) problems.push({ path: `${at}/misconceptionIds/${j}`, message: `unknown misconception ${misconceptionId}; use one of: ${ctx.misconceptionIds.join(', ') || '(none: leave the list empty)'}` }); });
    if (!beat.visualInvariant.trim()) problems.push({ path: `${at}/visualInvariant`, message: 'visualInvariant must say what is visible when the beat ends' });
    if (!beat.narrationOnly && !beat.mutedMeaning.trim()) problems.push({ path: `${at}/mutedMeaning`, message: 'a visual beat needs a muted meaning: what a viewer with the sound off should conclude from the board' });
    if (!beat.narrationOnly && !beat.entities.length) problems.push({ path: `${at}/entities`, message: 'a visual beat needs at least one entity to show' });
  });
  const range = beatCountRange(ctx.durationSec);
  if (plan.beats.length < range.min) problems.push({ path: '/beats', message: `a ${ctx.durationSec}s scene needs at least ${range.min} beats, got ${plan.beats.length}` });
  if (plan.beats.length > range.max) problems.push({ path: '/beats', message: `a ${ctx.durationSec}s scene allows at most ${range.max} beats, got ${plan.beats.length}` });
  for (const claim of ctx.claims) {
    if (!covered.has(claim.id)) problems.push({ path: '/beats', message: `claim ${claim.id} is not covered by any beat; add a beat whose claimIds include it` });
    if ((claim.epistemicType === 'unverified_explanation' || claim.verificationStatus === 'unverified') && beatCountByClaim.get(claim.id) !== 1) {
      problems.push({ path: '/beats', message: `unverified explanation claim ${claim.id} must appear in exactly one isolated narration-only beat` });
    }
  }
  return problems;
}

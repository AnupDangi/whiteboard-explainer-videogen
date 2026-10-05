import type { BeatContext } from './validate.js';
import type { BeatPlanDraft, TeachingBeat } from './types.js';

/** Ids, order and evidence come from code: the model supplies meaning only. */
export function compileBeatPlan(plan: BeatPlanDraft, ctx: BeatContext): TeachingBeat[] {
  const evidenceByClaim = new Map(ctx.claims.map((claim) => [claim.id, claim.evidenceSpanIds]));
  return plan.beats.map((beat, index) => ({
    ...beat,
    beatId: `${ctx.sceneId}.b${index + 1}`,
    sceneId: ctx.sceneId,
    order: index + 1,
    dependsOnBeatIds: [...new Set(beat.dependsOnOrders)].map((order) => `${ctx.sceneId}.b${order}`),
    evidenceSpanIds: [...new Set(beat.claimIds.flatMap((claimId) => evidenceByClaim.get(claimId) ?? []))],
  }));
}

export interface BeatPlanMetrics {
  majorClaims: number;
  claimsCovered: number;
  beats: number;
  beatsWithLearningQuestion: number;
  beatsWithLearnerStateTransition: number;
  dependencyLinks: number;
  danglingDependencyIds: number;
  beatsWithLearnerDelta: number;
  beatsWithFamily: number;
  beatsWithInvariant: number;
  visualBeats: number;
  visualBeatsWithMutedMeaning: number;
  danglingClaimIds: number;
  unsupportedEvidenceIds: number;
}

/** Phase 2 exit criteria, measured over compiled plans. */
export function beatPlanMetrics(plans: ReadonlyArray<{ ctx: BeatContext; beats: readonly TeachingBeat[] }>): BeatPlanMetrics {
  const m: BeatPlanMetrics = { majorClaims: 0, claimsCovered: 0, beats: 0, beatsWithLearningQuestion: 0, beatsWithLearnerStateTransition: 0, dependencyLinks: 0, danglingDependencyIds: 0, beatsWithLearnerDelta: 0, beatsWithFamily: 0, beatsWithInvariant: 0, visualBeats: 0, visualBeatsWithMutedMeaning: 0, danglingClaimIds: 0, unsupportedEvidenceIds: 0 };
  for (const { ctx, beats } of plans) {
    const claimIds = new Set(ctx.claims.map((claim) => claim.id));
    const sceneSpans = new Set(ctx.claims.flatMap((claim) => claim.evidenceSpanIds));
    const beatOrders = new Map(beats.map((beat) => [beat.beatId, beat.order]));
    const covered = new Set<string>();
    for (const beat of beats) {
      m.beats += 1;
      if (/[?？]$/u.test(beat.learningQuestion.trim())) m.beatsWithLearningQuestion += 1;
      if (beat.learnerBefore.trim().toLowerCase() !== beat.learnerAfter.trim().toLowerCase()) m.beatsWithLearnerStateTransition += 1;
      m.dependencyLinks += beat.dependsOnBeatIds.length;
      for (const dependencyId of beat.dependsOnBeatIds) if ((beatOrders.get(dependencyId) ?? Number.POSITIVE_INFINITY) >= beat.order) m.danglingDependencyIds += 1;
      if (beat.learnerDelta.trim()) m.beatsWithLearnerDelta += 1;
      if (beat.representationFamily) m.beatsWithFamily += 1;
      if (beat.visualInvariant.trim()) m.beatsWithInvariant += 1;
      if (!beat.narrationOnly) { m.visualBeats += 1; if (beat.mutedMeaning.trim()) m.visualBeatsWithMutedMeaning += 1; }
      for (const claimId of beat.claimIds) { if (claimIds.has(claimId)) covered.add(claimId); else m.danglingClaimIds += 1; }
      for (const spanId of beat.evidenceSpanIds) if (!sceneSpans.has(spanId)) m.unsupportedEvidenceIds += 1;
    }
    m.majorClaims += claimIds.size;
    m.claimsCovered += covered.size;
  }
  return m;
}

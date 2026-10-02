import type { PlannerSceneInput } from './prompt.js';

/** The one place that turns narration, teaching context, and ranked candidates into S6 input. Shared by runLive and harnesses. */
export function buildPlannerSceneInput(args: {
  sceneId: string;
  narrationScene: { rawText: string; plainText: string; mentions: Array<{ id: string; phrase: string }>; claimSpans?: PlannerSceneInput['claimSpans'] };
  teachingContext: PlannerSceneInput['teachingContext'];
  mentionCandidates: Map<string, Array<{ id: string; name: string; score: number }>>;
  previousElements: PlannerSceneInput['previousElements'];
}): PlannerSceneInput {
  return {
    sceneId: args.sceneId,
    raw: args.narrationScene.rawText,
    plainText: args.narrationScene.plainText,
    mentions: args.narrationScene.mentions.map((mention) => ({ id: mention.id, phrase: mention.phrase })),
    claimSpans: args.narrationScene.claimSpans,
    teachingContext: args.teachingContext,
    candidates: Object.fromEntries(args.narrationScene.mentions.map((mention) => [
      mention.id,
      (args.mentionCandidates.get(mention.phrase.trim().toLowerCase()) ?? []).map((candidate) => ({ id: candidate.id, name: candidate.name, score: candidate.score })),
    ])),
    previousElements: args.previousElements,
  };
}

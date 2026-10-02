import type { NarrationContext } from './validate.js';
import { NARRATION_HARD_CEILING } from './validate.js';
import { WORDS_PER_SEC } from '../../plan/analyze.js';

/** Topic-free narration rules; everything lesson-specific comes from the beat plan and the source excerpt passed in. */
export function buildNarrationPrompt(ctx: NarrationContext, scene: { title: string; goal: string }, sourceExcerpt: string): { system: string; user: string } {
  const system = `You write the speech for ONE scene of a whiteboard teaching video, beat by beat. The speech must work as an audio lesson on its own: a learner who only listens understands the idea, and the board then shows what was said.
Rules: teach the reasoning (what it is, why it matters, how it changes, what causes what); never refer to the screen, the drawing, positions, boxes, arrows or colours; never command the drawing ("now show", "draw"); say each idea once and move it forward instead of repeating it; introduce a term with its meaning before using it; use only facts and numbers from the source excerpt and the claims; calm, confident, conversational, one idea per sentence, short sentences.
Return ONE JSON object { "beats": [{ "beatId", "sentences": [...1-4 sentences], "claimSentences": [{ "claimId", "sentenceIndex" }], "emphasisTerms": [...] }] } with exactly one narration beat per teaching beat, in order, with the given beat ids. Each claimSentences entry names the sentence (0-based) of that beat that states the claim; every claim of the beat needs one. emphasisTerms are concept labels worth stressing.`;
  const beatLines = ctx.beats.map((beat) => `- ${beat.beatId} [${beat.beatType}; ${beat.cognitiveOperation}] claims ${JSON.stringify(beat.claimIds)}: ${beat.narrationGoal} (the learner should leave able to: ${beat.learnerDelta})`).join('\n');
  const words = Math.round(ctx.durationSec * WORDS_PER_SEC);
  const user = `SCENE ${ctx.sceneId}: "${scene.title}" — ${scene.goal}
About ${words} spoken words for ${ctx.durationSec} s (never more than ${Math.round(words * NARRATION_HARD_CEILING)}); the audio sets the real length.
Teaching beats (write one narration beat for each):
${beatLines}
Concept labels you may stress: ${JSON.stringify(ctx.emphasisCandidates)}

SOURCE (facts and numbers come only from here):
${sourceExcerpt}`;
  return { system, user };
}

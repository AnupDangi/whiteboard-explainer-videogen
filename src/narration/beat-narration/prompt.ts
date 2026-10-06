import type { NarrationContext } from './validate.js';
import { NARRATION_PROMPT_CEILING } from './validate.js';
import { wordsPerSec } from '../../plan/analyze.js';
import { tokenizeWords } from '../align.js';
import { semanticEventId } from '../../teaching/beat-plan/types.js';

/** Topic-free narration rules; everything lesson-specific comes from the beat plan and the source excerpt passed in. */
export function buildNarrationPrompt(ctx: NarrationContext, scene: { title: string; goal: string }, sourceExcerpt: string): { system: string; user: string } {
  const lesson = ctx.lesson;
  const languageName = new Intl.DisplayNames(['en'], { type: 'language' }).of(ctx.language ?? 'en') ?? 'English';
  const place = !lesson ? '' : lesson.sceneCount <= 1 ? 'This is the whole lesson.' : lesson.sceneIndex === 0 ? `This is the FIRST of ${lesson.sceneCount} scenes.` : lesson.sceneIndex === lesson.sceneCount - 1 ? `This is the LAST of ${lesson.sceneCount} scenes.` : `This is scene ${lesson.sceneIndex + 1} of ${lesson.sceneCount}.`;
  const firstBeat = !ctx.beatFlow || ctx.beatFlow.index === 0;
  const lastBeat = !ctx.beatFlow || ctx.beatFlow.index === ctx.beatFlow.count - 1;
  const beatOpening = !firstBeat ? 'Pick up naturally from the previous beat in this scene; do not restart the lesson or repeat its opening.'
    : lesson?.sceneIndex === 0 || (lesson && lesson.sceneCount <= 1) ? 'Open with the question or puzzle this lesson answers, in plain words, so the learner wants the answer (never "in this video").'
      : 'Open with ONE natural sentence that picks up from what the previous scene just taught and leads into this one.';
  const beatEnding = !lastBeat ? 'End by leading naturally toward the next beat; do not add a scene recap or takeaway yet.'
    : lesson && lesson.sceneIndex === lesson.sceneCount - 1 ? 'Finish with a two-sentence recap of the whole lesson and what the learner can now do.'
      : 'End the scene with a one-sentence takeaway that leads into the next scene.';
  const outputContract = ctx.beatFlow
    ? 'Return ONE JSON object for the supplied beat: { "beatId", "sentences": [...1-4 sentences], "claimSentences": [{ "claimId", "sentenceIndex" }], "semanticAnchors": [{ "semanticEventId", "sentenceIndex", "phrase" }], "emphasisTerms": [...] }. Use the exact supplied beat id. Each claimSentences entry names the sentence (0-based) of this beat that states that claim; every claim needs one. Each semanticAnchors entry names one required meaning change, in listed event order, and copies an exact nonempty phrase from the named sentence. The phrase must occur once and convey the change; never paraphrase the anchor. emphasisTerms are concept labels worth stressing.'
    : 'Return ONE JSON object { "beats": [{ "beatId", "sentences": [...1-4 sentences], "claimSentences": [{ "claimId", "sentenceIndex" }], "semanticAnchors": [{ "semanticEventId", "sentenceIndex", "phrase" }], "emphasisTerms": [...] }] } with exactly one narration beat per teaching beat, in order, with the given beat ids. Each claimSentences entry names the sentence (0-based) of that beat that states the claim; every claim of the beat needs one. Each semanticAnchors entry names one required meaning change, in the listed event order, and copies an exact nonempty phrase from the named sentence (0-based). Choose a phrase that occurs only once in that sentence and conveys the change; never paraphrase it in the anchor. emphasisTerms are concept labels worth stressing.';
  const system = `You are a warm, expert teacher recording the audio of ONE scene of a single continuous lesson. The speech must work as an audio lesson on its own: a learner who only listens understands the idea, and the board then shows what was said. It must sound like one person teaching from start to finish, never like separate fact cards.
Language: write every sentence in natural, idiomatic ${languageName}, as a ${languageName} teacher would say it aloud (not a word-for-word translation). ${ctx.language && ctx.language.toLowerCase() !== 'en' ? 'Teach in the requested language, while naturally retaining familiar English technical terms or short English phrases when speakers of that language commonly use them. Explain unfamiliar English terms in the requested language on first use; do not switch whole sentences into English.' : 'Speak in English throughout.'} Write numbers as digits and keep technical terms the way ${languageName} speakers use them. Use no symbols that cannot be spoken.
Teach like a person: ${place} ${beatOpening} Make this beat answer the question the previous beat raised; link ideas with because, so, that means, but, now. Move from the familiar to the new. Introduce a term with its meaning before you use it. When an idea is abstract, give one concrete everyday example or comparison (it may be generic, but it must add no new facts or numbers). Sometimes ask a short question and then answer it. Where the source supports it, name the common mistake and correct it. ${beatEnding} Speak to the learner ("you", "we"), vary sentence length, and never use lists or headings.
Rules: teach the reasoning (what it is, why it matters, how it changes, what causes what); when a claim lists a graph relation, name both endpoints and state that directed relation explicitly with its correct predicate; do not replace an edge with clause order or imply it through a separate outcome. Never refer to the screen, the drawing, positions, boxes, arrows or colours; never command the drawing ("now show", "draw"); say each idea once and move it forward instead of repeating it; use only facts and numbers from the source excerpt and the claims; preserve examples and analogy framing. For each unverified_explanation claim, say “not verified by the supplied source” in the anchored sentence and never present it as a sourced fact; calm, confident, conversational, short sentences.
${outputContract}`;
  const beatLines = ctx.beats.map((beat) => {
    const claims = beat.claimIds.map((id) => {
      const claim = ctx.canonicalClaims?.[id];
      return claim ? {
        id,
        statement: claim.statement,
        ...(claim.epistemicType ? { epistemicType: claim.epistemicType } : {}),
        ...(claim.identity?.relations.length ? { requiredRelations: claim.identity.relations.map(({ fromLabel, toLabel, type }) => ({ from: fromLabel, type, to: toLabel })) } : {}),
      } : { id };
    });
    const events = beat.requiredSemanticChanges.map((change, index) => ({ semanticEventId: semanticEventId(beat.beatId, index), kind: change.kind, identityKey: change.identityKey, ...(change.fromState ? { fromState: change.fromState } : {}), toState: change.toState }));
    return `- ${beat.beatId} [${beat.beatType}; ${beat.cognitiveOperation}] claims ${JSON.stringify(claims)}; semantic events ${JSON.stringify(events)}: ${beat.narrationGoal} (the learner should leave able to: ${beat.learnerDelta})`;
  }).join('\n');
  const words = Math.round(ctx.durationSec * wordsPerSec(ctx.language));
  const around = lesson ? `Lesson: "${lesson.title}".${lesson.previous ? ` The previous scene taught: ${lesson.previous.title} (${lesson.previous.goal}).` : ''}${lesson.next ? ` The next scene will cover: ${lesson.next.title} (${lesson.next.goal}).` : ''}\n` : '';
  const terminology = ctx.terminology?.length ? `Lesson terminology (use consistently; explain unfamiliar English terms in ${languageName}):\n${ctx.terminology.map((entry) => `- ${entry.term}${entry.nativeExplanation ? `: ${entry.nativeExplanation}` : ''}`).join('\n')}\n` : '';
  const flow = ctx.beatFlow ? `BEAT ${ctx.beatFlow.index + 1} OF ${ctx.beatFlow.count} IN THIS SCENE. Write only the supplied beat.\n${ctx.beatFlow.previousSentences?.length ? `Earlier beats in this scene said: ${ctx.beatFlow.previousSentences.join(' ')}\n` : ''}${ctx.beatFlow.nextGoal ? `The next beat will teach: ${ctx.beatFlow.nextGoal}\n` : ''}` : '';
  const beatInstruction = ctx.beatFlow ? 'Current teaching beat (write this beat only):' : 'Teaching beats (write one narration beat for each):';
  const revisionUnit = ctx.beatFlow ? 'beat' : 'scene';
  const previousWords = ctx.revision?.previous.reduce((sum, beat) => sum + tokenizeWords(beat.sentences.join(' '), ctx.language).length, 0) ?? 0;
  const revision = ctx.revision
    ? `\nREVISION: the previous version of this ${revisionUnit} was spoken in ${ctx.revision.previousSeconds.toFixed(1)} s at ${ctx.revision.measuredWordsPerSec.toFixed(1)} words per second, which does not fit the lesson's runtime. Write it again with ${ctx.revision.direction === 'shorten' ? 'at most' : 'at least'} ${ctx.revision.targetWords} spoken words (count them). Keep its planned meaning and every claim anchored to the sentence that states it; ${ctx.revision.targetWords < previousWords ? 'say the same things in fewer words and drop only what no claim needs' : 'add only short explanations the SOURCE supports'}. Previous version:\n${ctx.revision.previous.map((beat) => `- ${beat.beatId}: ${beat.sentences.join(' ')}`).join('\n')}\n`
    : '';
  const user = `${around}SCENE ${ctx.sceneId}: "${scene.title}" — ${scene.goal}
${ctx.revision ? `${ctx.revision.direction === 'shorten' ? 'At most' : 'At least'} ${ctx.revision.targetWords} spoken words (the audio sets the real length).` : `About ${words} spoken words for ${ctx.durationSec} s (never more than ${Math.round(words * NARRATION_PROMPT_CEILING)}); the audio sets the real length.`}${revision}
${terminology}${flow}
${beatInstruction}
${beatLines}
Concept labels you may stress: ${JSON.stringify(ctx.emphasisCandidates)}

SOURCE (facts and numbers come only from here):
${sourceExcerpt}`;
  return { system, user };
}

import type { NarrationContext } from './validate.js';
import { NARRATION_PROMPT_CEILING } from './validate.js';
import { wordsPerSec } from '../../plan/analyze.js';

/** Topic-free narration rules; everything lesson-specific comes from the beat plan and the source excerpt passed in. */
export function buildNarrationPrompt(ctx: NarrationContext, scene: { title: string; goal: string }, sourceExcerpt: string): { system: string; user: string } {
  const lesson = ctx.lesson;
  const languageName = new Intl.DisplayNames(['en'], { type: 'language' }).of(ctx.language ?? 'en') ?? 'English';
  const place = !lesson ? '' : lesson.sceneCount <= 1 ? 'This is the whole lesson.' : lesson.sceneIndex === 0 ? `This is the FIRST of ${lesson.sceneCount} scenes.` : lesson.sceneIndex === lesson.sceneCount - 1 ? `This is the LAST of ${lesson.sceneCount} scenes.` : `This is scene ${lesson.sceneIndex + 1} of ${lesson.sceneCount}.`;
  const system = `You are a warm, expert teacher recording the audio of ONE scene of a single continuous lesson. The speech must work as an audio lesson on its own: a learner who only listens understands the idea, and the board then shows what was said. It must sound like one person teaching from start to finish, never like separate fact cards.
Language: write every sentence in natural, idiomatic ${languageName}, as a ${languageName} teacher would say it aloud (not a word-for-word translation). ${ctx.language && ctx.language.toLowerCase() !== 'en' ? 'Teach in the requested language, while naturally retaining familiar English technical terms or short English phrases when speakers of that language commonly use them. Explain unfamiliar English terms in the requested language on first use; do not switch whole sentences into English.' : 'Speak in English throughout.'} Write numbers as digits and keep technical terms the way ${languageName} speakers use them. Use no symbols that cannot be spoken.
Teach like a person: ${place} ${lesson?.sceneIndex === 0 || (lesson && lesson.sceneCount <= 1) ? 'Open with the question or puzzle this lesson answers, in plain words, so the learner wants the answer (never "in this video").' : 'Open with ONE natural sentence that picks up from what the previous scene just taught and leads into this one.'} Make each beat answer the question the previous beat raised; link ideas with because, so, that means, but, now. Move from the familiar to the new. Introduce a term with its meaning before you use it. When an idea is abstract, give one concrete everyday example or comparison (it may be generic, but it must add no new facts or numbers). Sometimes ask a short question and then answer it. Where the source supports it, name the common mistake and correct it. ${lesson && lesson.sceneIndex === lesson.sceneCount - 1 ? 'Finish with a two-sentence recap of the whole lesson and what the learner can now do.' : 'End the scene with a one-sentence takeaway that leads into the next scene.'} Speak to the learner ("you", "we"), vary sentence length, and never use lists or headings.
Rules: teach the reasoning (what it is, why it matters, how it changes, what causes what); never refer to the screen, the drawing, positions, boxes, arrows or colours; never command the drawing ("now show", "draw"); say each idea once and move it forward instead of repeating it; use only facts and numbers from the source excerpt and the claims; calm, confident, conversational, short sentences.
Return ONE JSON object { "beats": [{ "beatId", "sentences": [...1-4 sentences], "claimSentences": [{ "claimId", "sentenceIndex" }], "emphasisTerms": [...] }] } with exactly one narration beat per teaching beat, in order, with the given beat ids. Each claimSentences entry names the sentence (0-based) of that beat that states the claim; every claim of the beat needs one. emphasisTerms are concept labels worth stressing.`;
  const beatLines = ctx.beats.map((beat) => `- ${beat.beatId} [${beat.beatType}; ${beat.cognitiveOperation}] claims ${JSON.stringify(beat.claimIds)}: ${beat.narrationGoal} (the learner should leave able to: ${beat.learnerDelta})`).join('\n');
  const words = Math.round(ctx.durationSec * wordsPerSec(ctx.language));
  const around = lesson ? `Lesson: "${lesson.title}".${lesson.previous ? ` The previous scene taught: ${lesson.previous.title} (${lesson.previous.goal}).` : ''}${lesson.next ? ` The next scene will cover: ${lesson.next.title} (${lesson.next.goal}).` : ''}\n` : '';
  const terminology = ctx.terminology?.length ? `Lesson terminology (use consistently; explain unfamiliar English terms in ${languageName}):\n${ctx.terminology.map((entry) => `- ${entry.term}${entry.nativeExplanation ? `: ${entry.nativeExplanation}` : ''}`).join('\n')}\n` : '';
  const revision = ctx.revision
    ? `\nREVISION: the previous version of this scene was spoken in ${ctx.revision.previousSeconds.toFixed(1)} s at ${ctx.revision.measuredWordsPerSec.toFixed(1)} words per second, which does not fit the lesson's runtime. Write it again with ${ctx.revision.direction === 'shorten' ? 'at most' : 'at least'} ${ctx.revision.targetWords} spoken words (count them). Keep exactly the same beats, in the same order, and keep every claim anchored to the sentence that states it; ${ctx.revision.targetWords < ctx.revision.previous.reduce((n, beat) => n + beat.sentences.join(' ').split(/\s+/).length, 0) ? 'say the same things in fewer words and drop only what no claim needs' : 'add only short explanations the SOURCE supports'}. Previous version:\n${ctx.revision.previous.map((beat) => `- ${beat.beatId}: ${beat.sentences.join(' ')}`).join('\n')}\n`
    : '';
  const user = `${around}SCENE ${ctx.sceneId}: "${scene.title}" — ${scene.goal}
${ctx.revision ? `${ctx.revision.direction === 'shorten' ? 'At most' : 'At least'} ${ctx.revision.targetWords} spoken words (the audio sets the real length).` : `About ${words} spoken words for ${ctx.durationSec} s (never more than ${Math.round(words * NARRATION_PROMPT_CEILING)}); the audio sets the real length.`}${revision}
${terminology}
Teaching beats (write one narration beat for each):
${beatLines}
Concept labels you may stress: ${JSON.stringify(ctx.emphasisCandidates)}

SOURCE (facts and numbers come only from here):
${sourceExcerpt}`;
  return { system, user };
}

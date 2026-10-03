import type { NarrationContext } from './validate.js';
import { NARRATION_PROMPT_CEILING } from './validate.js';
import type { TeachingMoveName } from '../../teaching/moves/types.js';
import { wordsPerSec } from '../../plan/analyze.js';

/** Move → rhetoric: how each teaching move sounds when spoken. Deterministic compiler text, never model output. */
const MOVE_RHETORIC: Record<TeachingMoveName, string> = {
  RevealMotivation: 'Open with the puzzle, in plain words, so the learner wants the answer.',
  ActivatePriorKnowledge: 'Remind the learner what they already own, then build on it.',
  StateLearningQuestion: 'State the one question this part answers.',
  BuildIntuition: 'Give one concrete everyday comparison before any formalism.',
  IntroduceMentalModel: 'Name the reusable picture the learner should keep.',
  RevealDefinition: 'Define each term with its meaning before you rely on it.',
  TraceMechanism: 'Walk causes in order; every step earns the next.',
  WorkExample: 'Show the setup, take one step, say why, show the result.',
  PredictNextStep: 'Ask what happens next, pause a beat, then answer it yourself.',
  ExposeMisconception: 'Name the common mistake plainly, as the wrong idea it is.',
  ForkCorrectIncorrect: 'Hold the wrong and right paths side by side.',
  ExplainDivergence: 'Say why the wrong path feels plausible.',
  RepairMisconception: 'Repair at the exact point the reasoning breaks.',
  ShowNonExample: 'Show what the idea is not.',
  ShowCounterexample: 'Show the case that breaks the naive rule.',
  TestBoundary: 'Push to the edge case and say what changes.',
  CompareCases: 'Compare the cases point for point.',
  ConfirmInvariant: 'Say what stays the same.',
  FadeSupport: 'Let the learner carry the step you just carried.',
  TransferVariant: 'Try the idea on a nearby case.',
  SummarizeLearnerDelta: 'Close with what the learner can now do.',
};

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
  const treatment = ctx.strategy || ctx.moves?.length
    ? `\nTeaching treatment for this scene: ${ctx.strategy ?? 'see moves'}. Speak each move as written:\n${(ctx.moves ?? []).map((m) => `- ${m.move}: ${MOVE_RHETORIC[m.move]}`).join('\n')}\n`
    : '';
  const bridge = `${ctx.previousTakeaway ? `The previous scene ended saying: "${ctx.previousTakeaway}" Pick up from exactly there in your first sentence.\n` : ''}${ctx.nextOpening ? `The next scene will open with: "${ctx.nextOpening}" Aim your closing takeaway at exactly that.\n` : ''}`;
  const words = Math.round(ctx.durationSec * wordsPerSec(ctx.language));
  const around = lesson ? `Lesson: "${lesson.title}".${lesson.previous ? ` The previous scene taught: ${lesson.previous.title} (${lesson.previous.goal}).` : ''}${lesson.next ? ` The next scene will cover: ${lesson.next.title} (${lesson.next.goal}).` : ''}\n` : '';
  const terminology = ctx.terminology?.length ? `Lesson terminology (use consistently; explain unfamiliar English terms in ${languageName}):\n${ctx.terminology.map((entry) => `- ${entry.term}${entry.nativeExplanation ? `: ${entry.nativeExplanation}` : ''}`).join('\n')}\n` : '';
  const user = `${around}SCENE ${ctx.sceneId}: "${scene.title}" — ${scene.goal}
About ${words} spoken words for ${ctx.durationSec} s (never more than ${Math.round(words * NARRATION_PROMPT_CEILING)}); the audio sets the real length.
${treatment}${bridge}${terminology}Teaching beats (write one narration beat for each):
${beatLines}
Concept labels you may stress: ${JSON.stringify(ctx.emphasisCandidates)}

SOURCE (facts and numbers come only from here):
${sourceExcerpt}`;
  return { system, user };
}

import type { ValidatorProblem } from '../../llm/structuredCall.js';
import type { TeachingBeat } from '../../teaching/beat-plan/types.js';
import { wordsPerSec } from '../../plan/analyze.js';
import type { SceneNarrationDraft } from './types.js';

export interface NarrationContext {
  sceneId: string;
  beats: TeachingBeat[];
  /** Digits the scene may speak: those in its claims and cited evidence. */
  allowedNumbers: ReadonlySet<string>;
  durationSec: number;
  /** Concept labels the speaker may stress. */
  emphasisCandidates: string[];
  /** ISO 639-1 language of the speech (default en). */
  language?: string;
  /** Native-language teaching with established English technical terms kept where natural. */
  speechLanguagePolicy?: 'native-plus-english-terms';
  /** Lesson-wide canonical terminology; explanations remain in the spoken language. */
  terminology?: ReadonlyArray<{ term: string; nativeExplanation?: string }>;
  /** Where this scene sits in the lesson, so the speech continues one talk instead of restarting. */
  lesson?: { title: string; sceneIndex: number; sceneCount: number; previous?: { title: string; goal: string }; next?: { title: string; goal: string } };
}

/** Speech that depends on the picture instead of teaching the idea (screen-dependent phrasing, final_plan/03 §12). */
const SCREEN_REFERENCE = /\b(?:look at|as you can see|you can see|on (?:the|your) (?:left|right|top|bottom)|(?:top|bottom)[- ](?:left|right)|in the (?:box|diagram|picture|image|figure|corner)|this (?:box|arrow|diagram|picture|icon)|the (?:arrow|box|diagram|picture|icon) (?:shows|points)|on (?:the )?screen|shown here|pictured)\b/i;
const STAGE_DIRECTION = /^(?:now[, ]+)?(?:show|display|draw|animate|render|highlight|reveal|place|write|cut to)\b/i;
/** Audio sets the clock, so a mild overrun is a warning; only a scene this much over its spoken budget is rejected. */
/** What the speaker is told never to exceed; the validator only rejects beyond NARRATION_HARD_CEILING, because the audio, not the word count, sets the real length. */
export const NARRATION_PROMPT_CEILING = 1.5;
export const NARRATION_HARD_CEILING = 2.5;

const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Greek letters, arrows and maths operators: the speech engine and the aligner cannot read them. */
// Greek is a supported writing system (and Greek letter names are speakable).
// Keep rejecting pictographic arrows and mathematical operators that TTS may
// silently omit, while allowing Greek prose and Greek-script names.
const UNSPEAKABLE_SYMBOLS = /[\u2190-\u21FF\u2200-\u22FF\u00B1\u00D7\u00F7\u221A]/u;

const DECIMAL_ZEROES = [0x30,0x660,0x6f0,0x7c0,0x966,0x9e6,0xa66,0xae6,0xb66,0xbe6,0xc66,0xce6,0xd66,0xde6,0xe50,0xed0,0xf20,0x1040,0x1090,0x17e0,0x1810,0x1946,0x19d0,0x1a80,0x1a90,0x1b50,0x1bb0,0x1c40,0x1c50,0xa620,0xa8d0,0xa900,0xa9d0,0xa9f0,0xaa50,0xabf0,0xff10];
const asciiDigits = (value: string): string => [...value].map((char) => {
  const cp = char.codePointAt(0)!;
  const zero = DECIMAL_ZEROES.find((candidate) => cp >= candidate && cp <= candidate + 9);
  return zero === undefined ? char : String(cp - zero);
}).join('');

export function narrationLengthWarning(draft: SceneNarrationDraft, ctx: NarrationContext): string | undefined {
  const words = draft.beats.reduce((sum, beat) => sum + beat.sentences.reduce((n, sentence) => n + wordCount(sentence), 0), 0);
  const budget = ctx.durationSec * wordsPerSec(ctx.language);
  return words > budget ? `${words} spoken words against a ${Math.round(budget)}-word budget; audio sets the clock` : undefined;
}

export function validateSceneNarration(draft: SceneNarrationDraft, ctx: NarrationContext): ValidatorProblem[] {
  const problems: ValidatorProblem[] = [];
  const planIds = ctx.beats.map((beat) => beat.beatId);
  if (draft.beats.length !== planIds.length) problems.push({ path: '/beats', message: `write exactly ${planIds.length} narration beats, one per teaching beat (${planIds.join(', ')}); got ${draft.beats.length}` });
  const seen = new Set<string>();
  draft.beats.forEach((narration, i) => {
    const at = `/beats/${i}`;
    const plan = ctx.beats[i];
    if (plan && narration.beatId !== plan.beatId) problems.push({ path: `${at}/beatId`, message: `narration beat ${i + 1} must be ${plan.beatId}, got ${narration.beatId}` });
    const planClaims = new Set(plan?.claimIds ?? []);
    narration.sentences.forEach((sentence, j) => {
      const key = normalize(sentence);
      if (SCREEN_REFERENCE.test(sentence)) problems.push({ path: `${at}/sentences/${j}`, message: 'refers to the screen; say what the idea is so the speech works with the sound only' });
      if (STAGE_DIRECTION.test(sentence.trim())) problems.push({ path: `${at}/sentences/${j}`, message: 'a visual stage direction is spoken; teach the idea instead of commanding the drawing' });
      if (UNSPEAKABLE_SYMBOLS.test(sentence)) problems.push({ path: `${at}/sentences/${j}`, message: 'contains a symbol that cannot be spoken or aligned (Greek letter, arrow or maths operator); write it as the word you say, for example tau, not the symbol' });
      if (/\[\[|\]\]/.test(sentence)) problems.push({ path: `${at}/sentences/${j}`, message: 'markers are not used; write plain speech' });
      for (const number of asciiDigits(sentence).match(/\d+(?:\.\d+)?/g) ?? []) if (!ctx.allowedNumbers.has(number)) problems.push({ path: `${at}/sentences/${j}`, message: `number ${number} is not in this scene's claims or evidence; state only numbers the source gives` });
      if (key && seen.has(key)) problems.push({ path: `${at}/sentences/${j}`, message: 'repeats a sentence already spoken in this scene; move the idea forward instead' });
      seen.add(key);
    });
    const anchored = new Set<string>();
    narration.claimSentences.forEach((anchor, j) => {
      if (!planClaims.has(anchor.claimId)) { problems.push({ path: `${at}/claimSentences/${j}/claimId`, message: `unknown claim ${anchor.claimId} for this beat; use one of: ${[...planClaims].join(', ')}` }); return; }
      anchored.add(anchor.claimId);
      if (anchor.sentenceIndex >= narration.sentences.length) problems.push({ path: `${at}/claimSentences/${j}/sentenceIndex`, message: `sentenceIndex ${anchor.sentenceIndex} is outside this beat's ${narration.sentences.length} sentences` });
    });
    for (const claim of planClaims) if (!anchored.has(claim)) problems.push({ path: `${at}/claimSentences`, message: `claim ${claim} must be anchored to the sentence of this beat that states it` });
  });
  const words = draft.beats.reduce((sum, beat) => sum + beat.sentences.reduce((n, sentence) => n + wordCount(sentence), 0), 0);
  const ceiling = Math.round(ctx.durationSec * wordsPerSec(ctx.language) * NARRATION_HARD_CEILING);
  if (words > ceiling) problems.push({ path: '/beats', message: `too long: ${words} spoken words, at most ${ceiling} for a ${ctx.durationSec}s scene (about ${Math.max(6, Math.floor(ceiling / Math.max(1, draft.beats.length)))} words per beat for ${draft.beats.length} beats); cut or merge the longest sentences` });
  return problems;
}

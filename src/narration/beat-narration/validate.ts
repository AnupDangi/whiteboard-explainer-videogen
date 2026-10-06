import type { ValidatorProblem } from '../../llm/structuredCall.js';
import { semanticEventId, type TeachingBeat } from '../../teaching/beat-plan/types.js';
import { wordsPerSec } from '../../plan/analyze.js';
import type { CoercionEntry } from '../../structured/coercionLedger.js';
import type { SceneNarrationDraft } from './types.js';
import { tokenizeWords } from '../align.js';
import { claimSemanticsMismatch, type ClaimSemantics } from '../../evidence/claims.js';
import { epistemicTextFramingProblem, type EpistemicType } from '../../evidence/ledger.js';
import { claimIdentityMismatch, formatClaimIdentityMismatch, type ClaimIdentity } from '../../evidence/claimIdentity.js';

export interface NarrationContext {
  sceneId: string;
  beats: TeachingBeat[];
  /** Digits the scene may speak: those in its claims and cited evidence. */
  allowedNumbers: ReadonlySet<string>;
  durationSec: number;
  /** Concept labels the speaker may stress. */
  emphasisCandidates: string[];
  /** Canonical claim meanings keyed by claim id; used only to validate the anchored sentence. */
  canonicalClaims?: Record<string, { statement: string; semantics?: ClaimSemantics; identity?: ClaimIdentity; epistemicType?: EpistemicType }>;
  /** ISO 639-1 language of the speech (default en). */
  language?: string;
  /** Native-language teaching with established English technical terms kept where natural. */
  speechLanguagePolicy?: 'native-plus-english-terms';
  /** Lesson-wide canonical terminology; explanations remain in the spoken language. */
  terminology?: ReadonlyArray<{ term: string; nativeExplanation?: string }>;
  /** Present for beat-local S4 calls so transitions stay coherent without rewriting adjacent beats. */
  beatFlow?: { index: number; count: number; previousSentences?: string[]; nextGoal?: string };
  /**
   * Set when the measured audio of an earlier draft missed the lesson's runtime: rewrite this scene to a word budget derived from the
   * real speaking rate. The claims and beats stay exactly as planned; only the amount of speech changes.
   */
  revision?: { /** Which side of the target the speech must land on, so each round moves toward the runtime instead of hovering around it. */ direction: 'shorten' | 'lengthen'; targetWords: number; measuredWordsPerSec: number; previousSeconds: number; previous: Array<{ beatId: string; sentences: string[] }> };
  /** Where this scene sits in the lesson, so the speech continues one talk instead of restarting. */
  lesson?: { title: string; sceneIndex: number; sceneCount: number; previous?: { title: string; goal: string }; next?: { title: string; goal: string } };
}

/** Speech that depends on the picture instead of teaching the idea (screen-dependent phrasing, final_plan/03 §12). */
const SCREEN_REFERENCE = /\b(?:look at|as you can see|you can see|on (?:the|your) (?:left|right|top|bottom)|(?:top|bottom)[- ](?:left|right)|in the (?:box|diagram|picture|image|figure|corner)|this (?:box|arrow|diagram|picture|icon)|the (?:arrow|box|diagram|picture|icon) (?:shows|points)|on (?:the )?screen|shown here|pictured)\b/i;
const STAGE_DIRECTION = /^(?:now[, ]+)?(?:show|display|draw|animate|render|highlight|reveal|place|write|cut to)\b/i;
/** Audio sets the clock, so a mild overrun is a warning; only a scene this much over its spoken budget is rejected. */
/** What the speaker is told never to exceed; the validator only rejects beyond NARRATION_HARD_CEILING, because the audio, not the word count, sets the real length. */
export const NARRATION_PROMPT_CEILING = 1.5;
export const NARRATION_HARD_CEILING = 3;
/** A length revision must land within this side-aware share of its word target (models cannot count exactly); the measure-and-rewrite rounds close the rest. */
export const REVISION_WORD_TOLERANCE = 0.15;

const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
const wordCount = (text: string, language?: string): number => tokenizeWords(text, language ?? 'und').length;

/** Greek letters, arrows and maths operators: the speech engine and the aligner cannot read them. */
// Greek is a supported writing system (and Greek letter names are speakable).
// Keep rejecting pictographic arrows and mathematical operators that TTS may
// silently omit, while allowing Greek prose and Greek-script names.
// ASCII operators (+ = ^ * < >) are spoken as words by TTS ("plus"), so the transcript the aligner sees no longer matches the audio.
const UNSPEAKABLE_SYMBOLS = /[\u2190-\u21FF\u2200-\u22FF\u00B1\u00D7\u00F7\u221A+=^*<>]/u;

const DECIMAL_ZEROES = [0x30,0x660,0x6f0,0x7c0,0x966,0x9e6,0xa66,0xae6,0xb66,0xbe6,0xc66,0xce6,0xd66,0xde6,0xe50,0xed0,0xf20,0x1040,0x1090,0x17e0,0x1810,0x1946,0x19d0,0x1a80,0x1a90,0x1b50,0x1bb0,0x1c40,0x1c50,0xa620,0xa8d0,0xa900,0xa9d0,0xa9f0,0xaa50,0xabf0,0xff10];
const asciiDigits = (value: string): string => [...value].map((char) => {
  const cp = char.codePointAt(0)!;
  const zero = DECIMAL_ZEROES.find((candidate) => cp >= candidate && cp <= candidate + 9);
  return zero === undefined ? char : String(cp - zero);
}).join('');

export function narrationLengthWarning(draft: SceneNarrationDraft, ctx: NarrationContext): string | undefined {
  const words = draft.beats.reduce((sum, beat) => sum + beat.sentences.reduce((n, sentence) => n + wordCount(sentence, ctx.language), 0), 0);
  const budget = ctx.durationSec * wordsPerSec(ctx.language);
  return words > budget ? `${words} spoken words against a ${Math.round(budget)}-word budget; audio sets the clock` : undefined;
}

export function validateSceneNarration(draft: SceneNarrationDraft, ctx: NarrationContext): ValidatorProblem[] {
  const problems: ValidatorProblem[] = [];
  const planIds = ctx.beats.map((beat) => beat.beatId);
  if (draft.beats.length !== planIds.length) problems.push({ path: '/beats', message: `write exactly ${planIds.length} narration beats, one per teaching beat (${planIds.join(', ')}); got ${draft.beats.length}` });
  const seen = new Set((ctx.beatFlow?.previousSentences ?? []).map(normalize).filter(Boolean));
  draft.beats.forEach((narration, i) => {
    const at = `/beats/${i}`;
    const plan = ctx.beats[i];
    if (plan && narration.beatId !== plan.beatId) problems.push({ path: `${at}/beatId`, message: `narration beat ${i + 1} must be ${plan.beatId}, got ${narration.beatId}` });
    const planClaims = new Set(plan?.claimIds ?? []);
    narration.sentences.forEach((sentence, j) => {
      const key = normalize(sentence);
      if (SCREEN_REFERENCE.test(sentence)) problems.push({ path: `${at}/sentences/${j}`, message: 'refers to the screen; say what the idea is so the speech works with the sound only' });
      if (STAGE_DIRECTION.test(sentence.trim())) problems.push({ path: `${at}/sentences/${j}`, message: 'a visual stage direction is spoken; teach the idea instead of commanding the drawing' });
      if (UNSPEAKABLE_SYMBOLS.test(sentence)) problems.push({ path: `${at}/sentences/${j}`, message: 'contains a symbol that cannot be spoken or aligned (Greek letter, arrow or maths operator such as + or =); write it as the word you say, for example tau, plus or equals, not the symbol' });
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
      else {
        const claim = ctx.canonicalClaims?.[anchor.claimId];
        if (claim) {
          const sentence = narration.sentences[anchor.sentenceIndex]!;
          for (const mismatch of claimSemanticsMismatch(claim.statement, sentence, claim.semantics)) {
            problems.push({ path: `${at}/sentences/${anchor.sentenceIndex}`, message: `claim ${anchor.claimId} semantic mismatch: ${mismatch}` });
          }
          if (claim.epistemicType) {
            const framingProblem = epistemicTextFramingProblem(claim.epistemicType, sentence);
            if (framingProblem) problems.push({ path: `${at}/sentences/${anchor.sentenceIndex}`, message: `claim ${anchor.claimId} epistemic framing mismatch: ${framingProblem}` });
          }
          if (claim.identity) for (const mismatch of claimIdentityMismatch(claim.identity, sentence)) {
            problems.push({ path: `${at}/sentences/${anchor.sentenceIndex}`, message: `claim ${anchor.claimId} identity mismatch: ${formatClaimIdentityMismatch(mismatch)}` });
          }
        }
      }
    });
    for (const claim of planClaims) if (!anchored.has(claim)) problems.push({ path: `${at}/claimSentences`, message: `claim ${claim} must be anchored to the sentence of this beat that states it` });
    const expectedChanges = plan?.requiredSemanticChanges ?? [];
    if (narration.semanticAnchors.length !== expectedChanges.length) problems.push({ path: `${at}/semanticAnchors`, message: `write exactly ${expectedChanges.length} semantic phrase anchors, one for each required change in order; got ${narration.semanticAnchors.length}` });
    let previousSemanticPosition: { sentenceIndex: number; charEnd: number } | undefined;
    narration.semanticAnchors.forEach((anchor, j) => {
      const path = `${at}/semanticAnchors/${j}`;
      const expectedId = plan ? semanticEventId(plan.beatId, j) : undefined;
      if (!expectedId || j >= expectedChanges.length || anchor.semanticEventId !== expectedId) problems.push({ path: `${path}/semanticEventId`, message: `semantic event ${j + 1} must be ${expectedId ?? 'from a planned beat'}, got ${anchor.semanticEventId}` });
      const sentence = narration.sentences[anchor.sentenceIndex];
      if (!sentence) { problems.push({ path: `${path}/sentenceIndex`, message: `sentenceIndex ${anchor.sentenceIndex} is outside this beat's ${narration.sentences.length} sentences` }); return; }
      if (!anchor.phrase.trim() || anchor.phrase !== anchor.phrase.trim()) problems.push({ path: `${path}/phrase`, message: 'phrase must be nonempty and have no leading or trailing whitespace' });
      else if (sentence.indexOf(anchor.phrase) < 0) problems.push({ path: `${path}/phrase`, message: 'phrase must be copied exactly from the nominated sentence' });
      else if (sentence.indexOf(anchor.phrase) !== sentence.lastIndexOf(anchor.phrase)) problems.push({ path: `${path}/phrase`, message: 'phrase must occur exactly once in the nominated sentence' });
      else {
        const charStart = sentence.indexOf(anchor.phrase);
        const charEnd = charStart + anchor.phrase.length;
        if (previousSemanticPosition && (anchor.sentenceIndex < previousSemanticPosition.sentenceIndex
          || (anchor.sentenceIndex === previousSemanticPosition.sentenceIndex && charStart < previousSemanticPosition.charEnd))) {
          problems.push({ path: `${path}/phrase`, message: 'semantic phrase anchors must point to distinct, non-overlapping spans in required-change order' });
        }
        previousSemanticPosition = { sentenceIndex: anchor.sentenceIndex, charEnd };
      }
    });
    narration.semanticAnchors.forEach((anchor, j) => {
      const sentencePath = `${at}/sentences/${anchor.sentenceIndex}`;
      const anchorPath = `${at}/semanticAnchors/${j}/phrase`;
      const sentenceRejected = problems.some((problem) => typeof problem !== 'string' && problem.path === sentencePath);
      const anchorAlreadyRejected = problems.some((problem) => typeof problem !== 'string' && problem.path === anchorPath);
      if (sentenceRejected && !anchorAlreadyRejected) problems.push({
        path: anchorPath,
        message: `sentence ${anchor.sentenceIndex} is being repaired; update this semantic phrase in the same repair so it is copied exactly from the final sentence and still names the planned meaning change`,
      });
    });
  });
  const words = draft.beats.reduce((sum, beat) => sum + beat.sentences.reduce((n, sentence) => n + wordCount(sentence, ctx.language), 0), 0);
  if (ctx.revision) {
    const target = ctx.revision.targetWords;
    // Overshoot on the wrong side is tolerated more than undershoot: each measured duration round re-aims, so a close miss must not end the lesson.
    const edge = Math.max(6, Math.round(target * 0.2));
    const spread = Math.max(3, Math.round(target * REVISION_WORD_TOLERANCE));
    // Models miss a word budget in the direction they were told to move; the window therefore sits on the correct side of the target.
    const [low, high] = ctx.revision.direction === 'shorten' ? [target - spread, target + edge] : [target - edge, target + spread];
    if (words < low || words > high) problems.push({ path: '/beats', message: `write between ${low} and ${high} spoken words (aim for ${target}); this has ${words}. Keep every beat and every claim, and ${words > high ? 'cut the least necessary words' : 'add only explanation the source supports'}` });
  }
  const ceiling = Math.round(ctx.durationSec * wordsPerSec(ctx.language) * NARRATION_HARD_CEILING);
  if (words > ceiling) problems.push({ path: '/beats', message: `too long: ${words} spoken words, at most ${ceiling} for a ${ctx.durationSec}s scene (about ${Math.max(6, Math.floor(ceiling / Math.max(1, draft.beats.length)))} words per beat for ${draft.beats.length} beats); cut or merge the longest sentences` });
  return problems;
}

/**
 * A claim anchored to a sentence number the beat does not have is anchored to the beat's last sentence instead. Only this
 * pointer is touched, every change is ledgered, and the result is accepted only if the whole draft then validates.
 */
export function clampClaimAnchors(draft: SceneNarrationDraft, ctx: NarrationContext): { value: SceneNarrationDraft; entries: CoercionEntry[] } | undefined {
  const value: SceneNarrationDraft = structuredClone(draft);
  const entries: CoercionEntry[] = [];
  value.beats.forEach((beat, i) => beat.claimSentences.forEach((anchor, j) => {
    const last = beat.sentences.length - 1;
    if (anchor.sentenceIndex > last) {
      entries.push({ path: `/beats/${i}/claimSentences/${j}/sentenceIndex`, oldValue: anchor.sentenceIndex, newValue: last, reason: 'claim anchored to a sentence the beat does not have; moved to its last sentence', semanticRisk: 'semantic' });
      anchor.sentenceIndex = last;
    }
  }));
  return entries.length > 0 && validateSceneNarration(value, ctx).length === 0 ? { value, entries } : undefined;
}

import type { AlignedAudio, MentionResolutionFailure, NarrationScript, ResolvedMention } from '../shared/types.js';
import { tokenizeWords } from './align.js';

const normalizeToken = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘ʼ]/gu, "'")
    .replace(/[^\p{L}\p{M}\p{N}'-]+/gu, '')
    // A plural possessive ("sides'") keeps its apostrophe in the aligned word but loses it in the phrase tokenizer.
    .replace(/^'+|'+$/g, '');

/** Dashes and slashes glue two spoken words into one aligner token ("recall—reproducing"); a mention may name one half. */
const SPLIT_JOINERS = /[\u2012-\u2015\u2212/]+/u;
const tokensOf = (s: string): string[] => s.split(SPLIT_JOINERS).map(normalizeToken).filter(Boolean);

interface SpanSearch {
  first: [number, number] | null;
  matchCount: number;
}

function findSpan(normWords: string[], phraseTokens: string[], from: number): SpanSearch {
  let first: [number, number] | null = null;
  let matchCount = 0;
  for (let i = from; i <= normWords.length - phraseTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      // A marker may end where a possessive or clitic begins ("example" inside "example's"): the aligner keeps the
      // apostrophe form as one word, so the phrase's final token matches a word that continues with an apostrophe.
      const word = normWords[i + j]!;
      const last = j === phraseTokens.length - 1;
      if (word !== phraseTokens[j] && !(last && word.startsWith(`${phraseTokens[j]}'`))) {
        ok = false;
        break;
      }
    }
    if (ok) {
      matchCount++;
      if (first === null) first = [i, i + phraseTokens.length];
    }
  }
  return { first, matchCount };
}

export interface ResolveMentionsResult {
  mentions: ResolvedMention[];
  failures: MentionResolutionFailure[];
}

/**
 * Resolve `[[id|phrase]]` markers against the aligned word sequence.
 *
 * Strategy per scene, processing mentions in narration (script) order:
 *  1. Normalize both the mention phrase and every aligned word (Unicode
 *     NFKC + case fold + strip punctuation) so "café," matches "café" and
 *     "Café" matches "cafe" only if a normalizer upstream folds diacritics —
 *     here we intentionally keep diacritics significant, only punctuation is
 *     stripped, per the spec's "Unicode" coverage requirement (café != cafe).
 *  2. Search forward from a monotonically advancing cursor first, so repeated
 *     identical phrases resolve to their respective sequential occurrences
 *     rather than all collapsing onto the first hit.
 *  3. If nothing is found from the cursor onward (mention referenced out of
 *     narration order), retry from the start of the scene.
 *  4. If more than one candidate span exists in the searched window, the
 *     match is still resolved deterministically (first occurrence) but
 *     flagged `ambiguous: true` so callers/tests can audit it — ambiguity is
 *     recorded, never silently dropped.
 *  5. A phrase with zero matches anywhere in the scene is a hard
 *     `missing-span` failure: it is NEVER silently skipped, since a dropped
 *     mention would desynchronize a reveal from its narrated word (a
 *     non-compensable hard failure per claude_pipeline.md).
 */
export function resolveMentions(script: NarrationScript, audio: AlignedAudio): ResolveMentionsResult {
  const mentions: ResolvedMention[] = [];
  const failures: MentionResolutionFailure[] = [];

  for (const scene of script.scenes) {
    const words = audio.sceneWords[scene.sceneId] ?? [];
    // Flatten aligned words into joiner-split tokens, remembering each token's word index.
    const flat = words.flatMap((w, wordIndex) => tokensOf(w.w).map((token) => ({ token, wordIndex })));
    const normWords = flat.map((entry) => entry.token);
    let cursor = 0;

    for (const raw of scene.mentions) {
      const phraseTokens = tokenizeWords(raw.phrase).flatMap(tokensOf);
      if (phraseTokens.length === 0) {
        failures.push({ sceneId: scene.sceneId, mentionId: raw.id, phrase: raw.phrase, reason: 'empty-phrase' });
        continue;
      }

      let search = findSpan(normWords, phraseTokens, cursor);
      if (!search.first && cursor > 0) search = findSpan(normWords, phraseTokens, 0);

      if (!search.first) {
        failures.push({ sceneId: scene.sceneId, mentionId: raw.id, phrase: raw.phrase, reason: 'missing-span' });
        continue;
      }

      const start = flat[search.first[0]]!.wordIndex;
      const end = flat[search.first[1] - 1]!.wordIndex + 1;
      mentions.push({
        sceneId: scene.sceneId,
        mentionId: raw.id,
        startMs: words[start].startMs,
        endMs: words[end - 1].endMs,
        ambiguous: search.matchCount > 1,
        wordRange: [start, end],
      });
      cursor = Math.max(cursor, search.first[1]);
    }
  }

  return { mentions, failures };
}


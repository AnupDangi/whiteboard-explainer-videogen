import type { AlignedAudio, MentionResolutionFailure, NarrationScript, ResolvedMention } from '../types.js';
import { tokenizeWords } from './align.js';

const normalizeToken = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘ʼ]/gu, "'")
    .replace(/[^\p{L}\p{M}\p{N}'-]+/gu, '');

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
      if (normWords[i + j] !== phraseTokens[j]) {
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
    const normWords = words.map((w) => normalizeToken(w.w));
    let cursor = 0;

    for (const raw of scene.mentions) {
      const phraseTokens = tokenizeWords(raw.phrase).map(normalizeToken).filter(Boolean);
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

      const [start, end] = search.first;
      mentions.push({
        sceneId: scene.sceneId,
        mentionId: raw.id,
        startMs: words[start].startMs,
        endMs: words[end - 1].endMs,
        ambiguous: search.matchCount > 1,
        wordRange: [start, end],
      });
      cursor = end;
    }
  }

  return { mentions, failures };
}

/** Convenience: run resolution and return audio with `.mentions` populated, throwing on any hard failure. */
export function attachResolvedMentions(script: NarrationScript, audio: AlignedAudio): AlignedAudio {
  const { mentions, failures } = resolveMentions(script, audio);
  if (failures.length > 0) {
    const detail = failures.map((f) => `${f.sceneId}/${f.mentionId} (${f.reason}): "${f.phrase}"`).join('; ');
    throw new Error(`Mention resolution failed for ${failures.length} mention(s): ${detail}`);
  }
  return { ...audio, mentions };
}

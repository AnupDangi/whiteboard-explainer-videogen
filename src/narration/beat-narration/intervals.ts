import { tokenizeWords } from '../align.js';
import type { CompiledSceneNarration } from './types.js';

export interface AlignedWordLike { w: string; startMs: number; endMs: number }
export interface BeatInterval { beatId: string; startMs: number; endMs: number; sentences: Array<{ sentenceId: string; startMs: number; endMs: number }> }

/**
 * Beat and sentence intervals from the aligned audio (the master clock): token positions in the narration text map to
 * aligned words, so no duration is ever estimated from speaking speed once real alignment exists.
 */
export function beatIntervals(narration: CompiledSceneNarration, words: readonly AlignedWordLike[]): BeatInterval[] {
  const textTokens = tokenizeWords(narration.text);
  const owner: number[] = [];
  const alignedTokens: string[] = [];
  words.forEach((word, index) => { for (const token of tokenizeWords(word.w)) { alignedTokens.push(token); owner.push(index); } });
  if (alignedTokens.length !== textTokens.length || alignedTokens.some((token, i) => token !== textTokens[i])) throw new Error(`aligned words do not match the narration token sequence for scene ${narration.sceneId}`);
  let cursor = 0;
  return narration.beatSpans.map((beat) => {
    const sentences = beat.sentenceSpans.map((span) => {
      const count = tokenizeWords(narration.text.slice(span.charStart, span.charEnd)).length;
      const first = owner[cursor]!;
      const last = owner[cursor + count - 1]!;
      cursor += count;
      return { sentenceId: span.sentenceId, startMs: words[first]!.startMs, endMs: words[last]!.endMs };
    });
    return { beatId: beat.beatId, startMs: sentences[0]!.startMs, endMs: sentences[sentences.length - 1]!.endMs, sentences };
  });
}

import { tokenizeWords } from '../align.js';
import type { CompiledSceneNarration } from './types.js';

export interface AlignedWordLike { w: string; startMs: number; endMs: number }
export interface BeatInterval { beatId: string; startMs: number; endMs: number; sentences: Array<{ sentenceId: string; startMs: number; endMs: number }> }
export interface AlignedSemanticAnchor {
  semanticEventId: string;
  beatId: string;
  phrase: string;
  startMs: number;
  endMs: number;
}

function alignedTokenOwners(narration: CompiledSceneNarration, words: readonly AlignedWordLike[], language: string): number[] {
  const textTokens = tokenizeWords(narration.text, language);
  const owner: number[] = [];
  const alignedTokens: string[] = [];
  words.forEach((word, index) => {
    for (const token of tokenizeWords(word.w, language)) { alignedTokens.push(token); owner.push(index); }
  });
  if (alignedTokens.length !== textTokens.length || alignedTokens.some((token, i) => token !== textTokens[i])) throw new Error(`aligned words do not match the narration token sequence for scene ${narration.sceneId}`);
  return owner;
}

/**
 * Beat and sentence intervals from the aligned audio (the master clock): token positions in the narration text map to
 * aligned words, so no duration is ever estimated from speaking speed once real alignment exists.
 */
export function beatIntervals(narration: CompiledSceneNarration, words: readonly AlignedWordLike[], language = 'und'): BeatInterval[] {
  const owner = alignedTokenOwners(narration, words, language);
  let cursor = 0;
  return narration.beatSpans.map((beat) => {
    const sentences = beat.sentenceSpans.map((span) => {
      const count = tokenizeWords(narration.text.slice(span.charStart, span.charEnd), language).length;
      const first = owner[cursor]!;
      const last = owner[cursor + count - 1]!;
      cursor += count;
      return { sentenceId: span.sentenceId, startMs: words[first]!.startMs, endMs: words[last]!.endMs };
    });
    return { beatId: beat.beatId, startMs: sentences[0]!.startMs, endMs: sentences[sentences.length - 1]!.endMs, sentences };
  });
}

/** Resolve compiled character anchors to the first and last aligned word that carries each exact phrase. */
export function alignedSemanticAnchorIntervals(narration: CompiledSceneNarration, words: readonly AlignedWordLike[], language = 'und'): AlignedSemanticAnchor[] {
  const owner = alignedTokenOwners(narration, words, language);
  const anchors: AlignedSemanticAnchor[] = [];
  let previousStart = -Infinity;
  for (const anchor of narration.semanticAnchors) {
    if (!Number.isSafeInteger(anchor.charStart) || !Number.isSafeInteger(anchor.charEnd) || anchor.charStart < 0 || anchor.charEnd <= anchor.charStart || anchor.charEnd > narration.text.length
      || narration.text.slice(anchor.charStart, anchor.charEnd) !== anchor.phrase) throw new Error(`semantic anchor ${anchor.semanticEventId} has an invalid compiled character span`);
    const beat = narration.beatSpans.find((candidate) => candidate.beatId === anchor.beatId);
    if (!beat || anchor.charStart < beat.charStart || anchor.charEnd > beat.charEnd) throw new Error(`semantic anchor ${anchor.semanticEventId} falls outside its compiled beat`);
    const tokenStart = tokenizeWords(narration.text.slice(0, anchor.charStart), language).length;
    const tokenEnd = tokenizeWords(narration.text.slice(0, anchor.charEnd), language).length;
    if (tokenStart < 0 || tokenEnd <= tokenStart || tokenEnd > owner.length) throw new Error(`semantic anchor ${anchor.semanticEventId} does not cover aligned speech tokens`);
    const firstWord = owner[tokenStart]!;
    const lastWord = owner[tokenEnd - 1]!;
    const startMs = words[firstWord]?.startMs;
    const endMs = words[lastWord]?.endMs;
    if (startMs === undefined || endMs === undefined || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || startMs < previousStart) {
      throw new Error(`semantic anchor ${anchor.semanticEventId} has invalid or out-of-order aligned timing`);
    }
    anchors.push({ semanticEventId: anchor.semanticEventId, beatId: anchor.beatId, phrase: anchor.phrase, startMs, endMs });
    previousStart = startMs;
  }
  return anchors;
}

import type { TeachingBeat } from '../../teaching/beat-plan/types.js';
import type { BeatSpan, CompiledSceneNarration, NarrationBeat, SceneNarrationDraft } from './types.js';

/** One scene text from the beats' sentences, with exact character spans for every beat and sentence. */
export function compileSceneNarration(sceneId: string, draft: SceneNarrationDraft, beats: readonly TeachingBeat[]): CompiledSceneNarration {
  let text = '';
  const narrationBeats: NarrationBeat[] = [];
  const beatSpans: BeatSpan[] = [];
  const claimSpans: CompiledSceneNarration['claimSpans'] = [];
  const claimed = new Set<string>();
  draft.beats.forEach((narration, i) => {
    if (text) text += ' ';
    const charStart = text.length;
    const sentenceSpans: BeatSpan['sentenceSpans'] = [];
    narration.sentences.forEach((sentence, j) => {
      if (j > 0) text += ' ';
      const start = text.length;
      text += sentence;
      sentenceSpans.push({ sentenceId: `${narration.beatId}.s${j + 1}`, charStart: start, charEnd: text.length });
    });
    const charEnd = text.length;
    for (const anchor of narration.claimSentences) {
      const span = sentenceSpans[anchor.sentenceIndex];
      if (!span || claimed.has(anchor.claimId)) continue;
      claimed.add(anchor.claimId);
      claimSpans.push({ claimId: anchor.claimId, exactText: text.slice(span.charStart, span.charEnd), plainStart: span.charStart, plainEnd: span.charEnd });
    }
    narrationBeats.push({ beatId: narration.beatId, sentenceIds: sentenceSpans.map((s) => s.sentenceId), text: text.slice(charStart, charEnd), ...(narration.emphasisTerms.length ? { speakingStyle: { emphasisTerms: [...narration.emphasisTerms] } } : {}) });
    beatSpans.push({ beatId: narration.beatId, pauseIntent: beats[i]?.pauseIntent ?? 'none', charStart, charEnd, sentenceSpans });
  });
  return { sceneId, text, beats: narrationBeats, beatSpans, claimSpans };
}

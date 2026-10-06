import { semanticEventId, type TeachingBeat } from '../../teaching/beat-plan/types.js';
import type { BeatSpan, CompiledSceneNarration, NarrationBeat, SceneNarrationDraft } from './types.js';

/** One scene text from the beats' sentences, with exact character spans for every beat and sentence. */
export function compileSceneNarration(sceneId: string, draft: SceneNarrationDraft, beats: readonly TeachingBeat[]): CompiledSceneNarration {
  let text = '';
  const narrationBeats: NarrationBeat[] = [];
  const beatSpans: BeatSpan[] = [];
  const claimSpans: CompiledSceneNarration['claimSpans'] = [];
  const semanticAnchors: CompiledSceneNarration['semanticAnchors'] = [];
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
    const changes = beats[i]?.requiredSemanticChanges ?? [];
    if (narration.semanticAnchors.length !== changes.length) throw new Error(`beat ${narration.beatId} needs ${changes.length} semantic anchors`);
    let previousSemanticAnchorEnd = -1;
    narration.semanticAnchors.forEach((anchor, j) => {
      const expectedId = semanticEventId(narration.beatId, j);
      const span = sentenceSpans[anchor.sentenceIndex];
      const sentence = narration.sentences[anchor.sentenceIndex];
      const offset = sentence?.indexOf(anchor.phrase) ?? -1;
      if (anchor.semanticEventId !== expectedId || !span || !anchor.phrase.trim() || anchor.phrase !== anchor.phrase.trim() || offset < 0 || sentence!.lastIndexOf(anchor.phrase) !== offset) throw new Error(`invalid phrase anchor ${expectedId}`);
      const charStart = span.charStart + offset;
      const charEnd = charStart + anchor.phrase.length;
      if (charStart < previousSemanticAnchorEnd) throw new Error(`semantic phrase anchors are duplicate, overlapping, or out of order at ${expectedId}`);
      previousSemanticAnchorEnd = charEnd;
      semanticAnchors.push({ semanticEventId: expectedId, beatId: narration.beatId, phrase: anchor.phrase, charStart, charEnd });
    });
    narrationBeats.push({ beatId: narration.beatId, sentenceIds: sentenceSpans.map((s) => s.sentenceId), text: text.slice(charStart, charEnd), ...(narration.emphasisTerms.length ? { speakingStyle: { emphasisTerms: [...narration.emphasisTerms] } } : {}) });
    beatSpans.push({ beatId: narration.beatId, pauseIntent: beats[i]?.pauseIntent ?? 'none', charStart, charEnd, sentenceSpans });
  });
  return { sceneId, text, beats: narrationBeats, beatSpans, claimSpans, semanticAnchors };
}

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const validOffset = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Independently verify compiled phrase spans against the ordered, pinned beat changes. */
export function compiledSemanticAnchorProblems(narration: unknown, beats: unknown): string[] {
  const problems: string[] = [];
  const compiled = record(narration);
  if (!compiled || typeof compiled.text !== 'string' || !Array.isArray(compiled.semanticAnchors) || !Array.isArray(compiled.beatSpans) || !Array.isArray(compiled.beats) || !Array.isArray(beats)) return ['compiled narration, semantic anchors, beat spans, spoken beats, and planned beats are required'];
  const text = compiled.text as string;
  const planned = beats as unknown[];
  const spans = compiled.beatSpans as unknown[];
  const spokenBeats = compiled.beats as unknown[];
  const anchors = compiled.semanticAnchors as unknown[];
  if (spans.length !== planned.length) problems.push(`beat span count ${spans.length} differs from planned beat count ${planned.length}`);
  if (spokenBeats.length !== planned.length) problems.push(`spoken beat count ${spokenBeats.length} differs from planned beat count ${planned.length}`);
  let anchorIndex = 0;
  let nextBeatStart = 0;
  planned.forEach((rawBeat, i) => {
    const beat = record(rawBeat);
    const beatSpan = record(spans[i]);
    const spokenBeat = record(spokenBeats[i]);
    if (!beat || typeof beat.beatId !== 'string' || !beat.beatId || !Array.isArray(beat.requiredSemanticChanges)) { problems.push(`beat ${i} lacks required semantic changes`); return; }
    const beatSpanValid = Boolean(beatSpan && beatSpan.beatId === beat.beatId && validOffset(beatSpan.charStart) && validOffset(beatSpan.charEnd) && beatSpan.charEnd >= beatSpan.charStart && beatSpan.charEnd <= text.length && Array.isArray(beatSpan.sentenceSpans));
    if (!beatSpanValid) problems.push(`beat ${beat.beatId} has invalid compiled span`);
    else {
      if (beatSpan!.charStart !== nextBeatStart || !spokenBeat || spokenBeat.beatId !== beat.beatId || spokenBeat.text !== text.slice(beatSpan!.charStart as number, beatSpan!.charEnd as number)) problems.push(`beat ${beat.beatId} span or spoken text differs from scene text`);
      const sentences = beatSpan!.sentenceSpans as unknown[];
      if (sentences.length === 0) problems.push(`beat ${beat.beatId} has no sentence spans`);
      let nextSentenceStart = beatSpan!.charStart as number;
      sentences.forEach((rawSentence, sentenceIndex) => {
        const sentence = record(rawSentence);
        if (!sentence || sentence.sentenceId !== `${beat.beatId}.s${sentenceIndex + 1}` || !validOffset(sentence.charStart) || !validOffset(sentence.charEnd) || sentence.charStart !== nextSentenceStart || sentence.charEnd <= sentence.charStart || sentence.charEnd > (beatSpan!.charEnd as number)) problems.push(`beat ${beat.beatId} sentence ${sentenceIndex + 1} has invalid span`);
        if (sentence && validOffset(sentence.charEnd)) nextSentenceStart = sentence.charEnd + 1;
        if (sentenceIndex < sentences.length - 1 && text[(sentence?.charEnd as number)] !== ' ') problems.push(`beat ${beat.beatId} sentence ${sentenceIndex + 1} lacks separator`);
      });
      if (sentences.length && nextSentenceStart !== (beatSpan!.charEnd as number) + 1) problems.push(`beat ${beat.beatId} sentence spans do not cover the beat`);
      nextBeatStart = (beatSpan!.charEnd as number) + 1;
      if (i < planned.length - 1 && text[beatSpan!.charEnd as number] !== ' ') problems.push(`beat ${beat.beatId} lacks beat separator`);
    }
    let previousAnchorEnd = -1;
    beat.requiredSemanticChanges.forEach((_change: unknown, j: number) => {
      const expectedId = semanticEventId(beat.beatId as string, j);
      const anchor = record(anchors[anchorIndex]);
      const at = `semantic anchor ${anchorIndex} (${expectedId})`;
      anchorIndex++;
      if (!anchor) { problems.push(`${at} is missing`); return; }
      if (anchor.semanticEventId !== expectedId || anchor.beatId !== beat.beatId) problems.push(`${at} has wrong event or beat identity`);
      if (typeof anchor.phrase !== 'string' || !anchor.phrase.trim() || anchor.phrase !== anchor.phrase.trim() || !validOffset(anchor.charStart) || !validOffset(anchor.charEnd) || anchor.charEnd !== (anchor.charStart as number) + anchor.phrase.length || anchor.charEnd > text.length || text.slice(anchor.charStart as number, anchor.charEnd as number) !== anchor.phrase) { problems.push(`${at} has invalid phrase or character offsets`); return; }
      if ((anchor.charStart as number) < previousAnchorEnd) problems.push(`${at} overlaps or precedes the previous semantic event phrase`);
      previousAnchorEnd = anchor.charEnd as number;
      const sentenceSpans = Array.isArray(beatSpan?.sentenceSpans) ? beatSpan.sentenceSpans : [];
      const containing = sentenceSpans.map(record).filter((span): span is Record<string, unknown> => Boolean(span && validOffset(span.charStart) && validOffset(span.charEnd) && (span.charStart as number) <= (anchor.charStart as number) && (anchor.charEnd as number) <= (span.charEnd as number)));
      if (containing.length !== 1) { problems.push(`${at} must lie in exactly one sentence of its beat`); return; }
      const sentence = text.slice(containing[0]!.charStart as number, containing[0]!.charEnd as number);
      if (sentence.indexOf(anchor.phrase) !== sentence.lastIndexOf(anchor.phrase)) problems.push(`${at} phrase is not unique in its sentence`);
    });
  });
  if (planned.length && nextBeatStart !== text.length + 1) problems.push('beat spans do not cover the scene text');
  if (anchors.length !== anchorIndex) problems.push(`semantic anchor count ${anchors.length} differs from expected ${anchorIndex}`);
  return problems;
}

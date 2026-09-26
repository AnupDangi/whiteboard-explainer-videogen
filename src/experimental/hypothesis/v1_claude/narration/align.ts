import type { AlignedAudio, AlignedWord, NarrationScript } from '../types.js';

/** Unicode-aware word tokenizer, including curly apostrophes used in generated narration. */
const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’‘ʼ-][\p{L}\p{M}\p{N}]+)*/gu;

export function tokenizeWords(text: string): string[] {
  return text.normalize('NFKC').match(WORD_RE) ?? [];
}

/**
 * Deterministic word-duration model used ONLY in fixture mode
 * (HypothesisRunOptions.alignment.provider === 'fixture'). This stands in for
 * real forced alignment: it is a pure function of the word string, never
 * wall-clock, never random, so replaying the same narration produces byte
 * identical timings (content-addressed caching depends on this).
 */
function baseDurationMs(word: string): number {
  const len = [...word].length;
  return 220 + Math.max(0, len - 3) * 40;
}

const SCENE_GAP_MS = 200;

/** Validate measured per-scene word clocks before they become planner anchors. */
export function alignedWordTimingProblems(words: AlignedWord[], durationMs: number): string[] {
  const problems: string[] = [];
  let previousStartMs = -Infinity;
  for (const [index, word] of words.entries()) {
    if (!word.w.trim()) problems.push(`word ${index} has empty text`);
    if (!Number.isFinite(word.startMs) || !Number.isFinite(word.endMs)) {
      problems.push(`word ${index} has non-finite timing`);
      continue;
    }
    if (word.startMs < 0 || word.endMs <= word.startMs || word.endMs > durationMs) {
      problems.push(`word ${index} has invalid interval [${word.startMs}, ${word.endMs}) for ${durationMs}ms audio`);
    }
    if (word.startMs < previousStartMs) problems.push(`word ${index} starts before the previous word`);
    previousStartMs = word.startMs;
  }
  return problems;
}

/**
 * Fixture-mode S5: tokenizes each scene's plain narration, assigns
 * deterministic per-word durations, then scales the whole run uniformly so
 * total duration lands on `targetDurationMs` (audio is the master clock —
 * every downstream timestamp derives from this, never the reverse).
 */
export function alignFixture(script: NarrationScript, targetDurationMs: number, wavPath = 'fixture://silence.wav'): AlignedAudio {
  const perScene = script.scenes.map((scene) => tokenizeWords(scene.plainText).map((w) => ({ w, raw: baseDurationMs(w) })));
  const gaps = Math.max(0, script.scenes.length - 1) * SCENE_GAP_MS;
  const rawTotal = perScene.reduce((sum, words) => sum + words.reduce((s, w) => s + w.raw, 0), 0) + gaps;
  const scale = rawTotal > 0 ? targetDurationMs / rawTotal : 1;

  const sceneWords: Record<string, AlignedWord[]> = {};
  const sceneBoundsMs: Record<string, { startMs: number; endMs: number }> = {};
  let cursorMs = 0;
  script.scenes.forEach((scene, i) => {
    const sceneStart = cursorMs;
    const words: AlignedWord[] = [];
    for (const { w, raw } of perScene[i]) {
      const dur = raw * scale;
      words.push({ w, startMs: cursorMs, endMs: cursorMs + dur });
      cursorMs += dur;
    }
    sceneWords[scene.sceneId] = words;
    sceneBoundsMs[scene.sceneId] = { startMs: sceneStart, endMs: cursorMs };
    if (i < script.scenes.length - 1) cursorMs += SCENE_GAP_MS * scale;
  });

  return {
    schemaVersion: 'claude-aligned-audio/v1',
    provider: 'fixture',
    wavPath,
    durationMs: Math.round(cursorMs),
    sceneWords,
    sceneBoundsMs,
    mentions: [],
  };
}

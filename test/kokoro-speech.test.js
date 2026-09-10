import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKokoroSpeech, KOKORO_VOICES} from '../dist/src/kokoro-speech.js';

const RUNTIME = process.env.TEST_KOKORO_TTS === '1';

test('Kokoro voice allowlist rejects unknown voices without spawning', async () => {
  await assert.rejects(generateKokoroSpeech('hello', {voiceId: 'not-a-voice'}), /Unknown Kokoro voice/);
  assert(KOKORO_VOICES.includes('af_heart'));
});

test('Kokoro speech returns real WAV with native word timings', {skip: !RUNTIME}, async () => {
  const {audio, timing, format} = await generateKokoroSpeech('hello world hello', {voiceId: 'af_heart'});
  assert.equal(format, 'wav');
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  const sampleRate = audio.readUInt32LE(24), channels = audio.readUInt16LE(22), bits = audio.readUInt16LE(34);
  assert.equal(sampleRate, 24000); assert.equal(channels, 1);
  const duration = audio.readUInt32LE(40) / (sampleRate * channels * bits / 8) * 1000;
  assert(Math.abs(duration - timing.durationMs) < 1);
  assert.deepEqual(timing.words.map(w => w.word), ['hello', 'world', 'hello']);
  assert.equal(timing.kind, 'kokoro-aligned');
  timing.words.forEach((word, i) => {
    assert(word.endMs > word.startMs);
    assert(word.endMs <= timing.durationMs + 1);
    if (i) assert(word.startMs >= timing.words[i - 1].endMs - 1);
  });
  assert(audio.subarray(44).some(byte => byte !== 0));
  // A1: the BOS token's predicted duration is real audio before the first phoneme; the first
  // word must start after it, not at t=0 (which would claim speech that isn't there yet).
  assert(timing.words[0].startMs > 0, 'A1: first word should start after the BOS lead-in, not at t=0');
  // A1: the last word must cover the audio's real end — no unaccounted trailing gap (this was
  // the video review's headline finding: 1.55-5.125s of non-silent audio after the last word).
  const trailingGapMs = timing.durationMs - timing.words[timing.words.length - 1].endMs;
  assert(trailingGapMs < 1, `A1: last word should cover the audio tail; got ${trailingGapMs}ms unaccounted`);
});

// A1 fix round 1: multi-chunk narration (text long enough to exceed Kokoro's per-chunk phoneme
// budget, _MAX_TOKENS=510 in kokoro_mlx/phonemize.py) must not reproduce the BOS/EOS attribution
// bug at INTERNAL chunk boundaries -- the fix above only clamped the last word of the LAST chunk.
// Offline verification against this exact text (running scripts/kokoro_tts.py's own chunking loop
// directly): it phonemizes to ~2400 vocab tokens total and splits into 6 chunks of 313-470 tokens
// each, all under 510 -- so this text structurally cannot synthesize as a single chunk; multi-chunk
// timing math is guaranteed to be exercised regardless of any future minor model/vocab differences.
const LONG_NARRATION = 'The history of the whiteboard explainer format stretches back further than most viewers realize. Early educators used simple chalkboards to sketch diagrams while narrating a lesson, building understanding one stroke at a time. As technology advanced, animators began recording hand drawn illustrations frame by frame, giving rise to a distinctive visual style that combined narration with progressive reveal. This approach proved remarkably effective for explaining abstract or technical subjects, because it let viewers watch an idea assemble itself piece by piece rather than confronting a finished diagram all at once. Marketing teams later adopted the format to explain complex products in a friendly, approachable way, often pairing a warm narrator voice with clean line art. Over time, software tools emerged that could automate much of this process, generating scenes, timing narration, and drawing shapes without a human illustrator at the easel. These systems still rely on careful synchronization between spoken words and visual elements, since a mismatch between what is said and what is drawn breaks the illusion of a coherent explanation. Modern pipelines therefore invest heavily in accurate word level timing, deriving timestamps directly from the speech synthesis model rather than guessing durations after the fact. When timing drifts, captions lag behind the voice, shapes appear before they are mentioned, and the whole presentation feels disjointed. Engineers working on these systems spend considerable effort tracing subtle bugs in how duration predictors attribute audio frames to individual words, because even small systematic errors compound across a long narration. A single mistimed boundary token can shift every subsequent word by a fraction of a second, and across a full video that drift becomes noticeable to any attentive viewer. This is why thorough testing matters so much in this domain. A test that only checks a short phrase might miss an entire class of bugs that only appears once the narration grows long enough to require multiple synthesis passes stitched back together. Long form narration, spanning several paragraphs, exercises code paths that short phrases never touch, including chunk boundaries, buffer concatenation, and cumulative timing offsets that must stay consistent from the first word to the very last one.';

test('Kokoro multi-chunk narration has no unaccounted gap at internal chunk boundaries', {skip: !RUNTIME}, async () => {
  const {timing} = await generateKokoroSpeech(LONG_NARRATION, {voiceId: 'af_heart'});
  assert.equal(timing.words.length, LONG_NARRATION.split(/\s+/).length);
  assert(timing.words.length > 300, 'narration should tokenize into enough words for multi-chunk synthesis to be structurally guaranteed (see comment above)');
  // Ordinary inter-word gaps (the space token's own predicted duration, previously silently
  // dropped -- see A1 fix round 2 in kokoro_tts.py) run tens of ms; a real chunk seam additionally
  // carries one chunk's EOS tail plus the next chunk's BOS lead-in, empirically up to ~400ms for
  // this narration. 1000ms sits with ample headroom above any legitimate per-word or per-seam cost
  // yet far below the multi-second (3.1-5.5s) gaps the unfixed per-chunk EOS/offset bugs produced
  // on this exact text, so it cleanly separates "real audio" from "unaccounted gap."
  for (let i = 1; i < timing.words.length; i++) {
    const gap = timing.words[i].startMs - timing.words[i - 1].endMs;
    assert(gap < 1000, `word ${i} ('${timing.words[i].word}') has an unaccounted ${gap}ms gap after the previous word -- possible chunk-boundary attribution regression`);
  }
  const trailingGapMs = timing.durationMs - timing.words[timing.words.length - 1].endMs;
  assert(trailingGapMs < 1, `last word should cover the audio tail; got ${trailingGapMs}ms unaccounted`);
});

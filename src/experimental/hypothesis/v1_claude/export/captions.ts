import type { AlignedAudio } from '../types.js';

export interface CaptionCue { startMs: number; endMs: number; text: string; sceneId: string }

export class InvalidCaptionTimingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCaptionTimingError';
  }
}

const timestamp = (ms: number): string => {
  const rounded = Math.max(0, Math.round(ms));
  const hours = Math.floor(rounded / 3_600_000);
  const minutes = Math.floor((rounded % 3_600_000) / 60_000);
  const seconds = Math.floor((rounded % 60_000) / 1_000);
  const millis = rounded % 1_000;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + '.' + String(millis).padStart(3, '0');
};

const payload = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Build readable caption cues from the measured word clock, preserving scene boundaries. */
export function buildWebVtt(audio: AlignedAudio, maxWords = 8, maxDurationMs = 4_000): string {
  if (!Number.isInteger(maxWords) || maxWords < 1 || maxDurationMs < 1) throw new Error('caption grouping limits must be positive');
  const cues: CaptionCue[] = [];
  for (const [sceneId, words] of Object.entries(audio.sceneWords)) {
    let pending: typeof words = [];
    let lastStart = -1;
    const flush = () => {
      if (!pending.length) return;
      cues.push({ startMs: pending[0].startMs, endMs: pending[pending.length - 1].endMs, text: pending.map((word) => word.w).join(' '), sceneId });
      pending = [];
    };
    for (const word of words) {
      if (!Number.isFinite(word.startMs) || !Number.isFinite(word.endMs) || word.startMs < 0 || word.endMs <= word.startMs || word.endMs > audio.durationMs || word.startMs < lastStart || !word.w.trim()) {
        throw new InvalidCaptionTimingError('cannot create captions: invalid or out-of-order aligned word in scene ' + sceneId);
      }
      lastStart = word.startMs;
      const elapsed = pending.length ? word.endMs - pending[0].startMs : 0;
      if (pending.length && (pending.length >= maxWords || elapsed > maxDurationMs)) flush();
      pending.push(word);
      if (/[.!?]["')\]]?$/.test(word.w)) flush();
    }
    flush();
  }
  if (!cues.length) throw new Error('cannot create captions: aligned audio contains no words');
  return 'WEBVTT\n\n' + cues.map((cue, i) => (i + 1) + '\n' + timestamp(cue.startMs) + ' --> ' + timestamp(cue.endMs) + '\n' + payload(cue.text) + '\n').join('\n');
}

/** Only an explicit diagnostic opt-in may omit invalid timed captions; aligned words are never rewritten. */
export function buildWebVttForRun(audio: AlignedAudio, diagnosticCaptionlessVideo = false): { vtt?: string; failure?: string } {
  try {
    return { vtt: buildWebVtt(audio) };
  } catch (error) {
    if (diagnosticCaptionlessVideo && error instanceof InvalidCaptionTimingError) {
      return { failure: error.message };
    }
    throw error;
  }
}

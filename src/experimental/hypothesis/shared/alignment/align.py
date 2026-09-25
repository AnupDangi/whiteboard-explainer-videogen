#!/usr/bin/env python3
"""
Local forced-alignment sidecar for the hypothesis harness.

Given a WAV file AND the exact reference text that was spoken (NOT blind
transcription), produces word-level start/end timestamps in milliseconds.
This is forced alignment: the reference text is fixed and only its timing
against the audio is inferred, using stable-ts's `align()` API on top of a
faster-whisper (CTranslate2) Whisper model -- CPU-only, no network calls at
run time (aside from a one-time model download cached by faster-whisper /
huggingface-hub under ~/.cache/huggingface).

Interface (matches the voice-engine CLI convention used elsewhere in this
project: JSON on stdin, JSON on stdout, non-zero exit + stderr message on
failure):

  stdin:  {"audioPath": str, "text": str, "language"?: str, "model"?: str}
  stdout: {"durationMs": int, "words": [{"word": str, "startMs": number, "endMs": number}, ...]}

`model` is one of faster-whisper's model sizes ("tiny", "base", "small",
"medium", "large-v3", ...). Default is "base". Current word-boundary
calibration is unmeasured; a diagnostic run cannot pass S5 without a valid,
versioned calibration record.

This script does forced alignment, not transcription: `text` is required
and is not optional. If text is missing/empty this is a hard error.
"""
import json
import sys
import wave
from contextlib import redirect_stdout
import io


def wav_duration_ms(path: str) -> int:
    """Read the real PCM duration from the WAV header/frame count directly,
    independent of anything the aligner reports (mirrors wavDurationMs in
    tts-runtime.ts on the Node side, so both sides agree on what
    "duration" means)."""
    with wave.open(path, 'rb') as w:
        frames = w.getnframes()
        rate = w.getframerate()
    if not rate:
        raise ValueError(f'WAV file has zero frame rate: {path}')
    return round(frames / rate * 1000)


def seconds_to_ms(seconds: float) -> float:
    """Convert measured seconds without rounding away sub-millisecond timing."""
    return seconds * 1000.0


def run_alignment(audio_path: str, text: str, language: str, model_size: str) -> dict:
    if not text or not text.strip():
        raise ValueError('text is required for forced alignment (blind transcription is not supported by this sidecar)')

    # stable_whisper prints tqdm progress bars and a compute-type warning to
    # stdout/stderr during import/load/align; none of that may leak into our
    # stdout JSON contract, so import lazily and keep stdout captured until
    # we deliberately write the final JSON line.
    import stable_whisper

    model = stable_whisper.load_faster_whisper(model_size, device='cpu', compute_type='float32')
    result = model.align(audio_path, text, language=language)
    if result is None:
        raise RuntimeError('stable-ts align() returned no result (alignment failed)')

    words = []
    for segment in result.segments:
        for word in segment.words:
            words.append({
                'word': word.word.strip(),
                'startMs': seconds_to_ms(word.start),
                'endMs': seconds_to_ms(word.end),
            })

    return {
        'durationMs': wav_duration_ms(audio_path),
        'words': words,
    }


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as error:
        print(f'invalid JSON on stdin: {error}', file=sys.stderr)
        sys.exit(1)

    audio_path = payload.get('audioPath')
    text = payload.get('text')
    language = payload.get('language') or 'en'
    model_size = payload.get('model') or 'base'

    if not audio_path:
        print('audioPath is required', file=sys.stderr)
        sys.exit(1)

    # Swallow stray stdout noise from third-party libs (tqdm sometimes writes
    # to stdout depending on environment) so only our JSON line is emitted.
    captured = io.StringIO()
    try:
        with redirect_stdout(captured):
            output = run_alignment(audio_path, text, language, model_size)
    except Exception as error:  # noqa: BLE001 - deliberately broad: surface any failure to the caller
        noise = captured.getvalue().strip()
        detail = str(error)
        if noise:
            detail = f'{detail} (stdout noise suppressed: {noise[:200]})'
        print(detail, file=sys.stderr)
        sys.exit(1)

    sys.stdout.write(json.dumps(output))
    sys.stdout.flush()


if __name__ == '__main__':
    main()

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
import importlib.util
import math
import os
import sys
import wave
from contextlib import redirect_stdout
import io
from pathlib import Path
from typing import Any


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


def load_model(model_size: str):
    import stable_whisper
    return stable_whisper.load_faster_whisper(model_size, device='cpu', compute_type='float32')


_ctc_backend: tuple[Any, list[str], int] | None = None

MIN_REPAIRED_WORD_MS = 40.0
MAX_REPAIRED_FRACTION = 0.1


def _repair_collapsed_words(words: list[dict], text: str, duration_ms: int) -> tuple[list[dict], list[int]]:
    """Give stable-ts zero-length words (its 20 ms grid drops short words such as
    "a"/"to") a small positive interval borrowed from the neighbouring word.
    Deterministic, recorded, and bounded: raises when the word sequence differs
    or more than MAX_REPAIRED_FRACTION of words collapsed."""
    if [w['word'] for w in words] != text.split():
        raise ValueError('cannot repair: word sequence differs from reference')
    out = [dict(w) for w in words]
    collapsed = [i for i, w in enumerate(out) if w['endMs'] <= w['startMs']]
    if len(collapsed) > MAX_REPAIRED_FRACTION * len(out):
        raise ValueError(f'cannot repair: {len(collapsed)}/{len(out)} words collapsed (limit {MAX_REPAIRED_FRACTION:.0%})')
    for i in collapsed:
        w = out[i]
        prev_end = out[i - 1]['endMs'] if i > 0 else 0.0
        next_start = out[i + 1]['startMs'] if i + 1 < len(out) else float(duration_ms)
        if next_start - prev_end >= MIN_REPAIRED_WORD_MS and (next_start - w['startMs'] >= MIN_REPAIRED_WORD_MS or w['startMs'] - prev_end >= MIN_REPAIRED_WORD_MS):
            start = min(max(prev_end, w['startMs']), next_start - MIN_REPAIRED_WORD_MS)
            w['startMs'], w['endMs'] = start, start + MIN_REPAIRED_WORD_MS
            continue
        # No silence: take the tail of the previous word, else the head of the next.
        if i > 0 and out[i - 1]['endMs'] - out[i - 1]['startMs'] >= 3 * MIN_REPAIRED_WORD_MS:
            out[i - 1]['endMs'] -= MIN_REPAIRED_WORD_MS
            w['startMs'], w['endMs'] = out[i - 1]['endMs'], out[i - 1]['endMs'] + MIN_REPAIRED_WORD_MS
        elif i + 1 < len(out) and out[i + 1]['endMs'] - out[i + 1]['startMs'] >= 3 * MIN_REPAIRED_WORD_MS:
            w['startMs'] = out[i + 1]['startMs']
            w['endMs'] = w['startMs'] + MIN_REPAIRED_WORD_MS
            out[i + 1]['startMs'] = w['endMs']
        else:
            raise ValueError(f'cannot repair word {i}: no neighbour long enough')
    return out, collapsed


def run_alignment(audio_path: str, text: str, language: str, model_size: str, model: Any = None, ctc_fallback=None) -> dict:
    if not text or not text.strip():
        raise ValueError('text is required for forced alignment (blind transcription is not supported by this sidecar)')

    # stable_whisper prints tqdm progress bars and a compute-type warning to
    # stdout/stderr during import/load/align; none of that may leak into our
    # stdout JSON contract, so import lazily and keep stdout captured until
    # we deliberately write the final JSON line.
    model = model if model is not None else load_model(model_size)
    duration_ms = wav_duration_ms(audio_path)
    repaired: list[int] = []
    default_error = None
    try:
        result = model.align(audio_path, text, language=language)
        words = _result_words(result) if result is not None else []
        default_error = _invalid_word_intervals(words, text, duration_ms)
    except Exception as error:  # noqa: BLE001 - try a separate measured aligner below
        words = []
        default_error = f'{type(error).__name__}: {error}'
    default_words = words

    if default_error:
        # stable-ts can leave some transcript words instantaneous when its
        # default alignment pass fails to place them. A fast-mode re-alignment
        # is another model-derived timing attempt (not interpolation). Accept
        # it only when it retains the exact reference word sequence and every
        # interval is positive.
        retry_error = None
        try:
            retry = model.align(audio_path, text, language=language, fast_mode=True)
            retry_words = _result_words(retry) if retry is not None else []
            retry_error = _invalid_word_intervals(retry_words, text, duration_ms)
        except Exception as error:  # noqa: BLE001 - continue to the independent CTC aligner
            retry_words = []
            retry_error = f'{type(error).__name__}: {error}'
        if not retry_error:
            words = retry_words
            aligner = 'stable-ts-fast-mode'
        else:
            try:
                words = (ctc_fallback or _align_with_ctc)(audio_path, text, language)
                ctc_error = _invalid_word_intervals(words, text, duration_ms)
            except Exception as error:  # noqa: BLE001 - S5 remains a hard failure if no measured aligner works
                words = []
                ctc_error = f'{type(error).__name__}: {error}'
            if ctc_error:
                # Last resort: repair the default pass's collapsed (zero-length)
                # words instead of failing the whole lesson outright. Bounded
                # and deterministic -- see _repair_collapsed_words.
                try:
                    words, repaired = _repair_collapsed_words(default_words, text, duration_ms)
                    repair_error = _invalid_word_intervals(words, text, duration_ms)
                except Exception as error:  # noqa: BLE001
                    repair_error = f'{type(error).__name__}: {error}'
                if repair_error:
                    raise RuntimeError(
                        'word alignment failed validation for stable-ts default, stable-ts fast_mode, CTC, and bounded repair; '
                        f'default={default_error}; fast_mode={retry_error}; ctc={ctc_error}; repair={repair_error}'
                    )
                aligner = 'stable-ts+collapsed-repair'
            else:
                aligner = 'torchaudio-wav2vec2-ctc'
    else:
        aligner = 'stable-ts'

    return {
        'durationMs': duration_ms,
        'words': words,
        'aligner': aligner,
        'repairedWordIndexes': repaired,
    }


def _align_with_ctc(audio_path: str, text: str, language: str) -> list[dict]:
    if language.lower().split('-')[0] != 'en':
        raise ValueError('the installed CTC fallback supports English only')
    global _ctc_backend
    if _ctc_backend is None:
        import torchaudio

        bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
        model_dir = Path(os.environ.get('HYPOTHESIS_ALIGNMENT_MODEL_DIR', Path(__file__).resolve().parents[3] / '.data' / 'alignment-models'))
        weights = model_dir / bundle._path
        if not weights.is_file():
            raise FileNotFoundError(f'local CTC fallback weights are missing: {weights}')
        model = bundle.get_model(dl_kwargs={'model_dir': str(model_dir), 'map_location': 'cpu'}).eval()
        _ctc_backend = (model, bundle.get_labels(), bundle.sample_rate)

    model, labels, sample_rate = _ctc_backend
    compare_path = Path(__file__).with_name('compare_aligners.py')
    spec = importlib.util.spec_from_file_location('_hypothesis_alignment_compare_runtime', compare_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'could not load CTC alignment helper: {compare_path}')
    compare = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compare)
    aligned, _samples, _original_rate, _mean_token_log_score = compare.align_ctc(Path(audio_path), text, model, labels, sample_rate)
    return [{'word': item['word'], 'startMs': item['startMs'], 'endMs': item['endMs']} for item in aligned]


def _result_words(result: Any) -> list[dict]:
    words = []
    for segment in result.segments:
        for word in segment.words:
            words.append({
                'word': word.word.strip(),
                'startMs': seconds_to_ms(word.start),
                'endMs': seconds_to_ms(word.end),
            })
    return words


def _invalid_word_intervals(words: list[dict], text: str, duration_ms: int) -> str | None:
    expected = text.split()
    actual = [word['word'] for word in words]
    if actual != expected:
        return f'word sequence differs from reference ({len(actual)} aligned, {len(expected)} expected)'
    if not words:
        return 'no aligned words'
    for index, word in enumerate(words):
        start, end = word['startMs'], word['endMs']
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or not math.isfinite(start) or not math.isfinite(end):
            return f'word {index} has non-numeric timing'
        if end <= start:
            return f'word {index} has non-positive interval [{start}, {end})'
        if start < 0 or end > duration_ms:
            return f'word {index} interval [{start}, {end}) is outside {duration_ms}ms audio'
    return None


def run_payload(payload: dict, models: dict[str, Any]) -> dict:
    audio_path = payload.get('audioPath')
    text = payload.get('text')
    language = payload.get('language') or 'en'
    model_size = payload.get('model') or 'base'
    if not audio_path:
        raise ValueError('audioPath is required')
    if model_size not in models:
        models[model_size] = load_model(model_size)
    return run_alignment(audio_path, text, language, model_size, models[model_size])


def serve_stream() -> None:
    """Newline-delimited JSON worker. The faster-whisper model stays loaded for this process."""
    models: dict[str, Any] = {}
    for raw in sys.stdin:
        if not raw.strip():
            continue
        try:
            payload = json.loads(raw)
            captured = io.StringIO()
            with redirect_stdout(captured):
                result = run_payload(payload, models)
            response = result
        except Exception as error:  # noqa: BLE001 - return a request-scoped failure and keep the worker alive
            response = {'error': str(error)}
        sys.stdout.write(json.dumps(response) + '\n')
        sys.stdout.flush()


def main() -> None:
    if '--worker' in sys.argv[1:]:
        serve_stream()
        return
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

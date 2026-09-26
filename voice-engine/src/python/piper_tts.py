#!/usr/bin/env python3
"""Piper provider bridge.

Reads one JSON request from stdin:
    {"text": str, "language": str, "voice": str, "voicePath": str, "audioPath": str}
Writes a WAV to `audioPath` and JSON to stdout:
    {"audioPath": str, "durationMs": float, "synthMs": float}
"""

import json
import sys
import time
import wave
from pathlib import Path
from typing import Any


_VOICES: dict[str, Any] = {}


def synthesize(request: dict[str, Any]) -> dict[str, Any]:
    text = request["text"]
    voice_path = request["voicePath"]
    audio_path = request["audioPath"]

    if not Path(voice_path).exists():
        raise FileNotFoundError(
            f"Piper voice not found: {voice_path}. Download it with "
            f"`.venv/bin/python -m piper.download_voices <voice-id> --data-dir models/piper`"
        )

    if voice_path not in _VOICES:
        from piper import PiperVoice
        _VOICES[voice_path] = PiperVoice.load(voice_path)
    voice = _VOICES[voice_path]

    started = time.perf_counter()
    with wave.open(audio_path, "wb") as handle:
        voice.synthesize_wav(text, handle)
    synth_ms = (time.perf_counter() - started) * 1000.0

    with wave.open(audio_path, "rb") as handle:
        duration_ms = handle.getnframes() / handle.getframerate() * 1000.0

    return {"audioPath": audio_path, "durationMs": duration_ms, "synthMs": synth_ms}


def main() -> None:
    if "--worker" in sys.argv[1:]:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                response = synthesize(json.loads(line))
            except Exception as error:  # noqa: BLE001 - report request failure while keeping model worker alive
                response = {"error": str(error)}
            print(json.dumps(response), flush=True)
        return
    print(json.dumps(synthesize(json.load(sys.stdin))))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - surface every failure loudly to the caller
        print(f"Piper synthesis failed: {error}", file=sys.stderr)
        sys.exit(1)

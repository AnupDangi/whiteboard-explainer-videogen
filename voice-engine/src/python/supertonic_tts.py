#!/usr/bin/env python3
"""Supertonic provider bridge.

Reads one JSON request from stdin:
    {"text": str, "language": str, "voice": str, "audioPath": str}
Writes a 44.1 kHz 16-bit WAV to `audioPath` and JSON to stdout:
    {"audioPath": str, "durationMs": float, "synthMs": float}

Model weights auto-download once (~400 MB) into ~/.cache/supertonic3/.
"""

import json
import sys
import time
import wave
from typing import Any


_TTS: Any = None
_STYLES: dict[str, Any] = {}


def synthesize(request: dict[str, Any]) -> dict[str, Any]:
    global _TTS
    text = request["text"]
    language = request.get("language") or "en"
    voice = request.get("voice") or "F1"
    audio_path = request["audioPath"]

    if _TTS is None:
        from supertonic import TTS
        _TTS = TTS(auto_download=True)
    tts = _TTS
    if voice not in _STYLES:
        _STYLES[voice] = tts.get_voice_style(voice_name=voice)
    style = _STYLES[voice]

    started = time.perf_counter()
    wav, _ = tts.synthesize(text=text, voice_style=style, lang=language)
    synth_ms = (time.perf_counter() - started) * 1000.0

    tts.save_audio(wav, audio_path)

    with wave.open(audio_path, "rb") as handle:
        duration_ms = handle.getnframes() / handle.getframerate() * 1000.0

    return {"audioPath": audio_path, "durationMs": duration_ms, "synthMs": synth_ms}


def main() -> None:
    if "--worker" in sys.argv[1:]:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                result = synthesize(json.loads(line))
                response = result
            except Exception as error:  # noqa: BLE001 - report request failure while keeping model worker alive
                response = {"error": str(error)}
            print(json.dumps(response), flush=True)
        return
    print(json.dumps(synthesize(json.load(sys.stdin))))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - surface every failure loudly to the caller
        print(f"Supertonic synthesis failed: {error}", file=sys.stderr)
        sys.exit(1)

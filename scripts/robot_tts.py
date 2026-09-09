"""Local segmented speech: measured PCM word boundaries, no generated code."""
import array
import base64
import json
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def synthesize(text):
    if not shutil.which('say'):
        raise RuntimeError('Local robot TTS requires macOS say on PATH')
    if not text.strip() or len(text) > 40000:
        raise ValueError('Speech text must contain 1–40000 characters')
    rate = 22050
    frames = bytearray()
    words = []
    cache = {}
    with tempfile.TemporaryDirectory(prefix='canvas-tts-') as folder:
        part = Path(folder) / 'word.wav'
        for word in text.split():
            if word not in cache:
                # stdin prevents narration from being interpreted as command options.
                subprocess.run(['say', '-v', 'Alex', '-r', '175', '-o', str(part),
                                '--data-format=LEI16@22050'], input=word, text=True,
                               check=True, capture_output=True, timeout=20)
                with wave.open(str(part), 'rb') as audio:
                    if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != rate:
                        raise RuntimeError('Unexpected speech PCM format')
                    samples = array.array('h', audio.readframes(audio.getnframes()))
                if sys.byteorder != 'little':
                    samples.byteswap()
                audible = [i for i, value in enumerate(samples) if abs(value) > 100]
                if not audible:
                    raise RuntimeError('Local speech returned empty audio; run the server with macOS speech access')
                start = max(0, audible[0] - int(rate * .01))
                end = min(len(samples), audible[-1] + int(rate * .025))
                trimmed = samples[start:end]
                if sys.byteorder != 'little':
                    trimmed.byteswap()
                cache[word] = trimmed.tobytes()
            start_ms = len(frames) / 2 / rate * 1000
            frames.extend(cache[word])
            words.append(dict(word=word, startMs=start_ms, endMs=len(frames) / 2 / rate * 1000))
            frames.extend(bytes(int(rate * .055) * 2))
        wav = Path(folder) / 'speech.wav'
        with wave.open(str(wav), 'wb') as out:
            out.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
            out.writeframes(frames)
        return dict(audio_base64=base64.b64encode(wav.read_bytes()).decode(),
                    timing=dict(kind='local-segment-aligned', words=words,
                                durationMs=len(frames) / 2 / rate * 1000))


if __name__ == '__main__':
    try:
        print(json.dumps(synthesize(json.load(sys.stdin)['text'])))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

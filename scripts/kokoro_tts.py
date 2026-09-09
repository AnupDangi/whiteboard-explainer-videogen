"""Kokoro neural speech with native word timings: measured, no generated code.

Reads {"text": str, "voice"?: str, "speed"?: float} from stdin, writes
{"audio_base64": wav, "timing": {"kind": "kokoro-aligned", "words": [...], "durationMs": n}}
to stdout. Requires kokoro-mlx 0.1.2 + mlx + spacy en_core_web_sm (see docs).
Word timings come from the model's own duration predictor (pred_dur, 40 frames
per second), mapped through misaki word tokens — the same signal the synth
itself uses, so boundaries cannot drift from the audio. Any mismatch between
the narration words and the mapped tokens is a loud failure, never silent.
"""
import base64
import io
import json
import sys
import wave

ALLOWED_VOICES = ('af_heart', 'am_michael', 'bf_emma', 'af_bella', 'am_adam')
SAMPLE_RATE = 24000
FRAMES_PER_SECOND = 40  # Kokoro duration frames at 24 kHz (600 samples each)


def fail(message):
    raise RuntimeError(message)


# Phase 4: process-wide singleton so a persistent server (kokoro_server.py) pays
# model load once; the stdio bridge below passes nothing and keeps per-spawn
# behavior unchanged.
_TTS = None


def get_tts():
    global _TTS
    if _TTS is None:
        from kokoro_mlx import KokoroTTS
        _TTS = KokoroTTS.from_pretrained()
    return _TTS


def flatten(tokens):
    for token in tokens:
        if isinstance(token, list):
            yield from flatten(token)
        else:
            yield token


def synthesize(text, voice='af_heart', speed=1.0, tts=None):
    if voice not in ALLOWED_VOICES:
        fail('Unknown Kokoro voice %r; use one of %s' % (voice, ', '.join(ALLOWED_VOICES)))
    if not text.strip() or len(text) > 40000:
        fail('Speech text must contain 1-40000 characters')
    if not 0.5 <= speed <= 2.0:
        fail('Speed must be 0.5-2.0')

    import numpy as np
    import mlx.core as mx
    from kokoro_mlx.phonemize import _SENTENCE_BOUNDARY, _MAX_TOKENS
    from misaki import en

    if tts is None:
        tts = get_tts()
    if voice not in tts.list_voices():
        fail('Voice %r not installed in the Kokoro voices directory' % voice)
    model = tts._model
    vocab = tts._config.vocab
    voices = tts._voices
    voice_array = voices.load_voice(voice)
    phonemizer = tts._get_phonemizer('en-us', voice)
    g2p = en.G2P(british=voice.startswith('bf_') or voice.startswith('bm_'))

    # Mirror phonemize_long chunking exactly: accumulate sentences until the
    # phoneme window would overflow, then flush. Chunk texts drive both the
    # word tokens (misaki) and the model input (kokoro), so they stay aligned.
    sentences = [s for s in _SENTENCE_BOUNDARY.split(text.strip()) if s.strip()]
    chunks, current = [], []
    for sentence in sentences:
        candidate = ' '.join(current + [sentence])
        ids = [vocab[c] for c in phonemizer._phonemes_for_text(candidate) if c in vocab]
        if len(ids) > _MAX_TOKENS and current:
            chunks.append(' '.join(current))
            current = [sentence]
        else:
            current = current + [sentence]
    if current:
        chunks.append(' '.join(current))
    if not chunks:
        fail('No synthesizable text')

    audio_parts, words = [], []
    elapsed_ms = 0.0
    for chunk_text in chunks:
        _, mtokens = g2p(chunk_text)
        leaves = [t for t in flatten(mtokens)]
        phonemes = phonemizer._phonemes_for_text(chunk_text)
        token_ids = [vocab[c] for c in phonemes if c in vocab]
        style = voices.get_style(voice_array, len(token_ids))
        ref = mx.array(np.asarray(style.tolist(), dtype=np.float32).reshape(1, 256))

        # Audio through the stock forward path (identical to generate()).
        audio = model.forward(phonemes, ref, speed)
        part = np.array(np.asarray(audio).astype(np.float32)).flatten()
        if part.size == 0:
            fail('Kokoro returned empty audio for a text chunk')

        # Durations through the same predictor ops forward() uses.
        ids = mx.array([[0, *token_ids, 0]])
        length = ids.shape[1]
        mask = mx.zeros((1, length), dtype=mx.bool_)
        bert = model.bert(ids)
        encoded = model.bert_encoder(bert).transpose(0, 2, 1)
        feats = model.predictor.text_encoder(encoded, ref[:, 128:], mx.array([length]), mask)
        hidden = model.predictor.lstm(feats)
        duration = model.predictor.duration_proj(hidden)
        duration = mx.sigmoid(duration).sum(axis=-1) / speed
        mx.eval(duration)
        pred = np.array(mx.clip(mx.round(duration), 0, None).astype(mx.int32).squeeze(0))
        if len(pred) != length:
            fail('Duration length %d does not match input length %d' % (len(pred), length))

        # Aggregate sub-word tokens back to the input's whitespace words. Each
        # phoneme char consumes one pred_dur entry (+1 BOS offset). A word that
        # cannot be reconstructed exactly is a loud failure, never a guess.
        offset, leaf = 0, 0
        for word in chunk_text.split():
            start = offset
            acc = ''
            while leaf < len(leaves) and acc != word:
                piece = leaves[leaf].text or ''
                if len(acc) + len(piece) > len(word) or not word.startswith(acc + piece):
                    fail('Cannot map narration word %r (G2P gave %r); refusing silent misalignment'
                         % (word, piece))
                acc += piece
                offset += len(leaves[leaf].phonemes or '')
                leaf += 1
            if acc != word:
                fail('Cannot map narration word %r; refusing silent misalignment' % word)
            start_ms = elapsed_ms + float(pred[1:1 + start].sum()) / FRAMES_PER_SECOND * 1000
            end_ms = elapsed_ms + float(pred[1:1 + offset].sum()) / FRAMES_PER_SECOND * 1000
            words.append(dict(word=word, startMs=start_ms, endMs=end_ms))
        elapsed_ms += float(pred.sum()) / FRAMES_PER_SECOND * 1000
        audio_parts.append(part)

    samples = np.concatenate(audio_parts)
    peak = float(np.abs(samples).max()) if samples.size else 0.0
    if peak <= 0.001:
        fail('Kokoro returned silent audio; check voice installation')
    pcm = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as out:
        out.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
        out.writeframes(pcm16.tobytes())
    duration_ms = len(samples) / SAMPLE_RATE * 1000
    return dict(audio_base64=base64.b64encode(buffer.getvalue()).decode(),
                timing=dict(kind='kokoro-aligned', words=words, durationMs=duration_ms))


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        print(json.dumps(synthesize(request['text'], request.get('voice') or 'af_heart',
                                    float(request.get('speed') or 1.0))))
    except Exception as error:
        print('Kokoro TTS failed: %s' % error, file=sys.stderr)
        sys.exit(1)

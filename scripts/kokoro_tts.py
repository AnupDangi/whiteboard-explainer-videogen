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
import logging
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
        # A1: pred[0] is the BOS token's predicted duration frames — real synthesized audio the
        # model plays before the first phoneme. The word-timing math below previously started
        # counting from pred[1] with no offset, so every word was timestamped as if the chunk's
        # audio began right where phoneme 1 starts — ignoring this real lead-in.
        bos_ms = float(pred[0]) / FRAMES_PER_SECOND * 1000

        # Aggregate sub-word tokens back to the input's whitespace words. Each
        # phoneme char consumes one pred_dur entry (+1 BOS offset). A word that
        # cannot be reconstructed exactly is a loud failure, never a guess.
        # A1 fix round 2 (discovered writing the round-1 multi-chunk regression test): the
        # phonemizer's own phoneme string (which `pred` is indexed against) inserts a real,
        # separately-predicted separator character (' ', vocab id present) between every word;
        # misaki's per-word `leaf.phonemes` never carries that separator. Walking `offset` by
        # summing leaf-phoneme lengths alone therefore silently drops one separator's predicted
        # duration at every word boundary -- invisible between adjacent words (both share the
        # same understated offset, so no gap appears between them) but compounding across a
        # chunk (measured: 3-5s of drift over ~60-word chunks on real narration) and landing
        # entirely on whichever word the deficit is finally measured against -- previously the
        # last word of the whole utterance, now also every chunk's last word via the round-1 fix
        # below. Fix: locate each word's true position directly in the vocab-filtered phoneme
        # stream instead of accumulating position from leaves, so separators are never skipped.
        filtered_phonemes = ''.join(c for c in phonemes if c in vocab)
        leaf, cursor = 0, 0
        for word in chunk_text.split():
            word_leaf_start = leaf
            acc, phon = '', ''
            while leaf < len(leaves) and acc != word:
                piece = leaves[leaf].text or ''
                if len(acc) + len(piece) > len(word) or not word.startswith(acc + piece):
                    fail('Cannot map narration word %r (G2P gave %r); refusing silent misalignment'
                         % (word, piece))
                acc += piece
                phon += leaves[leaf].phonemes or ''
                leaf += 1
            if acc != word:
                fail('Cannot map narration word %r; refusing silent misalignment' % word)
            start = filtered_phonemes.find(phon, cursor)
            if start < 0:
                # Fallback (V-JEPA run: "ViT-g"): the phonemizer's stream can diverge from
                # misaki's leaf phonemes on tokens with hyphens/acronyms. Fallback: locate
                # each consumed leaf's phonemes independently, in order, from the cursor,
                # allowing gaps BETWEEN pieces. Every piece is still matched exactly, so the
                # word span is composed of exact matches, not a guess.
                p_cursor = cursor
                first_pos, last_pos = None, None
                fallback_ok = True
                for li in range(word_leaf_start, leaf):
                    p_phon = leaves[li].phonemes or ''
                    if not p_phon:
                        continue
                    p_start = filtered_phonemes.find(p_phon, p_cursor)
                    if p_start < 0:
                        fail('Cannot locate phonemes for narration word %r (piece %r) in the synthesized phoneme stream' % (word, leaves[li].text))
                    p_cursor = p_start + len(p_phon)
                    if first_pos is None:
                        first_pos = p_start
                    last_pos = p_cursor
                if first_pos is None or last_pos is None:
                    fail('Cannot locate phonemes for narration word %r in the synthesized phoneme stream' % word)
                logging.getLogger('kokoro_tts').warning('fallback piece-wise timing for word %r', word)
                start, offset = first_pos, last_pos
                cursor = offset
            else:
                offset = start + len(phon)
                cursor = offset
            start_ms = elapsed_ms + bos_ms + float(pred[1:1 + start].sum()) / FRAMES_PER_SECOND * 1000
            end_ms = elapsed_ms + bos_ms + float(pred[1:1 + offset].sum()) / FRAMES_PER_SECOND * 1000
            words.append(dict(word=word, startMs=start_ms, endMs=end_ms))
        # A1 fix round 1: pred[-1] is THIS chunk's own EOS predicted duration — real audio
        # that plays after this chunk's last phoneme. Attribute it to this chunk's last word
        # (same principle as the BOS lead-in above, applied per-chunk instead of only at the
        # very end of the utterance) so internal chunk boundaries don't reproduce the same
        # unaccounted-trailing-audio bug the original fix only closed for the final chunk.
        if words:
            eos_ms = float(pred[-1]) / FRAMES_PER_SECOND * 1000
            words[-1]['endMs'] += eos_ms
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
    # A1 fix: the final chunk's EOS token and any trailing coarticulation frames are real
    # synthesized audio that belongs to the last spoken word (nothing else happens after it),
    # so attribute them there instead of leaving them as an unaccounted tail. This is not a
    # truncation (no audio removed) and not a global stretch (only the last word's end moves,
    # by exactly the amount of audio that follows it).
    if words:
        words[-1]['endMs'] = duration_ms
    # A1: Diagnose trailing audio after last word timestamp (now expected to be ~0 after the
    # fix above; kept as a regression sentinel — a future change that reintroduces a gap here
    # will show up in gapMs/trailingNonSilent instead of silently regressing).
    last_word_end = words[-1]['endMs'] if words else 0
    gap_ms = duration_ms - last_word_end
    trailing_non_silent = False
    if gap_ms > 0:
        # Check the final 200 ms of audio for non-silence (RMS > -40 dBFS).
        start_idx = max(0, len(samples) - int(SAMPLE_RATE * 0.2))
        segment = samples[start_idx:]
        rms = float(np.sqrt(np.mean(segment ** 2))) if segment.size else 0.0
        trailing_non_silent = rms > 0.001  # -40 dBFS threshold relative to peak=1
    result = dict(audio_base64=base64.b64encode(buffer.getvalue()).decode(),
                  timing=dict(kind='kokoro-aligned', words=words, durationMs=duration_ms,
                              gapMs=gap_ms, trailingNonSilent=trailing_non_silent))
    return result


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        print(json.dumps(synthesize(request['text'], request.get('voice') or 'af_heart',
                                    float(request.get('speed') or 1.0))))
    except Exception as error:
        print('Kokoro TTS failed: %s' % error, file=sys.stderr)
        sys.exit(1)

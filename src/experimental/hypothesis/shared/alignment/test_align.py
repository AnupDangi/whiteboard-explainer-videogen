import importlib.util
import tempfile
import unittest
import wave
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path


MODULE_PATH = Path(__file__).with_name('align.py')
SPEC = importlib.util.spec_from_file_location('hypothesis_alignment_sidecar', MODULE_PATH)
assert SPEC and SPEC.loader
ALIGN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ALIGN)

COMPARE_PATH = Path(__file__).with_name('compare_aligners.py')
COMPARE_SPEC = importlib.util.spec_from_file_location('hypothesis_alignment_comparison', COMPARE_PATH)
assert COMPARE_SPEC and COMPARE_SPEC.loader
COMPARE = importlib.util.module_from_spec(COMPARE_SPEC)
COMPARE_SPEC.loader.exec_module(COMPARE)


class AlignmentTimestampTests(unittest.TestCase):
    def test_seconds_to_ms_preserves_submillisecond_boundaries(self):
        self.assertAlmostEqual(ALIGN.seconds_to_ms(8.9801), 8980.1)
        self.assertAlmostEqual(ALIGN.seconds_to_ms(8.9802), 8980.2)
        self.assertGreater(ALIGN.seconds_to_ms(8.9802), ALIGN.seconds_to_ms(8.9801))

    def test_worker_payload_reuses_model_for_repeated_scene_requests(self):
        fake_model = SimpleNamespace(align=lambda audio_path, text, language: SimpleNamespace(segments=[SimpleNamespace(words=[SimpleNamespace(word=word, start=0.01, end=0.02) for word in text.split()])]))
        with tempfile.TemporaryDirectory() as directory:
            wav_path = Path(directory) / 'silent.wav'
            with wave.open(str(wav_path), 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16_000)
                audio.writeframes(b'\0\0' * 16_000)
            models = {}
            with patch.object(ALIGN, 'load_model', return_value=fake_model) as load:
                one = ALIGN.run_payload({'audioPath': str(wav_path), 'text': 'first scene'}, models)
                two = ALIGN.run_payload({'audioPath': str(wav_path), 'text': 'second scene'}, models)
            self.assertEqual(len(one['words']), 2)
            self.assertEqual(len(two['words']), 2)
            self.assertEqual(load.call_count, 1)

    def test_zero_duration_output_retries_with_model_fast_alignment(self):
        first = SimpleNamespace(segments=[SimpleNamespace(words=[
            SimpleNamespace(word='first', start=0.01, end=0.02),
            SimpleNamespace(word='scene', start=0.02, end=0.02),
        ])])
        measured_retry = SimpleNamespace(segments=[SimpleNamespace(words=[
            SimpleNamespace(word='first', start=0.01, end=0.08),
            SimpleNamespace(word='scene', start=0.08, end=0.13),
        ])])

        class RetryModel:
            def __init__(self):
                self.calls = []

            def align(self, audio_path, text, **kwargs):
                self.calls.append(kwargs)
                return first if len(self.calls) == 1 else measured_retry

        model = RetryModel()
        with tempfile.TemporaryDirectory() as directory:
            wav_path = Path(directory) / 'speech.wav'
            with wave.open(str(wav_path), 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16_000)
                audio.writeframes(b'\0\0' * 16_000)
            output = ALIGN.run_alignment(str(wav_path), 'first scene', 'en', 'base', model)

        self.assertEqual(model.calls, [{'language': 'en'}, {'language': 'en', 'fast_mode': True}])
        self.assertEqual([(word['startMs'], word['endMs']) for word in output['words']], [(10.0, 80.0), (80.0, 130.0)])
        self.assertEqual(output['aligner'], 'stable-ts-fast-mode')

    def test_invalid_stable_ts_results_use_measured_ctc_fallback(self):
        instantaneous = SimpleNamespace(segments=[SimpleNamespace(words=[
            SimpleNamespace(word='first', start=0.01, end=0.01),
            SimpleNamespace(word='scene', start=0.02, end=0.02),
        ])])
        model = SimpleNamespace(align=lambda audio_path, text, **kwargs: instantaneous)
        ctc_words = [
            {'word': 'first', 'startMs': 10.0, 'endMs': 80.0},
            {'word': 'scene', 'startMs': 80.0, 'endMs': 130.0},
        ]
        ctc_calls = []

        def ctc_fallback(audio_path, text, language):
            ctc_calls.append((audio_path, text, language))
            return ctc_words

        with tempfile.TemporaryDirectory() as directory:
            wav_path = Path(directory) / 'speech.wav'
            with wave.open(str(wav_path), 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16_000)
                audio.writeframes(b'\0\0' * 16_000)
            output = ALIGN.run_alignment(str(wav_path), 'first scene', 'en', 'base', model, ctc_fallback)

        self.assertEqual(ctc_calls, [(str(wav_path), 'first scene', 'en')])
        self.assertEqual(output['words'], ctc_words)
        self.assertEqual(output['aligner'], 'torchaudio-wav2vec2-ctc')

    def test_zero_duration_output_fails_when_model_retry_is_still_invalid(self):
        instantaneous = SimpleNamespace(segments=[SimpleNamespace(words=[
            SimpleNamespace(word='first', start=0.01, end=0.01),
            SimpleNamespace(word='scene', start=0.02, end=0.02),
        ])])

        class RetryModel:
            def align(self, audio_path, text, **kwargs):
                return instantaneous

        with tempfile.TemporaryDirectory() as directory:
            wav_path = Path(directory) / 'speech.wav'
            with wave.open(str(wav_path), 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16_000)
                audio.writeframes(b'\0\0' * 160)
            with self.assertRaisesRegex(RuntimeError, 'stable-ts fast_mode, CTC, and bounded repair'):
                ALIGN.run_alignment(str(wav_path), 'first scene', 'en', 'base', RetryModel(), lambda *_: [
                    {'word': 'first', 'startMs': 10, 'endMs': 10},
                    {'word': 'scene', 'startMs': 20, 'endMs': 20},
                ])

    def test_collapsed_short_words_are_repaired_after_all_measured_aligners_fail(self):
        words = [
            {'word': 'Pick', 'startMs': 0.0, 'endMs': 300.0},
            {'word': 'a', 'startMs': 300.0, 'endMs': 300.0},
            {'word': 'wheel', 'startMs': 300.0, 'endMs': 700.0},
            {'word': 'now', 'startMs': 760.0, 'endMs': 1000.0},
            {'word': 'to', 'startMs': 1000.0, 'endMs': 1000.0},
            {'word': 'spin', 'startMs': 1000.0, 'endMs': 1400.0},
            {'word': 'it', 'startMs': 1400.0, 'endMs': 1600.0},
            {'word': 'and', 'startMs': 1600.0, 'endMs': 1800.0},
            {'word': 'lean', 'startMs': 1800.0, 'endMs': 2100.0},
            {'word': 'left', 'startMs': 2100.0, 'endMs': 2400.0},
            {'word': 'slowly', 'startMs': 2400.0, 'endMs': 2900.0},
            {'word': 'today', 'startMs': 2900.0, 'endMs': 3300.0},
            {'word': 'please', 'startMs': 3300.0, 'endMs': 3700.0},
            {'word': 'okay', 'startMs': 3700.0, 'endMs': 4000.0},
            {'word': 'done', 'startMs': 4000.0, 'endMs': 4400.0},
            {'word': 'here', 'startMs': 4400.0, 'endMs': 4800.0},
            {'word': 'wow', 'startMs': 4800.0, 'endMs': 5000.0},
            {'word': 'yes', 'startMs': 5000.0, 'endMs': 5200.0},
            {'word': 'go', 'startMs': 5200.0, 'endMs': 5400.0},
            {'word': 'end', 'startMs': 5400.0, 'endMs': 5600.0},
        ]
        text = ' '.join(w['word'] for w in words)
        repaired, indexes = ALIGN._repair_collapsed_words(words, text, 6000)
        self.assertEqual(indexes, [1, 4])
        self.assertIsNone(ALIGN._invalid_word_intervals(repaired, text, 6000))
        for prev, cur in zip(repaired, repaired[1:]):
            self.assertLessEqual(prev['endMs'], cur['startMs'])
        self.assertGreaterEqual(repaired[1]['endMs'] - repaired[1]['startMs'], ALIGN.MIN_REPAIRED_WORD_MS)

    def test_repair_refuses_when_too_many_words_collapsed(self):
        words = [{'word': w, 'startMs': 100.0, 'endMs': 100.0} for w in ['a', 'b', 'c']] + [{'word': 'long', 'startMs': 100.0, 'endMs': 900.0}]
        with self.assertRaises(ValueError):
            ALIGN._repair_collapsed_words(words, 'a b c long', 1000)

    def test_run_alignment_reports_repair_identity_when_ctc_also_fails(self):
        class Collapsing:
            def align(self, audio_path, text, **kwargs):
                return None
        # Patch _result_words to return one collapsed word among 12 valid ones.
        base = [{'word': f'w{i}', 'startMs': i * 100.0, 'endMs': i * 100.0 + 90.0} for i in range(12)]
        base[5] = {'word': 'w5', 'startMs': 500.0, 'endMs': 500.0}
        text = ' '.join(w['word'] for w in base)
        with patch.object(ALIGN, '_result_words', return_value=base), patch.object(ALIGN, 'wav_duration_ms', return_value=2000):
            model = Collapsing()
            model.align = lambda *a, **k: object()
            result = ALIGN.run_alignment('x.wav', text, 'en', 'base', model=model, ctc_fallback=lambda *a: (_ for _ in ()).throw(ValueError('ctc down')))
        self.assertEqual(result['aligner'], 'stable-ts+collapsed-repair')
        self.assertEqual(result['repairedWordIndexes'], [5])


class CtcAlignmentContractTests(unittest.TestCase):
    LABELS = ['-', '|', 'a', 'b', 'c', 'e', 'g', 'l', 'o', 's', 't']

    def test_large_artifact_hash_is_streamed_and_matches_byte_hash(self):
        payload = bytes(range(256)) * 19
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic-model.bin'
            path.write_bytes(payload)
            self.assertEqual(COMPARE.sha256_file(path, chunk_bytes=113), COMPARE.sha256(payload))

    def test_text_normalization_preserves_original_words_and_ignores_punctuation(self):
        words, targets, owners = COMPARE.ctc_target("Let's go!", self.LABELS)
        self.assertEqual(words, ["Let's", 'go!'])
        self.assertEqual(targets, [7, 5, 10, 9, 1, 6, 8])
        self.assertEqual(owners, [0, 0, 0, 0, None, 1, 1])

    def test_unsupported_alphanumeric_text_fails_instead_of_dropping_content(self):
        with self.assertRaisesRegex(ValueError, 'unsupported CTC transcript characters'):
            COMPARE.ctc_target('CO2', self.LABELS)

    def test_ctc_target_allows_adjacent_repeated_letters_without_inserting_blank(self):
        # torchaudio.functional.forced_align documents that it natively supports
        # consecutively repeated target labels (its own note: "L_log_probs >=
        # L_label + N_repeat"), so ctc_target must NOT insert a blank mid-word —
        # ordinary words like "wheel" (adjacent 'e','e') should pass straight through.
        labels = ['-', '|', 'e', 'l', 'w', 'h']
        words, targets, owners = COMPARE.ctc_target('wheel', labels)
        self.assertEqual(words, ['wheel'])
        self.assertEqual(targets, [4, 5, 2, 2, 3])
        self.assertEqual(owners, [0, 0, 0, 0, 0])

    def test_ctc_target_never_emits_the_blank_label_for_punctuation(self):
        # The blank token's own label string is "-" (index 0). A literal hyphen
        # in a hyphenated word (e.g. "self-balancing") is punctuation, not an
        # acoustic target, but naively matching any dictionary key would treat
        # it as a real target character whose ID happens to equal the blank
        # index — which torchaudio.functional.forced_align always rejects.
        labels = ['-', '|', 's', 'e', 'l', 'f', 'b', 'a', 'n', 'c', 'i', 'g']
        words, targets, owners = COMPARE.ctc_target('self-balancing', labels)
        self.assertEqual(words, ['self-balancing'])
        self.assertNotIn(0, targets)

    def test_ctc_path_keeps_repeated_letters_separated_by_blank_and_checks_target(self):
        targets = [2, 3, 2]
        spans = COMPARE.ctc_token_spans([0, 2, 2, 0, 3, 0, 2], targets)
        self.assertEqual(spans, [(1, 3), (4, 5), (6, 7)])
        with self.assertRaisesRegex(ValueError, 'does not match'):
            COMPARE.ctc_token_spans([0, 2, 0, 4, 0, 2], targets)

    def test_alignment_comparison_rejects_non_generated_run_classes(self):
        COMPARE.require_generated_run({'runClass': 'generated-lesson'})
        for run_class in ('renderer-fixture', 'hand-authored-script', 'fixture', None):
            with self.subTest(run_class=run_class), self.assertRaisesRegex(ValueError, 'generated-lesson'):
                COMPARE.require_generated_run({'runClass': run_class})

    def test_comparison_requires_matching_provider_generated_source_and_script_stages(self):
        manifest = {'runClass': 'generated-lesson', 'runId': 'run-a', 'stages': {'sourceDoc': 'sha256:source'}}
        stage_names = [
            ('S1-source-intake', 'local'), ('S2-concepts', 'provider'),
            ('S3-teaching-plan', 'provider'), ('S4-narration-script', 'provider'),
            ('S5-tts-alignment', 'local'),
        ]
        evaluation = {
            'runClass': 'generated-lesson', 'runId': 'run-a',
            'stageRuns': [{'stage': stage, 'kind': kind, 'status': 'completed', 'failures': [], 'fallbackCount': 0}
                          for stage, kind in stage_names],
        }
        COMPARE.require_provider_generated_audio_run(manifest, evaluation)

        with self.assertRaisesRegex(ValueError, 'does not match'):
            COMPARE.require_provider_generated_audio_run(manifest, {**evaluation, 'runId': 'other'})
        altered = {**evaluation, 'stageRuns': [
            {**stage, 'kind': 'local'} if stage['stage'] == 'S4-narration-script' else stage
            for stage in evaluation['stageRuns']
        ]}
        with self.assertRaisesRegex(ValueError, 'wrong kind: S4-narration-script'):
            COMPARE.require_provider_generated_audio_run(manifest, altered)
        altered = {**evaluation, 'stageRuns': [
            {**stage, 'failures': [{'hard': True}]} if stage['stage'] == 'S3-teaching-plan' else stage
            for stage in evaluation['stageRuns']
        ]}
        with self.assertRaisesRegex(ValueError, 'failure/fallback: S3-teaching-plan'):
            COMPARE.require_provider_generated_audio_run(manifest, altered)

    def test_stable_and_ctc_comparisons_must_share_exact_s4_word_sequence(self):
        COMPARE.require_same_word_sequence('One, TWO.', [{'w': 'One,'}, {'w': 'TWO.'}])
        with self.assertRaisesRegex(ValueError, 'does not match'):
            COMPARE.require_same_word_sequence('One, TWO.', [{'w': 'One,'}, {'w': 'three.'}])

    def test_asr_consistency_is_lexical_and_reports_missing_or_extra_tokens(self):
        exact = COMPARE.transcript_consistency('To do this, a green plant.', 'to do this a green plant')
        self.assertTrue(exact['exactTokenSequence'])
        self.assertEqual(exact['expectedTokenCount'], 6)
        missing = COMPARE.transcript_consistency('To do this, a green plant.', 'To do this green plant')
        self.assertFalse(missing['exactTokenSequence'])
        self.assertEqual(missing['missingTokens'], ['a'])
        self.assertEqual(missing['extraTokens'], [])


if __name__ == '__main__':
    unittest.main()

import importlib.util
import tempfile
import unittest
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

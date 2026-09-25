import importlib.util
import json
import struct
import tempfile
import unittest
import wave
from pathlib import Path


MODULE_PATH = Path(__file__).with_name('word_boundary_review.py')
SPEC = importlib.util.spec_from_file_location('hypothesis_word_boundary_review', MODULE_PATH)
assert SPEC and SPEC.loader
REVIEW = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REVIEW)


def write_wav(path: Path, rate: int = 1000, seconds: int = 8):
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        # Synthetic pulse-like content for UI/code-contract tests only.
        stream.writeframes(b''.join(struct.pack('<h', 9000 if (i // 100) % 2 else 0)
                                    for i in range(rate * seconds)))


def make_run(root: Path, run_id: str, source_hash: str, word_count: int = 35):
    root.mkdir(parents=True)
    (root / 'scene-audio').mkdir()
    tokens = [f'word{i}' for i in range(word_count)]
    text = ' '.join(tokens)
    write_wav(root / 'scene-audio' / 'scene.wav')
    words = []
    for index, token in enumerate(tokens):
        start = 100 + index * 100
        words.append({'w': token, 'startMs': start, 'endMs': start + 60})
    manifest = {
        'runClass': 'generated-lesson', 'runId': run_id,
        'stages': {'sourceDoc': source_hash, 'input': 'input-' + run_id, 'narration': 'narration-' + run_id},
    }
    stage_names = [
        ('S1-source-intake', 'local'), ('S2-concepts', 'provider'),
        ('S3-teaching-plan', 'provider'), ('S4-narration-script', 'provider'),
        ('S5-tts-alignment', 'local'),
    ]
    evaluation = {
        'runClass': 'generated-lesson', 'runId': run_id,
        'stageRuns': [{'stage': name, 'kind': kind, 'status': 'completed', 'failures': [], 'fallbackCount': 0}
                      for name, kind in stage_names],
    }
    (root / 'run-manifest.json').write_text(json.dumps(manifest))
    (root / 'evaluation-bundle.json').write_text(json.dumps(evaluation))
    (root / 'narration.json').write_text(json.dumps({'scenes': [{'sceneId': 'scene', 'plainText': text}]}))
    (root / 'aligned-audio.json').write_text(json.dumps({
        'sceneWords': {'scene': words}, 'sceneBoundsMs': {'scene': {'startMs': 0, 'endMs': 8000}}
    }))
    return tokens


class WordBoundaryReviewTests(unittest.TestCase):
    def test_pack_blinds_candidate_alignment_and_keeps_key_outside_reviewers(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = root / 'run'
            make_run(run, 'run-a', 'source-hash-a', word_count=3)
            # A distinctive candidate timestamp must only occur in the sealed key.
            aligned = json.loads((run / 'aligned-audio.json').read_text())
            aligned['sceneWords']['scene'][0]['startMs'] = 123.456
            (run / 'aligned-audio.json').write_text(json.dumps(aligned))
            out, key_path = root / 'pack', root / 'organizer-key.json'
            key = REVIEW.build_pack([run], out, key_path)
            page = (out / 'judge-1' / 'review.html').read_text()
            self.assertIn('word0', page)
            self.assertIn('data:audio/wav;base64,', page)
            self.assertNotIn('stable-ts', page)
            self.assertNotIn('123.456', page)
            self.assertIn('123.456', key_path.read_text())
            self.assertEqual(key['sourceCount'], 1)
            self.assertTrue((out / 'judge-2' / 'review.html').is_file())

    def test_pack_rejects_fixture_provenance_and_duplicate_source_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture = root / 'fixture'
            make_run(fixture, 'fixture-run', 'source-f', 3)
            manifest_path = fixture / 'run-manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['runClass'] = 'renderer-fixture'
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'generated-lesson'):
                REVIEW.collect_run(fixture)

            run_a, run_b = root / 'a', root / 'b'
            make_run(run_a, 'run-a', 'same-source', 3)
            make_run(run_b, 'run-b', 'same-source', 3)
            with self.assertRaisesRegex(ValueError, 'repeated SourceDoc hashes'):
                REVIEW.build_pack([run_a, run_b], root / 'pack', root / 'key.json')

    def test_pack_rejects_organizer_key_inside_participant_tree(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = root / 'run'
            make_run(run, 'run-a', 'source-a', 3)
            with self.assertRaisesRegex(ValueError, 'outside the participant pack'):
                REVIEW.build_pack([run], root / 'pack', root / 'pack' / 'organizer-key.json')

    def test_score_requires_two_distinct_complete_reviewers_and_keeps_single_source_unmeasured(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = root / 'run'
            words = make_run(run, 'run-a', 'source-hash-a', word_count=3)
            out, key_path = root / 'pack', root / 'key.json'
            key = REVIEW.build_pack([run], out, key_path)
            item = key['items'][0]
            annotations = [{
                'itemId': item['itemId'],
                'words': [{'startMs': 100 + i * 100, 'endMs': 160 + i * 100} for i in range(len(words))],
            }]
            vote1 = root / 'v1.json'
            vote2 = root / 'v2.json'
            vote1.write_text(json.dumps({'schemaVersion': REVIEW.VOTE_SCHEMA, 'packageId': key['packageId'],
                                         'participantId': 'reviewer-a', 'annotations': annotations}))
            vote2.write_text(json.dumps({'schemaVersion': REVIEW.VOTE_SCHEMA, 'packageId': key['packageId'],
                                         'participantId': 'reviewer-b', 'annotations': annotations}))
            report = REVIEW.score_pack(key_path, [vote1, vote2])
            self.assertEqual(report['status'], 'pilot-only-unmeasured')
            self.assertEqual(report['sourceCount'], 1)
            self.assertTrue(report['reviewerAgreement']['passes'])
            self.assertIn('requires at least three distinct source documents', report['reasons'])
            self.assertEqual(report['candidateErrorsAgainstMeanHumanBoundary']['stable-ts']['medianAbsoluteErrorMs'], 0)

            duplicate_vote = root / 'same-reviewer.json'
            duplicate_vote.write_text(json.dumps({'schemaVersion': REVIEW.VOTE_SCHEMA, 'packageId': key['packageId'],
                                                  'participantId': 'reviewer-a', 'annotations': annotations}))
            with self.assertRaisesRegex(ValueError, 'distinct reviewers'):
                REVIEW.score_pack(key_path, [vote1, duplicate_vote])

    def test_score_can_only_measure_after_three_independent_source_hashes_and_100_words(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runs = []
            for index in range(3):
                run = root / f'run-{index}'
                make_run(run, f'run-{index}', f'source-{index}', word_count=35)
                runs.append(run)
            out, key_path = root / 'pack', root / 'key.json'
            key = REVIEW.build_pack(runs, out, key_path)
            votes = []
            for reviewer, shift in [('reviewer-a', 0), ('reviewer-b', 10)]:
                items = []
                for item in key['items']:
                    items.append({
                        'itemId': item['itemId'],
                        'words': [{'startMs': 100 + i * 100 + shift, 'endMs': 160 + i * 100 + shift}
                                  for i in range(len(item['words']))],
                    })
                path = root / f'{reviewer}.json'
                path.write_text(json.dumps({'schemaVersion': REVIEW.VOTE_SCHEMA, 'packageId': key['packageId'],
                                            'participantId': reviewer, 'annotations': items}))
                votes.append(path)
            report = REVIEW.score_pack(key_path, votes)
            self.assertEqual(report['status'], 'measured-candidate-comparison')
            self.assertEqual(report['sourceCount'], 3)
            self.assertEqual(report['wordCount'], 105)
            self.assertEqual(report['reviewerAgreement']['medianBoundaryDifferenceMs'], 10)

    def test_score_rejects_incomplete_or_out_of_range_word_marks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = root / 'run'
            make_run(run, 'run-a', 'source-a', word_count=2)
            out, key_path = root / 'pack', root / 'key.json'
            key = REVIEW.build_pack([run], out, key_path)
            item = key['items'][0]
            bad = [{'itemId': item['itemId'], 'words': [{'startMs': 0, 'endMs': 9000}, {'startMs': 2, 'endMs': 3}]}]
            paths = []
            for reviewer in ('r1', 'r2'):
                path = root / (reviewer + '.json')
                path.write_text(json.dumps({'schemaVersion': REVIEW.VOTE_SCHEMA, 'packageId': key['packageId'],
                                            'participantId': reviewer, 'annotations': bad}))
                paths.append(path)
            with self.assertRaisesRegex(ValueError, 'invalid interval'):
                REVIEW.score_pack(key_path, paths)


if __name__ == '__main__':
    unittest.main()

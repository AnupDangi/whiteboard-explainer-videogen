import importlib.util
import json
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock


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
            self.assertIn('localStorage.setItem(storageKey', page)
            self.assertIn("window.addEventListener('beforeunload',saveProgress)", page)
            self.assertIn("document.querySelector('#download').disabled=!complete", page)
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


def make_measured_pack(root: Path):
    """Three independent runs x 35 words with two agreeing votes (no live calls)."""
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
    assert report['status'] == 'measured-candidate-comparison'
    return key_path, votes, report


class WriteCalibrationTests(unittest.TestCase):
    def test_measured_evidence_writes_loader_shaped_calibration(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            key_path, _votes, report = make_measured_pack(root)
            key = json.loads(key_path.read_text())
            calibration = REVIEW.build_calibration(report, key)
            self.assertEqual(calibration['schemaVersion'], 'alignment-calibration/v2')
            self.assertEqual(calibration['status'], 'measured')
            # Aligner comes from the candidates recorded in the review pack.
            self.assertEqual(calibration['aligner'], 'stable-ts')
            self.assertEqual(calibration['medianAbsoluteBoundaryErrorMs'],
                             report['candidateErrorsAgainstMeanHumanBoundary']['stable-ts']['medianAbsoluteErrorMs'])
            self.assertEqual(calibration['boundarySamples'],
                             report['candidateErrorsAgainstMeanHumanBoundary']['stable-ts']['boundaryCount'])
            self.assertEqual(calibration['independentClips'], report['reviewItemCount'])
            # Loader-shaped: identity pins plus ordered error statistics.
            self.assertEqual(calibration['voiceEngine'], 'voice-engine')
            self.assertEqual(calibration['voiceProvider'], 'supertonic')
            self.assertEqual(calibration['alignerModel'], 'base')
            self.assertIn(calibration['aligner'], REVIEW.RECORDED_ALIGNERS)
            self.assertLessEqual(calibration['minimumAbsoluteBoundaryErrorMs'],
                                 calibration['medianAbsoluteBoundaryErrorMs'])
            self.assertLessEqual(calibration['medianAbsoluteBoundaryErrorMs'],
                                 calibration['maximumAbsoluteBoundaryErrorMs'])
            self.assertTrue(all(v >= 0 for v in (
                calibration['medianAbsoluteBoundaryErrorMs'],
                calibration['meanAbsoluteBoundaryErrorMs'],
                calibration['minimumAbsoluteBoundaryErrorMs'],
                calibration['maximumAbsoluteBoundaryErrorMs'])))

    def test_pilot_only_report_refuses_with_explicit_reason(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = root / 'run'
            make_run(run, 'run-a', 'source-hash-a', word_count=3)
            out, key_path = root / 'pack', root / 'key.json'
            key = REVIEW.build_pack([run], out, key_path)
            item = key['items'][0]
            annotations = [{'itemId': item['itemId'],
                            'words': [{'startMs': 100 + i * 100, 'endMs': 160 + i * 100}
                                      for i in range(len(item['words']))]}]
            votes = []
            for reviewer in ('reviewer-a', 'reviewer-b'):
                path = root / f'{reviewer}.json'
                path.write_text(json.dumps({'schemaVersion': REVIEW.VOTE_SCHEMA,
                                            'packageId': key['packageId'],
                                            'participantId': reviewer, 'annotations': annotations}))
                votes.append(path)
            report = REVIEW.score_pack(key_path, votes)
            self.assertEqual(report['status'], 'pilot-only-unmeasured')
            with self.assertRaisesRegex(ValueError, 'three distinct source'):
                REVIEW.build_calibration(report, json.loads(key_path.read_text()))

    def test_single_vote_file_and_unknown_aligner_refuse(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            key_path, votes, report = make_measured_pack(root)
            key = json.loads(key_path.read_text())
            with self.assertRaisesRegex(ValueError, 'exactly two independent'):
                REVIEW.score_pack(key_path, votes[:1])
            with self.assertRaisesRegex(ValueError, 'not a measured candidate'):
                REVIEW.build_calibration(report, key, aligner='invented-aligner')

    def test_cli_write_calibration_writes_file_only_on_measured_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            key_path, votes, _report = make_measured_pack(root)
            calibration_path = root / 'calibration.v2.json'
            argv = ['word_boundary_review.py', 'score', f'--key={key_path}',
                    f'--votes={votes[0]}', f'--votes={votes[1]}',
                    f'--write-calibration={calibration_path}']
            with mock.patch.object(sys, 'argv', argv):
                REVIEW.main()
            written = json.loads(calibration_path.read_text())
            self.assertEqual(written['status'], 'measured')
            self.assertEqual(written['aligner'], 'stable-ts')

            run = root / 'pilot'
            make_run(run, 'run-pilot', 'source-pilot', word_count=3)
            pilot_key = REVIEW.build_pack([run], root / 'pilot-pack', root / 'pilot-key.json')
            pilot_item = pilot_key['items'][0]
            pilot_votes = []
            for reviewer in ('reviewer-a', 'reviewer-b'):
                path = root / f'pilot-{reviewer}.json'
                path.write_text(json.dumps({
                    'schemaVersion': REVIEW.VOTE_SCHEMA, 'packageId': pilot_key['packageId'],
                    'participantId': reviewer,
                    'annotations': [{'itemId': pilot_item['itemId'],
                                     'words': [{'startMs': 100 + i * 100, 'endMs': 160 + i * 100}
                                               for i in range(len(pilot_item['words']))]}]}))
                pilot_votes.append(path)
            refused = root / 'refused.json'
            with self.assertRaises(SystemExit):
                with mock.patch.object(sys, 'argv', ['word_boundary_review.py', 'score',
                                                     f'--key={root / "pilot-key.json"}',
                                                     f'--votes={pilot_votes[0]}',
                                                     f'--votes={pilot_votes[1]}',
                                                     f'--write-calibration={refused}']):
                    REVIEW.main()
            self.assertFalse(refused.exists())


if __name__ == '__main__':
    unittest.main()

# Generated-audio alignment and review

This package contains the live stable-ts adapter, comparison diagnostics, and a
blinded human word-boundary review workflow. Alignment timestamps are accepted
only when every spoken word has a valid positive interval. A diagnostic or
human review never repairs timestamps or changes the live S5 provider.

## Current evidence

- The prior `36.5 ms` value came from a scratch set of eight local-TTS clips,
  without a checked-in clip manifest or per-sample evidence. It is **withdrawn
  as a calibration claim** and must not be used as the current run's calibration
  value.
- The only current source-generated lesson has one source hash, three audio
  scenes, and 126 narrated words. In that run, stable-ts produced three
  zero-duration intervals. Local English CTC produced no zero intervals, but
  its better utterance-edge VAD comparison is not interior-word truth.
- The local ASR lexical check recognized all 126 words, but ASR correctness does
  not establish word boundaries. The run and both aligners therefore remain
  **uncalibrated**; no aligner has been promoted.
- Archived hand-authored or renderer-fixture audio is ineligible for this
  workflow and must not be used to measure timing.

See `docs/HANDOFF.md` and `hypothesis/v1_claude/03-VALIDATION-HARNESS.md` for
the dated evidence ledger.

## Blinded human word-boundary review

The packer accepts one or more source-generated runs. Every run must have
matching run/evaluation IDs, a hashed SourceDoc, completed provider-backed
S2/S3/S4, exact narration-to-alignment word sequence, and scene WAVs. Runs
sharing a SourceDoc hash are rejected so retries cannot inflate the independent
document count. The reviewer HTML contains audio, waveform, and narration words
only; it does not contain candidate aligner names or candidate timestamps. The
organizer key with candidate timing is written separately from participant
folders.

```sh
python3 src/experimental/hypothesis/shared/alignment/word_boundary_review.py pack \
  --run-dir .data/hypothesis-runs/claude/generated-.../lesson \
  --out .data/alignment-review/pilot \
  --key-out .data/alignment-review/pilot-organizer-key.json

python3 src/experimental/hypothesis/shared/alignment/word_boundary_review.py score \
  --key .data/alignment-review/pilot-organizer-key.json \
  --votes .data/alignment-review/pilot/judge-1/votes.json \
  --votes .data/alignment-review/pilot/judge-2/votes.json \
  --out .data/alignment-review/pilot-report.json
```

Two distinct reviewers independently mark each word's start and end by playing
the clip and setting boundaries at the playhead. The score report preserves the
individual annotations, reviewer agreement, candidate-vs-human boundary error,
run/audio/source hashes, and limitations. The experimental agreement check is
pre-registered at median inter-reviewer boundary difference <=80 ms and P90
<=200 ms. These are reviewer-consistency checks, not the pipeline's S5 gate.

A report remains `pilot-only-unmeasured` until it covers at least three
distinct SourceDoc hashes, at least 100 word items, and meets the reviewer
agreement check. Even a measured report does not automatically alter S5: a
separate review must examine language, voice, boundary-error distribution, and
zero/missing words before any provider change. The existing live gate remains
unchanged.

The current one-source pilot pack is at
`.data/alignment-review-pilot-20260924/participants/`; its separate organizer
key is `.data/alignment-review-pilot-20260924/organizer-key.json`. It contains
three clips / 126 words and remains `pilot-only-unmeasured`. No human votes or
timing report have been collected.

## CTC and ASR diagnostics

`compare_aligners.py --run-dir <generated-run> [--model-dir <dir>]
[--asr-consistency]` compares stable-ts with the English torchaudio CTC model.
It accepts provider-generated audio stages only. Optional local ASR uses cached
faster-whisper weights only and never downloads on demand. Reports are
diagnostic; RMS VAD examines utterance edges only and must not be presented as
interior-word calibration.

## Setup and implementation notes

`align.py` is the stable-ts sidecar; `align.ts` validates and calls it. The
sidecar uses the local faster-whisper backend. To install its pinned Python
dependencies, run `sh src/experimental/hypothesis/shared/alignment/setup.sh`.
Model fetching occurs only when that setup/alignment workflow is deliberately
run. `requirements-ctc.txt` contains optional dependencies for the comparison
diagnostic.

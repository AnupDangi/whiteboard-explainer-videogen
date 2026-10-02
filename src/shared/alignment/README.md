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
- The current blinded pack uses five source-generated lessons (five distinct
  SourceDoc hashes), 29 scene clips, and 793 words. The pack meets the
  minimum-source and word-count requirements, but it has no human votes yet.
- A local diagnostic re-aligned six scenes from two of those sources. All six
  retained exact narration token order. Stable-ts `base` produced one or more
  zero-duration intervals in five of six scenes (five zero intervals total);
  `base.en` also had five zero intervals across the same sample. Stable-ts
  `fast_mode=True` and `suppress_silence=False` did not remove them.
- The project's CTC comparison ran against all 29 pack scenes and reported 18
  zero-duration intervals for stable-ts versus zero for WAV2VEC2 CTC. The
  report's RMS VAD comparison measures utterance edges only, not interior-word
  truth, so this is a candidate-generation result and does not calibrate or
  promote CTC.
- A repeatable benchmark of the same six-scene diagnostic batch ran three times
  per worker setting. Pool size 1 measured p50/p95 wall times of 1.606/1.613 s;
  pool size 2 measured 1.396/1.399 s (about 1.15x p50 speedup). All 18 aligned
  samples retained token order, and each worker setting reproduced five
  invalid intervals per six-scene batch. This small warm-model batch is local
  aligner timing, not end-to-end lesson or video timing.
- The local alignment environment is present (`stable-ts 2.19.1`,
  `faster-whisper 1.2.1`) and cached base/base.en weights were used offline.
  The five-source run remains **uncalibrated**; no aligner has been promoted.
- An earlier local ASR lexical check recognized its pilot narration, but ASR
  correctness does not establish word boundaries.
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
folders. Progress is saved in that reviewer's browser storage and restored
when the same page is reopened. Export stays disabled until every word has a
valid, ordered, in-clip interval; the scorer independently validates the
downloaded file as well.

```sh
python3 src/shared/alignment/word_boundary_review.py pack \
  --run-dir .data/hypothesis-runs/claude/generated-.../lesson \
  --out .data/alignment-review/pilot \
  --key-out .data/alignment-review/pilot-organizer-key.json

python3 src/shared/alignment/word_boundary_review.py score \
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

The earlier one-source pilot pack is at
`.data/alignment-review-pilot-20260924/participants/`; its separate organizer
key is `.data/alignment-review-pilot-20260924/organizer-key.json`. It remains
`pilot-only-unmeasured`. The current five-source pack is at
`.data/alignment-review/2026-09-26-five-topic/participants/`; its organizer key
is `.data/alignment-review/2026-09-26-five-topic/organizer-key.json`. Keep that
key separate from participant materials. Neither pack has completed human
annotations.

## CTC and ASR diagnostics

`compare_aligners.py --run-dir <generated-run> [--model-dir <dir>]
[--asr-consistency]` compares stable-ts with the English torchaudio CTC model.
It accepts provider-generated audio stages only. Optional local ASR uses cached
faster-whisper weights only and never downloads on demand. Reports are
diagnostic; RMS VAD examines utterance edges only and must not be presented as
interior-word calibration.

## Setup and implementation notes

`align.py --worker` serves newline-delimited JSON requests and keeps one
stable-ts/faster-whisper model loaded for the lifetime of that worker.
`align.ts` dispatches scene requests through a bounded, persistent worker pool;
set `HYPOTHESIS_ALIGNMENT_WORKERS` (default 2, maximum 8) to tune local CPU
parallelism. `closeAlignmentWorkers()` is available for orderly shutdown in
tests and embedding applications. The one-shot JSON sidecar mode remains
available for diagnostics. Workers use the local faster-whisper backend. To install its pinned Python
dependencies, run `sh src/shared/alignment/setup.sh`.
Model fetching occurs only when that setup/alignment workflow is deliberately
run. `requirements-ctc.txt` contains optional dependencies for the comparison
diagnostic. Reproduce the worker measurement with
`node scripts/alignment-worker-benchmark.mjs --run-dir=<run-a> --run-dir=<run-b> --model=base --workers=1,2 --scenes-per-run=3 --repeats=3 --out=<report.json>`
after `npm run build`. The tested report is
`.data/alignment-review/2026-09-26-five-topic/alignment-worker-benchmark.json`;
the five-topic CTC diagnostic is in `ctc-diagnostic-five-topic.json`.

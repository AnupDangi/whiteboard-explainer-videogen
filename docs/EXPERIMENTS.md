# Experiment plan

## Evidence rules

Record environment, inputs, commands, observations and limitations. Synthetic timing is appropriate for verifying arithmetic and control flow, never proof of natural-speech quality. A few fixtures do not prove open-domain teaching quality. Record failed experiments as well as passing ones.

## E01 — Scene representation and determinism

- Hypotheses: H04–H07, H09, H13, H17, H22.
- Command: `npm test` (engine tests).
- Inputs: both fixtures; malformed IDs and connectors; all supported layout/node-count combinations; repeated random-access timestamps.
- Pass: identical SVG bytes at the same timestamp regardless of previous calls; earlier node geometry unchanged; no overlapping node rectangles or out-of-bounds nodes in supported arrangements; invalid schema rejected.
- Limitation: node rectangles do not establish text glyph bounds or connector nonintersection.

## E02 — Speech timing

- Hypotheses: H02, H15–H17.
- Command: `npm test` (provider and timing tests).
- Inputs: synthetic character alignments including repeated words; invalid/mismatched/descending alignments; altered speech rate.
- Pass: indexed words receive the expected timestamps; malformed alignment rejected; final visual event and narration fit inside scene duration.
- Follow-up: make one paid narration run after configuring keys. Audit 20 phrase-to-visual anchors at normal speed. Target median absolute anchor error ≤150 ms and maximum ≤350 ms, excluding explicitly documented anticipation offsets. These are targets, not measured results.
- Failure action: fix alignment or scheduling before adjusting visuals to hide errors.

## E03 — Progressive availability and worker lifecycle

- Hypotheses: H18, H20–H22.
- Command: `npm test` (jobs and HTTP tests).
- Inputs: injected scene delays, cancellation during preparation, a failing speech adapter, a fresh store reading a persisted interrupted snapshot, retries of read requests.
- Pass: scene count and available duration increase monotonically; a playable scene exists before job completion; cancelled jobs stop appending; prior scenes survive failure; a restarted worker marks unfinished work interrupted rather than claiming success.
- Browser follow-up: set preparation delay to 20 seconds, press Play as soon as scene one arrives, watch a buffer stall and resume. Scrub across a scene boundary and repeat with audio.
- Limitation: delay injection is a scheduling experiment, not a real generation benchmark. This implementation uses snapshot polling, not HLS or a distributed worker queue.

## E04 — Open-domain explanation quality

- Hypotheses: H01, H03, H04, H10, H14.
- Prerequisite: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
- Dataset: 20 prompts, five each in mathematics, software, biology and business processes; include source-grounded requests and requests with insufficient context.
- Measure: first-pass schema validity, factual errors, missing concepts, unreadable scenes, narration/visual relevance, total tokens, wall time, cost.
- Target: ≥90% schema validity before any retry; zero critical factual errors in reviewed output; at least 16/20 usable explanations without manually changing scene data.
- Review: two humans independently rate accuracy, clarity and pacing on 1–5 scales. Keep disagreement instead of averaging away critical errors.
- Ablation: outline-first versus per-scene isolated generation using the same model and budget. Not implemented yet.

## E05 — Render and export

- Hypotheses: H06, H12, H13, H17.
- Commands: `npm run benchmark`; `npm run export -- --fixture attention --fps 12 --width 1280 --out output/attention.mp4`; inspect with `ffprobe`.
- Pass: expected dimensions and playable H.264 output; duration within one video frame of the timeline for silent export; rasterized identical SVGs match; scene transitions appear at expected positions.
- Audio extension: export an actual narrated `.data/JOB/job.json`; confirm continuous audio, no repeated phrases, and duration consistency.
- Report SVG construction throughput separately from rasterization, encoding, model latency and TTS latency. Do not combine these into a fictitious end-to-end speed.

## E06 — Layout stress test

- Hypotheses: H07–H09.
- Corpus: maximum-length labels, long single words, many capitals, combining characters, Nepali text, equations and six-node arrangements.
- Pass target: no clipping/overlap at desktop and mobile preview sizes. Actual text measurement and font fallback must be validated before claiming this gate.
- Current limitation: width estimates use character-count heuristics. Extremely wide glyphs, non-Latin shaping and fallback fonts remain unverified.

## E07 — Asset and cache ablations

- Hypotheses: H11, H19.
- Deferred until E04 shows concrete limitations. Add only assets that fix observed explanatory failures.
- Compare cached versus uncached render work with the same inputs, resolution and hardware. Evaluate quality separately from speed.

## E08 — Model choice

- Hypothesis: H23.
- Deferred until one live provider is working. Use the same E04 prompt corpus and schema.
- Compare small and larger accessible models on measured success rate, retries, semantic quality, token usage and cost. Record actual model IDs and dates.
- This tests whether WE need a larger model; it does not identify Lamina's model.

## Build order and stop conditions

1. Prove E01 and synthetic E02 before adding model complexity.
2. Prove worker lifecycle E03 before treating the demo as progressive generation.
3. Verify silent E05; then real narration and browser audio behavior.
4. Run E04 and E06 before broadening the primitive vocabulary.
5. Only run E07/E08 when the preceding measurements identify the bottleneck.

Do not add billing, collaboration, training infrastructure, music generation or cloud deployment to pass these gates.

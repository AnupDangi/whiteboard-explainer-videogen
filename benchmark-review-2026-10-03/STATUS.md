# Benchmark review bundle — 2026-10-03

## Current status — 2026-10-05

- The gallery includes five complete 60-second V2 diagnostic videos plus five earlier V1 examples. All five V2 videos are `DRAFT`; two use a fallback board. None has human quality or rights review.
- The five V2 summaries are not one comparable benchmark: their underlying locks span two pipeline digests, and neither digest matches the current worktree. They are one generated example per domain, not the frozen 5×3 grid. The benchmark harness now requires one code digest and one effective config hash and rejects fallback trials.
- The current player now emits run/session-bound telemetry after verified first-frame readiness and qualifying user-started audio playback. The CLI persists request acceptance in `run-start.json`, and review bundles validate browser timing against it. No live first-audible timing has been recorded yet. Archived first-ready-scene and first-clip times are separate readiness/encoding metrics. Full request-to-completion on the five samples was 181–334 seconds for about 60 seconds of video.
- Current implementation status and open work are in [`../../docs/HANDOFF.md`](../../docs/HANDOFF.md). The dated notes below are historical snapshots; statements that there were no V2 videos describe the earlier state.

- Gallery: index.html (video-only lesson cards; no prompt text).
- Videos: five prior V1 icon-evaluation lessons, copied with their contact-sheet posters and run evidence. Vaccination, half-life, and osmosis were drafts with zero hard failures; thermostat and spaced repetition failed timeline visual-claim coverage.
- V2 cold batch: both the prior completion batch and the user-requested retry are stored under results/cold-v2/. Each contains all 15 trial logs, runner evidence, and report. The retry's 15/15 attempts failed at S1 with `fetch failed` before provider responses; known provider cost is $0 and that retry produced no V2 videos. Five later V2 diagnostic videos are in the gallery and have separate run evidence under ignored `.data/benchmark-v2/cold-v2/2026-10-04-final*/`.
- P13 render benchmark: raw report is under results/p13/.
- Earlier V1 dev benchmark report: results/dev-v1/report.json.
- Five V1 icon-eval evaluation bundles and locks: results/icon-eval/<domain>/.
- All ten `.data/v2-local1..10` diagnostic run folders and their logs are copied under results/v2-local-diagnostics/ (234 MB). These preserve the intermediate model/audio/board evidence as well as the run summaries.

The five V2 videos are not cold-grid outputs and should not be read as current V2 benchmark passes.

## Update — 2026-10-04 (S6 hardening, first complete V2 videos)

- The gallery now leads with five V2 lessons (doppler-effect, mitosis, dijkstra, compound-interest, ohms-law-series): each a complete 60.000 s MP4 from one cold generation of the final code, local TTS, 0 hard failures, status draft. Two lessons (mitosis, dijkstra) used the deterministic fallback board for one scene. Evidence per lesson is under `results/v2-final/`.
- These are diagnostic single trials, not the 5×3 cold grid; the same code gave 2/5 on one sweep and different compositions on others, so generation is not deterministic. S6 first-try validity is 5/25 (fails its 95% gate; 23/25 after salvage and repair), S4 first-try validity 71/86 (fails 98%), time to first verified scene 136–235 s (fails 20 s), pictorial entities 0/18, boards are sparse. No human review; no quality or correctness claim.
- What changed: deterministic salvage and fallback for S6, layout fixes (band heights, stable slots, kit growth, move detours), S3/S4 pacing and validator fixes, low reasoning effort for S4/S6. Full list, measurements, and open items: `docs/HANDOFF.md` (top entry).

## Latest run — 2026-10-04

- Final bounded Doppler attempt used the v6 BoardOps prompt and default Luna S6 model. S1–S5 produced plan, narration, and four local audio files. S6 rejected the first scene after two repairs because its directed-edge citation did not support the edge; it also rejected a five-word board label. S6 first-try validity was 0/1. No lesson lock or MP4 was produced.
- This was Doppler attempt 3/3. Do not rerun this domain in the current diagnostic series. Known model spend was `$0.026422`; local TTS used 0 credits. Combined V2 follow-up known model spend is `$0.255569`; TTS cost-per-minute remains unmeasured.
- Full run evidence is stored in `results/cold-v2-followup/2026-10-04-doppler-v6-final/`. No V2 video was added to the HTML gallery.

## Historical snapshot — architecture and pipeline status (2026-10-03, superseded)

- This work includes code and harness changes as well as model-input changes: constrained JSON calls and staged validation, provenance/replay artifacts, bounded repair, persistent BoardOps, lock-pinned deterministic rendering, S6-only planner routing, bounded benchmark attempts, and worker-pool measurement. The canvas renderer is deterministic for a given verified lock and toolchain; model generation and provider/TTS responses are not deterministic. Captured inputs, raw outputs, hashes, locks, and seeds make completed runs replayable and auditable.
- The current product failure remains S6 BoardOps reliability: JSON can be schema-valid yet fail source evidence, binding, creator dependency, or layout validation. Validators fail closed; the five diagnostic gallery videos came from one trial per domain, and two use a fallback board. S4 narration/duration remains a second failure area.
- V2 icon resolution still needs domain and scene-family context propagated through the default resolver. Contextual catalog retrieval is not yet measured. The five visible gallery videos are historical V1 samples only.
- P13 throughput/RAM/CPU is measured on one host; thermal and cross-host measurements are open. Full 5×3 cold grid, Stage A/B, held-out custody, human muted-board/rights/alignment review, cost/minute, and certification remain open. P17 remains deferred.

## Historical snapshot — pipeline status (2026-10-03, superseded)

| Stage | Evidence | Current diagnosis |
|---|---|---|
| Cold V2 source intake (S1) | Two frozen 5×3 batches, 30/30 failed before a provider response; 0 completed artifacts | Network `fetch failed`; the runs do not test S3, board planning, or rendering. Stop further retries until provider networking is available. |
| Local-TTS lesson preparation | Ten diagnostic V2 osmosis runs, 0 MP4s | Six runs failed the measured fixed-duration gate; four failed S6 BoardOps after the two-repair limit; two had beat-narration/duration-rewrite failures (categories overlap). |
| V2 board planning (S6) | In the reached-S6 runs, no lesson completed; latest failures include unsupported evidence tokens, missing claim bindings, dependent operations on rejected creators, and layout/operation validity | Planner reliability is the main product defect after intake and duration fit. Keep these as visible failures; do not count fallback output as a pass. |
| V1 icon-evaluation runs | Five complete videos across immunology, nuclear science, cell biology, control systems, and learning science | Vaccination, half-life, and second osmosis run are drafts with zero hard failures; thermostat and spaced repetition fail visual-claim coverage. One earlier osmosis planning attempt was truncated. |
| P13 raster throughput | Three subprocess trials, 120 locked SVG frames, worker counts 1/2/4/8 | Throughput/RAM/CPU measured on one 10-core host. Thermal status and cross-host results remain unmeasured. |

The gallery presents one full-scene contact-sheet poster per video, then the playable video, domain, title, status, and a short description. It contains no prompts. It currently includes five historical V1 videos and five V2 diagnostic videos; none is evidence for a complete current-digest 5×3 benchmark.

The S6 prompt has since been tightened from these retained failures: created visuals must carry non-empty exact concept/claim bindings, and a layout repair must preserve factual text and citations unless the replacement wording is still source-supported. The new prompt contract is versioned and lock-pinned. Offline typecheck and full suite pass; a live confirmation is still pending.

ElevenLabs now advances to the next configured key after an ambiguous network/5xx outcome, retains an estimated credit hold, and falls back to local synthesis after all configured keys fail. Mock runtime checks confirmed key 1 → key 2 success, all three keys → local fallback, and one 429 retry per key. No live provider call was made; balance and billing behavior remain unverified.

## Latest lead attempts (2026-10-03)

- A free OpenRouter models-list request returned HTTP 200, so one real cold Dijkstra lead was run. It failed at S3: one required step scene was missing; the repair added the step but left a 6-second section. Four model calls cost `$0.005807685`.
- The generic S3 duration-allocation prompt was tightened. A bounded follow-up generated a valid five-section, 60-second plan (five 12-second sections), and all beat narrations were retained. The local-TTS run then stalled at S5 before any audio artifact. Its OpenRouter spend is `$0.013321095` across 14 calls; there is no video.
- An ElevenLabs-configured S5 attempt also stalled without a usage result. Local alignment showed an HTTPS connection in `SYN_SENT`; local model availability was not confirmed. Both attempts were interrupted and retained under `results/cold-v2-leads/`. Possible ElevenLabs billing on the pending request is unknown.
- `scripts/v2-benchmark.mjs` now supports `--tts=local|elevenlabs`, case/trial subsets and reports, caps runs at three trials per case, and stops at the first hard failed trial. This prevents continuing into cases whose prior failure has not been diagnosed.
- At the end of the initial 2026-10-03 lead pass, no full V2 cold-grid artifacts or videos existed (0/15); S5 was suspected to be waiting on an uncached model or provider. The 2026-10-04 follow-up below corrected the S5 diagnosis: local audio completed when the harness used the free second alignment slot. The current blockers are S4/S6 reliability.

## Follow-up — 2026-10-04

- The newer local-TTS runs now complete alignment when the benchmark uses the second host slot. This corrects the prior S5 diagnosis: the cached models were present; a harness concurrency value of 1 waited on slot 0 held by another worktree.
- The latest failures are S6 BoardOps grounding/repair/layout across mitosis, Doppler and compound-interest, plus S4 beat-narration/duration rewrite on the second Ohm’s-law attempt. A third mitosis attempt using the intended S6 scaling setting also changed S4 beat narration and hit the budget guard before S6. Full results are in `results/cold-v2-followup/README.md` and the copied batch folders.
- Two sandboxed Dijkstra attempts failed S1 at `ENOTFOUND` with 0 calls; a free Node provider probe succeeded outside the sandbox. Later domain trials used the escalated network path.
- No V2 trial produced a lesson lock or MP4. The five files in `videos/` remain prior V1 outputs only. The existing HTML stays video-only with a complete-scene contact-sheet poster, title, domain and description for each video.
- Diagnostic timeout is 15 minutes by default (maximum 20 minutes). The runner stops on missing/unverified status or incomplete artifacts. Each live domain was limited to one or two complete generation attempts; the interrupted compound slot-wait is retained separately.
- S6-only model routing is now available as `--s6-planner` / `V2_BENCH_PLANNER`, with both model IDs recorded. The route passed typecheck and the offline suite but remains untested live within the $0.10 cap.
- Open: improve S6 and S4 reliability; V2 domain/scene-family context propagation in icon resolution; full 5×3 cold grid; Stage A/B; held-out custody; human muted-board, rights and alignment review; cost/minute; P13 thermal/cross-host evidence. P17 remains deferred. `ABSOLUTE_QUALITY_CERTIFICATION=UNAVAILABLE`.

# 03 — Validation Harness

## Current status ledger (2026-09-25)

The 2026-09-24 authenticated API check supersedes historical DNS failures in older run notes. Connectivity is passed. The S3 normalization/cache-versioning defects found in the 2026-09-25 takeover audit are fixed. After Task 14's documentation updates, the offline gate passed at 349 Node + 17 Python tests. Provider-backed reliability, S5 calibration, and visual acceptance remain unresolved.

| Gate / experiment | Status | Evidence / remaining work |
|---|---|---|
| Provider transport retries and validator classification | tested | Focused tests verify bounded transport retries are separate from the one semantic repair, no-endpoint outcomes do not block the budget ledger, and validator exceptions remain distinct hard failures. |
| Exact evidence anchoring | tested | Seven focused tests cover exact, normalized, and unique relocated verbatim quotes, offset mapping, and rejection of paraphrase/ambiguity. |
| Prompt builder and S6 recipe prompt v13 | tested | Six builder/keyword-guard tests and four recipe/version tests passed. The recorded v12 base prompt hash remains pinned; v13 adds the versioned topic-neutral recipes. |
| Mechanism bank v4 | implemented | Five tests cover template/primitive coverage and topic-word disjointness. Entries remain experimental with every review pending; this is not visual validation or promotion evidence. |
| Deterministic scene-richness metrics | tested | Four focused tests and the full offline suite cover structural counts and aggregation. These metrics do not measure clarity, visual quality, or Simi parity. |
| Diagnostic S6 opt-in | tested | Three focused tests verify the default skip, explicit diagnostic planning, and unchanged hard S5 failures/run status. No S6 paid call is included in this evidence. |
| S6 prompt-arm calibration harness | tested | Two focused tests verify valid-rate, richness, failure-code, and cost aggregation, including repair failure without fallback. Paid prompt-arm measurements remain unmeasured. |
| SVG icon-library ingest | tested | Six focused tests cover deterministic normalization, accepted-license enforcement, unsupported-file reasons, and path limits. No visual icon-quality judgment is implied. |
| Multi-library registry and catalog hashing | tested | Three focused tests verify default registry behavior and catalog/embedding-byte invalidation. Streamline is the only enabled library. |
| User icon library ingest | unmeasured | Existing reports show assetlab-mit 162 accepted / 52 rejected (36 unknown-color, 15 no-ink, 1 bad-geometry), assetlab-isc 13 / 0, and assetlab-apache20 0 / 20 (all no-ink). Unknown-color affects 16.8% of the MIT input set, below the plan's 30% pre-flatten amendment threshold. These remain unverified workspace artifacts: no user-provided source path is recorded in chat and referenced `ATTRIBUTION.md` files are absent. No candidate library is enabled and no embedding was regenerated. |
| Query-embedding cache and lesson icon pins | tested | Five focused tests plus E2E replay checks cover model-keyed cache behavior and cross-scene pin stability. No retrieval threshold was recalibrated. |
| Cold S1–S4 reliability harness | tested | Two focused tests cover conditional stage rates, failure-code counts, cost totals, and empty inputs. Actual cold provider reliability remains unmeasured. |
| Task 14 reliability run | unmeasured | The $1.00-capped paid command has not been approved or run. |
| Task 14 diagnostic S6 runs | unmeasured | Three prepared sources and their stage-cache directories exist. The three paid runs (up to $0.30 each) have not been approved or run. |
| Task 14 prompt-arm calibration | unmeasured | The $1.00-capped paid calibration command has not been approved or run. |
| C6 / E1 / E5 visual acceptance | unmeasured | No eligible generated lesson has passed blinded human review. S5 alignment calibration still requires two independent reviewers. |
| OpenRouter connectivity / authentication | passed | Unauthenticated `/api/v1/models` HEAD returned HTTP 200; one authenticated `qwen/qwen3.8-flash` chat call returned HTTP 200 with a four-token cap and empty visible content. This establishes connection, credentials, and route only. A schema-valid structured response was not obtained from that tiny smoke call. The authorized network path was required because default sandbox DNS still fails. |
| Fresh Qwen S2→S4 proof | failed | Cold 60-second source run `continuation-20260924/lessons/photosynthesis-source-fresh-20260924` completed S2 after repair and failed S3 after repair; S4 was not reached. Four calls cost $0.0075701. The raw S2/S3 responses, per-call usage, selected provider/model, and stage times are in `lesson-prep.json`. This is a semantic/contract failure, not a connectivity failure. This run predates the 2026-09-25 S3 fix. |
| Fresh Qwen S2→S4 proof, against the corrected code (2026-09-25) | passed | Three of about ten attempts passed S1–S4 zero-shot (`ocean-tides`, `bicycle-balance`, `composting`) with qwen/qwen3.8-flash alone. Other attempts failed at S2/S3 with evidence-quote, empty-completion, or teaching-contract failures. One Sonnet rescue passed S3 with no repair; seven further attempts hit OpenRouter direct-routing rejections. Total live spend was $0.1145. |
| First full S1–S12 attempts on new sources (2026-09-25) | failed | All three successful S1–S4 lessons produced playable MP4s but correctly remained failed due to unmeasured S5 calibration, zero-duration words, skipped S6 planning, and planner-fallback gates. No result was mutated into a pass. |
| S3 normalization/cache integrity fix (Phase 0) | passed | Three confirmed defects fixed in `plan/stages.ts` and `pipeline/lesson.ts`: (1) `canonicalize()` no longer synthesizes a missing `SceneContract` or recomputes `requiredRelations` from the graph before validation — `teachingContractProblems` now sees the model's raw output, so a real planner violation is a hard failure surviving exactly one repair, never a silent fix; (2) `S2-concepts`/`S3-teaching-plan`/`S4-narration-script` cache entries now carry real, distinct `stageVersion` strings instead of a hardcoded `'1'`, and S3's was bumped so old warm caches from the prior normalizer cannot replay; (3) valid single-use `lessonBible.terminology` entries the model declares are preserved rather than stripped down to persistent-only concepts. Two new regression tests cover an omitted contract and an invented unsupported relation, each asserting the hard failure survives one repair; a third assertion confirms single-use terminology survives. Read-only retry-ownership audit: provider failures and semantic-validation failures are correctly separated (only the latter spends the one repair); a code-level exception thrown inside `canonicalize`/`validate` would still land in the generic `stage-threw` bucket rather than a distinct category — documented as an acceptable, narrow, later-phase gap. |
| Post-change offline gate | passed | `npm run typecheck:hypothesis` exits 0. `npm run test:hypothesis` passes the full Node suite (294 tests) and 17 Python tests, all runs to completion, none short-circuited. |
| S3 prompt calibration — measured (2026-09-25) | passed | `plan:calibrate` measured 5 held-out sources × 3 cold attempts: `v3-baseline` 0/15; `v4-explicit-concepts` 6/15 (40%). The latter is the default; bicycle-balance and composting remained 0% under both variants, so a third candidate is still needed for that failure cluster. |
| Long-form / RAG — code-verified unimplemented | unmeasured | Not merely "not yet measured": `grep` confirms zero `section-parallel`/`long-form`/`RAG_ENGINE` references in `v1_claude/`. `maxConcepts` is hard-capped at 14 independent of `targetDurationSec`. Live 5-min/10-min attempts both failed at S2 before this cap would even bind. Any future long-form or RAG work is new architecture, not a parameter change. |
| Baseline hashes | implemented | Frozen v1 records 40 files; corrective v2 hashes 77 reference videos/frames and retained run artifacts without altering v1. G-10 is partial; G-DOC and G-LONG are missing. |
| Exemplar review-failure exclusion | tested | Retrieval rejects any exemplar with a failed factuality, visual, license, leakage, or human review, even when the example remains marked experimental. A synthetic regression covers a failed-license entry; pending experimental examples remain available to the explicitly versioned E5 arms. No media was reviewed or promoted. |
| Provider spend metadata integrity | tested | Structured calls reject missing, non-finite, or negative prompt/completion token counts and cost rather than normalizing absent billing fields to zero. A synthetic S6 response without `usage.cost` leaves spend unclaimed and blocks the durable ledger as uncertain; the call remains hard-failed. No live provider request was made, and live billing/cap behavior remains unmeasured. |
| S1 local source intake | tested | Unit checks preserve DOCX heading/table/figure markers, DOCX inline math within prose and display math as equation spans, PPTX slide/table order, and original PDF page numbering across blank pages. Extractor-authored character ranges, not visible Markdown-like headings inside source text, determine actual PDF page/PPTX slide citations; spoofed `Page 99` and `Slide 99` regressions pass. Textless/scanned PDF rejection is explicit; OCR and embedded images are not included, and five-document E9 remains unrun. |
| Procedural icon seed descriptors | tested | Removed topic-only associations (`photosynthesis`→leaf, `carbon dioxide`→cloud, and domain tags for induction/electromagnetism/physics). Literal asset names remain searchable; the regression confirms an indirect topic falls to the labeled text rung. This only narrows the hand-authored fallback catalog and is not icon calibration; E4 remains unmeasured. |
| Local embedding model initialization retry | tested | A transient MiniLM loader rejection no longer poisons the process: concurrent callers share one initialization, failed initialization can retry, and successful initialization is then memoized. The unit test injects a failed loader; it does not initialize MiniLM or establish embedding quality, which remains unmeasured here. |
| S2–S6 generated-stage wiring | tested | Neutral synthetic integration exercises S2→S6 and warm cache replay. The S1–S4 test now passes: its relation-loss rejection assertion is reached and holds, since normalization no longer replaces model relations before the gate. Two additional cases confirm an omitted contract and an invented unsupported relation are hard-rejected after one repair. This is fail-closed contract-check evidence only — no complete generated lesson exists yet. |
| S6 scene-local contract context | tested | Scene-context compilation rejects concept IDs that differ from `SceneContract.requiredConceptIds`, relation contexts that omit, duplicate, or add a relation, and concept/relation citations absent from permitted evidence before any provider call. The live lesson mapper supplies the per-section concepts and relation subset. Unit tests use synthetic source evidence only; visual quality remains unmeasured. |
| Generated-source golden isolation | tested | Source-generated runs never load fixed benchmark claims or duration targets through a colliding case ID/source filename. A typed helper rejects golden lookup for `generated-lesson`; benchmark/script categories retain their explicit frozen target. Regression covers collisions with Attention and photosynthesis IDs. This is gate-routing evidence only and does not validate visual quality. |
| Case-ID input dispatch audit | tested | Remaining `liveCli` case-ID routing selects retained hand-authored SceneSpecs/scripts and defaults those runs to `renderer-fixture` or `hand-authored-script`; `lessonCli --source` instead builds S1–S5 from the supplied source and marks the run `generated-lesson`. `goldenForRun` refuses generated lessons, and judge eligibility refuses fixture/script classes. These retained inputs are not used as visual-quality evidence. |
| Independent source coverage in generated-run diagnostics | unmeasured | Inventory found four failed 60-second run directories, but all have the same SourceDoc SHA-256 and the same narration SHA-256: they are retries of one photosynthesis lesson, not four independent samples. No run is eligible for C6/E1/E5. OpenRouter and Anthropic DNS lookups still return `ENOTFOUND`; no provider call was made. |
| S5 fractional alignment timestamps | tested | The stable-ts sidecar now retains fractional-millisecond word boundaries instead of independently rounding start/end before artifact caching; the live S5 artifact version invalidates prior rounded results. A Python unit test verifies distinct submillisecond inputs remain distinct. Fresh local re-alignment of source-generated scene audio returned three exact-zero intervals; stable-ts `fast_mode=True` did not remove them. S5 now records these as hard failures before mention resolution, and captions remain fail-closed. |
| S5 calibration source and publish gate | unmeasured | The old 36.5 ms scratch calibration was withdrawn because its source clips and per-boundary data are unavailable and its observations are not interior-word truth. Runtime configuration now records `unmeasured` with null metrics; a live run without measured calibration can collect diagnostic TTS/alignment audio but receives a hard S5 failure and cannot publish. The historical number remains only in a clearly named withdrawn record. |
| S5 blinded human word-boundary workflow | implemented | `word_boundary_review.py` builds two independently ordered, self-contained audio review pages from provider-generated source runs only. The pages expose narration/audio/waveform, never candidate aligner labels/timestamps. The organizer key is enforced outside the participant tree and binds source/run, narration, and audio hashes to candidate timings. Scoring requires two distinct reviewers, complete in-range word marks, monotonic starts, and reports inter-reviewer agreement plus each candidate's boundary error. Calibration remains unmeasured until at least three distinct SourceDoc hashes, 100+ words, and pre-registered agreement criteria (median ≤80 ms, P90 ≤200 ms) are satisfied; a pilot cannot promote S5. Synthetic contract tests pass; no human votes exist yet. |
| S5-to-S6 fail-closed prerequisite | tested | On a source-generated cache replay with three hard S5 zero-duration intervals, S6 compiled no prompt and all three paid calls were skipped. Each scene retained a local diagnostic fallback and a hard skip failure; total run status stayed failed and planner spend was $0.00. The invalid clock also prevented MP4/caption output. No frames or legacy fixture media were inspected; no visual-quality claim follows. |
| S5 model-size diagnostic | tested | Matched fresh source-generated audio/text across cached base/small/medium/base.en models with `fast_mode=True`; zero intervals were 4/126, 2/126, 4/126, and 5/126 respectively. Single-lesson diagnostic only; no model adopted and calibration does not transfer. |
| S5 stable-ts option diagnostic | tested | On the same generated-run audio, `suppress_silence=False` retained 3 zero intervals; `token_step=150` matched the default result, while `token_step=50` increased zeros to 6 and worsened VAD-boundary median/max error to 54.05/395.31 ms. No settings were changed; one source does not support adoption or recalibration. |
| S7/S10 text-width measurement | tested | Intrinsic text widths and scene-title/text-box fitting use resvg's rendered glyph ink bounds. A synthetic layout regression confirms the width distinction for narrow and wide glyph runs. This validates sizing behavior only; the font itself is not bundled, glyphs remain SVG text, and no output was visually rated. |
| CTC and transcript-consistency diagnostics | tested | `compare_aligners.py` refuses non-generated runs and reports stable-ts/English torchaudio Wav2Vec2 CTC against independent utterance-boundary RMS. Optional v2 `--asr-consistency` performs local-only transcription and token comparison. In one source-generated photosynthesis lesson, ASR matched all 126 S4 words exactly; the three stable-ts zero-duration words (`To`, `a`, `the`) were recognized, while CTC measured positive intervals for all words. ASR and CTC do not supply interior-word ground truth; both aligner calibration and generalization remain unmeasured, and S5 continues to fail closed. |
| Evidence spans through S2/S6 planning | tested | Exact quoted spans are enriched with extracted-source offsets; SourceDoc v2 adds extractor-authored PDF page, PPTX slide, and DOCX body paragraph/table locations to S2 claims and S6 context. Source text cannot spoof native PDF/PPTX locations using visible `Page N` or `Slide N` headings. Planner rejects absent/forged references and altered native locations, relation omission, incorrect endpoints, mismatched citations, and concept links without concept-specific evidence. DOCX body-block ordinals are source-structure locators, not persistent XML IDs. No complete generated-video provenance audit has passed yet. |
| S3 scene contracts and S6 context | tested | Existing S3 call requests LessonBible/SceneContracts; validation requires source concepts, relations, cited spans, contract duration equal to the section budget, and unique canonical terminology for persistent concepts. Concepts used in multiple sections must be declared persistent. S3 instructions use prompt v3; S6 prompt v12 preserves the explicit `prim` schema requirement and native citation locations, allows multiple supporting source spans for multi-concept titles/elements, and defaults to 6,000 output tokens; repair diagnostics tell the planner to keep evidence for each linked concept and remove unsupported numeric claims. S4/S5 timing, evidence, prior-scene identity, only above-threshold catalog candidates, available template slots, and versioned example selections enter the hashed code-compiled S6 context. The compiler rejects missing/extra/duplicate required concepts, relation sets that differ from the SceneContract, and concept/relation evidence references absent from the permitted scene evidence set before spending. The same serializer supplies exemplar intent, SceneSpec, rationale, and provenance to the model and hash; retrieval score is hashed as metadata. Exact prompts and audit metadata are retained in the typed cached result; focused cache/context tests pass. The icon threshold is not calibrated (E4 unmeasured), and no successful provider-generated contract run exists. S6 paid calls are now skipped after any hard S5 word-clock failure, verified on a fresh source-generated cached replay. |
| Fresh generated photosynthesis run after S5/S6 changes | failed | S1–S4 warm hits; all three S5 alignments regenerated and the S5 stage recorded three exact zero-duration intervals as hard failures. S6 network fetch failed all three calls with $0 reported spend. Run has 13 hard failures, 3 fallbacks, and status `failed`. `ffprobe` confirmed the ~60s H.264/AAC MP4 container only; the diagnostic video was not viewed or scored and is ineligible for C6/E1/E5. |
| S6 old fixture boundary | tested | Five old fixture demonstrations are absent from runtime prompts and E5 arms. New generated lessons default to zero-shot. Prompt data is escaped and experimental examples are declared structural only. |
| Dynamic exemplar selection / prompt optimization | implemented | Cross-domain bank and deterministic text/mechanism/diverse experimental arms are implemented with hashes and selection logs. Bank v3 requires an evaluation split and retrieval excludes golden-derived, development/test, target-source/lesson, and lexical near-duplicate exemplars; rank v2 versions the 0.72 Jaccard threshold. This does not detect semantic paraphrases. Bank records provenance and factuality, visual, license, leakage, and human review states; approval fails closed unless every review passes with reviewer and timestamp. Current entries remain experimental and pending, no entry is human visually approved, and E5 quality is unmeasured. |
| E5 example-order permutation | tested | The live planner can run ranked or reversed selected-example order with `--example-order`; order affects the compiled context hash, S6 cache input, run ID, and config hash and is recorded in run summaries. Synthetic tests verify prompt order and invalid zero-shot/reverse combinations. No model/video comparison has been run. |
| E5 treatment eligibility | tested | Retrieval arms are rejected before any TTS/provider stage unless the run is explicitly `generated-lesson`, has the exact SourceDoc, and every scene has a SceneContract/LessonBible with no hand-authored SceneSpec. Synthetic eligibility tests cover fixture, missing-source, missing-contract, and hand-authored rejection. No generated lesson has been admitted yet. |
| E5 matched-pair gate | tested | Run manifests now include S6 arm/order/model/catalog/prompt/bank versions and the exact narration-audio SHA-256. The pair gate requires two individually judge-eligible generated lessons, same case/input/source/narration/alignment/audio/voice/render/content-model, and exactly the declared model or prompt-arm contrast. Synthetic pair records cover a valid pair and reject fixtures plus source, narration, audio, voice, and uncontrolled-treatment mismatches. This gate does not evaluate video quality. |
| E5 blinded timed-video human review | tested | Review tooling requires each matched pair's exact case ID and SourceDoc hash to occur in a versioned held-out source-set manifest, in addition to generated-run eligibility and the matched contrast gate. It records represented stage costs, counterbalances A/B order across two independent reviewers, and keeps run/treatment identity in the separate sealed organizer key. The scoring CLI requires the organizer record and verifies its exact answer-key hash, item-to-run/treatment/cost mappings, and held-out-set hash before scoring; any mismatch yields `unmeasured`. The reviewer form compares complete timed videos with shared playback/seek and records clarity, mechanism explanation, factual concerns, and preference. Synthetic holdout/vote/integrity tests pass; the frozen held-out source set is missing, so no real E5 pack or human vote exists. |
| E5 shared upstream cache | implemented | `lessonCli --stage-cache=<dir>` lets separate treatment output directories reuse the same content-addressed S1–S5 artifacts while S6 keys stay treatment-specific. No cold/warm paired provider run has been completed. |
| Few-shot example leakage guard | tested | S6 checks selected examples' distinctive visible text (including container child labels) and numeric values against generated scene content; copied facts fail unless independent target source evidence contains them. A synthetic changed-topic test keeps the template and selected exemplar fixed while changing labels, values, and relation type; unsupported copies and the wrong source-relation type fail. These are code-contract checks only. The safeguard is lexical and cannot detect all semantic paraphrases; held-out timed-video review remains required. |
| E4 calibration evaluator | tested | `catalog:e4:calibrate` validates at least 200 unique labeled source-grounded concept–asset pairs and 50 human labels, records the VLM/human agreement rate, sweeps cosine thresholds, and reports precision/coverage/overall semantic match. It reports `passed` only when one cutoff clears both precision ≥0.90 and overall semantic match ≥0.85; it does not change runtime constants. Synthetic evaluator tests pass; the actual E4 experiment and thresholds remain unmeasured because the labeled corpus does not exist. |
| Factual numeric-value evidence | tested | Generated titles, element labels/text, edge labels, and data-bearing meter/plot/number-line/object/stack/axis/hill values must match numbers in their own cited source quotes; physical-unit mismatches fail, while a source percentage can support its normalized meter fraction. Explicit illustrative-example origins are separately classified. Focused negative, positive, unit-mismatch, and percent-normalization tests pass. |
| Historical fixture deterministic smoke | tested | The old three-scene hand-authored Attention render previously cleared deterministic gates. This historical record is retained unchanged; its scene output has been removed from current tests and must not be rerun or used as generated-planner, architecture, or visual-quality evidence. |
| G6 readability floor | tested | Note-tier text now starts at 32px and every visible text run below 32px is a hard failure. A regression test shrinks a token-strip box and verifies all six undersized sublabels hard-block. |
| Hard gate/publish status separation | tested | Unit coverage verifies clean runs stay draft, hard failures dominate, and missing factual evidence or alignment blocks a judge-approved publish. |
| Judge input eligibility and reference matching | tested | Judge API, CLIs, and E5 review-pack eligibility exclude fixtures, hand-authored runs, incomplete/failed videos, fallback outputs, mismatched run identities, missing source provenance/S1–S12 records, and failed per-scene gates. Topic-matched Simi scoring requires an explicit topic matched by the extracted SourceDoc title and versioned reference tag; case ID, source filename, and run-directory names cannot classify the lesson. The exact serialized SourceDoc must also match the manifest's recorded SHA-256, preventing substituted titles or source metadata from steering E1/E5 eligibility. Regressions cover filename/case collisions and edited SourceDocs. Focused eligibility tests do not render or score any video. |
| Timed-video judge path | implemented | VLM judge samples three chronological frames from each generated scene's actual reveal times, supplies the active aligned word, and records sequence coherence and mechanism visibility alongside final-frame clarity/style. Synthetic timeline point selection is tested; no generated video has been sent to a judge. |
| VLM judge result cache | tested | Results are keyed by model, prompt/schema version, exact prompt, and ordered image-byte hashes; only schema-valid responses are reused. Synthetic byte buffers and cache envelopes are tested. No visual judge call has been made. |
| E1 individual human vote capture | tested | `judge:human:pack:hypothesis` accepts only a complete eligible generated lesson, requires an explicitly matched topic, samples 10 generated and 10 correctly tagged reference frames, and writes independently ordered, self-contained participant folders with opaque images, offline review pages, vote export, separate answer key, and hashed organizer provenance. `judge:human:hypothesis` runtime-validates both JSON schemas, preserves raw input, and reports `unmeasured` for malformed/incomplete inputs. A judge must meet the 4/5 style floor overall and on generated frames separately, so reference scores cannot mask weak generated output. Unit tests use synthetic vote/manifest data only; no pack has been built and no human votes have been collected. |
| Topic/label/value perturbation guard | tested | One generic template is rerendered with altered topic text, labels, and numeric values; stale values must disappear. |
| Caption word-clock generation | tested | WebVTT utility groups measured words at sentence boundaries and escapes cue payload text; empty, out-of-range, zero-duration, and out-of-order aligned words fail closed. The fresh generated run exposed zero-duration words in stable-ts alignment; no timestamp correction is fabricated. |
| C1–C5 | unmeasured | No frozen comparative report yet. |
| C6 renderer proof | unmeasured | Historical hand-authored scenes are renderer regression inputs only. They are excluded from visual acceptance. No current source-generated timed lesson has passed the C6 human review. |
| E1 blinded Simi comparison | unmeasured | No two-human votes or order-reversed VLM results on fully generated timed videos. Hand-authored scenes and renderer fixtures are explicitly ineligible. |
| E2–E8 | unmeasured | No completed, comparable experiment reports. |
| E9 unseen-document evaluation | unmeasured | Five fixed unseen documents and judge scores not present. |
| E10 cold/warm 1-, 5-, 10-minute jobs | unmeasured | No complete job matrix with stage cost and time. |
| E1/E4 thresholds and clarity targets | unmeasured | Targets below remain gates, not achieved metrics. |
| S11 export worker pool + MP4 decode smoke and frame parity | tested | `npm run test:hypothesis` runs a neutral synthetic frame through resvg workers and ffmpeg, decodes the MP4, compares `frameSvgAt` against `renderSVG`, and verifies failed/interrupted encodes do not publish a final-path MP4. This is export plumbing evidence, not a quality judgment or full-duration performance result. Browser preview evidence is recorded in the next row. |
| Browser renderer playback and seeking | tested | The previous local C6 fixture preview is historical only and is not reused. The current browser-player test uses neutral synthetic scenes; in-process route checks verify draft status, scene/timeline loading, and refusal to serve production files. Real generated-run audio sync, caption-track presentation, and playback remain unmeasured. |
| Bundled font and browser/rasterizer consistency | tested | A SHA-256 check and resvg glyph-bounds check exercise the bundled Kalam Bold asset with system fonts disabled; the synthetic browser-player route serves the same TrueType bytes and awaits the face before rendering. This is a renderer contract test only. No legacy fixture media was rendered or scored; C6 and generated visual quality remain unmeasured. |
| Offline warm cache and live-stage cache implementation | tested | Fixture E2E reuses S4/S5/S7–S10 artifacts (14 stage hits) and changed narration invalidates S4/S5 dependencies. Provider-backed S2–S4/S6 and the S1–S12 processing-stage DAG now have content-addressed cache code; full live cold/warm replay and changed-source dependency invalidation remain unmeasured, not unimplemented. |
| C6 preliminary visual comparison | failed | The prior comparison misattributed photosynthesis `simi-scene01.png` to Attention and its token-strip conclusion is withdrawn. The Attention reference is `lamina-video-ec6c5e81-291c-4917-93f5-7820f50b4213-1-scene01.png`; no replacement matched review has been completed. |
| C6 visual acceptance / E1 style parity | unmeasured | No two-human votes, timed matched-video review, calibrated VLM agreement, or order-reversed judge results. Keep reference topic attribution explicit. |
| Archived C6 renderer artifact | tested | `runId=26f092b9725224aae36a873ec97268cacf4d83e0bdef7d2454d5bf1d9cdfe4a4`, run class `renderer-fixture`, status `draft`, 3 scenes, 0 hard failures, 0 warnings, mean occupancy 0.4904. Historical hand-authored SceneSpecs and fixture narration/alignment; SVG/contact-sheet only. Not generated-planner or MP4 quality evidence and excluded from future quality evaluation. |
| Live-stage cache and persistent spend guard | tested | Unit tests verify content-addressed stage reuse/invalidation, serialized budget checks, persistent spend, fail-closed handling of uncertain calls/locks, blocking future calls after a measured overrun, and passing only the true shared remaining allowance into each provider request. Per-million-token ceilings use the lesser of remaining stage and lesson-wide budget plus request bounds; paid provider cap behavior and warm/cold replay remain unmeasured. |
| Generated-lesson end-to-end smoke | failed | One 30-second source-based run stopped at S2 (`fetch failed`); no successful provider response was obtained and later stages did not execute. The ledger is fail-closed pending billing/network review. |
| Provider connectivity diagnosis | passed | Earlier sandbox-only probes failed DNS, but later authorized HTTPS HEAD and authenticated chat calls both returned HTTP 200. Keep the old failures as historical environment records; do not spend further work on network diagnosis unless a real request fails. |
| Full offline suite | tested | After removing retained lesson SceneSpecs from tests, `npm run typecheck:hypothesis` and `npm run test:hypothesis` passed with 257 tests. No old Attention/math SceneSpec or media was loaded. The suite's synthetic render/encode tests verify code behavior only, not visual quality or cost. A prior 224-test result that included legacy renderer checks is historical only. `npm run baseline:verify` previously failed because frozen manifests reference run artifacts absent from this checkout; manifests remain unchanged. |
| Legacy scene output in active tests | tested | Current planner, math, drawing, end-to-end, export, cache, and browser tests use neutral synthetic inputs; no test imports retained Attention/math scene outputs. Full suite verified; tests check contracts and renderer plumbing only and do not make visual-quality claims. |
| Fresh source-generated live smoke | failed | A new 60-second photosynthesis source (not a fixture) replayed S1/S2, then first failed S3 because the model returned empty `section.conceptIds` twice. After a generic prompt revision to v3, S3 and S4 completed, TTS audio was produced, and live S6 planning began. Provider spend reached $0.119435816 against the $0.10 configured ceiling across 9 calls; the process was stopped after observing the overrun. Its `video.mp4` is not complete (`ffprobe`: `moov atom not found`), and no final run report exists. It is not visual-quality evidence. The source and run artifacts are under `/tmp/hypothesis-photosynthesis-source-20260924.md` and `.data/hypothesis-runs/claude/generated-20260924-retry1/photosynthesis-60s/`. |

Never substitute fixture or hand-authored-script results for generated-lesson results in these reports. They are permissible only for deterministic code regression checks. Every architecture-quality claim requires a completed source-generated timed video; a renderer preview, diagnostic fallback, or fixture-derived scene is ineligible.

Purpose: every architectural claim (ours or Gemini's) becomes an experiment with a pass/fail criterion. Nothing is called "better" without a number.

---

## 1. Golden set

| Set | Contents | Use |
|---|---|---|
| G-10 | Your 10 frozen lessons (attention, web request, zero-trust, gradient descent, induction, photosynthesis, immune, catalyst, inflation, bill→law) | Regression on every change |
| G-LONG | Your 4 long lessons (5-min) | Long-form timing, continuity, cost |
| G-DOC | 5 real uploads: paper section, textbook chapter, policy doc, product doc, formula-heavy notes | Generalization — the real test |
| SIMI-REF | 20–40 Simi keyframes tagged by template + 3 full Simi videos on overlapping topics | Style and design reference |

Rule: goldens are frozen and hashed. A change to a golden = new golden version, never an edit.

---

## 2. Deterministic gates (run on every video, zero cost)

| Gate | Rule | Fail action |
|---|---|---|
| G1 schema | Every artifact validates against its zod schema | Block |
| G2 placeholders | 0 unresolved elements in final render | Block |
| G3 overlap | 0 element bbox intersections (excluding declared containers/badges) | Block |
| G4 safe area | All elements within canvas minus 64 px | Block |
| G5 occupancy | Content bbox area / canvas in [0.45, 0.75] at scene end | Warn → block after week 2 |
| G6 font size | Rendered label height ≥ 32 px at 1080p | Block |
| G7 palette | Every fill in palette tokens; every stroke = style stroke | Block |
| G8 anchors | Every element has a resolvable anchor; anchor time inside scene | Block |
| G9 idle | No window > 2500 ms without a reveal or emphasis | Warn |
| G10 concurrency | ≤ 2 reveals running simultaneously | Warn |
| G11 sync | Last visual event ≤ audio end; video length = audio length ± 200 ms | Block |
| G12 element count | 2 ≤ elements per scene ≤ 9 | Warn |
| G13 label length | Labels ≤ 4 words | Warn |
| G14 license | Every asset's license in allowlist | Block |
| G15 cost | Actual $ ≤ ceiling for duration | Block (prod) / warn (dev) |

Implementation: gates read the LaidOutScene + Timeline + render log, not pixels — fast and exact.

---

## 3. Metrics (recorded per run, compared to previous run)

| Metric | Definition | Week-1 target |
|---|---|---|
| Rung distribution | % elements resolved at primitive / catalog / composed / text-box | text-box ≤ 25% of `object` elements |
| Semantic match | VLM judge: fraction of object elements whose visual depicts the label | ≥ 0.85 |
| Style coherence | VLM judge 1–5 per frame: "do all elements look like one illustrator made them?" | ≥ 4.0 |
| Teaching clarity | VLM judge 1–5 per scene given narration | ≥ 3.8 |
| Template diversity | Distinct templates per 1-min lesson | ≥ 3 |
| Occupancy | Mean content area share | 0.5–0.7 |
| Reveal-word lag | Median (reveal start − mention start) | −200 … +100 ms |
| Render speed | Video seconds / wall seconds | ≥ 3× |
| Wall time 1-min | Upload → MP4 | Record (Simi claims ~20–40 s) |
| Cost per video | Sum of API costs | ≤ ceiling |
| Cache hit rate | On rerun of unchanged input | ≥ 95% |

---

## 4. Experiments

Each experiment: hypothesis → setup → metric → pass criterion. Run on G-10 unless stated.

### E1 — Style parity (the look)
- H: A fully generated source-to-video run is stylistically indistinguishable from topic-matched Simi output while teaching its source-grounded mechanism.
- Setup: generate lessons through S1–S12 from frozen source inputs and current versioned architecture, then sample 10 timed frames from completed MP4s. Pair only with correctly attributed Simi frames for the same topic where available; otherwise mark the pair as style-only. Shuffle and scale to 480 px. Exclude renderer fixtures, hand-authored SceneSpecs/scripts, diagnostic fallbacks, and failed or incomplete videos from the quality sample.
- Judges: VLM (blind, "which frames come from the same product?") + 2 humans.
- Pass: each human's source classification accuracy is ≤ 60%; each human's mean style score is ≥ 4/5 both across the mixed set and on generated frames alone; VLM style coherence across the mixed set ≥ 4.

### E2 — Cards vs freeform
- H: Removing 168×132 cards increases perceived quality.
- Setup: take SceneSpecs from completed source-generated lessons and render the same scene data through old card mode vs new freeform mode. No hand-authored or fixture SceneSpecs enter the visual sample.
- Pass: freeform wins pairwise preference ≥ 80%.

### E3 — Normalization makes hybrid coherent
- H: Mixed-source assets after normalization are as coherent as a single source.
- Setup: use the same generated lesson scenes and candidate assets across 4 conditions — Iconify-only raw, Hybrid raw, Iconify-only normalized, Hybrid normalized. No fixture scenes or outputs are scored.
- Metric: style coherence per frame.
- Pass: Hybrid normalized ≥ Iconify-only normalized − 0.2. (Your earlier finding "mixing reduces coherence" should reverse after normalization.)

### E4 — Ladder thresholds calibration
- H: There exist τ_high/τ_mid that maximize semantic match without collapsing to text boxes.
- Setup: 200 concept→asset pairs labeled correct/incorrect by the VLM judge (spot-check 50 by hand); sweep thresholds.
- Output: precision/recall curve; choose τ_high at precision ≥ 0.9.
- Pass: chosen thresholds recorded in config with the curve in the report.

### E5 — Planner model A/B
- H: A stronger planner model produces diagrams (not entity lists) and is worth its cost.
- Setup: first compare planner models with the same prompt and catalog candidates. Then, on the best affordable model, compare prompt arms on identical frozen and held-out sources, narration, voice, duration, candidate catalog, renderer, and evaluation protocol: (A) zero-shot; (B) text-nearest experimental retrieval; (C) skill/mechanism-conditioned retrieval; (D) skill-conditioned retrieval with set-level coverage/diversity. The old hard-authored Attention/math fixtures are excluded from all arms. Keep dynamic arms behind an experiment flag until they beat zero-shot on held-out completed videos. Use training/evaluation-disjoint exemplars; store example IDs, hashes, provenance, selection scores, prompt version, and order for every run. Add an order-permutation check because demonstration order can affect results and may not transfer across models.
- Metrics: blind human teaching clarity and mechanism explanation on rendered timed video; factual/evidence coverage; relation transfer; visual semantic match; readability/style; list-scene and fallback rates; hard-gate failures; successful-video cost, tokens, and wall time. SceneSpec/schema quality is diagnostic, not the selection target.
- Pass: choose model + prompt arm by held-out human-judged video clarity per total successful-video cost, subject to factual, alignment, visual, and publish gates and the $0.10 one-minute ceiling. Do not promote an arm based only on schema validity, prompt self-score, or one topic.
- Exemplar policy: demonstrations teach DSL and visual reasoning patterns, not lesson answers. Retrieval should match pedagogic mechanism (cause→effect, compare, process chain, input→operator→result, trajectory, derivation), template/primitive need, and scene load; prefer a complementary set over redundant nearest neighbors. The target source and evidence remain the sole authority for factual claims. Any unsupported invented example must be marked `illustrative-example`.
- Controlled promotion (“agent learning”): no live self-modification or model-weight training is in scope. A generated example may enter a versioned bank only after human/judge review for correctness, evidence, visual quality, provenance, and held-out leakage; a reviewer approves a bank version, then a new offline E5 run measures it. Preserve rejected and prior versions.
- Anti-copy checks: alter target topic, labels, values, and relation graph while retaining selected demonstrations; verify no exemplar fact survives unless independently supported by target evidence. Verify missing evidence/alignment cannot produce a passed video.

### E6 — Wrong icon vs text box
- H: A labeled text box beats a wrong-but-resolved icon.
- Setup: collect 30 mismatches observed in fully generated lessons, then render each identical scene with (a) the mismatched icon and (b) a text box. Do not source the sample from historical hand-authored fixtures.
- Pass: text box preferred ≥ 70% → confirms "semantic correctness > coverage" and justifies strict τ.

### E7 — Font and roughness
- H: Clean strokes with a marker font are closer to Simi than rough.js hachure.
- Setup: apply 4 fonts × roughness {0, 0.5 fixed seed, 1.5 hachure} to 5 scenes extracted from completed source-generated lessons. Keep generated scene data identical across conditions.
- Metric: pairwise similarity to SIMI-REF by VLM + human.
- Pass: choose the configuration with highest similarity; expected winner roughness 0 or 0.5.

### E8 — Reveal sync
- H: Word-anchored reveals feel more "tutor-like" than proportional beat timing.
- Setup: use scenes from completed source-generated lessons; compare (a) old proportional timing and (b) word anchors on the same narration and aligned audio. Exclude fixture or hand-script timing.
- Metrics: reveal-word lag + human preference on 5 clips.
- Pass: median lag in target band; preference ≥ 70% for (b).

### E9 — Real documents (generalization)
- H: The pipeline produces valid, clear videos from unseen documents.
- Setup: G-DOC end to end.
- Pass: all gates pass; clarity ≥ 3.5; every failure categorized into the failure taxonomy (§6).

### E10 — Speed and cost
- H: 1-min video fits the $0.10 ceiling and a practical wall-time budget.
- Setup: cold run and warm run for 1/5/10 min.
- Report: per-stage time and cost table from `evaluation-bundle/v2`; time-to-first-playable-frame for player mode. Compute model/API cost from generated runs only. Renderer fixtures and hand-authored scripts may test code paths but are excluded from architecture-quality measurements and successful-video cost claims.
- Pass: cost ≤ ceiling; record wall time against Simi's claimed range.

---

## 5. VLM judge — prompts (fixed, versioned)

Use a capable vision model; cache by image hash + prompt version. Always ask for JSON.

**J-semantic (per object element)**
```
You see a small drawing from a teaching video. Without being told what it is,
name the object in ≤ 3 words. Then: does it plausibly represent "<LABEL>" in a
teaching diagram about "<TOPIC>"? Answer JSON:
{"named":"...", "represents": true|false, "confidence":0-1, "why":"≤15 words"}
```
Run blind first (named) then with the label — blind naming catches icons that only "fit" because the label tells you what to see.

**J-style (per frame)**
```
Rate 1-5 whether every element in this frame looks drawn by the same illustrator
(stroke weight, line style, fill palette, lettering). List up to 3 elements that
break the style. JSON: {"score":n, "offenders":[...]}
```

**J-clarity (per scene, frame + narration)**
```
Narration: "<TEXT>". Final frame attached.
1) Would a first-time learner understand the idea from this visual + narration? 1-5
2) Does the visual show the relationship/mechanism, or only list things? "mechanism"|"list"
3) One concrete improvement (≤20 words).
JSON: {"clarity":n, "type":"...", "fix":"..."}
```

**J-timed (per scene, chronological frames + aligned words)**
```
Three frames are sampled at chronological reveal times from the completed MP4.
The active aligned word at each timestamp and the scene narration are supplied.
Rate whether the board builds coherently, reveals support the spoken mechanism,
and important objects do not appear too early or late. Return JSON:
{"score":1-5,"sequenceCoherent":true|false,"mechanismVisible":true|false,"issues":[...]}
```

**J-simi (pairwise)**
```
Frame A and Frame B. Which looks more like a polished whiteboard explainer
(clean marker strokes, flat pastel fills, clear diagram, good use of space)?
JSON: {"winner":"A"|"B"|"tie", "reasons":["..."]}
```
Randomize A/B order; run both orders; count a win only if consistent.

Judge hygiene: calibrate on 20 hand-labeled items before trusting a judge; report judge-human agreement.

---

## 6. Failure taxonomy (every failure gets exactly one primary code)

| Code | Stage | Meaning |
|---|---|---|
| F-ING | S1 | Lost structure (equation, table, heading) |
| F-CON | S2 | Wrong/missing concept or relation |
| F-PED | S3 | Bad order, missing prerequisite |
| F-SCR | S4 | Narration wrong, too dense, or mentions missing |
| F-ALN | S5 | Mention timing wrong |
| F-LIST | S6 | Scene is a list where a mechanism was needed |
| F-TPL | S6 | Wrong template for the idea |
| F-META | S7 | Wrong metaphor chosen |
| F-GAP | S7 | No good asset — ended as text box where an object was clearly better |
| F-LAY | S8 | Overlap, crowding, tiny elements |
| F-TIM | S9 | Reveal too early/late, idle, clutter |
| F-STY | S10 | Style break |
| F-ENC | S11 | A/V sync or encode error |

The weekly report ranks codes by count × severity. That ranking *is* next week's backlog.

---

## 7. Report format (`harness/reports/<date>.md`)

1. Run config (git sha, model ids, prompt versions, catalog version).
2. Gate pass table per golden.
3. Metrics vs previous run (delta column, red if worse).
4. Experiment results with pass/fail.
5. Failure taxonomy ranking with 3 example frames for the top code.
6. Side-by-side strip: ours vs Simi for 5 matched scenes.
7. Cost + time table.
8. Decision: what changes next and why.

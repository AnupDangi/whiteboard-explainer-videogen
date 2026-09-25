# 02 — Implementation Plan

## Execution status (2026-09-25)

Statuses use `implemented`, `tested`, `passed`, `failed`, or `unmeasured`; these are evidence states, not estimates.

Current update supersedes the older DNS observations below. OpenRouter connectivity and authentication passed on 2026-09-24 through the authorized network path. The S3 normalization defects found in the 2026-09-25 takeover audit are fixed. After Task 14's documentation updates, `npm run typecheck:hypothesis && npm run test:hypothesis` passed with 349 Node tests and 17 Python tests. Task 11 and Task 14 provider measurements remain unmeasured unless their exact inputs and paid commands are approved.

| Work item | Status | Evidence / remaining work |
|---|---|---|
| Task 1: provider route errors, transport retries, validator exceptions | tested | `provider-transport.test.ts` covers typed no-endpoint/rate-limit failures, bounded transport retries, non-blocking no-dispatch accounting, and distinct validator errors. See the Task 1 HANDOFF entry for the full offline result. |
| Task 2: deterministic evidence quote anchoring | tested | `evidenceAnchor.ts` anchors exact, normalized, and unique relocated verbatim source quotes; paraphrase and ambiguous matches fail. Seven focused tests passed. |
| Task 3: sectioned prompt builder and schema-keyword guard | tested | `prompt/builder.ts` hashes named prompt sections; S2/S3 reject schema keywords as concept IDs. Six focused tests passed, including the recorded v12 byte-identity check before Task 4's recipe addition. |
| Task 4: visual recipe cards and S6 prompt v13 | tested | All templates have topic-neutral recipe cards; prompt/cache versions include `visual-recipes/v1` and v13. Four recipe tests passed; the zero-shot default remains unchanged. |
| Task 5: mechanism bank v4 | implemented | Ten structural examples extend bank v1 to cover all templates and key primitive families. Five tests pass; every entry remains experimental with reviews pending, and no retrieval arm has been promoted. |
| Task 6: deterministic scene-richness metrics | tested | `harness/sceneRichness.ts` and `__tests__/scene-richness.test.ts`; 4 focused tests passed and the full suite passed at 328 Node + 17 Python tests. This is structural diagnosis, not visual-quality evidence. |
| Task 7: diagnostic S6 opt-in with hard S5 failures preserved | tested | `--plan-despite-alignment-failure` is included in cache/config identity and leaves S5 hard failures and the failed run status intact; 3 focused tests passed. |
| Task 8: S6 prompt-arm calibration harness | tested | `scene:calibrate` reads cached S1–S5 artifacts and reports validity, failure codes, richness, and spend. Harness tests passed; no paid calibration measurement was run. |
| Task 9: deterministic SVG library ingest | tested | Six focused tests cover supported SVG normalization, ordering, license rejection, per-file rejection, and path limits. The CLI rejects paths escaping the library root. |
| Task 10: catalog registry and catalog version | tested | Three registry tests passed; current enabled registry remains Streamline-only. Catalog and embedding hashes participate in cache/run identity. |
| Task 11: user icon library | tested | User supplied a source (github.com/AnupDangi/Assest-Library) with its own `bridge-pipeline` export in chat. Ingested: assetlab-mit 195/214 accepted (19 rejected: 3 unknown-color, 15 no-ink, 1 bad-geometry, well under the 30% amendment threshold), assetlab-isc 13/13 accepted, assetlab-apache20 0/20 accepted (all no-ink, not enabled). `assetlab-mit` and `assetlab-isc` are now registered in `ENABLED_LIBRARIES` with `house: false`. Regression test passed; full suite passed at 350 Node + 17 Python. E3 (normalization coherence) and E4 (thresholds) remain `unmeasured` — icons are available but their visual quality has not been judged. See HANDOFF. |
| Task 12: cached query embeddings and lesson icon pins | tested | Five focused tests and the E2E replay checks passed; cache keys include the embedding model, and stable concept pins persist across scenes. |
| Task 13: cold S1–S4 reliability harness | passed | Two focused tests passed. User-approved paid run (`--durations=60 --repeats=3 --budget=1.00`, real spend $0.0663): S2 0.867, S3 (conditional) 0.231, S4 (conditional) 1.000, end-to-end 0.200 (3/15). Top failure code `plan-repair-failed` (10 occurrences) recorded in HANDOFF as the next bounded task, per the plan's own rule (end-to-end below 0.8). |
| Task 14: paid reliability and S6 measurements | tested | All three user-approved paid steps ran (total real spend $0.0824 of $2.30 authorized cap). Step 1 (reliability): see Task 13 row. Step 2 (diagnostic S6, 3 lessons, $0.0161): all three hard-failed before reaching S5/S6 (stage-cache correctly invalidated by Tasks 1–13's version bumps, so each ran S1–S4 fresh; ocean-tides failed S4 word-count, bicycle-balance and composting failed S3 plan-repair) — no diagnostic S6 SceneSpec was produced; `unmeasured` for that specific goal. Step 3 (scene:calibrate, 3 arms × 2 repeats × 14 scenes = 84 attempts, $0.00 real spend): 0/28 valid on every arm — 22/28 per arm hit `planner-call-failed` after transport-retry exhaustion (OpenRouter `HTTP 404 No endpoints found` for `anthropic/claude-sonnet-5`, region KTM — a previously-documented, still-live upstream routing issue, not a code defect; Task 1's no-charge classification held throughout, `spentUsd: 0`, `blocked: false` even under 198 preflight failures), 6/28 per arm hit `scene-context-invalid` on 3 `composting` scenes. No arm was or could be compared or promoted; zero-shot remains the default. See HANDOFF for full breakdown. |
| OpenRouter connectivity and authentication | passed | An unauthenticated HTTPS HEAD to `/api/v1/models` returned HTTP 200. A minimal authenticated `qwen/qwen3.8-flash` chat request returned HTTP 200 with `max_tokens=4`; visible `content` was empty, so this proves route/authentication only, not usable structured JSON. Both successful requests used authorized network access outside the default sandbox, whose DNS lookup still fails. No secret was printed or copied. |
| Current S2/S3 provider-backed run | failed | A fresh 60-second Markdown input under `.data/hypothesis-runs/claude/continuation-20260924/lessons/photosynthesis-source-fresh-20260924/` used Qwen with cold cache: S2 completed after one repair; S3 failed after one repair; S4 was not called. Four responses used 20,571 prompt tokens, 11,731 completion tokens, $0.0075701, and about 158 seconds of stage time. S2 emitted 14 concepts, 17 relations, and 11 prerequisites, too broad for 60 seconds. Raw responses and route metadata are preserved in `lesson-prep.json`. This run predates the 2026-09-25 S3 fix below and has not been repeated against the corrected code. |
| S3 normalization integrity fix (2026-09-25) | passed | `canonicalize()` in `plan/stages.ts` no longer overwrites/synthesizes `section.contract` or recomputes `requiredRelations` from the graph, and no longer strips single-use `lessonBible.terminology`. `validate()` now runs `analyzeTeachingPlan`/`teachingContractProblems` against the model's raw output before any mutation, so an omitted SceneContract or an unsupported relation is a real hard failure consumed by the one-repair cycle, not silently repaired. `S2-concepts`/`S3-teaching-plan`/`S4-narration-script` now carry real `stageVersion` strings in `pipeline/lesson.ts` (S3 bumped to `S3-teaching-plan-v2-raw-validate`), invalidating any stale warm cache from the old normalizer. Retry-ownership audit: provider/network failures and semantic/validation failures are correctly separated (only the latter consumes the one repair); an exception thrown inside `canonicalize`/`validate` itself would surface as a generic `stage-threw` exception rather than a distinct code-bug category — a real but narrow gap, left open for a later phase since fixing it touches the frozen `structuredCall` repair mechanism. |
| Canonical anti-hardcoding rules and AGENTS pointer | implemented | Root `CLAUDE.md`; runtime content boundary, evidence provenance, frozen-output and fallback rules. |
| Baseline inventory and hashes | implemented | Frozen v1 retains 40 files. Corrective `harness/baselines/manifest.v2.json` hashes 77 reference videos/frames and retained run artifacts with run-class provenance; G-10, G-DOC, and G-LONG remain incomplete or missing. |
| Typecheck and offline implementation suite | passed | `npm run typecheck:hypothesis` exits 0. `npm run test:hypothesis` now passes the full Node suite (294 tests: the prior 290, plus 4 new `contracts.test.ts` cases, no existing test modified) and 17 Python tests (15 prior + 2 new CTC regressions) run to completion and pass. Offline tests are code behavior evidence only; no live provider call is part of this suite. |
| S3 prompt calibration harness (2026-09-25, updated 2026-09-26) | passed | `harness/planCalibration.ts` + `plan:calibrate` CLI measures named S3 prompt variants against real cold calls on 5 fixed non-G-10 sources, sharing one cached S2 graph per source per variant for a fair A/B. First measurement (N=3×5, qwen/qwen3.8-flash): `v3-baseline` 0/15 (0%), `v4-explicit-concepts` 6/15 (40%) — `harness/reports/2026-09-24-plan-calibration.md`. **Second round (2026-09-26)**: a `reliability:run` on this plan's own new evidence-anchoring/keyword-guard code measured S3's conditional pass rate at only 0.231, worse than the 40% baseline. Root-caused from real raw model output (systematic-debugging Phase 1-4): the model emitted `lessonBible.terminology: []` and every section's `requiredRelations: []` on both the initial attempt and the repair — v4's worked example never showed `terminology` filled and only showed a trivial 1-relation case. `v5-fully-worked-example` (fuller worked example, same rules text) measured `v4` 7/15 (47%) vs `v5` 8/15 (53%), cheaper and fewer failures — `harness/reports/2026-09-25-plan-calibration.md`. Modest, noisy result on a small sample; adopted per this harness's established practice. `v5-fully-worked-example` is now `DEFAULT_PLAN_PROMPT_VARIANT`; S3 cache identity bumped to `S3-teaching-plan-v5-fully-worked-example`/`S3-teaching-plan-prompt-v5`. `plan/contracts.ts` gained a real per-rule failure-code taxonomy (`teachingContractFindings`) alongside the unchanged string-only `teachingContractProblems`. `buildConceptGraph`'s `maxTokens` is now scaled from its own capacity numbers instead of a flat 4000, fixing an observed mid-object truncation. Remaining gap: a real end-to-end `reliability:run` re-measurement under v5 has not yet been done — the plan-calibration numbers above are the adoption evidence, not a confirmed end-to-end rate. |
| Long-form (5/10/30/60 min) | unmeasured | Confirmed unimplemented: no `section-parallel`/`long-form` path exists; `plan/stages.ts` caps `maxConcepts` at 14 regardless of duration. Live 5-minute and 10-minute attempts failed at S2 before that cap could be evaluated. |
| RAG | unmeasured | Confirmed unimplemented: `RAG_ENGINE`/`rag-engine` is not referenced by this pipeline; the sibling directory is a separate, unrelated single-file service. |
| Local embedding model initialization retry | tested | A retrying lazy loader deduplicates concurrent initialization, clears a rejected load, and memoizes the subsequent success. The regression injects a transient failure without downloading a model; actual MiniLM loading and semantic retrieval remain unmeasured in this environment. |
| Skip S6 prompt compilation and paid calls when S5 has hard alignment failures | tested | A fresh source-generated photosynthesis cache replay reused S1–S5; all three hard zero-duration words remained. Logs show no prompt compiled, zero provider responses/calls, $0.00 spend, and three local diagnostic fallbacks. Run remained failed; invalid alignment also blocked captions and MP4 output. No output frames or legacy fixtures were inspected. This verifies code-path behavior, not visual validation. |
| S5 calibration source | unmeasured | The prior 36.5 ms value is retained in `calibration.v1.withdrawn.json` for history, but withdrawn because its scratch clips/per-sample data are unavailable and it only covered utterance edges/pauses. Runtime now loads `calibration.v2.json` with explicit `unmeasured` status and null metrics; a live run may collect diagnostic audio but receives a hard S5 calibration failure and cannot publish. On 2026-09-25, 3 new independent source-generated narrations were produced (`ocean-tides`, `bicycle-balance`, `composting`, under `.data/hypothesis-runs/claude/phase0-live/`) and all reproduce the zero-duration stable-ts defect, plus a fully packed 3-source/436-word blind review is ready at `.data/alignment-review-pack-20260925/` — still `unmeasured` because it needs two human reviewers, which cannot be supplied by an agent. |
| S5 blinded human word-boundary review | implemented | `word_boundary_review.py` accepts only provider-generated S1–S4 provenance with exact narration/alignment words and source-run-matched audio. Reviewer pages contain audio/waveform and transcript, not candidate timestamps or aligner labels; the sealed organizer key is separate. Two complete independent votes are required. Duplicate SourceDoc hashes are rejected; a one-source pilot remains `pilot-only-unmeasured`. Synthetic tests cover pack blinding, generated-only eligibility, duplicate-source rejection, vote validation, reviewer agreement, candidate scoring, and the three-source/100-word threshold. A real 3-source/14-item/436-word pack now exists at `.data/alignment-review-pack-20260925/` (two blinded participant pages ready), clearing the measurement-eligibility gate for the first time — still no human annotations exist. |
| S5 CTC diagnostic tool (`compare_aligners.py`) bug fix | passed | `ctc_target` matched transcript characters by raw dictionary membership, so a literal hyphen in an ordinary word (e.g. "self-balancing") coincidentally matched the CTC blank label's string (`"-"`, index 0) and was emitted as a real target ID, which `torchaudio.functional.forced_align` always rejects. Fixed by restricting target extraction to `char.isalpha()`. Two regression tests added to `test_align.py` (repeated-adjacent-letters need no special handling per torchaudio's own documented allowance; a hyphenated word never emits the blank label). First clean stable-ts vs CTC comparison on a new independent source (`bicycle-balance-60s-mixed`): stable-ts 3 zero-duration words / median 39.8 ms error; CTC 0 zero-duration words / median 42.4 ms error. All 17 Python tests (15 prior + 2 new) pass. |
| S5 model-size diagnostic | tested | On one fresh source-generated three-scene lesson (126 aligned words), stable-ts `fast_mode=True` produced 4 zero-duration intervals with base, 2 with small, 4 with medium, and 5 with base.en. One source is insufficient to select a model or transfer the 36.5ms calibration; base remains unchanged and small is a follow-up candidate only. |
| S5 stable-ts option diagnostic | tested | On the same source-generated 126-word lesson, disabling silence suppression retained all 3 zero-duration words; `token_step=150` matched defaults (3 zeros; VAD-boundary median/max 49.05/325.31 ms), while `token_step=50` worsened to 6 zeros and 54.05/395.31 ms. No option was adopted; this is one source and utterance-boundary VAD is not word-level ground truth. |
| S5 local TTS voice diagnostic | tested | Re-synthesized the exact S4 narration from one source-generated photosynthesis lesson with installed Piper `en_US-lessac-medium` and aligned with stable-ts base. Piper had 2/42, 2/42, and 3/42 zero-duration intervals across its three scenes (7 total); the existing Supertonic run had 3/42, 0/42, and 1/42 (4 total). Both preserved all words and monotonic starts. One lesson and zero-duration counts do not establish word-level timing or naturalness; keep the current voice and hard alignment gate unchanged. |
| Independent CTC aligner candidate | tested | The generated-run-only comparator reports stable-ts and torchaudio English Wav2Vec2 CTC against independent 5 ms RMS utterance boundaries. A new optional ASR consistency check in comparison v2 transcribed all 126 S4 words exactly across the same source-generated lesson, including all three words stable-ts assigned zero duration. CTC produced 0 zero intervals vs 3 for stable-ts; boundary median/max were 39.49/152.75 ms vs 49.05/325.31 ms. ASR is the same faster-whisper model family used by stable-ts and proves lexical recognition only, not word boundaries. One lesson, interior-word truth, multilingual coverage, broader calibration, and live cost remain unmeasured; stable-ts is unchanged and S5 still hard-fails. |
| S5 measured timestamp precision | tested | Stable-ts fractional-millisecond word boundaries are preserved through the sidecar rather than rounded independently; live alignment cache version bumped to invalidate old rounded results. A Python regression checks distinct submillisecond boundaries. Exact zero-duration words still hard-fail. A fresh local alignment of source-generated scene audio preserved fractional boundaries but still returned three exact-zero word intervals. stable-ts `fast_mode=True` retained the same zeros; dropping instant words would omit spoken text, so the live pipeline records them as S5 hard failures. |
| Generic renderer mechanics and readability gates | tested | Layout/readability behavior is covered by deterministic code checks. Historical hand-authored scenes are archived only and are excluded from quality evaluation. The earlier Simi token-strip comparison is invalid because `simi-scene01.png` shows photosynthesis; the Attention reference is a different video. No generated-video visual acceptance exists. |
| Text sizing from rendered glyph widths | tested | S7 uses resvg ink bounds for box, pill, token strip, meter, matrix, formula fallback, object and text intrinsic widths; S10 fits scene titles and text-box labels from the same measure. Kalam Bold is now bundled under its SIL OFL 1.1 notice and loaded with system fonts disabled for both measurement and MP4 rasterization. The browser player serves and awaits the same font before drawing. Resolver/layout/render cache versions were bumped. The measurements remain ink bounds rather than OpenType advance metrics; generated-video quality and C6 acceptance remain unmeasured. |
| Bundled display-font provenance and renderer parity | tested | The bundled Kalam Bold asset is identified by SHA-256 `2f6576601db015d4f6c08678120277fc8510b98c06e932ce7a6a9cbff4cbdded`; the upstream Kalam metadata identifies Indian Type Foundry and SIL OFL 1.1. The same font bytes are used by resvg text measurement, worker MP4 rasterization, and the browser preview route. Font hash participates in layout/render/MP4 cache keys and run/config identity. Synthetic renderer tests verify the hash, font loading, glyph bounds, and browser asset route. This establishes code-path consistency only, not C6 or visual quality. |
| Hard-failure run status | implemented | Runs with hard failures are `failed`; clean runs remain `draft` until a judge passes and the caller explicitly attests evidence/alignment completeness. |
| Captions sidecar | implemented | Live run emits WebVTT from measured word timing; empty/malformed caption source fails the stage. Not muxed into MP4. |
| Topic/label/value anti-hardcoding test | tested | Generic-template perturbation checks changed labels/numbers; a synthetic cross-topic S6 test retains the template and selected exemplar while changing labels, values, and the source relation. Copied text/numeric facts fail unless independently supported; a copied relation type must match the target source graph. The procedural icon seed catalog no longer routes topic-only associations such as photosynthesis to a leaf icon; indirect topics fall through to labeled text. Unit mismatches fail; percent values may support their normalized 0–1 meter equivalent. |
| Content-sensitive run identity | tested | Run ID/input hash changes when scene data changes with the same case ID and render/model settings. Cache mode and output directory do not alter content identity. Fixture stages and provider-backed S2–S4/S6 outputs resume by content hash; full live run resume remains open. |
| Source-generated benchmark isolation | tested | `goldenForRun` never loads a golden target for `runClass: generated-lesson`, even when a source ID or filename collides with a frozen case ID. Golden claims/duration scoring remain limited to non-generated benchmark/script runs. A regression covers both `photosynthesis` and `transformer-attention` collisions; no source-generated output was rendered or scored. |
| E1 topic/reference identity | tested | Matched Simi comparison now requires the explicit topic to match the extracted SourceDoc title and versioned reference map. Case IDs and source filenames cannot make an unrelated generated lesson appear topic-matched. Untitled or mismatched source documents remain ineligible for topic-matched scores; style-only review remains available. |
| Generic input golden scoring | tested | Unknown IDs no longer receive a fabricated empty golden; no golden duration score is applied. |
| SourceDoc source offsets and exact-quote evidence through ConceptGraph → SceneSpec planning | tested | Source spans preserve Markdown, table, equation, figure-reference, PDF page and office structure. SourceDoc v2 carries extractor-authored PDF page, PPTX slide, and DOCX body paragraph/table locators into resolved S2 citations and S6 context; visible source text that resembles a generated `Page N`/`Slide N` heading cannot override those locators. Planner rejects altered native locations as well as missing/forged references. DOCX block ordinals identify XML body positions but are not durable XML IDs. S1 stage/prompt versions invalidate prior locator inference. Claim attribution remains section-coarse, and no real generated lesson has yet passed this chain. |
| S1 PDF/DOCX/PPTX/Markdown/text intake | tested | CLI extracts PDF pages with `pdftotext`, DOCX paragraphs/headings/tables/figure descriptions, and PPTX slides/tables in numeric order. PDF/PPTX extractor-generated character ranges bind spans to actual page/slide numbers, including blank PDF pages; spoof-heading regressions prove visible document text cannot change those locators. Textless/scanned PDFs fail with an OCR-not-enabled error. DOCX mixed runs preserve inline equations within prose and isolate display equations into equation spans. This remains text extraction: OCR, embedded figure pixels, full equation fidelity, and source-native byte locations remain unimplemented. |
| Relation transfer and missing-mention failures | tested | Generated scenes must represent every S2 relation through concept-linked visual endpoints, with evidence matching the exact relation; omitted/forged links fail. Absent narration mentions fail alignment resolution. An incomplete schema-safe fallback is retained for diagnosis but carries a hard gate; generated-run quality is not measured. |
| S6 relation-context contract equality | implemented | The code-compiled scene context rejects missing, duplicate, or unrelated source relations unless its scene-local relation set exactly equals `SceneContract.requiredRelations`; this fails before prompt compilation/provider spend. Synthetic contract tests cover all three mismatches. No visual or fixture output is used as evidence. |
| S10/S11 deterministic renderer export and bounded raster worker pool | tested | Shared SVG renderer → worker-thread resvg → ffmpeg emits a decodable MP4 in the offline code-path check. Live S11 now writes to a unique partial filename and atomically renames only after ffmpeg succeeds, so interrupted encodes cannot leave a final-path MP4. A parity check compares `frameSvgAt` with `renderSVG`. Browser playback and seek were checked separately on a renderer regression input; generated audio/video sync remains unmeasured. |
| Browser player using the hypothesis renderer | tested | `npm run preview:hypothesis -- <run-directory> [port]` serves a local player that uses the shared `frameSvgAt` renderer path and waits for the bundled Kalam font. In-process route tests use neutral synthetic scenes and verify font serving, status preservation, and route restrictions. No old hand-authored fixture is used as current visual evidence; real generated-run audio/VTT synchronization and playback remain unmeasured. |
| Content-addressed artifacts and warm resume for offline S4/S5/S7–S10 fixture stages | tested | Typed cache keys include upstream payload/input hashes and stage/schema/prompt/model/catalog versions. End-to-end test proves 14 warm hits and verifies changed narration invalidates S4/S5 dependencies. |
| Live generated-stage cache for S2–S4 and S6 | implemented | Lesson CLI stores typed, content-addressed validated results; keys include source/graph/plan/planner input, explicit stage/prompt/schema/model/catalog versions. Warm hits zero current-run usage and retain the original response artifact. Cold/warm paid-provider replay is unmeasured. |
| Persistent budget ledger | tested | Shared across S2–S4 and S6 per lesson/case output directory; serializes provider calls and records actual returned cost. Each request receives the minimum of its remaining stage allowance and persistent lesson allowance under the ledger lock; OpenRouter `provider.max_price` ceilings are computed from that true allowance, prompt UTF-8 size, and max output tokens. Every attempt records the requested per-token ceiling plus OpenRouter's selected model/provider and actual per-attempt token/cache/cost usage when supplied. Missing or invalid prompt/completion token counts or `usage.cost` now fail the structured call; with a durable ledger, a dispatched response without billing data blocks further calls as uncertain rather than recording $0. The ledger verifies actual returned cost and blocks future requests after an overrun; reads reject spend above the cap while marked unblocked. Before run finalization, durable cumulative spend must cover the current run's non-cached provider-stage costs (it may also include earlier attempts); invalid or under-recorded spend becomes a hard run failure. Unknown provider errors, inconsistent spend records, and abandoned locks fail closed; known pre-dispatch DNS/connection errors are logged without charge/block. Synthetic tests verify shared allowances, measured overruns, cumulative spend, route metadata capture, missing billing usage, and cached-cost exclusion. Live billing/cap behavior remains unmeasured. |
| First generated-lesson live smoke | failed | Capped 30-second run using `docs/ARCHITECTURE.md` stopped at S2 with `fetch failed`; no model output, plan, script, TTS, or video. The run summary records $0 returned cost / 0 returned calls; its pre-change ledger remains blocked and untouched. A later unauthenticated connectivity probe failed DNS with `ENOTFOUND`. No generated-quality claim. |
| Live stage cache: S1–S12 processing stages | tested | Source intake, concept/plan/script, TTS/alignment, planner, resolve/layout/timeline/render, MP4 encode, and captions have typed stage artifacts. S11 stores a content-addressed binary blob and materializes it into each run directory; a missing blob triggers regeneration in warm mode and fails closed in replay mode. Synthetic regression covers warm materialization and repair. Final evaluation/publish decision is recomputed from current gates. End-to-end live warm replay and full invalidation remain unmeasured. |
| Live stage and gate ledger | implemented | `evaluation-bundle/v2` records S1–S12 duration, invocation spend, cached artifact spend when known, cache state, fallbacks, failures, per-scene Claude/shared gate results, and final publish decision. `lessonCli` includes the records in generated-run summaries. Typecheck passes; live values remain unmeasured without a successful generated run. |
| Complete S1–S12 live stage DAG and resume | implemented | All named data-processing stages have content-addressed artifacts across the generated and fixture paths; publish status is recalculated and never cached as a pass. Full-stage cold/warm live validation remains unmeasured. |
| S3 LessonBible + SceneContracts | tested | The teacher prompt now explicitly asks for identical, nonempty graph concept IDs in every section and SceneContract, with an exact ID checklist; prompt/cache version is v3. Empty/mismatched generated sections remain hard failures. A fresh source-generated photosynthesis run initially failed after repair with empty section IDs; after the prompt change S3 and S4 completed on retry. This is one successful stage observation, not evidence of visual quality or complete lesson success. |
| S1–S6 source lesson integration and warm resume | failed | A neutral test transport previously traversed S2, S3, S4, and zero-shot S6, and warm S2–S4 cache replay made no provider calls. The latest S3 normalization breaks the S1–S4 integration test: an otherwise valid plan gets a soft warning, and relation omission is rewritten before its expected hard gate. That specific earlier test claim is withdrawn until the current code passes. Provider connectivity passed; no complete provider-generated S1–S6 lesson exists. |
| Fresh source-generated S5 v2 end-to-end check | failed | S1–S4 warm hits; S5 artifacts regenerated and recorded three zero-duration intervals as hard failures. S6 network fetch failed in all three scenes ($0 reported spend); total 13 hard failures, 3 fallbacks. S11 produced a technically valid ~60s H.264/AAC diagnostic MP4 verified only with ffprobe; no frames/video inspected or scored. C6/E1/E5 remain unmeasured. |
| S6 deterministic prompt compiler | tested | Generated scenes compile a typed context from S3 contract, S4 narration, S5 measured mentions, evidence, previous board, available template slots, and only catalog candidates above the current minimum similarity threshold. Prompt v12 retains explicit `prim` guidance, multi-span evidence validation, exact citation locations (including PDF page/PPTX slide where available), repair guidance to retain evidence for each linked concept and remove unsupported numbers, and a 6,000-token structured-output allowance. The compiler rejects concept context that does not exactly match `SceneContract.requiredConceptIds`, missing/extra/duplicate relation context, and concept/relation citations absent from the scene evidence set before provider spend. The same serializer records exemplar intent, SceneSpec, rationale, and provenance in prompt/hash data; retrieval score is included as hash metadata. The versioned threshold policy affects context, cache keys, run ID, and config hash; E4 calibration remains unmeasured. Exact prompts, hashes, ordered exemplar IDs/scores, and versions are in the typed cache payload/log; warm replay preserves the audit payload. Fresh source-generated scene planning began but did not complete a valid video. |
| Multi-concept source-evidence validation | tested | S6 titles/elements linked to multiple concepts can cite separate exact source spans; every citation must still resolve to the source and each concept must have at least one matching citation. Regression covers valid two-span transfer and rejection when one linked concept loses its evidence. |
| Fresh source-generated Qwen retry after S6 changes | failed | Reused cached S1–S5 from the generated photosynthesis run; all three S6 calls failed at network fetch before receiving provider output ($0 reported spend). The prior generated run's MP4 was a failed diagnostic artifact with planner and zero-duration alignment/caption hard failures; it was not visually inspected or scored. C6/E1/E5 remain unmeasured. |
| S6 old fixture boundary | tested | The five old Attention/math examples are absent from runtime prompts and E5 arms. They remain archived historical fixtures only. New generated runs default to zero-shot; the prompt forbids copying experimental example facts and escapes target data. |
| Dynamic few-shot / prompt-selection experiment | implemented | Versioned cross-domain experimental bank and deterministic `text`, `mechanism`, and `diverse` retrieval arms exist; zero-shot is the control. Ranked/reversed demonstration order is available for E5 and recorded in context/cache/run identity. `--stage-cache` lets different output dirs reuse identical S1–S5 artifacts; run manifests record treatment versions and audio hash, and the E5 pair gate rejects mismatched source/narration/audio/voice/render settings or non-generated inputs. Retrieval treatments fail before TTS/provider work unless run provenance is `generated-lesson`, the source document and every schema-valid contract/bible exist, and no SceneSpec is hand-authored. Old hard-authored fixtures are excluded. Bank v3 requires each exemplar's evaluation split and excludes all golden-derived, development/test, target-source/lesson, lexical near-duplicate examples, and any exemplar with a failed factuality, visual, license, leakage, or human review (rank version v2; Jaccard threshold 0.72). The duplicate test is lexical, not semantic. Bank records provenance and five explicit review states; approval fails closed without all five passes, an identified reviewer, and a timestamp. Entries remain pending/experimental; E5 held-out video quality remains unmeasured. No automatic exemplar promotion. |
| E5 blinded timed-video human review tooling | implemented | `judge:e5:human:pack:hypothesis` requires a versioned held-out source set, exact case ID + SourceDoc hash membership, judge-eligible generated-run pairs, and the matched E5 contrast gate before copying MP4s into independently randomized A/B participant packs; only opaque filenames/IDs reach reviewers. The sealed key records orientation, prompt/model treatment, and successful-video API cost represented by the stage ledger. `judge:e5:human:hypothesis` validates two complete independent vote files and reports individual/aggregate clarity, mechanism explanation, factual-concern rate, preference share, and successful-video cost by treatment; it never auto-selects a winner. Synthetic tests verify holdout membership, counterbalancing, controlled model/prompt contrasts, vote completeness, and scoring. No frozen E5 held-out source set or real pack/vote exists; held-out generated-video quality remains unmeasured. |
| E4 catalog threshold calibration evaluator | tested | `catalog:e4:calibrate` validates the versioned concept–asset dataset, requires at least 200 unique source-grounded pairs and 50 human-adjudicated labels, records VLM/human agreement, sweeps the complete cosine-threshold curve, and selects only where icon precision ≥0.90 and overall semantic match ≥0.85. It never edits runtime thresholds. Synthetic contract tests pass; no real labeled E4 dataset exists and τ values remain uncalibrated. |
| Diagnostic fallback publish integrity | tested | Prior hard planner failures and the fallback marker remain hard, even when a renderable list preview is produced. Preparation hard failures stop the live lesson. |
| Visual stage versions in cache and run identity | tested | S7 resolver, S8 layout, S9 timeline, and S10 render now have explicit algorithm versions included in cache keys, run IDs, and config hashes. The latest fixture manifest contains distinct versioned keys for all four stages; unchanged-source warm reuse and live source invalidation remain unmeasured. |
| Measured icon calibration result | unmeasured | τ values are starting thresholds; no real 200-pair labeled E4 sweep or 50 human checks exist. The offline evaluator is implemented/tested, not calibration evidence. |
| C1–C6 and E1–E10, including blinded human E1 | unmeasured | No result is claimed until matched, completed source-generated videos, judges, and a report exist. The 2026-09-24 live photosynthesis attempt is incomplete and over budget, so it is ineligible for visual acceptance. E5 includes few-shot and dynamic retrieval arms, order sensitivity, leakage controls, held-out evaluation, and reviewed exemplar-bank promotion. |
| RAG, cost targets, complete 5/10/30/60-minute runs | unmeasured | Explicitly deferred until visual validation passes. |

Execution order: correct reference attribution and preserve baselines → implement source-grounded S3 contracts and code-owned S6 context/prompt compilation → prove generic renderer C6 across topics → run matched C1–C6/E1–E10 on complete videos → only then integrate RAG and long-form work. C6 remains the first **visual acceptance** gate; implementing prompt infrastructure before that gate does not imply it passed. This supersedes the day-by-day order below where they conflict.

Build order principle: deterministic renderer mechanics can be checked with synthetic inputs, but visual quality is assessed only on fresh source-generated, timed videos. Do not reuse or re-render the historical Attention/math fixtures as evidence that the planner or output quality is improving. If a future generated run is visually weak, improve the generic renderer, visual grammar, or planning contract without adding lesson-specific branches.

---

## Day 0 — Spikes and baseline (half day)

Goal: every dependency proven in 20-minute spikes before you build on it.

| Task | Output | Done when |
|---|---|---|
| Run spikes S-1 … S-8 from file 04 | `spikes/` folder with passing scripts | Each prints its success line |
| Freeze baseline | Copy 10 lessons + current metrics from `visual-system-benchmark` into `harness/goldens/` | `baseline/summary.json` exists |
| Collect Simi references | 20–40 Simi keyframes, tagged by template (hub_spoke, convergence…) | `harness/reference/simi/*.png` + `index.json` |
| Hand-write 3 SceneSpecs | "Why Attention", "Query Meets Keys", "Blending the Values" as DSL JSON | Validated by zod schema |

---

## Day 1 — Renderer core (the look)

Build `s10-render` with no LLM involved.

1. `style/tokens.ts` (copy from file 01 §5).
2. Primitives: `box`, `pill`, `tokenStrip`, `operator`, `meter`, `arrow`, `text`, `bracket`. Each primitive returns `{ paths: StrokePath[], fills: FillShape[], texts: TextRun[], bbox }`.
3. Text: layout widths use resvg-rendered glyph bounds; uppercase labels remain SVG text. Converting text into glyph paths with OpenType remains unimplemented.
4. `renderFrame(laidOutScene, timeline, t): string` — pure function returning SVG.
5. Reveal functions (below).

```ts
// reveal.ts — stroke draw-on for any path
export function strokeReveal(d: string, length: number, progress: number) {
  const p = Math.min(1, Math.max(0, progress));
  return `<path d="${d}" fill="none" stroke="${STYLE.stroke.color}" stroke-width="${STYLE.stroke.width}"
    stroke-linecap="round" stroke-linejoin="round"
    stroke-dasharray="${length}" stroke-dashoffset="${length * (1 - p)}"/>`;
}

// text / formula wipe: clip rect grows left→right
export function wipeReveal(id: string, bbox: BBox, progress: number, inner: string) {
  const w = bbox.w * Math.min(1, Math.max(0, progress));
  return `<clipPath id="c_${id}"><rect x="${bbox.x}" y="${bbox.y - 8}" width="${w}" height="${bbox.h + 16}"/></clipPath>
          <g clip-path="url(#c_${id})">${inner}</g>`;
}
```

**Acceptance (Day 1):** the 3 hand-written scenes rendered at hand-placed coordinates as single PNG keyframes sit next to Simi's frames and a person cannot tell style apart at thumbnail size (E1 in file 03).

---

## Day 2 — Layout + templates + timeline + video

1. Implement templates: `title_card`, `hub_spoke`, `chain`, `convergence`, `fan_out`, `list_icon`, `weighted_blend` (the 7 used most in the Simi frames). Remaining 5 on Day 6.
2. Solver: slots → measured sizes → overlap push → occupancy scale.
3. Timeline compiler from anchors. For now, anchors use a fake uniform word clock.
4. Encode: resvg worker pool → ffmpeg stdin → MP4, 30 fps.

```ts
// encode.ts — no per-frame process spawn
const ff = spawn(ffmpegPath, ['-y','-f','image2pipe','-framerate','30','-i','-',
  '-i', wavPath, '-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-c:a','aac','-shortest', out]);
for (let f = 0; f < totalFrames; f++) {
  const svg = renderFrame(scene, timeline, (f / 30) * 1000);
  ff.stdin.write(new Resvg(svg).render().asPng());   // move to worker pool once it works
}
ff.stdin.end();
```

**Acceptance:** "Query Meets Keys" renders as a 20 s MP4 with draw-on animation, no overlaps, occupancy in band. Render speed recorded (target: ≥ 3× realtime on your laptop after worker pool).

---

## Day 3 — Catalog v0 + normalizer + ladder

1. Normalizer (file 01 §4.2) with svgo + path classification + restyle.
2. Seed catalog: 150 concrete objects from **stroke-based Iconify sets with permissive licenses** (filter by `info.license` in `@iconify/json`; Lucide and Tabler are strong candidates). Add Streamline assets only if your plan's license permits use in rendered videos.
3. Embeddings for catalog entries (local MiniLM via `@huggingface/transformers`, zero API cost).
4. Ladder: catalog exact/alias → embedding ≥ τ_high → compose(base + badge) → styled text box.
5. Badges: 13 small glyphs drawn as primitives (✓ ✗ ? ! $ ⚠ ↑ ↓ ⏱ lock ★ + −), attached at top-right of base object.

**Acceptance:** zero placeholders across the 10 golden lessons; rung distribution recorded; E3 (normalization coherence) passes.

---

## Day 4 — Voice + word alignment + scene planner v1

1. S5: keep Supertonic. If it doesn't emit word timings, add forced alignment (see file 04 S-6). Output `AlignedAudio` with mention times.
2. S4 script format with `[[id|spoken words]]` mentions. Strip markers before TTS; keep char offsets to map mentions → word indices.
3. S6 planner: prompt (file 01 §3.3), few-shots = your 3 hand-written scenes + 6 more you write for other templates, catalog candidates injected, zod validation, one repair call, deterministic fallback.
4. Run the planner with **two models** (your current flash model and one strong model) on the 10 goldens. Store both.

**Acceptance:** 100% of scenes schema-valid after repair/fallback; every element anchored; E5 (planner model A/B) run and scored.

---

## Day 5 — Wire the DAG + gates

1. `runner/dag.ts`: explicit stage graph, content-addressed cache (`hash(input, modelId, promptVersion, schemaVersion)`), resume from any stage, frozen inputs hashed at start.
2. `runner/budget.ts`: global persistent counter (file or Redis) — replaces per-process `maxLive`.
3. `s12-gates`: all deterministic gates from file 03 §2.
4. Single entrypoint: `engine run --input doc.pdf --duration 60 --out out/`.
5. Delete dead twins: `providers/*.ts` stubs, fake `references/iconify-index.json`, old `generate-benchmark-data / freeze-plan / render-outputs` scripts.

**Acceptance:** one command produces MP4 + report for any golden; rerun is ~all cache hits; a forced failure in S7 is reported by gates, not swallowed.

---

## Day 6 — Real documents + remaining templates + math

1. S1 ingest for PDF/DOCX/MD (start simple: text + headings + equations; figures later).
2. S2 + S3 on 5 real uploads (a paper section, a textbook chapter, a policy doc, a product doc, one with heavy formulas).
3. Remaining templates: `compare_2`, `threshold`, `layered_stack`, `cycle`, `formula_focus`.
4. `formula` primitive via MathJax → SVG, wipe reveal.

**Acceptance:** 5 real-document videos generated end-to-end with gates passing; failures logged with stage + reason.

---

## Day 7 — Side-by-side evaluation and decision

1. Run E1–E10 (file 03). Produce `harness/reports/week1.md`.
2. Blind comparison: 10 Simi frames + 10 yours, shuffled; judge (VLM + you + one other person) rates style and clarity.
3. Decide next week's focus from the data: planner quality, catalog breadth, or renderer polish.

**Week 1 exit criteria:** style parity on E1 ≥ 80% "can't tell / ours equal"; placeholders = 0; semantic-match ≥ 0.85; every golden under cost ceiling.

---

## Weeks 2–3 — Hardening (quality loop)

| Track | Work | Metric to move |
|---|---|---|
| Planner | More few-shots per template, failure taxonomy from judge, prompt versions A/B | Teaching-clarity judge score, template diversity |
| Catalog | 150 → 400 objects; offline asset factory v1 (sketch DSL → render → judge) for recurring gaps | Rung-2 share ↑, rung-4 share ↓ |
| Continuity | Carry-over elements, erase/redraw transitions, camera nothing fancy | Judge "flow" score |
| Intro/outro | Tutor intro: source title, section roadmap, time plan; recap scene | Presence gate |
| Speed | Parallel scene planning; worker pool; live player Mode B | Time-to-first-frame, total wall time |
| Long form | Section-parallel pipeline for 5/10/30/60 min | Cost per minute, gates pass rate |

## Weeks 4+ — Scale

Queue (BullMQ), stateless workers, object storage for artifacts, observability dashboard, learner-profile input into S3. See file 01 §11.

---

## Offline asset factory (rung 5) — spec for week 2

```
gap concept ──► LLM writes SKETCH DSL (not SVG):
   { "viewBox":100, "shapes":[
       {"t":"circle","cx":50,"cy":40,"r":22,"fill":"yellow"},
       {"t":"rect","x":35,"y":60,"w":30,"h":25,"rx":4,"fill":"none"},
       {"t":"poly","pts":[[40,85],[50,95],[60,85]],"closed":false} ] }
          │  validator: ≤ 25 shapes, coords in [0,100], palette only, min feature size
          ▼
   compile to SVG ──► normalizer ──► render 256px PNG
          │
          ▼
   VLM judge: "What object is this?" (blind) → must name the concept or a synonym
          │  + style judge against 5 catalog neighbors
          ▼
   pass → catalog entry (source: 'generated', qa scores) · fail ×3 → mark concept "text-box only"
```

Alternative factory path to A/B: image model (flat doodle, white bg, fixed style prompt) → `vtracer` → normalizer → same judge. Offline only.

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Planner produces "entity lists" not diagrams | High with flash models | Strong model for S6 only; template few-shots; judge-driven prompt iteration |
| Filled icons look wrong with stroke reveal | Medium | Prefer stroke-based sets; outline-then-fill for fill-type |
| Word alignment drift on Nepali/other languages | Medium | Forced aligner with per-language model; fall back to proportional timing per sentence |
| Render too slow for 60-min | Medium | Worker pool, resvg, section parallelism, player mode for in-app |
| License problems with icon sources | Medium | License stored per catalog entry; build fails on non-allowed license |
| Over-engineering scale before quality | High (tempting) | No queue/infra work until week-1 exit criteria pass |

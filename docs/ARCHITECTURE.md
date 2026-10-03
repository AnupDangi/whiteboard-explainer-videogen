# Architecture — Claude hypothesis track (`src/`)

This is the implementation of the hypothesis in `claude_pipeline.md` and `hypothesis/v1_claude/*.md`. All pipeline code lives under `src/`; the unreachable legacy runtime (`src/core`, `src/domain`, `src/gateway`,
`src/ingest`) was removed on 2026-09-27. `docs/AUDIT-2026-09-27.md` is the developer report: findings, what was
fixed, and how to extend each part (template, planner, model, document reader).

**Extension points** (none needs an edit to the pipeline runners):

| To add | Where | Contract |
|---|---|---|
| Document format / PDF reader | `src/intake/registry.ts` `registerSourceExtractor` | `SourceExtractor` in `src/intake/types.ts` |
| Scene template | `src/layout/templates/catalog.ts` spec + geometry in `src/layout/templates/definitions.ts` | slots, required slots, recipe; the type, zod enum, prompt table and gate derive from it |
| S6 planner | `src/planner/registry.ts` `registerScenePlanner` | `ScenePlanner` (prompt, plan, versions) |
| Model provider | `src/llm/modelClient.ts` | `ModelClient { chat, pricing? }`, passed to `structuredCall` |
| Relation arrow wording | `src/run/config.ts` `RELATION_ARROWS` | verb + whether it has a direction |

## Pipeline order (logical dependency order)

> **Teaching Compiler V1 update (2026-09-29):** `final_plan/03_ARCHITECTURE.md` is the
> canonical contract for the source-generated S1–S12 path. S4 materializes claim
> selectors from verbatim spoken sentences and prompts narration to name each claim's
> endpoints and relation; S6 gets those exact spoken spans and uses two bounded validator-driven repairs
> (structure, then claim/relation coverage); S7 records the canonical R0–R11 strategy
> while type-gating similarity against curated bridge types; and S8/S9 inputs are frozen
> in a verified `lesson.lock.json` before S10/S11. `pnpm run video:render -- --from=<lock>`
> replays render work offline. Output hashes live in `render-artifacts.json`. The current
> AssetBridge is still a migration snapshot: strict opt-in snapshot validation exists,
> and `freezeBridgeSnapshot()` can create a self-contained export from an explicitly
> reviewed bridge. Its version commits to sorted metadata and all asset SHA-256 values.
> Production S7 still does not consume that snapshot until the reviewed Asset Lab
> handoff. See the latest `docs/HANDOFF.md` entry for status and gates.

> **S6/S8 layout update (2026-09-30):** the recipe catalog now includes hierarchy/tree,
> decision tree, timeline, rule/exception, and claim/evidence geometries. S6 chooses
> semantic node roles explicitly; S2 source-cites `contains`, `branches`, `precedes`,
> `excepts`, and `supports` relations so validators can reject unsupported layouts.
> Branch-condition labels are copied from cited relation evidence. These checks establish
> contract shape, not learner comprehension; muted-board validation is still required.

The live `run-manifest.json` records SHA-256 hashes for materialized evaluation,
lesson-lock, render-manifest, SVG, contact-sheet, video, and caption artifacts.
The manifest excludes its own hash to avoid a self-reference. Encoded output
hashes also remain in `render-artifacts.json`; `lesson.lock.json` is written
before S10 and is never amended with post-encode data. The verifier requires each
renderable scene's spec, resolved program, layout, and timeline paths and hashes;
removing one and recomputing the lock signature does not make the lock renderable.
Source-generated locks also pin `lesson-prep.json`, which contains the prepared
syllabus, concept graph, plan, and teaching contracts. A renderable lock fails
closed when Node, pipeline, resvg, Rough.js, or ffmpeg cannot be identified.

S8 uses the pinned Rough.js 4.6.6 package (MIT; package registry integrity is
recorded in `package-lock.json`) only to compile procedural classroom-ink
strokes. It leaves approved catalog vectors and exact math, plot, code, and
chemistry adapters untouched. Seeds bind renderer version, lesson, scene,
element or edge, and profile; fixed paths and seeds are stored in the locked
layout artifact. S10 never calls Rough.js.

For local source requests, S1 reads each file once, hashes that byte snapshot,
selects the reader from it, and extracts from the same buffer. The source hash,
benchmark check, cache key, and resulting `SourceDoc.contentSha256` therefore
refer to one immutable in-memory input even if the path changes during intake.

Simi coverage metrics treat `code`, `molecule`, and `reaction` as rendered
visual adapters. The last-resort text rate carries its visually representable
claim denominator explicitly; claims without a per-claim intent remain B3
failures and are not counted as resolved text fallbacks.

S1–S4 retain their dependency order. Once an S4 scene script is ready, S5 src/audio/alignment and timing-independent S6 semantic planning can run together. Each scene joins its own measured S5 result before mention-time validation, layout, timed gates, and its playable event. Scene events and final rendering remain in original lesson order.

```
LessonRequest (local files or HTTPS URLs: PDF, DOCX, PPTX, HTML, text)         src/plan/sourceIntake.ts -> src/plan/intake/*, lessonCli.ts
  S1  intake              one reader per format (registry);  src/plan/intake/{registry,pdfPoppler,pdfDocling,
                           canonical text, native locations,  office,html,text}.ts
                           titles, figures, warnings
  S1  SourceBundle        per-document hashes/locations,     src/plan/sourceBundle.ts
                           ranked exact EvidenceHits,
                           local BM25 fallback, figure crops
      optional RAG index  tables/equations/images through    src/plan/ragSidecar.ts, rag-engine/service.py
                           RAG-Anything; estimated cost,
                           disabled unless explicitly enabled
  S1b Syllabus             60–3600s bounded path, src/plan/hierarchical.ts
                           supported-depth selection,
                           global concept IDs and module map
  S2-S3 Per module          local concept graph and bounded src/pipeline/lesson.ts, src/plan/stages.ts
                           teaching plan; max 6 modules /
                           8 syllabus concepts per module
      legacy path           non-canonical internal fixtures src/plan/stages.ts
                           retain the prior S2-S4 sequence
      plan analysis        deterministic F-PED checks       src/plan/analyze.ts
  S4  NarrationScript      one call per scene, in parallel, src/plan/stages.ts writeScript
                           [[id|phrase]] markers, word
                           budget of 2.6 words/s
  S5  TTS + alignment      persistent bounded voice and     src/pipeline/sceneAudio.ts, voice-engine/src,
                           stable-ts workers; overlaps S6   src/shared/alignment
                           for that scene; validate each
                           word interval before timed work
                           retain fractional-ms boundaries; hard-check word clocks before mention resolution
                           English CTC is comparison-only until its timing calibration passes
      mention resolution                                     src/narration/resolveMentions.ts
  S6  Scene Planner        planner chosen by id (default    src/planner/registry.ts, src/planner/board.ts,
                           board-v2); timing-independent    planner/{context,exemplars,prompt,plan}.ts
                           context;
                           joins S5 before timed stages
                           board planner: initial call + up to 2 bounded,
                           validator-driven repairs; legacy SceneSpec
                           planner retains its one-repair contract;
                           emits typed representation intents only; no asset
                           names, IDs, or retrieval candidates enter S6;
                           hard S5 alignment errors skip paid planning by default;
                           diagnostic opt-in preserves failures and failed status
  S7-S10 one shared chain (fixture and live runners)          src/pipeline/visualChain.ts
  S7  resolve (ladder)     exact -> embedding -> lexical ->  resolveScene.ts, catalog/*
                           styled text box; S7 retrieves from the source
                           referent and pins only after semantic validation
  S8  layout               templates + measured text bounds  src/layout/measure.ts, solver.ts,
                           + growth/shrink fit + edge routing templates/*
  S9  timeline             phased reveals, edge and term     src/timeline/compile.ts
                           tracks, <= 2 concurrent reveals
  S10 render               pure renderSVG(scene, timeline,   render/*
                           t); only after the S1–S9 lock verifies
  S11 encode               deterministic raster frames,      export/*
                           content-hashed module clips,
                           chapter/caption mux and assembly
  S12 gates + judge        deterministic gates on every      validation/gates.ts, src/shared/evaluation.ts,
                           run; VLM judge on dev runs        harness/*
```

## Task 6–13 modules and commands

- `src/harness/sceneRichness.ts` reports deterministic structural metrics for a scene or set of scenes. These metrics are diagnostic and are not visual-acceptance evidence.
- `lessonCli.ts --plan-despite-alignment-failure` opts into diagnostic S6 planning when S5 has hard alignment failures. The opt-in is part of src/run/cache identity; S5 failures remain hard and the run remains failed.
- `src/planner/sceneInput.ts` supplies the same planner input builder to live runs and the calibration harness. `src/harness/sceneCalibration.ts` and `sceneCalibrationCli.ts` implement cached S1–S5 prompt-arm diagnostics; `pnpm run scene:calibrate` writes explicitly labeled reports with a per-invocation budget ledger.
- `src/catalog/libraryIngest.ts` and `scripts/ingest-icon-library.mjs` normalize a supported SVG subset and write a catalog plus rejection report. `pnpm run icons:ingest -- <library-dir>` enforces the manifest license list and rejects paths escaping the library root.
- `src/harness/developmentBenchmark.ts` verifies the frozen five-topic/15-trial development manifest and exact source bytes before a benchmark attempt is accepted. Both `one-shot-video.mjs` and `lessonCli.js --benchmark-attempt=<id>` derive the pinned source, instruction, duration, topic ID, and cold-cache setting from that manifest; explicit overrides are checked, and failed early attempts retain a partial `run-manifest.json` with hashes for the evidence available at failure.
- `src/harness/releaseArtifactVerifier.ts` verifies run-manifest-indexed artifact bytes, matches each attempt to the frozen slot, and rerenders claimed-passed locks through the offline lock renderer. `release:gates --runs=<dir1,dir2,...> --project-root=<repo>` evaluates only those verified src/run/evaluation/lock artifacts and leaves held-out, semantic human audits, asset-rights review, and reviewer votes unmeasured when their signed/reviewed evidence is absent. `release:gates --input=...` remains a threshold preview only and always reports `unmeasured`.
- `src/catalog/registry.ts` defines enabled libraries and hashes each enabled catalog and embedding matrix into `catalogVersion()`. Retrieval, src/run/config identity, and S6/S7 cache inputs use that version. The registry currently enables Streamline only; AssetLab workspace artifacts are not enabled pending source and attribution verification.
- `src/catalog/queryEmbeddingCache.ts` caches vectors by embedding model and normalized query. `src/catalog/iconPins.ts` pins S7-resolved icons by concept identity and depicted referent across scenes only after the scene's semantic gates pass. Explicit S6 representation intent participates in pin compatibility; asset IDs and candidate names are software-owned and never enter the default board-planner prompt. Distinct objects tied to one teaching concept retain distinct assets; the pin set participates in S7 cache identity.
- `src/harness/reliability.ts` and `reliabilityCli.ts` implement cold S1–S4 reliability measurement. `pnpm run reliability:run` records conditional stage rates, end-to-end rate, failure codes, retries, evidence-anchor markers, cost, and duration under a capped persistent ledger.
- Live lesson summaries and `video:one-shot` provenance preserve the full numeric evaluation metric map; `validate:batch` reports per-run visual, relation, state-change, and R11 text metrics plus means with contributing-run counts. Missing metrics remain `n/a`. This is measurement transport only: the release batch still needs typed cold-trial/topic and human-review evidence before its thresholds can be evaluated.
- `release:gates -- --input=<versioned-evidence.json>` evaluates supplied cold-run, held-out, alignment-calibration, lock-rerender, rights, and muted-board evidence. Relation and state-change coverage are independent checks; muted-board scoring requires a hashed review-pack manifest and at least two distinct reviewers per major scene, with scene-balanced scoring. Missing evidence stays `unmeasured`; the command does not launch providers or attest to the contents of externally supplied hashes.
  The input envelope uses `schemaVersion: "teaching-compiler-v1-release-gates/v1"` and an `evidence` object. Evidence names the five opaque `topicIds`, all 15 `{attemptId, topicId, trial, cold, completion}` rows, per-complete-run metrics, versioned held-out report metadata, measured alignment calibration from two annotators across at least three documents and 100 word items, and each muted-board `{sceneId, reviewerId, responseId, score}` plus the frozen review-pack scene IDs and manifest digest. See `src/harness/releaseGate.ts` for the full typed contract. For example: `pnpm run release:gates -- --input=release-evidence.json --output=release-report.json`.

These CLIs have offline contract tests. One paid cold S6 diagnostic has been measured and failed with claim-to-relation and provider-usage errors; it is a separate diagnostic, not a frozen benchmark slot. The full 15-run benchmark, held-out measurement, and prompt-arm calibration remain incomplete.

### Run identity and measurement

`lessonCli.ts` gives each invocation a unique `runs/<timestamp>-<uuid>/` directory while keeping the lesson's content-addressed stage cache reusable under `<out>/<lesson>/stage-cache/` (or the explicit `--stage-cache` root). Per-run budgets, stage outputs, and manifests cannot overwrite sibling runs. The top-level CLI summary is also written to a unique temporary file and atomically renamed to a run-unique filename.

Stage records include UTC start/end timestamps and measured elapsed time where available. S4 records each narration scene independently; cache replay reports zero current API spend and preserves original artifact spend separately. Run manifests distinguish full CLI wall time, source/S1–S4 preparation time, and S5–S12 pipeline wall time. Provider usage metrics separate shared concept/plan preparation, scene planner spend, and per-scene S6 spend. Overlapping parallel stage durations are diagnostic and must not be summed as end-to-end wall time.

### Source bundles and retrieval

`LessonRequest.sources` accepts multiple local PDF, DOCX, PPTX, Markdown, text, and JSON files plus public HTTPS URL sources returning HTML, plain text, or PDF. URL intake rejects credentials, custom ports, private/reserved DNS answers, validates every redirect, and pins the request to validated DNS answers. Office and PDF evidence retains native page/slide/paragraph/table locations. Embedded PDF, DOCX, and PPTX images are content-hashed into `.data/hypothesis-source-assets/` and indexed with their page/slide metadata.

S1 creates `SourceBundle` and ranked `EvidenceHit` artifacts. The deterministic local BM25 retriever is always available and each hit resolves to an exact source quote and original document hash. Conflicting documents remain separate and cited. `sourcePrompt()` includes the ranked evidence and sanitized embedded-figure metadata; absolute asset paths are excluded from model prompts. If the optional `RAG_ENGINE=on` Python environment is installed, `ragSidecar.ts` indexes text, tables, equations, and embedded image assets through the existing RAG-Anything service. The lesson evidence contract still uses ranked exact local citations (`deep-indexed+local-text` mode); the sidecar's answer-only query string is never treated as cited evidence. The sidecar reports estimated cost because it does not expose invoice usage, and the estimate settles only when retrieval matches exact source spans — a miss or partial run keeps $0 with honest `local-text` status while budget gating and fail-closed uncertain-spend blocking stay unchanged. If the environment is absent or indexing fails, the run stays in accurately labeled `local-text` mode.
HTML source evidence preserves parser-authored element selectors and its source locator. Remote HTML uses an HTTPS locator; local HTML uses a `file:` locator. SceneSpec validation accepts both while the source-evidence check requires the exact locator and quote from intake. The URL fetcher itself remains HTTPS-only.

S1 creates `SourceBundle` and ranked `EvidenceHit` artifacts. The deterministic local BM25 retriever is always available and each hit resolves to an exact source quote and original document hash. Conflicting documents remain separate and cited. `sourcePrompt()` includes the ranked evidence and sanitized embedded-figure metadata; absolute asset paths are excluded from model prompts. If the optional `RAG_ENGINE=on` Python environment is installed, `ragSidecar.ts` indexes text, tables, equations, and embedded image assets through the existing RAG-Anything service. The lesson evidence contract still uses ranked exact local citations (`deep-indexed+local-text` mode); the sidecar's answer-only query string is never treated as cited evidence. The sidecar reports estimated cost because it does not expose invoice usage. If the environment is absent or indexing fails, the run stays in accurately labeled `local-text` mode.

For repeated source inputs, use repeated CLI arguments such as `--source=notes.pdf --source=slides.pptx --url=https://example.org/lesson`. A direct URL source is fetched on each run and then its bytes and parser result are hashed; local document parser artifacts use the shared content-addressed S1 cache.

### Duration-aware planning

The lesson CLI accepts whole-second `--duration` requests from 60 through 3600 seconds. Canonical requests start with a syllabus call that returns a learning objective, audience assumptions, stable global concept IDs and terminology, prerequisite order, distinct module goals, evidence coverage, exact module budgets, and tri-state `sourceSupport` (`supported`, `partial`, or `insufficient`). Partial support must select a shorter duration; insufficient support records `source-insufficient-for-goal` and stops before narration, voice synthesis, and rendering. The run stores requested and planned durations separately. For sources above 12,000 characters, S1b sends at most 48,000 characters of exact source text as excerpts paired with their span IDs (opening material, retrieval hits, closing material, document-wide samples); a truncated excerpt is marked. Generated concept and module IDs may be normalized from ASCII uppercase or hyphen spellings to lowercase snake case before strict schema and reference checks; collisions still fail, and span IDs and factual text are never normalized. PDF line-end hyphenation can be matched mechanically to a model quote, but the stored citation keeps the exact source bytes. Paraphrases remain invalid.

Each module is planned independently with a scoped source excerpt and its assigned syllabus concepts. S2 enforces the global concept IDs and labels; S3 retains the existing per-response scene/schema limits; S4 writes one module. In generated lesson CLI runs, S5 then synthesizes and aligns that module before the next module is planned. Measured audio plus scene gaps rebudgets only unwritten modules; each completed module retains its original target and measured duration. The exact scene src/audio/alignment artifact is reused by the live S5 stage within the same cold run, so the module boundary does not synthesize scenes twice. Alignment words must match narration tokens and have valid, positive intervals to satisfy the timing gate; when a positive audio duration exists, the module clock can still rebudget later scenes while the alignment finding remains a hard publication failure. A global lesson bible is assembled after module validation, recurring concepts are marked persistent, and module scene IDs are namespaced to avoid collisions. `lessonToLiveInput()` flattens ordered scenes for the current src/player/export path while carrying module targets and measured audio durations. Generated lessons use actual concatenated audio duration and do not add trailing silence to satisfy the nominal target; their duration delta remains in run metrics. Golden diagnostic clips retain their existing target padding behavior. After an S4 scene script is available, the live path overlaps S5 for that scene with timing-independent S6 planning, then joins the measured audio before layout, gates, and scene-event emission.

Mention matching and narration tokenization retain internal Unicode apostrophes. Mention comparison normalizes curly and straight apostrophes to the same form, so a script phrase such as “the model’s output” can resolve against either typography without changing or inferring audio timestamps.

Generated lesson budgets are $0.10 / $0.50 / $0.70 / $1.00 for 60 / 300 / 600 / 1800 seconds; 3600 seconds and other numeric durations use the bounded duration-based cap. A shortened syllabus uses the cap for its planned duration. Renderer fixtures and golden clips retain the $0.10 cap. Syllabus and module artifacts use the shared content-addressed stage cache.

`src/pipeline/run.ts` remains an offline S4→S10 runner for supplied SceneSpecs. Retained Attention/math
SceneSpecs are historical artifacts and are not loaded by current tests or used for visual evaluation.
Current plumbing tests use neutral inputs from `__tests__/support/syntheticScenes.ts`; their result
class is `renderer-fixture`, and they make no generated-quality claim. Do not run the old lesson scenes
as a substitute for missing source-generated lessons.

## Progressive delivery and teaching boards (Phase 4/5 engineering)

The live path writes `scene.playable` JSONL events only after a scene has passed its timing-dependent layout and deterministic gates. Events carry run/module/scene identity, a contiguous playable-scene sequence, local duration, descriptor SHA-256, and a run-relative preview location. The descriptor carries exact local aligned words and a content-hashed scene WAV. The loopback player polls during generation, retries transient artifact fetches, and plays the validated scene WAVs in event order.

Board planning can select source-neutral diagram circle, triangle, or rectangle nodes when an icon would misstate a concept. These compile to existing deterministic shapes with source citations. Text-only process relations emit a review warning; geometry alone does not establish that the drawing teaches the narrated claim. S4 also rejects spoken visual-director commands before TTS.

The S6 board planner and the SceneSpec planner support a static `code` visual only when the excerpt occurs verbatim inside a cited source quote. It preserves case, punctuation, spaces, and line breaks; layout assigns fixed character cells and pure SVG rendering escapes each character as text. The excerpt is never interpreted or executed. Inputs are limited to 14 lines and 40 printable characters per line. Chemistry now has a deliberately bounded molecule/reaction primitive: at S6 a cited quote must contain matching explicit bracket-atom notation with single/double/triple bonds; graph isomorphism, valence, coefficients, and reaction atom balance are checked before deterministic SVG rendering. It supports neutral acyclic linear/branched H/C/N/O/F/Cl structures with explicit hydrogen; prose-only structures, rings, charges, isotopes, and stereo fail closed. Unresolved non-text requests with a label use R10's labelled box; R11 is text-only for explicit text requests or empty labels. Strict AssetBridge byte verification rejects external/relative/data SVG references and reference-mutating animation while allowing local fragment references; this strict verifier is not yet on the production S7 path. The lower-level SceneSpec parser checks supplied evidence references but cannot authenticate their origin; source authenticity relies on the S6 pipeline's validated references. B4 and source-grounded comprehension still need evaluation. All 89 checked-in AssetBridge diagram rows remain spec-only: they are explicitly rejected until they carry concrete instances and relations; generic R9 topology is a separate fallback and does not count as compiling those rows.

Cross-process filesystem leases configure host-wide limits through `HYPOTHESIS_PROVIDER_CONCURRENCY`, `HYPOTHESIS_SCENE_CONCURRENCY`, `HYPOTHESIS_S6_CONCURRENCY`, `HYPOTHESIS_TTS_ALIGNMENT_CONCURRENCY`, and `HYPOTHESIS_RASTER_CONCURRENCY` (defaults 2, 4, 2, 2, and 2). Module clips use content-addressed input manifests that include scene data, local src/audio/captions, canvas, frame rate, font, visual renderer version, and encoder. The frame cache keys exact rendered SVG bytes plus the complete Resvg options and measured render settings, verifies PNG hashes, and defaults to 256 MiB.

Canonical module clips are assembled in syllabus order. Chapter offsets use probed clip durations, and the final MP4 carries H.264 video, AAC audio, chapter markers, and `mov_text` captions. Offline integration tests decode a synthetic assembled MP4 and verify its stream types, chapter bounds, external captions, and src/audio/video duration within 100 ms. These fixtures prove export plumbing only.

Module export keeps every narrated scene on its audio clock even when a visual scene fails. Such missing visuals remain hard failures and any retained MP4 is diagnostic. The CLI and one-shot provenance report the probed encoded MP4 duration separately from narrated duration; a material mismatch is a hard failure.

Phase status and evidence are maintained in `docs/HANDOFF.md`: Phase 4 and 5 engineering is implemented and offline-tested, while generated-lesson quality is unmeasured. Two-human word-boundary calibration remains unmeasured, so Phase 3 and publication stay gated. Live RAG-Anything, 1/5/10/30-minute cold/warm runs, 1/3/5-job benchmarks, and human review of complete source-generated lessons remain outstanding.

The golden-case live path (`liveCli.ts`) runs S5→S11 on frozen marked scripts. `lessonCli.ts --source=...`
accepts text, Markdown, PDF, DOCX, and PPTX; PDF pages and office structural text are extracted to a
versioned `SourceDoc` before S2.

S5 calibration is currently explicitly `unmeasured`. The prior scratch-derived
36.5 ms record is preserved only as a withdrawn historical artifact; live runs
may collect diagnostic src/audio/alignment without that value, but `runLive.ts`
records a hard S5 failure and will not publish. `word_boundary_review.py`
creates blinded audio-only word-boundary packs from provider-generated source
runs; aligner candidates remain in a separate organizer key. A five-source pack
contains 29 clips and 793 words, but no human annotations have been submitted.
The reviewer page now saves progress in browser storage, restores it on reopen,
and disables vote export until every boundary is valid, ordered, and inside its
clip. The resumable pages are in `.data/alignment-review/2026-09-26-five-topic-resumable/participants/`;
their organizer key stays outside that participant tree.

Voice-engine Supertonic/Piper bridges now accept newline-delimited worker requests and cache loaded provider models per process. `VOICE_ENGINE_WORKERS` defaults to 1 because each worker retains model memory; measured scene synthesis timing comes from the provider's synthesis interval, while run stage wall time includes worker queueing. Stable-ts uses `HYPOTHESIS_ALIGNMENT_WORKERS` (default 2, maximum 8), caches models inside long-lived Python workers, and returns each response independently. This checkout has stable-ts 2.19.1, faster-whisper 1.2.1, and cached `base`/`base.en` weights. A repeatable three-run batch of six real scenes from two generated topics measured pool-size-1 p50/p95 at 1.606/1.613 s and pool-size-2 at 1.396/1.399 s; exact token order held in all 18 aligned samples, while five of six scenes had invalid zero-duration intervals in each repeat. The existing CTC diagnostic across the five-source/29-scene pack counted 18 stable-ts zero intervals and zero CTC zero intervals. It compares utterance-edge RMS VAD, not interior word boundaries, so these findings do not calibrate or promote CTC. See `src/shared/alignment/README.md` and `.data/alignment-review/2026-09-26-five-topic/alignment-worker-benchmark.json` / `ctc-diagnostic-five-topic.json` for exact results. The two-human calibration gate remains open.

The audio-master module boundary is implemented but its human calibration gate is not. A blinded review pack exists at `.data/alignment-review/2026-09-26-five-topic/`; until both independent annotators submit complete votes and the scorer produces a measured calibration, publication remains blocked. The local integration test uses a deterministic injected aligner solely to verify module-budget control and same-run audio-cache reuse; it is not alignment-quality or performance evidence.

Golden target lookup is disabled for `runClass: generated-lesson`; case IDs and
source-derived IDs can no longer activate benchmark claims or duration targets.
Explicit benchmark/script paths can still resolve their frozen targets.

The existing S3 call also produces a `LessonBible` and one source-grounded `SceneContract` per section.
Code checks concept/relation coverage and exact source span IDs before narration; concepts reused across
sections must be declared persistent, and each persistent concept must have one canonical terminology
entry that agrees with the source concept label. These checks are part of S3 prompt v4, which invalidates
previous teaching-plan cache entries. SourceDoc v2 carries native PDF page, PPTX slide, and DOCX body
paragraph/table locations on spans, resolved evidence, concept graphs, and S6 contexts. PDF/PPTX locators
come from extractor-generated character ranges rather than parsing visible page/slide headings, so source
text cannot spoof them; the Scene Planner must copy locators exactly, and its gate rejects altered values. DOCX body-block ordinals are extraction
locators rather than durable XML IDs. S1's stage/schema/prompt versions invalidate earlier cached source
documents. S6 prompt v13 explicitly requires the schema's `prim` discriminator and adds topic-neutral visual recipe cards,
separate from nested primitive payloads. Its planner gate requires every persistent concept
shown in a scene to use its canonical term visibly on a concept-linked element. S4 marked narration
and S5 measured mention times enrich that contract deterministically into `ScenePlanningContext`.
Code compiles the S6 prompt with one visual-director instruction; there is no prompt-writing model.
New generated lessons default to zero-shot. The exemplar bank is mechanism-bank/v4, covers all templates and several primitive families, and remains experimental with review states pending. The old fixed Attention/math fixtures are absent from runtime prompts and E5 arms. The `text`, `mechanism`, and `diverse` arms use a versioned cross-domain experimental bank;
selection, context, prompt hashes, and versions are logged. The context hash includes every selected
example field actually sent to the model (intent, SceneSpec, rationale, and provenance), plus its
retrieval score; prompt assembly and hash payload share one serializer. Bank v4 stores provenance, an explicit
evaluation split, and separate factuality, visual, license, leakage, and human review states; an
`approved` entry fails validation unless every review passes with an identified reviewer and
timestamp. Retrieval excludes every example linked to an evaluation golden, all development/test
split entries, the target source/lesson, and lexical intent near-duplicates at a versioned 0.72
Jaccard threshold. The near-duplicate filter is lexical and does not detect semantic paraphrases.
Current entries remain pending and experimental. None of those arms has passed held-out timed-video
review. A fallback retains its
original hard src/planner/provider failures.

For matched E5 runs, `lessonCli --stage-cache=<dir>` shares content-addressed S1–S5 artifacts across
separate output directories while S6 keys remain treatment-specific. Run manifests expose prompt
treatment versions and the aligned-audio SHA-256. `src/harness/e5Comparison.ts` rejects pairs with
mismatched source, narration, alignment, audio, voice, render, content model, or undeclared treatment
differences. This is pair-integrity enforcement, not video-quality evidence.

`judge:e5:human:pack:hypothesis --pairs=<e5-pair-list.json> --dataset=<versioned-heldout-set.json>`
accepts only matched generated-video pairs whose case ID and exact SourceDoc SHA-256 occur in the
declared evaluation set, then creates two self-contained full-timed-video packs with A/B orientation
counterbalanced between judges. The sealed answer key and organizer record are stored outside the
participant folders; run IDs, model/prompt treatment, cost, and provenance are absent from the review
UI. `judge:e5:human:hypothesis --key=<sealed-key.json> --organizer=<organizer-record.json>
--votes=<judge-1.json,judge-2.json>` validates the exact key hash against organizer provenance, then
checks blinded item IDs, src/run/treatment/cost mappings, and the held-out set hash before scoring. It
reports each judge and aggregate preference, clarity, mechanism explanation, factual concerns, and
successful-video API cost by treatment. A provenance mismatch yields `unmeasured`. The report is
descriptive and does not automatically promote a planner or prompt arm. No real E5 review has been run.

The held-out set has schema `e5-heldout-set/v1`: `{setId, version, createdAt, sources:[{caseId,
sourceDocSha256}]}`. `sourceDocSha256` must equal the generated run manifest's content hash for its
exact `SourceDoc`; the source registry itself is hashed into organizer provenance. The current frozen
inventory does not contain a completed held-out source set, so the pack command correctly fails
closed until one is assembled and reviewed.

S11 uses a bounded worker-thread raster pool and serializes completed PNG frames to ffmpeg in order. The
live encoder writes to a unique partial filename and renames to `video.mp4` only after ffmpeg completes;
an interrupted encode cannot publish a truncated final-path artifact. Its content-addressed cache stores
the MP4 bytes as a binary blob and materializes them into each run directory on warm hits. A missing blob
is regenerated in warm mode and is a replay miss; metadata alone can never claim that an MP4 exists.
The offline suite verifies a small real MP4 encode/decode. `pnpm run preview:hypothesis -- <run-directory>
[port]` starts a loopback-only preview for a completed run. Its browser client loads laid-out scenes,
timelines, aligned words, and optional local src/audio/captions, then calls the same pure `frameSvgAt`
composition function as MP4 export. The production application's playback path remains separate and
is not used by this experiment. Browser audio synchronization against a generated lesson has not been
validated yet.

`src/harness/reference/lamina/index.json` attributes `simi-scene01.png` to the photosynthesis video and
`lamina-video-ec6c5e81-...-scene01.png` to the Attention video. The earlier token-strip comparison is
withdrawn. Reference frames judge style and clarity; they do not define topic-specific renderer code.
The judge CLI/API accepts only complete generated lessons with matching run/evaluation identities, source artifacts, all stage records, and passing scene gates. Matched Simi comparisons require a declared topic confirmed by the extracted SourceDoc title and versioned reference topic map. E1 and E5 also verify that the exact serialized SourceDoc matches the SHA-256 recorded in the run manifest. Case IDs, source filenames, and run-directory names cannot establish topic identity; missing, substituted, or mismatched titles cannot receive topic-matched scores.

## Source evidence

- `SourceDoc` preserves the extracted text and stable source identity. Structural spans retain character
  and line locations; PDF page markers preserve original numbering through blank pages, and textless
  scanned PDFs fail because OCR is not enabled. Markdown, DOCX headings/tables/figure descriptions, inline math
  markers within prose, isolated display-equation spans, and PPTX slide/table boundaries are kept in the
  extracted representation.
- S2 claims and factual relations require exact quoted evidence from span IDs. S6 titles, elements, and
  factual relation edges carry evidence references or an explicit `illustrative-example`/`fixture` origin.
- The selected-exemplar copy guard checks visible text fields, including labels inside containers, and
  numeric values. It is a lexical guard rather than semantic entailment; paraphrase leakage still needs
  held-out human review and is not claimed as solved by the validator.
- Generated S6 scenes attach `conceptIds` to visual elements. The planner gate requires every source graph
  relation to appear as a typed edge between elements linked to its source and target concepts, using the
  relation's own evidence references. A relation-incomplete fallback can be rendered for diagnosis but
  retains a hard failure and cannot publish.
- Before evaluation, the generated-lesson runner resolves visual quotes against the same `SourceDoc` and
  blocks the run on missing/forged offsets. S4 resolves claim selectors to exact spoken sentence spans;
  B3 checks mapped targets against the spoken claim window, allowing the configured 150 ms reveal lead
  and rejecting later-than-grace or unexplained early reveals. B4 checks endpoint depictions even for
  edge-only claims, distinguishes R10 labelled geometry from R11 text, and rejects uncalibrated
  similarity selections, including when the selection is reused as an R0 pin. Run metrics report
  required relation coverage and `transforms` state-change coverage separately. These automated checks
  do not replace the planned blinded semantic review. PDF scan OCR, embedded figure extraction, and office-native byte
  locations are not implemented.
- This evidence path is covered by offline tests; it has not yet passed a full provider-generated lesson
  provenance audit.

## Drawn in real time

Text-driven widths use resvg's glyph ink bounds at the configured family and
weight. The Kalam Bold binary is bundled with its SIL OFL 1.1 notice, hashed in
`src/render/fonts.ts`, and loaded with system-font fallback disabled for layout
measurement and worker-based MP4 rasterization. The browser preview serves the
same binary and waits for it before drawing. Box, pill, token strip, meter,
matrix, object-label, and text elements use those measurements; the scene title
and styled text-box fallback fit to them as well. These are ink bounds with
layout padding, not OpenType advance metrics. Text remains SVG `<text>`, not
glyph paths. This is renderer reproducibility work; visual acceptance remains
unmeasured and no archived hand-authored fixture output is current quality
evidence. The font SHA-256 also participates in src/layout/render/MP4 cache keys
and the src/run/config identity.

Timing comes from the Lamina reference pack (`src/harness/reference/lamina/OBSERVATIONS.md`).

- **One primary reveal per element**, with phases in draw order.
  - The outline strokes are drawn one path after another, by cumulative length, like a pen.
  - The flat fill fades in after the outline completes.
  - The label or text is wiped in from left to right last.
  - The element holds one concurrency slot for its whole reveal, so a fill tail can never become an
    uncounted third reveal.
- **Edges** have their own `edge` track.
  - An arrow starts after its source has been drawn and finishes as its target starts drawing.
  - The shaft is drawn over the first 80% of the event and the arrowhead over the last 20%.
  - Endpoints are inset from both nodes.
  - Routing is a straight line, then either bend order, then a side detour. It never runs through other
    nodes.
- **Sub-reveals** have their own `term` track, anchored to their own mentions.
  - Formula `parts` (each typeset as a MathJax `\cssId` group) fade in.
  - Plot `tangent` / `steps` / `riseRun` groups are drawn on at stroke speed.
- **The scene title** (96 px, shrunk to fit) wipes in over 700 ms.
- **Scene transitions**: a 300 ms left-to-right erase before the next scene. There is no erase when the
  next scene carries elements over.

## Visual vocabulary

- **Icons**: the registry currently enables 1,992 Streamline free duotone icons (plump-color, flex-color, color), CC BY 4.0. Other libraries remain disabled until their source and attribution are verified.
  - They are ingested offline by `scripts/build-catalog.mjs` from a local `@iconify/json`.
  - At render time each icon is normalized: the outline becomes the house ink at 5.5 px, the body takes
    the element's palette token, and white highlights stay white.
  - Every icon at rung 2 or 3 is labelled underneath in uppercase.
  - Vectors are precomputed by `scripts/embed-catalog.mjs`, using local `Xenova/all-MiniLM-L6-v2`.
  - The 18 procedural doodles are still used, but only when there is no house-style match.
- **Math primitives**:
  - `plot`: a closed function family plus parameters. Code samples the curve; the model never writes
    points or code. It supports markers, `tangentAt`, `trajectory` and `riseRun`, each group with an
    optional anchor.
  - `numberLine`.
  - `formula` with `latex` or with term-by-term `parts`.
  - Templates `formula_focus` (up to 4 derivation lines) and `plot_focus`. Each item in these is fitted to
    its own column.
- **Layout growth**: templates are tried at element sizes from 1.6× down to 1.0×; then, when a template has a
  dense variant (`DENSE_TEMPLATES`), that variant at the same sizes; only then 0.85× down to 0.6×. The first
  placement that fits inside the safe area with no overlaps wins, so small icons are not left in empty space and
  a board that already fits keeps its default geometry. Dense `fan_out` puts the source at the centre and targets
  on the elliptical ring (straight arrows cannot cross other targets); dense `hub_spoke` pulls the same radial
  ring in to the exact no-overlap bound so tall icon+label objects fit at native size; dense `layered_stack` narrows the layer
  gap. A board that still needs shrinking fails the 32 px readability gate visibly.
- **Box labels**: `boxLabelLines()` keeps a box label on one line unless its padded one-line width exceeds 420 px,
  then splits it into at most two balanced lines at body size. Layout sizing and rendering share the decision.
- **Convergence inputs**: 3+ inputs use a data-sized grid within the generic convergence template; a long
  single column had shrunk icon labels below the 32 px hard readability floor. The Attention fixture now
  exercises the shared object-icon ladder with explicitly illustrative magnifying-glass/key metaphors.
  This fixture proof does not establish generated planner or Simi style parity.
- **Roughness**: stays 0. `draw/rough-geometry.ts`, `draw/freehand.ts` and `draw/marker-motion.ts` (ported
  from the retired ChatGPT track) are available for experiment E7 but are not wired into rendering.

## Models

Every stage model is configuration (`.env`); there are no code defaults.

| Stage | Variable | Notes |
|---|---|---|
| S1b–S4 | `OPENROUTER_CONTENT_MODEL` (legacy alias `OPENROUTER_DIRECTOR_MODEL`); optional `OPENROUTER_{SYLLABUS,CONCEPTS,PLAN,SCRIPT}_MODEL` | `--content=<model>` on the CLI overrides all four |
| S6 | `OPENROUTER_SCENE_MODEL` | board planner (`src/planner/registry.ts`) |
| Judge | `OPENROUTER_VISION_MODEL` (pinned `qwen/qwen3-vl-32b-instruct`, validated 2026-09-30: text+image, structured outputs, $0.104/$0.416 per M) | separate $0.25 cap; a response without billed cost is an error |

All LLM stages go through `src/llm/structuredCall.ts` over a `ModelClient` (`src/llm/modelClient.ts`; OpenRouter by
default, `OPENROUTER_BASE_URL` for any compatible endpoint):
- JSON-candidate extraction and a lenient control-character parse; one repair by default, with the S6 board
  planner explicitly using two bounded repair phases and full validation after each response;
- `finishReason` is recorded; a response cut at the token limit is labelled `<stage>-truncated` and its repair
  gets 1.5x the output tokens;
- price-aware routing: `max_price` is the model's own price from `GET /models` plus 25 %; a model whose worst-case
  call cannot fit the remaining budget fails before sending (`model-too-expensive-for-budget`);
- the persistent ledger reserves the worst case under its lock, releases the lock during the call, and settles
  the billed cost, so calls run concurrently; a request the provider rejects (4xx) or that was never sent does not
  block the ledger.

## Catalog threshold calibration

`catalog:e4:calibrate --input=<e4-labeled-pairs.json>` evaluates a versioned set of concept–asset
pairs against cosine scores. The input records the source/case hash, catalog hash, embedding model,
VLM label, and optional human-adjudicated label/reviewer for each pair. The evaluator requires 200
unique pairs and 50 human checks, reports VLM/human agreement and a complete threshold curve, and
selects a cutoff only when both icon precision ≥0.90 and overall semantic match ≥0.85 hold. It never
changes `TAU_HIGH_EMB` or `TAU_MID_EMB`; changing runtime thresholds requires a reviewed calibration
report and a version bump. No real E4 labeled dataset is present, so the existing thresholds remain
uncalibrated.

## Commands

```
pnpm run typecheck:hypothesis && pnpm run test:hypothesis      # offline, no keys needed
pnpm run strip:scene -- <run>/preview-scenes/0000.json out.png # progression strip of one generated scene (after a build)
pnpm run run:lesson -- --lesson=all [--content=<model>] [--planner=<model>]
pnpm run video:one-shot -- --prompt="<learner prompt>" --source=<file>|--url=<url> [--duration=60] [--id=<name>]  # locked single run, provenance in output/
pnpm run run:hypothesis:live [-- --case=<golden> --planner=<model>]
pnpm run preview:hypothesis -- <run-directory> [port]                 # loopback browser player
pnpm run judge:hypothesis -- --runs=.data/hypothesis-runs/claude/lessons [--cache-dir=.data/hypothesis-runs/judge-cache]
pnpm run judge:human:pack:hypothesis -- --run=<eligible-generated-run-dir> --topic=<declared-topic> [--out=<pack-root>] [--key-out=<sealed-key.json>] [--organizer-out=<organizer-record.json>]
pnpm run judge:human:hypothesis -- --key=<sealed-answer-key.json> --votes=<judge-1.json,judge-2.json> [--out=<report.json>]
pnpm run judge:e5:human:pack:hypothesis -- --pairs=<e5-pair-list.json> --dataset=<versioned-heldout-set.json> [--out=<pack-root>] [--key-out=<sealed-key.json>]
pnpm run judge:e5:human:hypothesis -- --key=<sealed-e5-key.json> --votes=<judge-1.json,judge-2.json> [--out=<report.json>]
pnpm run catalog:build                                         # rebuild the Streamline catalog + embeddings
pnpm run catalog:e4:calibrate -- --input=<e4-labeled-pairs.json> [--out=<report.json>]
pnpm run reference:lamina                                      # rebuild the Lamina reference pack
```

## Teaching Compiler V2 continuation

The current V2 runtime is under `src/pipeline-v2`, `src/visual-v2`, and
`src/audio`. Board planning is sequential because each scene inherits the
previous scene's live elements, edges, bindings, and retained geometry. It
validates each response through the shared reducer/timeline contracts and allows
at most two semantic repairs. Visual claim coverage comes from explicit
concept/claim bindings, never English label matching. `beat-end` and
`scene-end` lifecycle events are part of new timeline locks; older V2 locks
without that optional captured field remain readable.

ElevenLabs routing is offline-deterministic only when an operator-captured
capability snapshot is supplied. Audio artifacts retain submitted and
normalized text, provider clocks, span mappings, provider/model/voice identity,
credits, and normalization version. Process-local reservations protect
concurrent calls; cross-process reservations and ledger settlement remain
separate limitations. Provider credits are not USD. V2 evaluation bundles
record speech usage and make the $0.10 lesson cost gate unmeasured whenever TTS
has no USD valuation.

Per-scene clips are immutable, hash-verified cache entries and are concatenated
against the locked master audio. The loopback preview can also play a published
V2 lock directly: it serves only the lock's hash-listed SVG frames and verified
master WAV, synchronizes the timeline to audio, bounds seeking to the locked
duration, and reports buffering or media-verification failure. `onClipReady`
still signals only a silent clip. The runner locks the full lesson before clip
encoding, so the preview does not overlap board preparation, does not consume
the clip-ready prefix, and does not emit a measured first-audible-playable
latency. Scene-lock aggregation, preparation overlap, and first-playable
telemetry remain open; see `docs/HANDOFF.md` for current evidence and limits.

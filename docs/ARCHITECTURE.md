# Architecture — Claude hypothesis track (`src/experimental/hypothesis/v1_claude/`)

This is the implementation of the hypothesis in `claude_pipeline.md` and `hypothesis/v1_claude/*.md`. All code
lives under `src/experimental/`. Production code (`src/server.ts`, `src/runtime/*`, `src/gateway/*`, and the
existing renderer) is not modified.

## Pipeline order (logical dependency order)

S1–S4 retain their dependency order. Once an S4 scene script is ready, S5 audio/alignment and timing-independent S6 semantic planning can run together. Each scene joins its own measured S5 result before mention-time validation, layout, timed gates, and its playable event. Scene events and final rendering remain in original lesson order.

```
LessonRequest (multiple local files, HTTPS HTML/text/PDF, text + duration)    plan/sourceIntake.ts, lessonCli.ts
  S1  SourceBundle        per-document hashes/locations,     plan/sourceBundle.ts
                           ranked exact EvidenceHits,
                           local BM25 fallback, figure crops
      optional RAG index  tables/equations/images through    plan/ragSidecar.ts, rag-engine/service.py
                           RAG-Anything; estimated cost,
                           disabled unless explicitly enabled
  S1b Syllabus             canonical 60/300/600/1800s path, plan/hierarchical.ts
                           supported-depth selection,
                           global concept IDs and module map
  S2-S3 Per module          local concept graph and bounded pipeline/lesson.ts, plan/stages.ts
                           teaching plan; max 6 modules /
                           8 syllabus concepts per module
      legacy path           non-canonical internal fixtures plan/stages.ts
                           retain the prior S2-S4 sequence
      plan analysis        deterministic F-PED checks       plan/analyze.ts
  S4  NarrationScript      one call per scene, in parallel, plan/stages.ts writeScript
                           [[id|phrase]] markers, word
                           budget of 2.6 words/s
  S5  TTS + alignment      persistent bounded voice and     pipeline/runLive.ts, voice-engine/src,
                           stable-ts workers; overlaps S6   shared/alignment
                           for that scene; validate each
                           word interval before timed work
                           retain fractional-ms boundaries; hard-check word clocks before mention resolution
                           English CTC is comparison-only until its timing calibration passes
      mention resolution                                     narration/resolveMentions.ts
      retrieval            top-k Streamline icons for each   catalog/semantic.ts rankConcepts
                           mention (local MiniLM)
  S6  Scene Planner        timing-independent context;      planner/{context,exemplars,prompt,plan}.ts
                           joins S5 before timed stages
                           one visual-model call + 1 repair;
                           hard S5 alignment errors skip paid planning by default;
                           diagnostic opt-in preserves failures and failed status
  S7  resolve (ladder)     exact -> embedding -> lexical ->  resolveScene.ts, catalog/*
                           styled text box
  S8  layout               templates + measured text bounds  layout/measure.ts, solver.ts,
                           + growth/shrink fit + edge routing templates/*
  S9  timeline             phased reveals, edge and term     timeline/compile.ts
                           tracks, <= 2 concurrent reveals
  S10 render               pure renderSVG(scene, timeline,   render/*
                           t)
  S11 encode               deterministic raster frames,      export/*
                           content-hashed module clips,
                           chapter/caption mux and assembly
  S12 gates + judge        deterministic gates on every      validation/gates.ts, shared/evaluation.ts,
                           run; VLM judge on dev runs        harness/*
```

## Task 6–13 modules and commands

- `harness/sceneRichness.ts` reports deterministic structural metrics for a scene or set of scenes. These metrics are diagnostic and are not visual-acceptance evidence.
- `lessonCli.ts --plan-despite-alignment-failure` opts into diagnostic S6 planning when S5 has hard alignment failures. The opt-in is part of run/cache identity; S5 failures remain hard and the run remains failed.
- `planner/sceneInput.ts` supplies the same planner input builder to live runs and the calibration harness. `harness/sceneCalibration.ts` and `sceneCalibrationCli.ts` implement cached S1–S5 prompt-arm diagnostics; `npm run scene:calibrate` writes explicitly labeled reports with a per-invocation budget ledger.
- `catalog/libraryIngest.ts` and `scripts/ingest-icon-library.mjs` normalize a supported SVG subset and write a catalog plus rejection report. `npm run icons:ingest -- <library-dir>` enforces the manifest license list and rejects paths escaping the library root.
- `catalog/registry.ts` defines enabled libraries and hashes each enabled catalog and embedding matrix into `catalogVersion()`. Retrieval, run/config identity, and S6/S7 cache inputs use that version. The registry currently enables Streamline only; AssetLab workspace artifacts are not enabled pending source and attribution verification.
- `catalog/queryEmbeddingCache.ts` caches vectors by embedding model and normalized query. `catalog/iconPins.ts` pins resolved icons by concept identity across scenes; the pin set participates in S7 cache identity.
- `harness/reliability.ts` and `reliabilityCli.ts` implement cold S1–S4 reliability measurement. `npm run reliability:run` records conditional stage rates, end-to-end rate, failure codes, retries, evidence-anchor markers, cost, and duration under a capped persistent ledger.

These CLIs have offline contract tests. No Task 14 paid reliability, diagnostic S6, or prompt-arm calibration run has been approved or measured yet.

### Run identity and measurement

`lessonCli.ts` gives each invocation a unique `runs/<timestamp>-<uuid>/` directory while keeping the lesson's content-addressed stage cache reusable under `<out>/<lesson>/stage-cache/` (or the explicit `--stage-cache` root). Per-run budgets, stage outputs, and manifests cannot overwrite sibling runs. The top-level CLI summary is also written to a unique temporary file and atomically renamed to a run-unique filename.

Stage records include UTC start/end timestamps and measured elapsed time where available. S4 records each narration scene independently; cache replay reports zero current API spend and preserves original artifact spend separately. Run manifests distinguish full CLI wall time, source/S1–S4 preparation time, and S5–S12 pipeline wall time. Provider usage metrics separate shared concept/plan preparation, scene planner spend, and per-scene S6 spend. Overlapping parallel stage durations are diagnostic and must not be summed as end-to-end wall time.

### Source bundles and retrieval

`LessonRequest.sources` accepts multiple local PDF, DOCX, PPTX, Markdown, text, and JSON files plus public HTTPS URL sources returning HTML, plain text, or PDF. URL intake rejects credentials, custom ports, private/reserved DNS answers, validates every redirect, and pins the request to validated DNS answers. Office and PDF evidence retains native page/slide/paragraph/table locations. Embedded PDF, DOCX, and PPTX images are content-hashed into `.data/hypothesis-source-assets/` and indexed with their page/slide metadata.

S1 creates `SourceBundle` and ranked `EvidenceHit` artifacts. The deterministic local BM25 retriever is always available and each hit resolves to an exact source quote and original document hash. Conflicting documents remain separate and cited. `sourcePrompt()` includes the ranked evidence and sanitized embedded-figure metadata; absolute asset paths are excluded from model prompts. If the optional `RAG_ENGINE=on` Python environment is installed, `ragSidecar.ts` indexes text, tables, equations, and embedded image assets through the existing RAG-Anything service. The lesson evidence contract still uses ranked exact local citations (`deep-indexed+local-text` mode); the sidecar's answer-only query string is never treated as cited evidence. The sidecar reports estimated cost because it does not expose invoice usage, and the estimate settles only when retrieval matches exact source spans — a miss or partial run keeps $0 with honest `local-text` status while budget gating and fail-closed uncertain-spend blocking stay unchanged. If the environment is absent or indexing fails, the run stays in accurately labeled `local-text` mode.

For repeated source inputs, use repeated CLI arguments such as `--source=notes.pdf --source=slides.pptx --url=https://example.org/lesson`. A direct URL source is fetched on each run and then its bytes and parser result are hashed; local document parser artifacts use the shared content-addressed S1 cache.

### Duration-aware planning

The lesson CLI accepts `--duration=60`, `--duration=300`, `--duration=600`, or `--duration=1800` seconds. Canonical requests start with a syllabus call that returns a learning objective, audience assumptions, stable global concept IDs and terminology, prerequisite order, distinct module goals, evidence coverage, and exact module budgets. Module budgets are `[60]`, `[300]`, `[300,300]`, or six 300-second modules. If the source cannot support the requested depth, the syllabus may select a shorter supported canonical duration and must give a coverage reason. The run stores requested and planned durations separately. For sources above 12,000 characters, S1b sends at most 48,000 characters of exact source text as excerpts paired with their span IDs (opening material, retrieval hits, closing material, document-wide samples); a truncated excerpt is marked. Generated concept and module IDs may be normalized from ASCII uppercase or hyphen spellings to lowercase snake case before strict schema and reference checks; collisions still fail, and span IDs and factual text are never normalized. PDF line-end hyphenation can be matched mechanically to a model quote, but the stored citation keeps the exact source bytes. Paraphrases remain invalid.

Each module is planned independently with a scoped source excerpt and its assigned syllabus concepts. S2 enforces the global concept IDs and labels; S3 retains the existing per-response scene/schema limits; S4 writes one module. In generated lesson CLI runs, S5 then synthesizes and aligns that module before the next module is planned. Measured audio plus scene gaps rebudgets only unwritten modules; each completed module retains its original target and measured duration. The exact scene audio/alignment artifact is reused by the live S5 stage within the same cold run, so the module boundary does not synthesize scenes twice. Alignment words must match narration tokens and have valid, positive intervals to satisfy the timing gate; when a positive audio duration exists, the module clock can still rebudget later scenes while the alignment finding remains a hard publication failure. A global lesson bible is assembled after module validation, recurring concepts are marked persistent, and module scene IDs are namespaced to avoid collisions. `lessonToLiveInput()` flattens ordered scenes for the current player/export path while carrying module targets and measured audio durations. Generated lessons use actual concatenated audio duration and do not add trailing silence to satisfy the nominal target; their duration delta remains in run metrics. Golden diagnostic clips retain their existing target padding behavior. After an S4 scene script is available, the live path overlaps S5 for that scene with timing-independent S6 planning, then joins the measured audio before layout, gates, and scene-event emission.

Mention matching and narration tokenization retain internal Unicode apostrophes. Mention comparison normalizes curly and straight apostrophes to the same form, so a script phrase such as “the model’s output” can resolve against either typography without changing or inferring audio timestamps.

Generated lesson budgets are $0.10 / $0.50 / $0.70 / $1.00 for 60 / 300 / 600 / 1800 seconds. A shortened syllabus uses the cap for its planned duration. Renderer fixtures and golden clips retain the $0.10 cap. Syllabus and module artifacts use the shared content-addressed stage cache.

`pipeline/run.ts` remains an offline S4→S10 runner for supplied SceneSpecs. Retained Attention/math
SceneSpecs are historical artifacts and are not loaded by current tests or used for visual evaluation.
Current plumbing tests use neutral inputs from `__tests__/support/syntheticScenes.ts`; their result
class is `renderer-fixture`, and they make no generated-quality claim. Do not run the old lesson scenes
as a substitute for missing source-generated lessons.

## Progressive delivery and teaching boards (Phase 4/5 engineering)

The live path writes `scene.playable` JSONL events only after a scene has passed its timing-dependent layout and deterministic gates. Events carry run/module/scene identity, a contiguous playable-scene sequence, local duration, descriptor SHA-256, and a run-relative preview location. The descriptor carries exact local aligned words and a content-hashed scene WAV. The loopback player polls during generation, retries transient artifact fetches, and plays the validated scene WAVs in event order.

Cross-process filesystem leases configure host-wide limits through `HYPOTHESIS_PROVIDER_CONCURRENCY`, `HYPOTHESIS_SCENE_CONCURRENCY`, `HYPOTHESIS_S6_CONCURRENCY`, `HYPOTHESIS_TTS_ALIGNMENT_CONCURRENCY`, and `HYPOTHESIS_RASTER_CONCURRENCY` (defaults 2, 4, 2, 2, and 2). Module clips use content-addressed input manifests that include scene data, local audio/captions, canvas, frame rate, font, visual renderer version, and encoder. The frame cache keys exact rendered SVG bytes plus the complete Resvg options and measured render settings, verifies PNG hashes, and defaults to 256 MiB.

Canonical module clips are assembled in syllabus order. Chapter offsets use probed clip durations, and the final MP4 carries H.264 video, AAC audio, chapter markers, and `mov_text` captions. Offline integration tests decode a synthetic assembled MP4 and verify its stream types, chapter bounds, external captions, and audio/video duration within 100 ms. These fixtures prove export plumbing only.

Phase status and evidence are maintained in `docs/HANDOFF.md`: Phase 4 and 5 engineering is implemented and offline-tested, while generated-lesson quality is unmeasured. Two-human word-boundary calibration remains unmeasured, so Phase 3 and publication stay gated. Live RAG-Anything, 1/5/10/30-minute cold/warm runs, 1/3/5-job benchmarks, and human review of complete source-generated lessons remain outstanding.

The golden-case live path (`liveCli.ts`) runs S5→S11 on frozen marked scripts. `lessonCli.ts --source=...`
accepts text, Markdown, PDF, DOCX, and PPTX; PDF pages and office structural text are extracted to a
versioned `SourceDoc` before S2.

S5 calibration is currently explicitly `unmeasured`. The prior scratch-derived
36.5 ms record is preserved only as a withdrawn historical artifact; live runs
may collect diagnostic audio/alignment without that value, but `runLive.ts`
records a hard S5 failure and will not publish. `word_boundary_review.py`
creates blinded audio-only word-boundary packs from provider-generated source
runs; aligner candidates remain in a separate organizer key. A five-source pack
contains 29 clips and 793 words, but no human annotations have been submitted.
The reviewer page now saves progress in browser storage, restores it on reopen,
and disables vote export until every boundary is valid, ordered, and inside its
clip. The resumable pages are in `.data/alignment-review/2026-09-26-five-topic-resumable/participants/`;
their organizer key stays outside that participant tree.

Voice-engine Supertonic/Piper bridges now accept newline-delimited worker requests and cache loaded provider models per process. `VOICE_ENGINE_WORKERS` defaults to 1 because each worker retains model memory; measured scene synthesis timing comes from the provider's synthesis interval, while run stage wall time includes worker queueing. Stable-ts uses `HYPOTHESIS_ALIGNMENT_WORKERS` (default 2, maximum 8), caches models inside long-lived Python workers, and returns each response independently. This checkout has stable-ts 2.19.1, faster-whisper 1.2.1, and cached `base`/`base.en` weights. A repeatable three-run batch of six real scenes from two generated topics measured pool-size-1 p50/p95 at 1.606/1.613 s and pool-size-2 at 1.396/1.399 s; exact token order held in all 18 aligned samples, while five of six scenes had invalid zero-duration intervals in each repeat. The existing CTC diagnostic across the five-source/29-scene pack counted 18 stable-ts zero intervals and zero CTC zero intervals. It compares utterance-edge RMS VAD, not interior word boundaries, so these findings do not calibrate or promote CTC. See `src/experimental/hypothesis/shared/alignment/README.md` and `.data/alignment-review/2026-09-26-five-topic/alignment-worker-benchmark.json` / `ctc-diagnostic-five-topic.json` for exact results. The two-human calibration gate remains open.

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
original hard planner/provider failures.

For matched E5 runs, `lessonCli --stage-cache=<dir>` shares content-addressed S1–S5 artifacts across
separate output directories while S6 keys remain treatment-specific. Run manifests expose prompt
treatment versions and the aligned-audio SHA-256. `harness/e5Comparison.ts` rejects pairs with
mismatched source, narration, alignment, audio, voice, render, content model, or undeclared treatment
differences. This is pair-integrity enforcement, not video-quality evidence.

`judge:e5:human:pack:hypothesis --pairs=<e5-pair-list.json> --dataset=<versioned-heldout-set.json>`
accepts only matched generated-video pairs whose case ID and exact SourceDoc SHA-256 occur in the
declared evaluation set, then creates two self-contained full-timed-video packs with A/B orientation
counterbalanced between judges. The sealed answer key and organizer record are stored outside the
participant folders; run IDs, model/prompt treatment, cost, and provenance are absent from the review
UI. `judge:e5:human:hypothesis --key=<sealed-key.json> --organizer=<organizer-record.json>
--votes=<judge-1.json,judge-2.json>` validates the exact key hash against organizer provenance, then
checks blinded item IDs, run/treatment/cost mappings, and the held-out set hash before scoring. It
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
The offline suite verifies a small real MP4 encode/decode. `npm run preview:hypothesis -- <run-directory>
[port]` starts a loopback-only preview for a completed run. Its browser client loads laid-out scenes,
timelines, aligned words, and optional local audio/captions, then calls the same pure `frameSvgAt`
composition function as MP4 export. The production application's playback path remains separate and
is not used by this experiment. Browser audio synchronization against a generated lesson has not been
validated yet.

`harness/reference/lamina/index.json` attributes `simi-scene01.png` to the photosynthesis video and
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
  blocks the run on missing/forged offsets. Current narration claim coverage is section-level, not precise
  sentence-to-visual-value attribution. PDF scan OCR, embedded figure extraction, and office-native byte
  locations are not implemented.
- This evidence path is covered by offline tests; it has not yet passed a full provider-generated lesson
  provenance audit.

## Drawn in real time

Text-driven widths use resvg's glyph ink bounds at the configured family and
weight. The Kalam Bold binary is bundled with its SIL OFL 1.1 notice, hashed in
`render/fonts.ts`, and loaded with system-font fallback disabled for layout
measurement and worker-based MP4 rasterization. The browser preview serves the
same binary and waits for it before drawing. Box, pill, token strip, meter,
matrix, object-label, and text elements use those measurements; the scene title
and styled text-box fallback fit to them as well. These are ink bounds with
layout padding, not OpenType advance metrics. Text remains SVG `<text>`, not
glyph paths. This is renderer reproducibility work; visual acceptance remains
unmeasured and no archived hand-authored fixture output is current quality
evidence. The font SHA-256 also participates in layout/render/MP4 cache keys
and the run/config identity.

Timing comes from the Lamina reference pack (`harness/reference/lamina/OBSERVATIONS.md`).

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

| Stage | Model | Notes |
|---|---|---|
| S2–S4 | `OPENROUTER_CONTENT_MODEL` (qwen3.8-flash; deepseek-v4.1-flash when the qwen pool is rate-limited, chosen explicitly with `--content`) | a reasoning cap is sent to hidden-reasoning models |
| S6 | `OPENROUTER_SCENE_MODEL`, default `anthropic/claude-sonnet-5` | no `temperature` (Anthropic endpoints reject it); `reasoning.effort: medium`; the SceneSpec schema is too large for Anthropic's grammar compiler, so JSON is requested by the prompt and fully validated by zod |
| Judge | `OPENROUTER_VISION_MODEL` | separate $0.25 cap |

All LLM stages go through `llm/structuredCall.ts`, which provides:
- JSON-candidate extraction and a lenient control-character parse;
- exactly one repair;
- per-call OpenRouter price ceilings derived under the shared ledger lock from the smaller of the remaining stage and lesson-wide budgets, plus prompt/output bounds,
  plus a persistent actual-spend ledger and timeout. Price ceilings use OpenRouter's `provider.max_price`
  in USD per million input/output tokens ([OpenRouter cost controls](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/));
- real cost accounting.

The HTTP client is `llm/openrouter.ts`, which mirrors the production gateway without modifying it.

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
npm run typecheck:hypothesis && npm run test:hypothesis      # offline, no keys needed
npm run strip:scene -- <sceneId> out.png                      # progression strip of a fixture scene (after a build)
npm run run:lesson -- --lesson=all [--content=<model>] [--planner=<model>]
npm run video:one-shot -- --prompt="<learner prompt>" --source=<file>|--url=<url> [--duration=60] [--id=<name>]  # locked single run, provenance in output/
npm run run:hypothesis:live [-- --case=<golden> --planner=<model>]
npm run preview:hypothesis -- <run-directory> [port]                 # loopback browser player
npm run judge:hypothesis -- --runs=.data/hypothesis-runs/claude/lessons [--cache-dir=.data/hypothesis-runs/judge-cache]
npm run judge:human:pack:hypothesis -- --run=<eligible-generated-run-dir> --topic=<declared-topic> [--out=<pack-root>] [--key-out=<sealed-key.json>] [--organizer-out=<organizer-record.json>]
npm run judge:human:hypothesis -- --key=<sealed-answer-key.json> --votes=<judge-1.json,judge-2.json> [--out=<report.json>]
npm run judge:e5:human:pack:hypothesis -- --pairs=<e5-pair-list.json> --dataset=<versioned-heldout-set.json> [--out=<pack-root>] [--key-out=<sealed-key.json>]
npm run judge:e5:human:hypothesis -- --key=<sealed-e5-key.json> --votes=<judge-1.json,judge-2.json> [--out=<report.json>]
npm run catalog:build                                         # rebuild the Streamline catalog + embeddings
npm run catalog:e4:calibrate -- --input=<e4-labeled-pairs.json> [--out=<report.json>]
npm run reference:lamina                                      # rebuild the Lamina reference pack
```

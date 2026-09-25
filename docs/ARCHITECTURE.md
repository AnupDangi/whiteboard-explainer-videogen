# Architecture — Claude hypothesis track (`src/experimental/hypothesis/v1_claude/`)

This is the implementation of the hypothesis in `claude_pipeline.md` and `hypothesis/v1_claude/*.md`. All code
lives under `src/experimental/`. Production code (`src/server.ts`, `src/runtime/*`, `src/gateway/*`, and the
existing renderer) is not modified.

## Pipeline order (fixed; stages are never reordered)

```
LessonRequest (text, Markdown, PDF, DOCX, PPTX + duration)    plan/sourceIntake.ts, lessonCli.ts
  S2  ConceptGraph         content model, zod, exact source   plan/stages.ts buildConceptGraph
                           evidence references + 1 repair    plan/sourceDoc.ts
  S3  TeachingPlan         same content call emits the       plan/stages.ts buildTeachingPlan
                           LessonBible + SceneContracts;     plan/contracts.ts
                           analyser and evidence checks
                           run inside validation
      plan analysis        deterministic F-PED checks        plan/analyze.ts
  S4  NarrationScript      one call per scene, in parallel,  plan/stages.ts writeScript
                           [[id|phrase]] markers, word
                           budget of 2.6 words/s
  S5  TTS + alignment      voice-engine + stable-ts;         pipeline/runLive.ts, shared/alignment
                           retain fractional-ms boundaries; hard-check word clocks before mention resolution
                           English CTC is comparison-only until its timing calibration passes
      mention resolution                                     narration/resolveMentions.ts
      retrieval            top-k Streamline icons for each   catalog/semantic.ts rankConcepts
                           mention (local MiniLM)
  S6  Scene Planner        code compiles typed context, then planner/{context,exemplars,prompt,plan}.ts
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
  S11 encode               resvg -> ffmpeg, erase            export/*
                           transitions, attribution
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

`pipeline/run.ts` remains an offline S4→S10 runner for supplied SceneSpecs. Retained Attention/math
SceneSpecs are historical artifacts and are not loaded by current tests or used for visual evaluation.
Current plumbing tests use neutral inputs from `__tests__/support/syntheticScenes.ts`; their result
class is `renderer-fixture`, and they make no generated-quality claim. Do not run the old lesson scenes
as a substitute for missing source-generated lessons.

The golden-case live path (`liveCli.ts`) runs S5→S11 on frozen marked scripts. `lessonCli.ts --source=...`
accepts text, Markdown, PDF, DOCX, and PPTX; PDF pages and office structural text are extracted to a
versioned `SourceDoc` before S2.

S5 calibration is currently explicitly `unmeasured`. The prior scratch-derived
36.5 ms record is preserved only as a withdrawn historical artifact; live runs
may collect diagnostic audio/alignment without that value, but `runLive.ts`
records a hard S5 failure and will not publish. `word_boundary_review.py`
creates blinded audio-only word-boundary packs from provider-generated source
runs; aligner candidates remain in a separate organizer key. Human annotations
and at least three independent SourceDoc hashes are required before a measured
comparison can be reported. None exists yet.

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
- **Layout growth**: templates are tried at element sizes from 1.6× down to 0.6×. The largest placement
  that fits inside the safe area with no overlaps wins, so small icons are not left in empty space.
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

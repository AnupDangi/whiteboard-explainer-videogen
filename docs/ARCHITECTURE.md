# Architecture — what the codebase actually is

Verified against source on 2026-09-17. Every claim cites `path:line`. Line counts are current.

## 1. Two pipelines, one shared spine

| pipeline | entry | planner | compiler/renderer | flag |
|---|---|---|---|---|
| legacy "explainer" (V1) | `src/explainer/jobs.ts:46` | `src/explainer/planner.ts` | `src/explainer/engine.ts:589` | `VISUAL_PIPELINE=explainer` |
| semantic (V2) | `src/semantic/jobs.ts:45` | `src/semantic/planning/generate.ts:85` | `src/semantic/compiler/compile-scene.ts:15` + `src/semantic/renderer/render-svg.ts:14` | default |

Selection point: `src/semantic/pipeline.ts:8` (code default `semantic`). Route sets are disjoint: `/api/jobs*` vs `/api/semantic/*` (`src/server.ts:207`). The two pipelines share `src/shared/*`, including the single ingestion pathway `src/shared/ingestion/source.ts` (`ingestSource`); `src/explainer/sources.ts` is now a re-export shim so V1 keeps working. This removed the old `semantic/` → `explainer/` import violation.

**There is no shared compile/render path.** V1 uses `explainer/engine.ts`, V2 uses `semantic/renderer/*`. This is deliberate but doubles maintenance.

## 2. Size

```
src/ total                         14,269 LOC / 139 files
  explainer/      (V1)              4,350  (20 files)   planner.ts alone = 1,431
  semantic/planning/                2,044  (11 files)
  semantic/assets/                  1,251  (23 files)
  semantic/          (core)         1,149  (17 files)
  semantic/compiler/                1,061  ( 9 files)   fallback.ts = 357
  semantic/identity/                  927  ( 9 files)
  shared/                             857  ( 9 files)   incl. ingestion/{source,blocks}.ts
  semantic/harness/                   595  ( 9 files)
  semantic/knowledge/                 496  ( 7 files)
  semantic/teacher/                   320  ( 5 files)
  server.ts                           224
  semantic/renderer/                  209  (10 files)
  semantic/scene/                     242  ( 2 files)
  semantic/frontend/                  236  ( 1 file)
  semantic/retrieval/                 131  ( 2 files)
  semantic/source/                     92  ( 2 files)
  semantic/cache/                      84  ( 2 files)
```

## 3. V2 stage chain (authoritative)

Execution order: `src/semantic/planning/generate.ts`. Policies: `src/semantic/harness/stage.ts:11-23`.

| # | stage | owner module | model? |
|---|---|---|---|
| 0 | `ingest` | `explainer/sources.ts` | no |
| 1 | `knowledge-compiler` | `planning/knowledge-compiler.ts` | **yes** |
| 2 | `teaching-architect` | `planning/teaching-architect.ts` | **yes** |
| 3 | `whiteboard-planner` | `harness/state.ts:39` | no |
| 4 | `representation-guide` | `identity/representation.ts:98` | no |
| 5 | `source-visual-grounding` | `knowledge-compiler.ts:256` | no |
| 6 | `visual-director` | `planning/visual-director.ts:135` | **yes** |
| 7 | narration finalize | `planning/narration.ts:4` | no |
| 8 | `tts` ∥ `compiler` | `semantic-timing.ts` / `compiler/compile-scene.ts` | no |
| 9 | `tts-alignment` | `semantic/jobs.ts` | no |
| 10 | `pedagogy-critic` | `critic-repair.ts` | yes (only if `V2_CRITIC=on`) |
| 11 | `render` | `renderer/render-svg.ts` | no |

Only **4 model calls per scene** (knowledge, teaching, architect, director) plus optional critic. Everything else is deterministic.

## 4. Data layers (transforms)

```
ConceptGraph        contracts.ts:10     <- knowledge-compiler.ts
  -> TeachingPlanV2  types.ts:23        <- teaching-planner.ts / teaching-architect.ts
  -> SemanticScenePlan types.ts:22      (nested scenes[])
  -> WhiteboardPlan  contracts.ts:46    <- state.ts:39
  -> VisualSceneV2   types.ts:33        <- intent-adapter.ts:15 directionToScene
  -> CompiledSceneV2 types.ts:42        <- compile-scene.ts:13
  -> SVG string                         <- render-svg.ts:13
```

Known losses between layers:
- `state.ts:22` — `terminology.definition` and `quantities.value` are filled with `canonicalName` (placeholder, not real definitions).
- `identity/registry.ts:15,20,32` — canonical plan path drops `evidenceRefs` and `misconceptions`.
- `intent-adapter.ts:20-26` — parent/child relations dropped for non-containment archetypes.
- `intent-adapter.ts:66` — continuity is reset to `{keepFromPrevious:[], prepareForNext:[]}` in `directionToScene`; the real continuity is re-derived later in `generate.ts:198-206`.

## 5. The constraint that holds

Models emit **validated semantic data only**. Geometry is constructed by trusted code. `renderSVG(scene, timeMs)` is pure and deterministic — no `Date`, `Math.random`, `performance.now`, DOM or env inside `renderer/` or `compiler/` (grep-verified). Browser and export call the same function. This is the central invariant and it is intact.

## 6. Layering of trust

- **Deterministic (no model):** all of `compiler/*`, `renderer/*`, `assets/*`, `harness/{gates,state,registry,journal,stage}.ts`, `identity/{canonicalize,resolver,registry,representation}.ts`, `schemas.ts`, `evaluation.ts`, `semantic-timing.ts`.
- **Model boundary:** exactly one module does network I/O — `planning/model-adapter.ts:39`. Everything model-driven goes through it.

## 7. The second architecture: healing

The system is built to tolerate malformed model output field-by-field. This is effective but is now a parallel design surface:

- `schemas.ts:54-129 healSchema` — ~11 rules (object→array, enum near-miss aliases, empty-string drop, missing arrays, number clamps, parent/child sync). **Entirely unlogged.**
- `compiler/fallback.ts` (357 LOC) — model-free composition repair: demote-to-annotation, break flow cycles, cap primaries, promote/demote hero, inject `=` token, strip archetype-incompatible assets.
- ~24 `*-heal` / `*-fallback` log sites in `semantic/`, **23 more** in `explainer/planner.ts`.
- `compile-scene.ts:57-113` — three collision-repair passes.

Inventory count: 21 distinct `v2.*-heal` tags, ~269 heal/fallback/degrade/clamp/repair tokens across `src/`.

## 8. Layout capabilities (V2)

| archetype | algorithm | location |
|---|---|---|
| flow | longest-path ranking, ≤5 cols | `compiler/archetypes.ts:11-17` |
| cycle | single ring + walk validation | `archetypes.ts:18-27`, heal `visual-director.ts:64-98` |
| transformation / comparison | equal-cell horizontal grid | `archetypes.ts:28-30` |
| cross_section / spatial_process | hero centre + ≤4 margin supports | `archetypes.ts:31-34` |
| numbered_steps | vertical rows | `archetypes.ts:35-37` |
| equation_walkthrough | stacked derivation rows | `archetypes.ts:38-43` |
| matrix_operation | weighted horizontal widths | `archetypes.ts:44-49` |
| branch / cause_effect / state_machine | layered Sugiyama-lite, ≤4 ranks | `archetypes.ts:50-86` |
| hierarchy | BFS tree, leaf-centred, ≤3 levels | `archetypes.ts:87-101` |
| timeline | equal row | `archetypes.ts:102-105` |
| trajectory | parametric curve | `archetypes.ts:106-109` |
| **structural_diagram, convergence** | **no layout branch — zone fallback only** | `compile-scene.ts:32-33` |
| **simple_explanation** | declared in `types.ts:3` but rejected by `zones.ts:5` | `compile-scene.ts:21` |

## 9. Identity layer is half-wired

Two identity systems coexist:
1. `harness/registry.ts:6 LessonSemanticRegistry` — used by the live path.
2. `identity/types.ts SemanticIdentityRegistry` (with `canonicalize.ts`, `resolver.ts`) — largely superseded and mostly test-facing.

`identity/references.ts` was deleted, along with the orphaned exports `normalizeLegacyTeachingPlan`, `buildVisualScene`, `canonicalizeRelation` and `remapContinuityIds`. The live translation is `intent-adapter.ts`. `src/semantic/artifacts.ts` has **four live importers** (`scripts/export-example-video.ts`, `scripts/generate-v2-video.ts`, `scripts/bench-semantic-archetypes.ts`, `eval/live/runner.ts`).

## 10. Dead / partial features

- `simple_explanation` and `chart` archetypes: still declared in `types.ts:4` for legacy/identity compatibility, but rejected by the compiler (`zones.ts:43`) and **no longer advertised to models** — the V2 prompt vocabulary, the teaching/scene JSON schemas and `runtime-schemas.ts` events use `SUPPORTED_ARCHETYPES` only. `structural_diagram` and `convergence` **are** supported through an explicit zone strategy (`zones.ts:47`, `compile-scene.ts:143`).
- Motions: only the members of `MOTIONS` (`types.ts:10`) animate. `move`/`split`/`merge` were removed from the vocabulary rather than left advertised (`types.ts:6-9`).
- Continuity `transitions` (MOVE/REMOVE/REPLACE/REINTRODUCE/TRANSFORM): derived at `generate.ts:287`, validated at `validate.ts:124`, read by `harness/registry.ts:18`, but **the renderer never reads them** (`renderer/scene-state.ts` uses only `keepFromPrevious` + beat actions).
- Relations render even when no action animates them (VISIBLE_STATIC, `renderer/relations.ts:8-27`); the old "edges vanish silently" defect is fixed.
- Anchors: rich subpart anchors exist only for curated assets; everything else is a generic 5-point box that degrades to `center` in 5 places.

## 11. Assets and skills (current truth)

- **Assets: 43 static, plus external retrieval.** 4 direct (`assets/icons/inputs.ts`, `assets/illustrations/plant.ts`) + 39 catalog templates (`assets/templates/catalog.ts:57`). Matching is runtime-computed (`assets/search.ts:3-7`, tiers `identity/representation.ts:47-124`). External icons resolve through `assets/external/*` (Iconify + licence gate + ranker) and normalise through `assets/normalize/*`; `CompiledSceneV2.assetCatalog` threads the resolved geometry into compile/render.
- **Icon system plan: P0–P3b landed** (`renderer/palette.ts`, `assets/normalize/*`, `assets/external/*`, `assetCatalog`, external retrieval wired into `representation-guide`). The P4 cache module exists (`external/cache.ts`) but has no live caller; P7 promotion is not started. See `docs/ICON_SYSTEM_PLAN.md`.
- **Skills: 4 of 14 SKILL.md files actually load.** Only the `# Hard invariants` section is injected (`semantic/skills.ts:31-45`): `visual-director`, `teaching-architect`, `teaching-architect/references/knowledge-compiler.md`, and (v3) `knowledge-compiler`. `test/skill-wiring.test.js` also loads `multilingual-teacher` and `teaching-architect/references/source-visual-grounding.md`. The target classification (runtime / deterministic-invariant / process / deferred) is recorded in `skills/README.md` (`Architecture_plan.md` §31-36, §70); the deterministic-invariant skills stay code+tests, never prompts.

## 12. Where the time goes

A 1-minute video needs 2 scenes. Measured on a real run (`59ca93e3`, 1 scene, 41s output):

| class | share |
|---|---|
| LLM latency (knowledge + teaching + architect + director) | **91.0%** |
| TTS engine | 9.0% |
| deterministic compile + render + gates | **<0.3%** |

Critical path is **100% external model latency plus one serial TTS**. The deterministic compiler and renderer are not a bottleneck. Details and parallelisation targets live in `docs/HANDOFF.md`.

## 13. semantic-v3 front end (W0-W5 landed)

`Architecture_plan.md` is the target architecture. Per its §69 migration rule it is built **alongside** V2 behind `VISUAL_PIPELINE=semantic-v3` (`src/semantic/pipeline.ts`); V2 stays the default until `eval/live/gates.ts:24-34` pass.

W0 (foundation) landed, no runtime behaviour change on the V2 path:

- **Single ingestion pathway** (`Architecture_plan.md` §4): `src/shared/ingestion/source.ts`. Neutral module, imports no pipeline; `src/explainer/sources.ts` re-exports it. `test/frontend-v3-w0.test.js` enforces the layering rules (`shared/` never imports a pipeline; the two pipelines never import each other).
- **Versioned cache skeleton** (`§14`, `§42-43`, `§50-51`): `src/semantic/cache/keys.ts` (source/lesson/scene/render keys + `CACHE_VERSIONS`) and `src/semantic/cache/store.ts` (file + memory stores whose `put` refuses an unvalidated artifact). Not yet wired to a stage.
- **Per-stage routing** (`§54`): `src/shared/model-router.ts` gained `loadV3ModelRouter` and `PLAN_MODEL_DEFAULTS` (vision/graph-map/graph-reduce/teacher-planner/scene-worker/rescue). These are the architecture document's model IDs, overridable by `MODEL_ROUTER` JSON or `OPENROUTER_*_MODEL`; V2 routing (`loadModelRouter`) is unchanged. All plan IDs were verified present on OpenRouter (2026-09-17); a route that stops resolving still fails visibly rather than substituting a fixture.
- `semantic-v3` is accepted by `visualPipeline` and serves the semantic UI (`src/server.ts`).

**W1 (typed source + retrieval) landed:**
- Typed source blocks (`Architecture_plan.md` §5-7): `src/shared/ingestion/blocks.ts` parses heading/text/figure/table/equation/code blocks; `SourceDocument.blocks` is now populated by `ingestSource`, and HTML is serialized to structured text before parsing. Deterministic, no network.
- Semantic chunker (§7-8): `src/semantic/source/chunker.ts` targets ~1000 tokens (max 1500), respects heading boundaries and keeps code/table/equation/figure blocks whole.
- Retrieval (§8-10, §68): `src/semantic/retrieval/bm25.ts` (zero-dep BM25 + RRF fusion over injected vectors) and `sets.ts` (`CoverageSet` = one chunk per top-level section, `FocusSet` = top-K, `graphContext` = union). Vectors are injected, so retrieval stays pure.
- Embeddings boundary (§8): `embedTexts` added to `planning/model-adapter.ts` (the one network module); key-gated and fail-soft to BM25-only.
- Source cache (§14): `src/semantic/source/cache.ts` over `cache/{keys,store}.ts`.
- Tests: `test/semantic-source-retrieval.test.js`.

W2 (knowledge graph + reducer), W3 (teacher planner) and W4 (scene worker + TTS) are not started. Nothing on the new front end is wired into a job yet.

**W2 (knowledge stage) landed:**
- `src/semantic/knowledge/types.ts` + `schema.ts`: `GraphFragment` and `BaseConceptGraph`/`FocusedConceptGraph` contracts, with model-facing JSON schemas. Evidence is mandatory on claims/mechanisms.
- `graph-map.ts` (§11-12, §64): packs document-ordered chunks into 1/2/4/8 concurrent map calls (never one per chunk) and returns `GraphFragment[]`.
- `reducer.ts` (§13, §57): deterministic merge — dedup, alias merge, evidence pruning, central concepts, thesis; drops every claim/mechanism without valid evidence; `gateBaseGraph` rejects unsupported evidence, dangling relations and prerequisite cycles. `focusGraph` narrows by prompt plus one hop, scoping claims/mechanisms via optional `conceptKeys`.
- `graph-reduce.ts` (§13, §61): optional single model reducer; its output is re-reduced deterministically and its evidence is discarded, so a model-authored quote can never become valid evidence. Falls back to the deterministic reducer; never repairs.
- `cache.ts` (§14-15, §51): `BaseConceptGraph` cached by source hash after the gate **and** `assertSchema`, with the schema in `cache/keys.ts`. The base graph is source-owned (built without the lesson objective), so re-using a source across lessons is cheap.
- `index.ts` orchestrator: source → chunks → retrieval context → parallel maps → reducer → cache → focus. Not wired into a job yet.
- Tests: `test/semantic-knowledge.test.js`.

**W3 (teacher planner) landed:**
- `src/semantic/teacher/{types,schema,gate,planner,index}.ts`: `LessonGraph`, `LessonBible`, `SceneContract` + model schema; **one** `teacherPlanner` call returns the whole lesson (never per scene). Duration controls depth (`scenesForDuration`, `depthGuidance`), title/intro policy enforced.
- `gateLessonPlan`: scene count vs duration, closed-world concept/mechanism/evidence/scene-id references across the graph, bible and continuity, duplicate scene ids, prerequisite ordering, archetype support, title policy. `buildLessonPlan` caches by `lessonCacheKey` and treats a malformed entry as a miss.
- Tests: `test/semantic-teacher.test.js`.

**W4 (scene worker + TTS) landed:**
- `src/semantic/scene/worker.ts`: **one** `sceneWorker` call decides narration + visual intent for a batch, output reuses the existing `VisualSceneV2` contract so the compiler is unchanged. Batching: Scene 1 alone, then pairs (`sceneBatches`); parallelism capped at 8; the returned scene-id set must equal the batch's contract ids. `gateSceneIntent` enforces closed-world concepts, candidate archetypes, required-concept coverage and reference integrity.
- `src/semantic/scene/voice.ts`: `VoiceProfile` per lesson, `narrationForScene` (one narration per scene) and a version-sensitive `ttsCacheKey`.
- Tests: `test/semantic-scene.test.js`.

At W4 nothing on the new front end was wired into a job yet; W5 below wires `generateV3`. W5 also still needs routing/session caches/skills consolidation, and W6 (migration A/B) is not started.

**W5 (generateV3 wired) landed:**
- `src/semantic/frontend/generate-v3.ts`: the v3 orchestrator — source → knowledge → one teacher call → scene worker batches → `compileScene` → optional TTS. It yields the same per-scene shape the V2 job loop consumes, so `SemanticJobStore` persists and publishes it unchanged. A failed knowledge/teacher/scene/compile gate **throws**; it never fabricates a PASS.
- `src/semantic/jobs.ts`: `SemanticJobStore` takes the pipeline; `run()` selects `generateV3` when `VISUAL_PIPELINE=semantic-v3` and a parsed source is available, else `generateV2` unchanged. `sourceDoc` is captured from the ingest and stripped from the snapshot. v3 retry is explicitly rejected until resume artifacts exist.
- `src/server.ts`: passes the resolved pipeline into the store.
- `src/semantic/scene/worker.ts`: objects must carry exactly one representation carrier; `assetRef` is rejected because no candidates are supplied yet.
- **Scene-tier cache** (`§42`, §51): `generateV3` reuses a gated `VisualSceneV2` per lesson-graph + contract hash (`sceneCacheKey`), and `SemanticJobStore` supplies a file-backed `v3Cache`. A warm source+lesson+scene cache buys **zero** model calls.
- `skills/knowledge-compiler/SKILL.md`: the knowledge stage's hard invariants are now a real runtime skill, injected by `graph-map.ts` (§31, §33).
- Tests: `test/semantic-frontend-v3.test.js`.

- **Routing/session caching** (`§52-53`): `model-adapter.ts` marks the byte-stable system prefix with `cache_control:{type:'ephemeral'}` and sends `session_id`; `generateV3` supplies `source:<hash>` for knowledge maps and `lesson:<hash>` for teacher/scene stages. Verified against OpenRouter's documented API and live-confirmed.

W5 still needs: the render cache tier and the remaining skills consolidation. W6 (full migration A/B across the matrix) is not started.

**Render-tier decision:** the render cache is deliberately **not** implemented. `renderSVG` is pure and measured at <0.3% of job time (`§12`), so caching SVG buys nothing; the only expensive render artefacts are MP4 frames/segments, and export already streams them to FFmpeg rather than re-rendering the scene. Revisit only if export profiling shows render as a bottleneck.

**Skills consolidation:** the target classification (runtime 3-4 / deterministic-invariant / development-process / deferred) is recorded in `skills/README.md`; no runtime-invariant skill text is left unloaded without an explicit classification. Removing files is deferred until each target stage fully replaces its V2 counterpart.

**Live v3 runs and A/B (2026-09-17):** `generateV3` compiles end to end; on the same 1-minute text source it produced 2 scenes in **14.2s wall / 4 calls / $0.0214** versus V2's 70.0s / 6 calls / $0.0434. OpenRouter research: every shortlist model supports strict structured output, and `openai/gpt-5.6-luna` returns 200 on the exact request when endpoints are available (the earlier 404 was transient endpoint/tier availability; the plan fallback `google/gemini-3.8-flash` served). Twelve real contract defects found live were fixed and gated; three deterministic recovery tiers (flatten → single-hero → minimal single-object scene) guarantee a bad model shape cannot hard-fail a lesson. Under the reproducible `matrix:frontends` run (3 topics, 1 minute, no TTS) v3 passed the duration gate **3/3** while V2 passed **1/3** (one compile `Illegal overlap`, one director `Action has no target`); v3 was 2.6-5.3x faster and ~1.6-1.9x cheaper. Residual: v3 narration-length spread; the one bounded length repair now targets the requested duration (not the teacher's duration sum) and runs on cache hits, which took a real `SemanticJobStore` v3 job to `complete`/`PASS` (52.5s for 60s) with an assembled MP4 — see `docs/HANDOFF.md` "Length-repair root cause".

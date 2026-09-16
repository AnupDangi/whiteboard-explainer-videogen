# Architecture — what the codebase actually is

Verified against source on 2026-09-16. Every claim cites `path:line`. Line counts are current.

## 1. Two pipelines, one shared spine

| pipeline | entry | planner | compiler/renderer | flag |
|---|---|---|---|---|
| legacy "explainer" (V1) | `src/explainer/jobs.ts:46` | `src/explainer/planner.ts:486` | `src/explainer/engine.ts:241` | default |
| semantic (V2) | `src/semantic/jobs.ts:41` | `src/semantic/planning/generate.ts:76` | `src/semantic/compiler/compile-scene.ts:13` + `src/semantic/renderer/render-svg.ts:13` | `VISUAL_PIPELINE=semantic` |

Selection point: `src/semantic/pipeline.ts:4`. Route sets are disjoint: `/api/jobs*` vs `/api/semantic/*` (`src/server.ts:207`). The two pipelines share only `src/shared/*` (logger, model-router, language, voice-engine client) and `src/explainer/sources.ts` (imported by `src/semantic/jobs.ts:12`).

**There is no shared compile/render path.** V1 uses `explainer/engine.ts`, V2 uses `semantic/renderer/*`. This is deliberate but doubles maintenance.

## 2. Size

```
src/ total                          9,791 LOC / 96 files
  explainer/      (V1)              4,493  (20 files)   planner.ts alone = 1,431
  semantic/planning/                1,411  (10 files)
  semantic/identity/                1,025  (10 files)
  semantic/          (core)           940  (16 files)
  semantic/compiler/                  720  ( 9 files)   fallback.ts = 357
  semantic/harness/                   419  ( 7 files)
  semantic/renderer/                  158  ( 9 files)
  semantic/assets/                     98  ( 9 files)
  shared/                             271  ( 6 files)
  server.ts                           224
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
2. `identity/types.ts:83 SemanticIdentityRegistry` — largely superseded.

The entire `identity/references.ts` module is orphaned. `canonicalToPlan`, `normalizeLegacyTeachingPlan`, `buildVisualScene`, `resolveObjects/Relations/Beats`, `canonicalizeRelation`, `remapContinuityIds` have **zero production references** (test-only or none). The live translation is `intent-adapter.ts`.

~35 orphaned runtime exports across 20 files (e.g. `CRITIC_RUBRIC`, `INK`, `PALETTE`, `GENERATION_MANIFEST_VERSION`). `src/semantic/artifacts.ts` has no importer at all.

## 10. Dead / partial features

- `simple_explanation` archetype: declared, rejected by the compiler.
- Motions `move`, `split`, `merge`: accepted by validation (`compile-scene.ts:19`) but `renderer/scene-state.ts:6-15` has no branch — they never animate. `morph`/`replace` do.
- Continuity `transitions` (MOVE/REMOVE/REPLACE/REINTRODUCE): computed at `harness/state.ts:67-79`, validated, but **the renderer never reads them** (`scene-state.ts:4-17` uses only `keepFromPrevious` + beat actions).
- Relations render **only if an action animates them** (`renderer/relations.ts:8`); model-added non-required relations silently vanish.
- Anchors: rich subpart anchors exist only for curated assets; everything else is a generic 5-point box that degrades to `center` in 5 places.

## 11. Assets and skills (current truth)

- **Assets: 43 total** — 4 direct (`assets/icons/inputs.ts`, `assets/illustrations/plant.ts`) + 39 catalog templates (`assets/templates/catalog.ts:57`). All original static geometry, `chalk-ink-v2`. Matching is genuinely runtime-computed (normalised scoring in `assets/search.ts:3-7`, tiers in `identity/representation.ts:47-124`) **over a hardcoded import list** (`assets/registry.ts:7`).
- **Icon system plan: 0 of 7 proposed module groups implemented.** No `assets/external/`, no `assets/normalize/`, no `renderer/palette.ts`, no `assetCatalog`, no `RepresentationSource:'external'` (`representation.ts:12`). `assets/validator.ts:3` explicitly forbids external SVG.
- **Skills: 3 of 13 SKILL.md files actually load.** Only the `# Hard invariants` section (≤10 lines) is injected (`semantic/skills.ts:31-45`). Loaded: `visual-director`, `teaching-architect`, `teaching-architect/references/knowledge-compiler.md`. Stages `whiteboard-planner`, `pedagogy-critic`, `source-visual-grounding` exist but receive **zero** skill text. 19 of 21 reference docs are dead.

## 12. Where the time goes

A 1-minute video needs 2 scenes. Measured on a real run (`59ca93e3`, 1 scene, 41s output):

| class | share |
|---|---|
| LLM latency (knowledge + teaching + architect + director) | **91.0%** |
| TTS engine | 9.0% |
| deterministic compile + render + gates | **<0.3%** |

Critical path is **100% external model latency plus one serial TTS**. The deterministic compiler and renderer are not a bottleneck. Details and parallelisation targets live in `docs/HANDOFF.md`.

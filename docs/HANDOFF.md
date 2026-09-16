# Handoff — state of the project, 2026-09-16

Written after a full read of `src/` (96 files, 9,791 LOC) by five read-only audits. Structure reference: `docs/ARCHITECTURE.md`. Philosophy and non-goals: `AGENTS.md`.

## Waves landed

| wave | commit | result |
|---|---|---|
| **S0** baseline | `9905c41` | layout spacing fix, gate-before-teaching, docs reset, `test/layout-invariants.test.js` |
| **S1** failure ownership | *(this commit)* | `classifyFailure` + harness ownership gate; preflight; `test/harness-routing.test.js` |

Tests: **432/432**. Code graph: **1,736 nodes / 3,737 edges** (`graphify update . --force`).

### S1 measured effect (same prompt, live paid route, 1 scene)

| | before (`s1-smoke`) | after (`s1-smoke-after`) |
|---|---|---|
| director model calls | **2** | **1** |
| director ms | 37,858 | 16,122 |
| routed failures | 0 | 1 (`→ representation-guide`) |
| retries on a non-director failure | 2 | **0** |

The failure was unchanged (`Critical representation degraded: object_sensory-experience`) — which is the point: S1 stops the pipeline from *paying twice* for a defect the director cannot fix, and attributes it to the owner that can. The job still fails; that defect is real work for S3/S4.

Structural proof: `classifyFailure()` now has a production caller (`executeStage`, `stage.ts:91`). Before S1 the classifier had **zero** production callers — it existed only for tests.

## 0. Cleanup performed this session

- Removed `output/` (415 MB), `.data/` (13 MB), `dist/` (1.2 MB). Rebuilt `dist/`.
- Deleted stale docs. `docs/` now holds only: `ARCHITECTURE.md`, `HANDOFF.md`, `ICON_SYSTEM_PLAN.md`. Root: `README.md`, `AGENTS.md`, `PLAN_TO_IMPLEMENT.md`.
- `tasks.md` deleted (its content was duplicated in the old `V4_IMPLEMENTATION.md`).
- Code graph adopted: `graphify` MCP in `opencode.json`, regenerate with `graphify update . --force`.

## 1. What genuinely works (verified)

- **The central constraint holds.** Models emit validated semantic data; all geometry is compiled by trusted deterministic code; `renderSVG(scene, timeMs)` is pure. No `Date`/`Math.random`/`performance.now`/DOM inside `renderer/` or `compiler/` (grep-verified).
- **V2 has a real spine.** One orchestrator (`planning/generate.ts:76`) threads every stage through one harness (`harness/stage.ts:38`) with per-stage owner/timeout/budget/repair policy (`harness/stage.ts:11-23`), one journal, one manifest. Two disjoint pipelines are enforced at `semantic/pipeline.ts:4`.
- **Deterministic layer is verified by tests**: compiler, renderer determinism/escaping, validators, geometry/collision/timeline math, representation fallbacks, harness resume/cancel, cost/route accounting.
- **A real scene has rendered and exported.** Run `59ca93e3` compiled and rendered scene 1 (`Abduction / Sense Experience / Axioms / Induction / Deduction / World Models`, 40.98s) with local TTS audio.

## 2. What is broken or incomplete

Ordered by impact on "generate a clean video".

1. **Layout formula manufactured overlaps.** `compiler/archetypes.ts:56-72` pitched rows at `400/group.length` (100px for a 4-node rank) under 110px rects with a ~166px rect+label block. The layout itself produced the overlaps the compiler then rejected as `Illegal overlap`, and the repair pass could not fix them (hero immovable, `.8` scale floor insufficient, only 6 zones). **This was misdiagnosed in prior handoffs as "director variance".** Fixed this session (bounded layered grid).
2. **Wasted model calls dominate latency.** On the last failed run, **97 of 174 seconds (56%) produced nothing**: a teaching window re-planned after a knowledge failure, and the director called 4× on a scene that could never compile. Validation fires only *after* full generation (`planning/model-adapter.ts:56-60`).
3. **Director action contract is ambiguous to the model.** The model attaches relation refs to `draw`/`morph` actions; resolution then yields a relation-only target, rejected by `validate.ts:80-82`. Seen in 4 of 4 raw director outputs.
4. **Renderer never reads `continuity.transitions`.** MOVE/REMOVE/REPLACE/REINTRODUCE are computed (`harness/state.ts:67-79`) and validated but ignored by `renderer/scene-state.ts:4-17`. Motions `move`/`split`/`merge` are accepted and never animate.
5. **Relations only draw when an action animates them** (`renderer/relations.ts:8`). Model-added relations vanish silently.
6. **`structural_diagram` and `convergence` have no layout algorithm** — they fall back to round-robin zones (`compile-scene.ts:26,32-33`). `simple_explanation` is declared but rejected (`zones.ts:5`).
7. **Identity layer is half-wired**: `identity/references.ts` fully orphaned; ~35 orphaned runtime exports; `artifacts.ts` has no importer.
8. **`healSchema` (`schemas.ts:54-129`) mutates model output with zero logging.**

## 3. Why it is slow, and where parallelisation is missing

Measured share for one completed scene: **LLM 91.0%, TTS 9.0%, deterministic compile+render <0.3%.**

Critical path today (serial):

```
knowledge (11s) -> teaching windows SERIAL (18-54s)
 -> architect scene1 (13s) -> architect scene2 (13s)     <- loop A finishes ALL scenes
 -> director s1 (21s) -> TTS s1 (11s) || compile
 -> director s2 (21s) -> TTS s2 (11s) -> render
```

Already parallel: knowledge windows (`generate.ts:120`), TTS ∥ compile within a scene (`generate.ts:226`).

Missing, with exact sites:

| # | opportunity | site | est. saving (2 scenes) |
|---|---|---|---|
| A | overlap `architect(i+1)` with `render(i)` — loop A runs to completion before loop B starts | `generate.ts:160-171` vs `:172` | ~13s |
| B | overlap `director` across scenes | `generate.ts:209` (loop `:172`) | ~21s |
| C | parallelise teaching windows (serial `await` in a `for`) | `generate.ts:134-141` | ~18s |
| D | parallelise TTS beats inside a scene (serial `await speech` per beat) | `semantic-timing.ts:68-71` | ~7s/scene |
| E | overlap TTS across scenes | `generate.ts:223` | ~11s |
| F | parallelise architect across scenes | `generate.ts:165` | ~13s (overlaps A) |
| G | parallel MP4 export (scenes serial, frames serial, per-segment ffmpeg serial) | `scripts/export-semantic-job.ts:41,53` | 40-70% of export wall |
| H | **kill discarded calls** (validate earlier; teach once) | `model-adapter.ts:56-60` + repairs | 20-100s |

Also: the harness allows absurd ceilings — `knowledge-compiler` 600s (`stage.ts:13`), `visual-director` 360s (`stage.ts:18`), worst case per scene 1,630s. Nothing enforces a job-level deadline tied to `targetMinutes`.

**Time budget is not modelled in reverse.** A 1-minute video should be planned from a latency budget (e.g. ~20-30s/scene), and the harness should shrink `maxScenes`/window counts to fit it. Today `targetMinutes` only sets `maxScenes`; it never budgets model calls.

## 4. What is actually proven vs asserted

- `npm test` = 361 tests, 1,258 asserts, **all fixture/mock**. No test ever calls a real model. Real verification lives in `scripts/live-v2-evaluation.ts` (48-case manifest), outside the default gate.
- **Proven:** deterministic layer, harness resume/cancel, route accounting.
- **Not proven:** that a real LLM produces schema-valid, semantically faithful output; grounding/anti-fabrication; visual adequacy; latency.
- Tests are plant-heavy (`plant` appears 203×; `abduction`/`einstein` 0×). The demo topic leaks into the "generic" eval layer (`semantic/evaluation.ts:21-24`, `semantic/calibration.ts:9-17`).

## 5. Icon system: NOT STARTED

`docs/ICON_SYSTEM_PLAN.md` states this itself. Verified: 0 of 7 proposed module groups exist. No `assets/external/`, no `assets/normalize/`, no `renderer/palette.ts`, no `CompiledSceneV2.assetCatalog`, no `RepresentationSource:'external'` (`representation.ts:12`). `assets/validator.ts:3` explicitly forbids external SVG.

Current behaviour: 43 static assets, runtime *scoring* over a **hardcoded** registry (`assets/registry.ts:7`). Unmatched concepts degrade to a composition family or a labelled primitive — **no dynamic/runtime asset generation**.

This is the gap between us and a system that can visually explain arbitrary concepts.

## 6. Skills: mostly dead markdown

13 `SKILL.md` files exist; **3 load** and only their `# Hard invariants` section (≤10 lines) is injected (`semantic/skills.ts:31-45`). Loaded into `knowledge-compiler`, `teaching-architect`, `visual-director`. `whiteboard-planner`, `pedagogy-critic`, `source-visual-grounding` stages receive **no** skill text although docs exist for them. 19 of 21 reference docs are never read.

## 7. Open questions — needs a decision before more code

1. **Docs set.** I kept `docs/{ARCHITECTURE, HANDOFF, ICON_SYSTEM_PLAN}.md` + root `README.md`, `AGENTS.md`, `PLAN_TO_IMPLEMENT.md`. You said "only two files". Confirm the exact final set.
2. **Icon system: build it or not?** It is the largest single capability gap (dynamic representation for unseen concepts). P0-P2 in the plan needs no network. Do you want it prioritised over fixing visual quality?
3. **V1 pipeline:** 4,493 LOC, still the default (`VISUAL_PIPELINE=explainer`). Delete, freeze, or keep as reference?
4. **Latency target:** what is "Lamina-level" for a 1-minute video — 30s? 60s? This determines how aggressively to cut `maxScenes` and windows.
5. **Budget:** the OpenRouter account's monthly spend cap blocks paid routes; only free routes work, and they are too slow/unreliable for the knowledge stage. This must be raised before any real end-to-end run.

## 8. Wave S1 — what changed

```
src/semantic/harness/contracts.ts   STAGE_OWNERS: the one stage→owner map
src/semantic/repair.ts              classifyFailure(), RoutedStageFailure; RepairOwner retired to = StageOwner
src/semantic/harness/stage.ts       repairIfOwned(): a foreign failure is routed, never repaired
src/semantic/compiler/zones.ts      SUPPORTED_ARCHETYPES is the executable subset
src/semantic/planning/visual-model.ts  unsupported archetypes are rejected before the director call
src/semantic/planning/generate.ts   preflight: archetype capacity + board beat count before the director
src/semantic/planning/visual-director.ts  post-compile integrity failures typed REPRESENTATION (routed)
test/harness-routing.test.js        eight routing acceptance tests
test/layout-invariants.test.js      layered-layout regression (S0)
```

Routing rules, in precedence order: a gate finding names its own stage → `PipelineError.failureClass` names the class → a provider/budget error is `harness`-owned → otherwise the running stage owns it. Rule 4 preserves genuinely stage-owned repairs (the teaching repair executed inside the knowledge stage still works).

Committed. Working tree clean apart from generated artifacts.

### Next: S2 (heal audit + visibility)

`healSchema` (`schemas.ts:54-129`) silently mutates model output with zero logging; ~24 `*-heal` sites in `semantic/`, 23 in the V1 planner. S2 classifies each as NORMALIZATION / SAFE-DETERMINISTIC / SEMANTIC, instruments the semantic ones, and freezes new heal rules. Then S3 makes runtime contracts truthful (static relations, unsupported motions, ignored transitions).

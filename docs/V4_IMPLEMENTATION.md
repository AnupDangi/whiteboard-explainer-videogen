# V4 document implementation — semantic pipeline V2

Source contract: `../../v4_docs/{Architecture(1),Tasks,Tests,Harness,Evalaution}.md`.
The documents call the new runtime **V2**; this is separate from earlier V1 sketch-style
experiments also labeled V2. Branch: `v4-optimization`. No commits or pushes made.

## Current acceptance state

The explainer pipeline remains default. `VISUAL_PIPELINE=semantic` opens the experimental manual-scene lab.
The same lab is available at `/semantic.html` under V1. The feature flag does not reroute the
legacy V1 job API. Automatic V2 generation currently has a separate CLI.

Manual plant: visually inspected in exported PNGs and the live browser. Correct root/leaf
endpoints, five semantic beats, persistent plant, no generic boxes. Initial annotation
collision was found in PNG review and fixed by including text bounds in collision checks.
Do not interpret this review as a blind human pairwise result.

Automatic plant capability passed in live run 09: all ten semantic checks pass; final PNG
inspected. One teaching call plus two director calls cost $0.03532815; scene ready 22.123 s,
reported first playable 22.570 s, estimated silent timing. Earlier failures remain retained.
This opens archetype capability work, not the human-quality or production migration gate. Unsupported archetypes and
motions fail explicitly; they are never silently rendered as a structural scene or boxes.

## Task evidence

| Tasks | Status | Files changed / architectural change | Tests / benchmark evidence | Limitations / next task |
|---|---|---|---|---|
| 0.1–0.2 | Offline baseline captured | `scripts/capture-v1-baseline.ts`: immutable six-case capture, SHA + source hashes, 11 scenes | `output/v4-baseline/manifest.json`; each case has MP4, scene/compiled JSON, contact sheet, timing/cost report. 0/11 static violations. SHA `932af863982eac6d5d0db099c3914c00cd7a7813` | Silent estimated timing. No baseline live LLM/TTS latency claims. MLA/HTTP cases were manually authored; others use existing fixtures. |
| 1.1–1.3 | Implemented foundation | `src/semantic/types.ts`, `schemas.ts`, `pipeline.ts`, server and public V2 viewer | Strict bounded schemas; closed object boundaries, ID/reference/enum rejection; V1 default verified | No migration of persisted V1 jobs. Experimental flag selects preview UI. |
| 2.1–2.3 | Implemented, live gate in progress | `planning/teaching-planner.ts`, `validate.ts`; explicit central concept, claims/mechanisms, evidence and beat registry | Tests cover critical mechanism coverage, duplicate beats, concept identity, state requirements, exact source quotes, fabricated evidence | Evidence membership does not prove factual entailment. Live reliability not yet accepted. |
| 3.1–3.2 | Implemented for initial archetypes | `planning/visual-model.ts`; central concept is model-authored, no topic regex or graph-degree guess | Tests reject unavailable archetypes and preserve central plant | Structural/convergence, transformation/comparison, cross-section/spatial-process, numbered steps, flow and cycle supported. Other families remain explicit errors. |
| 4.1–4.5 | Initial registry implemented | `assets/`: 39 original semantic assets, immutable registry, deterministic ID retrieval, anchors and state metadata | All assets validate; root/leaf, matrix cell/row/column, router expert anchors; unknown candidates fail visibly | Assets outside plant need domain visual evaluation with their archetype compilers. No synthesized SVG or external assets. |
| 5.1–5.5 | Manual capability demonstrated | `examples/semantic/photosynthesis-plant.scene.json`, benchmark case, `scripts/bench-semantic-plant.ts` | Before: V1 plant overview was flow labels. After: central plant with actual subpart arrows; 5 beats, 2.166 s longest static span. PNG and browser inspection completed | Human teaching-quality pairwise still pending. |
| 6.1–6.5 | Core drawing implemented | `assets/geometry.ts`, `renderer/illustrations.ts`, `cursor.ts` | Ordered geometry, exact polyline lengths, outline-before-fill, cursor point/tangent, direct-seek tests | Curves are deterministically tessellated into polylines. Before/after state geometry and morphing not yet implemented. |
| 7.1–7.5 | Structural compiler foundation | `compiler/`: hero-first sizing, zones, semantic anchors, route obstacles, text bounds, semantic collision policies, local annotation repair | Plant compiles; bounds/collision/anchor/serialization tests; impossible routes fail | General repair strategy and remaining nonstructural layouts remain. Complex nesting coverage needs expansion. |
| 8.1–8.3 | Implemented director boundary | `planning/visual-director.ts`; supplied candidates only, eight explicit decisions, semantic relation/beat checks | Mock end-to-end planner/director test; unknown asset and missing relation rejection | Live plant capability passed. Broader reliability pending. Geometry failures do not trigger paid semantic repair. |
| 9.1–9.3 | Implemented freeze boundary | `planning/narration.ts`, `generate.ts`; approved beat prose is frozen after asset/direction feasibility and before speech | Frozen narration + visible speech failure tests | No separate model rewrite call: reuse validated prose to avoid introducing independent facts. |
| 10.1–10.4 | Initial timeline implemented | `compiler/timeline.ts`; exact beat-local anchors, bounded lag, speech timing authority, static interval union | Repeated term, timing mismatch, invalid times, explicit pause tests. Instantaneous reveals do not count as sustained motion | Full timing percentile reporting pending. |
| 11.1–11.3 | Initial pure renderer implemented | `renderer/`; no DOM/env/clock in renderer, browser imports same module as export | Same/fresh-process/JSON-roundtrip tests; browser playback/seek checked, no console errors | Equation/chart/highlight module expansion accompanies later archetypes. |
| 12 | Implemented + calibrated | `src/semantic/vision-judge.ts` (metered vision boundary), `src/semantic/calibration.ts`, `scripts/calibrate-semantic-critic.ts`; deterministic lints still run first | Live: run 1 accuracy 0.889 / not reliable (2 misses, retained); run 2 accuracy 1.0, 0 misses, 0 order flips, 18 calls / $0.0366 in `output/semantic-critic-calibration-02` | One model + one scene; critic is optional and not yet wired as an automatic repair trigger. |
| 13 | Capability passed; human review pending | `scripts/generate-semantic.ts` uses real configured router with shared $0.15 budget, one semantic repair per stage | Run 09: live scene, all ten semantic checks pass, $0.03532815, 22.123 s scene ready; final frame inspected. Earlier failures preserved | Silent estimated timing; no TTS or blind human pairwise result. JSON-object compatibility mode used; strict local schemas still mandatory. |
| 14 | Complete (manual) | All ordered layouts: transformation, cross-section, spatial-process, numbered-step, dependency-flow, comparison, cycle, equation-walkthrough, matrix-operation, hierarchy, timeline, trajectory; structural/convergence share the physical-family compiler | Eleven manual cases export MP4/JSON/contact sheets under `output/semantic-archetypes-07`; focused geometry/semantic/fail-closed tests | Manual fixtures are not live planner coverage; advanced state/motion and graph layout (ELK) remain pending. |
| 15–16 | Pending | V1 preserved | No live performance improvement claimed | Full multi-domain evaluation, calibrated critic, speech, human pairwise and performance gates remain. |

## Validation and reproducible commands

- Baseline `npm test`: 153 tests / 151 pass / 0 fail / 2 skip.
- Full suite after initial V2 stages: 176 tests / 174 pass / 0 fail / 2 skip.
- Latest full suite: 180 tests / 180 pass / 0 fail / 0 skip (76.461 s); after the Kokoro and ElevenLabs removals this covers layout, cycle, dependency-order, equation/matrix, hierarchy, timeline/trajectory, critic calibration, the local voice-engine boundary and existing HTTP regressions.
- HTTP tests require loopback permission. Initial sandbox EPERM was environmental;
  the same tests passed with loopback access. A new test cleanup typo was corrected
  from nonexistent `shutdown()` to the store's `close()`; the hung run was stopped.

```sh
npm test
npm run test:semantic
npm run baseline:v1 -- output/new-immutable-baseline
npm run bench:semantic:plant -- output/manual-plant-review
node --env-file-if-exists=.env dist/scripts/generate-semantic.js output/new-automatic-run
npm run calibrate:semantic:critic -- output/semantic-critic-calibration
echo '{"text":"Local narration check","language":"en"}' | (cd voice-engine && node dist/cli.js)
PORT=3014 VISUAL_PIPELINE=semantic npm start
```

Manual benchmark at `output/semantic-plant-accepted/`: compile 8.38 ms; 100 pure SVG frames
21.09 ms; 36.65 s silent video export 3.39 s at 960×540 / 12 fps; hero 66% of
object rectangle area. These are fixture/compiler measurements, not model or TTS
performance. Later renderer changes require regenerating acceptance artifacts.

## Important implementation boundaries

- V2 schema permits the planned action/archetype vocabulary; the compiler separately
  enforces the implemented capability subset. Unsupported operations throw.
- `JsonModel` queries configured-model pricing, estimates request ceiling before spend,
  records actual usage, and shares a bounded budget across stages. Provider failures,
  truncation and unmetered responses never become fixture success.
- Teaching source grounding checks evidence quote membership and reference coverage;
  semantic factual correctness requires later grounded critique/human evaluation.
- V2 is not the release default. The final migration criteria in `v4_docs/Tasks.md`
  remain open, particularly blind human preference and live end-to-end performance.

## Prompt builder — 2026-09-13

`src/semantic/planning/prompt-builder.ts` is now the single source of truth for V2
stage prompts. `teachingPrompt()` and `directorPrompt()` replace the inline
literals in teaching-planner.ts and visual-director.ts (behavior-compatible
refactor; same baseline rules plus teacher-voice, math-pedagogy and visual
richness rules). `criticRepairPrompt()` is ready for the Wave 2 bounded
critic-repair wiring. `assertPromptVocabulary()` plus `test/prompt-builder.test.js`
pin capability words (ARCHETYPES/MOTIONS) and rule sections so prompts cannot
drift from `types.ts`. New deterministic teacher-voice lints in
`planning/validate.ts` (`lintTeacherVoice`) reject meta-numbered narration
("Step 1", "first step", "next slide") and label-reading-length narration before
TTS. Suite after this change: 183 tests / 183 pass / 0 fail (prompt-builder tests
run in-suite; per-file sums differ only because some suites register tests
conditionally). No model-call or schema changes.

## Archetype expansion review — 2026-09-12

Eleven manual cases now cover DNA replication, tectonic cross-section, MLA compression,
HTTP request flow, numbered caching rules, the water cycle, an equation walkthrough,
matrix multiplication, the memory hierarchy, a Roman timeline and gradient descent. All
exports use estimated silent timing, not live generation performance. The MLA example is qualitative, with a
separate two-vector K/V asset; it does not claim exact matrix dimensions. The plate section
uses an explicit mantle overlay, with the child's semantic zone respected within its parent.
Flow columns derive from dependency edges; cyclic input is rejected by that compiler.
Cycle placement follows one closed directed loop and assigns facing ports. Physical water
stages use curated ocean/vapor/cloud/runoff geometry, not placeholder rectangles.

Frame review found normalized SVG path lengths rasterizing as dotted primitive outlines.
Primitives now use explicit measured polyline geometry, matching illustration rendering.
Hero/occupancy diagnostics apply only to structural/spatial families.

Next: wire the calibrated judge into a bounded critic-repair path and add remaining
state/motion operations. Then connect V2 to actual speech and progressive jobs before the
full multi-domain/performance/migration evaluation.

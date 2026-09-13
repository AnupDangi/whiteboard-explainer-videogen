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

## Live end-to-end run + model config — 2026-09-13

First successful live V2 job through the new synchronous path: job `94117016`,
status `complete`, one `convergence` scene, **$0.022144**, firstPlayable /
sceneReady **17.4 s**, estimated silent timing (no TTS). Objects: hero plant +
sunlight/water/CO₂ supports on real assets; relations terminate on plant
anchors leaf.top / roots / leaf.right; five beats match the teaching plan. One
advisory diagnostic: narrated static interval >3500 ms. Live split: teaching
7.4 s, director 10.0 s, compile 0.4 ms, TTS 0 (silent).

Root cause of the preceding failure streak: `.env` routed V2 teaching to
`google/gemini-2.5-flash-lite`. Probes: `json_schema` strict mode on
`gemini-3.8-flash` returns an empty object (`{}`), while `json_object` returns
the full valid plan. This repo's custom schema subset is not compatible with the
provider's strict structured-output path, so `V2_JSON_MODE=object` is required
(as the earlier handoff noted) and the models are now teaching/director/vision =
`google/gemini-3.8-flash`.

Deterministic robustness heals added so accepted provider output is repaired
locally instead of paying for repairs: schema-level (array-from-object,
missing required arrays, single-value version default, `part_of` and motion-verb
enum aliases, numeric clamp, parent/child sync, action target purity,
`hidden`→`neutral`), planner-level (derive empty `requiredConceptIds` and
undeclared relations from beats, continuity concept mapping, attach uncovered
critical requirements, drop implicit structural relations), director-level
(accept required relations via hero/subpart anchors or either-direction concept
pairs, drop stray relation-objects, map `prepareForNext` concepts to objects,
degrade unknown anchors to `center`), one bounded re-direction on proven
geometry failure, and a `length`-truncation retry at ×1.5. Suite after this
change: 204 tests / 204 pass / 0 fail. This run is a feasibility result for OUR
implementation; it does not establish teaching efficacy or live TTS latency.

## Richer visuals capability — 2026-09-13

Wave 4 additions, all deterministic: (1) state variants — `before` renders the
highlighted part set dimmed (stroke-opacity .55), `after`/`morph`/`replace`
actions are compiled (previously rejected as unimplemented) and render a state
badge that fades in with morph progress; the compiler no longer requires assets
to declare `before`/`after` state maps (Task 6.5). (2) Multi-line equation
renderer — derivation lines reveal one at a time, completed lines dim to 0.75
opacity, the active line gets a green wash tied to emphasis (supports the
math-pedagogy prompt rules). (3) Branch/cause_effect/state_machine layered graph
layout — deterministic longest-path ranking + sorted barycenter-lite placement,
2–10 nodes, ≤4 layers, ≤4 per layer, cycle rejection (deterministic Sugiyama-lite
in lieu of an ELK dependency; physical families still never pass through graph
layout, Task 7.5). (4) General repair for non-structural archetypes — nudge
within zone then scale-down .9/.8 before declaring an illegal overlap, matching
the structural repair's philosophy (Task 7.4). (5) Asset registry 39 → 43:
refrigeration cycle (compressor/condenser/evaporator with flow ports) and
economy price-level for the Phase 15 inflation case. Tests: 6 new cases
(morph badge, dimmed before state, per-line equation reveal, layered branch
layout, general repair path, new asset validation). Suite after this change:
204 tests / 204 pass / 0 fail. Renderer changes require regenerating acceptance
artifacts (`output/semantic-plant-accepted/`) before any new fixture claims.

## Synchronous progressive V2 jobs — 2026-09-13

`src/semantic/jobs.ts` adds a `SemanticJobStore` (durable per-job snapshots under
`.data/semantic/`, bounded to 2 active jobs, prompt/language/archetype/budget
validation, failure taxonomy mirroring V1's classifyError). Each `generateV2`
yield is committed as a scene snapshot the moment it is ready; `firstPlayableMs`
is recorded when the FIRST scene commits, not when the job completes. Server
routes: `POST /api/semantic/jobs`, `GET /api/semantic/jobs/:id` (polling
fallback), `POST /api/semantic/jobs/:id/cancel`, and
`GET /api/semantic/jobs/:id/stream` — an SSE stream that pushes each scene as it
becomes ready with offset-based resume (`?from=N` replays only scenes the client
is missing; a completed job replays its full scene list then `end`). Semantic
audio is served at `/media/semantic/<job>/<scene>.wav`. The semantic viewer
(`public/semantic.html`) gains a live generation panel: SSE scene push with
prebuffering of later scenes while the first plays, automatic polling fallback on
stream error, and firstPlayable display. Language is plumbed from the job into
`createVoiceEngineSpeech`. Tests: 7 new cases (lifecycle, silent mode, input
validation before any model call, error-vs-partial, taxonomy, SSE push+resume,
polling fallback) using a deterministic mock model — no provider keys. Suite
after this change: 198 tests / 198 pass / 0 fail. No live provider run was
executed in this change; measured latency claims remain pending.

## Critic-repair wiring — 2026-09-13

`src/semantic/contact-sheet.ts` renders event-aligned frames (initial, after each
beat's last action, final) through the exact pure browser renderer into one labeled
SVG sheet; verified rasterizable by sharp. `src/semantic/critic-repair.ts` wires
the calibrated vision judge into the generation loop: deterministic lints run
first ($0, hard findings throw before any judge call), then a pairwise judgment
(A/B and B/A so position bias is measured), and at most ONE director repair call
using `criticRepairPrompt` from the prompt builder. Repairs are constrained:
scene identity, beat IDs and narration text must survive; the repaired scene must
pass deterministic preflight again. `generateV2` accepts an optional `judge`; the
critic path activates only when `V2_CRITIC=on` AND a judge is supplied, and adds
`criticMs`/`criticRepairs` to StageMetrics. Judge calls remain metered and
budget-capped by `vision-judge.ts`. Tests: 8 new cases (event alignment, sheet
rasterization, accept-with-zero-model-calls, one-repair bound, position-bias
union, preflight-before-judge, narration/identity protection). Suite after this
change: 191 tests / 191 pass / 0 fail. No live calibration run was executed in
this change; the critic remains optional and its earlier calibration results
(run 2 accuracy 1.0) are unchanged.

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

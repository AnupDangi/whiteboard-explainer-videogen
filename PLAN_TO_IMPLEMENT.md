# Harness-Controlled Teaching Compiler Refactor

## Summary

Refactor semantic V2 into a versioned teaching compiler while preserving the deterministic compiler, renderer, browser/export parity, V1 pipeline, job persistence, SSE delivery, TTS adapters, and current evaluation corpus.

The harness—not any agent—will own execution order, canonical identity, learner state, visual continuity, model selection, budgets, retries, validation, repair routing, timeline state, persistence, and release gates.

For passive video, `LearnerState` represents expected knowledge established by validated teaching beats. Actual comprehension remains an evaluation result. Failed critical gates retain diagnostic partial artifacts but produce no publishable MP4.

## Implementation phases

### Phase 0 — Baseline and contract freeze

- Preserve all existing dirty-worktree changes.
- Record commit, configuration, model route, prompt/skill, schema, asset, and benchmark hashes.
- Capture current deterministic tests and live benchmark results as the comparison baseline.
- Classify existing V2.1 work as reusable, incomplete, or superseded; do not rebuild typed representation, continuity, speech, telemetry, or contact-sheet features that already satisfy the new contracts.
- Keep `VISUAL_PIPELINE=explainer` as the default throughout migration.

### Phase 1 — Harness kernel and stage isolation

- Introduce a single `TeachingHarness` orchestrator with this logical pipeline:

  `ingest → knowledge-compiler → teaching-architect → whiteboard-planner → representation-guide/source-visual-grounding → visual-director → deterministic compiler → TTS/alignment → pedagogy-critic → render`

- After narration is frozen, execute visual compilation and TTS concurrently; the logical stage order remains visible in persisted provenance.
- Give every stage typed input, typed output, validator, one owner, cost allocation, deadline, retry policy, and artifact location.
- Agents receive only their stage input and schema. They cannot call other stages, mutate harness state, select models, alter budgets, execute tools, or emit SVG, coordinates, code, runtime IDs, or pipeline instructions.
- Persist an append-only stage journal so interrupted jobs can be inspected and safely resumed from the last validated boundary.
- Compile local skill instructions into versioned stage prompts; store hashes and never allow skill text to become executable runtime control.

### Phase 2 — Knowledge compiler

- Produce a source-grounded `ConceptGraph` before lesson planning:
  - canonical concepts and aliases;
  - prerequisite DAG;
  - mechanisms and state transitions;
  - terminology;
  - claims, quantities, and evidence spans;
  - source figures and their provenance.
- Collapse aliases deterministically and reject ambiguous or conflicting canonical identities.
- Validate evidence references against the ingested document.
- Use source material as the factual authority by default. External assets may be resolved with provenance, but external factual claims require an explicitly enabled grounding policy.
- For long documents, build one global graph and lesson arc, then process bounded chapter windows against that shared state to preserve 30–60 minute continuity.

### Phase 3 — Learner model and teaching architect

- Add immutable learner-profile input with a default beginner profile and an evolving expected `LearnerState`.
- Make the teaching architect emit a `TeachingContract` for every beat:
  - learner-before and learner-after;
  - objective and motivating question;
  - prerequisites;
  - teaching strategy;
  - mechanism to explain;
  - likely misconception and correction;
  - worked example, prediction, retrieval prompt, or checkpoint where appropriate;
  - expected learner-state update.
- Enforce topological prerequisite order, terminology-before-use, one primary learner delta per beat, bounded new concepts, and complete mechanism coverage.
- Validate the complete lesson arc before visual planning. Repair only the failed teaching contract once.

### Phase 4 — Whiteboard planner and persistent semantic identity

- Convert each validated `TeachingContract` into narration segments and semantic scene intent.
- Replace scene-local concept identity with a lesson-wide `semanticKey` registry owned by the harness.
- Emit canvas diffs rather than independent full-scene reinvention:
  - `PRESERVE`;
  - `TRANSFORM`;
  - `INTRODUCE`;
  - `RESET`, allowed only at validated conceptual boundaries.
- Map those intentions deterministically to existing runtime continuity actions:
  `KEEP`, `MOVE`, `TRANSFORM`, `REPLACE`, `REMOVE`, and `REINTRODUCE`.
- Preserve concept identity, representation family, color role, semantic parts, established terminology, and reusable geometry across chapters.
- Reject unexplained resets, duplicate teaching beats, narration without visual support, and reintroduction under conflicting aliases.

### Phase 5 — Representation and source grounding

- Promote the existing representation code into a harness-owned service with typed requests, candidates, provenance, confidence, compatibility, states, parts, anchors, and degradation severity.
- Apply the fixed resolution chain:

  `trusted asset → semantic asset → composition → domain template → constrained synthesis → semantic abstraction → failure`

- Keep `representation-guide` deterministic: relationship and cognitive intent select suitable archetype families.
- Let `source-visual-grounding` select source figures, verified real assets, or semantic canvas representations only when they improve understanding.
- Treat decorative assets as invalid and generic-box downgrade of a critical concept as a hard teaching failure.
- Retain safe declarative synthesis only: models describe semantic parts; deterministic code creates and validates geometry.
- Cache validated representations by semantic, style, source, and content hashes.

### Phase 6 — Visual director and compiler boundary

- Restrict the visual director to visual decisions over validated teaching and representation inputs.
- Its output contains semantic object choices, emphasis, focus, and continuity decisions—not facts, pedagogy, geometry, IDs, SVG, or animation code.
- Validate that each visual action encodes meaning and that active objects, focal areas, simultaneous motion, and new terms remain inside cognitive-load limits.
- Adapt the validated direction into the existing `VisualSceneV2`.
- Leave layout, containment, routing, collision handling, text fitting, anchors, geometry repair, and rendering deterministic.
- Keep `renderSVG(scene, timeMs)` pure and seek-independent.

### Phase 7 — Narration, speech, and semantic timing

- Freeze narration per teaching beat only after teaching and representation feasibility pass.
- Run TTS per semantic segment so exact segment durations exist even without word alignment.
- Preserve buffered Supertonic/Piper compatibility and the optional streaming speech interface.
- Use timing provenance in this order:
  `provider timestamps → aligner timestamps → semantic-segment timing → estimated words`.
- Bind visual actions to important spoken anchors, not every word.
- Detect signed anchor lag, action gaps, unintended narrated no-change intervals, late critical reveals, and unnecessary resets.
- Allow pauses only when explicitly declared in the teaching contract.
- A speech failure remains visible; it cannot silently become a successful narrated job.

### Phase 8 — Pedagogy critic and targeted repair

- Run deterministic gates before the model critic.
- Make the pedagogy critic return binary findings for:
  - prerequisite violation;
  - missing learner delta;
  - mechanism not explained;
  - continuity loss;
  - cognitive overload;
  - unsupported or ungrounded claims;
  - duplicated teaching;
  - missing visual support;
  - unacceptable representation degradation.
- Use typed `StageFailure` objects with class, owner stage, code, message, context, before/after values, and provenance.
- Route repair only to the owning stage:
  - semantic defects → knowledge compiler, teaching architect, or whiteboard planner;
  - representation defects → resolver/source grounding;
  - visual-choice defects → visual director;
  - geometry defects → deterministic compiler;
  - timing defects → timeline;
  - speech/provider defects → speech or model router.
- Permit one targeted repair per failed stage. Revalidate that stage and all downstream deterministic invariants without regenerating upstream work.
- After exhaustion, mark the job `FAIL`, retain committed scenes and diagnostics, and withhold final MP4 publication.

### Phase 9 — Jobs, API, UI, and observability

- Preserve existing job, SSE, media, renderer, and export interfaces; add fields rather than creating a second job system.
- Expose:
  - current stage and stage owner;
  - validated learner progression;
  - continuity decisions;
  - gate outcomes;
  - model route and fallback;
  - per-stage latency, tokens, and cost;
  - repairs and degradations;
  - final `PASS`, `FAIL`, or operational `PARTIAL`.
- Stream validated scenes for preview, but enable final MP4 only after global teaching, continuity, speech, compile, and render gates pass.
- Store all stage inputs/outputs, evidence, validated IR, compiled scenes, audio, diagnostics, hashes, and reports beneath the existing job artifact tree.
- Never expose provider secrets or full environment values in hashes or UI.

### Phase 10 — Evaluation and migration

- Separate renderer-generalization evaluation from coherent teaching evaluation.
- Keep the fixed 48-case corpus and add coherent lesson suites for photosynthesis, DNA, attention/MLA, HTTP, compression, equations, matrices, routing, cycles, timelines, and trajectories.
- Add fixed long-form document cases, including the DeepSeek report, to test global lesson structure, canonical identity, repetition, and chapter continuity.
- For each coherent architecture wave:
  1. run typecheck, build, deterministic tests, schema/property tests, and browser/export parity;
  2. run fixed fixture regressions;
  3. run 48 cases × 3 narrated repetitions with provider failures preserved;
  4. generate machine-readable and Markdown before/after reports.
- Track Truth, Teaching, Visual, Timing, Continuity, Reliability, Performance, and Cost separately.
- Evaluate comprehension outside generation using factual, mechanism, and transfer questions. Compare expected learner-state changes with independent evaluator and human results.
- Calibrate model critics on controlled corruptions in both pairwise orders before using them as release gates.
- Add blind V1-versus-V2 human comparisons and a smaller real-learner pre-test/post-test/retention protocol.
- Update `docs/HANDOFF.md`, `docs/RESULTS.md`, and the existing V4 architecture documents after each accepted wave.

## Public interfaces and data contracts

- `ConceptGraph`: canonical concepts, aliases, prerequisites, mechanisms, claims, evidence, terminology, quantities, and source visuals.
- `LearnerProfile`: level, goals, language, assumed knowledge, and optional constraints.
- `LearnerState`: expected established concepts, mental models, terminology, unresolved questions, misconceptions addressed, checkpoints, and provenance.
- `TeachingContract`: learner delta, motivation, prerequisite set, teaching strategy, mechanism, misconception, checkpoint, evidence, and state update.
- `WhiteboardPlan`: semantic narration segments, semantic objects, relations, and persistent canvas diffs.
- `SemanticRegistry`: canonical concept key to persistent visual identity, representation family, semantic parts, style role, state, and scene instances.
- `StageEnvelope<T>`: stage/version, input hash, output, validator result, model/skill/prompt hashes, token/cost/latency data, and repair attempt.
- `StageFailure` and `GateResult`: typed ownership, severity, failure context, repair scope, and final PASS/FAIL.
- `HarnessRunManifest`: complete reproducibility metadata and aggregate job accounting.
- Extend semantic job input additively with learner profile, grounding policy, target duration, and harness version.
- Preserve `VisualSceneV2`, `CompiledSceneV2`, renderer, SSE, and MP4 contracts unless an additive provenance field is required.

## Test and acceptance plan

- Schema tests prove agents cannot submit runtime IDs, coordinates, SVG, code, unknown fields, or execution directives.
- Knowledge tests cover alias collapse, prerequisite cycles, evidence validity, terminology, quantities, and long-document graph consistency.
- Teaching tests cover learner delta, prerequisite order, misconceptions, worked examples, checkpoints, duplication, and cognitive-load limits.
- Continuity tests cover all six runtime actions, stable semantic identity, geometry reuse, chapter boundaries, and justified resets.
- Representation tests cover every fallback tier, provenance, degradation severity, asset safety, semantic parts, and generic-box rejection.
- Repair tests prove exactly one owning-stage repair and no full-pipeline regeneration.
- Timing tests cover segment timing, provider/aligner/estimated provenance, repeated spoken anchors, lag, pauses, static intervals, and speech failures.
- Job tests cover interruption, resume, partial diagnostics, failed-gate MP4 withholding, progressive previews, cancellation, and accurate cost aggregation.
- Renderer tests retain finite geometry, containment, deterministic seeking, browser/export parity, contact sheets, and `ffprobe` validation.
- Migration gates:
  - compile success ≥99%;
  - full narrated job success ≥95%, moving toward 98%;
  - critical claim, mechanism, and relation coverage 100%;
  - prerequisite violations zero;
  - unacceptable representation degradation near zero;
  - continuity score >90% with unexplained resets near zero;
  - narrated first-AV P50 ≤12 seconds initially;
  - browser/export determinism unchanged;
  - blind human preference for V2 ≥70%;
  - positive comprehension gain on factual, mechanism, and transfer questions.

## Assumptions and approval boundary

- `LearnerState` is expected instructional state, not claimed actual mastery.
- Failed critical gates retain debug artifacts and previewable committed scenes but produce no final MP4.
- V1 remains available and remains the default until migration gates pass.
- Existing V2.1 components are reused when they satisfy these ownership rules.
- Existing dirty-worktree changes are preserved; no destructive cleanup, commit, push, or repository publication is included.
- Live provider failures remain failures, and estimated timing remains labeled as estimated.
- Paid benchmark runs use explicit per-run and aggregate harness budgets with complete accounting.
- Implementation begins only after explicit approval of this plan.

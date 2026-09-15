# Grounding selection implemented; remaining gaps declared, 2026-09-15

Plan-gap audit against PLAN_TO_IMPLEMENT.md found one actionable stub and one
policy decision. Fixed: source-visual-grounding now deterministically selects
source figures by caption-to-concept match against the scene's required
concepts, records rejection reasons per figure, and advisories when nothing
matches; groundedSourceVisualIds no longer blanket-passes every figure.
Declared, awaiting user decision: `groundingPolicy:source-plus-verified`
currently behaves as source-only because there is no verified-external-claims
channel; the director path keeps a legacy full-scene fallback behind the
required semantic `direction` contract. The deterministic pedagogy gates cover
every plan category; the calibrated VLM judge remains optional (V2_CRITIC).

Verification: `npm run typecheck` clean; `npm test` **312/312 pass, 0 fail**;
`git diff --check` clean.

# Full check pass, 2026-09-15

Cold-build verification from the working tree: `git status` clean of code
changes, 10 functional commits on top of `26658c0`, `npm run typecheck`
clean, `npm test` **311/311 pass, 0 fail** (two runs; one `semantic job
lifecycle` flake under parallel load passed on rerun and in isolation),
`git diff --check` clean, renderer purity spot-check clean (no wall-clock
state in `render-svg.ts`), `VISUAL_PIPELINE` default `explainer` confirmed.

Phase-by-phase code audit against `PLAN_TO_IMPLEMENT.md`: Phases 0-10
verified in code (kernel contracts, knowledge compiler, architect stage,
board alignment, resolver chain + synthesis validation, director/compiler
boundary, per-segment TTS, repair routing, job gating + resume, eval corpus
+ comprehension protocol + migration gates). One audit finding fixed this
pass: local skills were documentation only. `skillContract` now compiles
each skill's `SKILL.md` into a versioned stage contract - its exact content
hash lands in stage envelopes and its Hard invariants are appended as
non-executable prose to the knowledge-compiler, teaching-architect and
visual-director instructions, with drift pinned by tests.

Final live check of the day: resume replayed the five completed grounded
stages at 0 ms ($0.012 total, one call) and the director hung both 150 s
attempts inside its 300 s budget - the same provider latency wall, not a
code failure. Today's provider spend ~$0.57. The system is ready for the
48x3 narrated benchmark and the machine-evaluated migration gates as soon
as OpenRouter routes answer within the 150 s request timeout.

# Phase 10 local completion: comprehension protocol, long-form case, migration gates, 2026-09-15

- Comprehension protocol fixtures (plan Phase 10): every smoke case plus the
  new long-form case carries fixed factual/mechanism/transfer questions.
  `expectedLearnerCoverage` scores them structurally against the final
  expected learner state — explicitly NOT a comprehension claim; real
  comprehension still requires the independent evaluator + human protocol.
- Fixed long-form document case: `deepseek_mla_report`
  (`eval/live/cases/deepseek-report-excerpt.md`, 12.4 KB, 3 chapters) drives
  the chapter-window pipeline (fixture exceeds the 12k window threshold;
  verified ≥2 windows), testing global lesson structure, canonical identity
  and cross-chapter continuity with `maxScenes:4`.
- Machine-readable migration gates (`eval/live/gates.ts`): the eleven plan
  gates (compile ≥99%, full job ≥95%, critical coverage 100%, prerequisite
  violations 0, unexplained resets 0, continuity >90%, first-AV P50 ≤12 s,
  representation degradation, determinism, blind preference ≥70%, comprehension
  gain) evaluate automatically in every aggregated report JSON and Markdown.
  Human-dependent gates report `pass:null` and fail closed.
- The 48×3 narrated benchmark itself remains gated on provider stability;
  when it runs, the gates evaluate automatically.

Verification: `npm run typecheck` clean; `npm test` **308/308 pass, 0 fail**
(5 new in `test/eval-gates.test.js`); `git diff --check` clean.

# Root-cause pass on the live blocker, 2026-09-15

The "provider bimodality" was decomposed into concrete causes with data:
1. **Request timeout was cutting off healthy calls.** Observed gemini
   successes ran 13–127 s; the 120 s request timeout aborted slow-but-valid
   responses mid-flight (the 127 s knowledge success would have died).
   Request timeout raised to 150 s; visual-director stage deadline 300 s.
2. **Mode hypothesis disproven**: the earlier "standalone probe vs job"
   difference was not `V2_JSON_MODE` — both contexts use the same .env
   object mode; 2/2 object-mode probes succeeded.
3. **Resume proven at full scale**: after one run journaled knowledge (127 s)
   + architect (12 s) + board + representation + grounding OK, the retry
   replayed all five stages at 0 ms with zero model calls and spent $0.012
   total, running only the failed director.
4. What remains is genuinely provider-side: gemini alternates between
   compact valid JSON (~2-8k tokens, 13-130 s) and verbose truncation
   chains (>12k tokens at a 12k/18k budget) across time windows; qwen and
   deepseek hang to the request timeout. Route health correctly deprioritizes
   hung routes on the next stage; the director then failed twice at 150 s
   each in the final attempt. No narrated scene completed today; total
   provider spend today ~$0.55, program < $1. Recorded as the
   infrastructure baseline for the 48×3 benchmark.

Recommended next lever (not implemented): route the knowledge/director calls
to whichever provider currently answers fastest, learned per-window from
route-health telemetry, or run the benchmark when OpenRouter routes recover;
`SemanticJobStore.retry` now makes such retries cheap because completed
stages replay for free.

Verification: `npm run typecheck` clean; `npm test` **303/303 pass, 0 fail**;
`git diff --check` clean.

# Provider resilience: verbosity caps and route health, 2026-09-15

Two bounded changes target today's observed provider failure modes:
- Knowledge/architect schemas now cap verbosity at the contract level
  (prerequisite reasons 160 chars, mechanism/claim statements 400,
  terminology definitions 200, evidence quotes 600; architect
  objective/motivation 160, misconception/checkpoint 200). A standalone live
  probe confirmed the effect: gemini compiled a valid 7-concept graph in
  20.5 s (previously the same call emitted >12k completion tokens and
  truncated twice at the 1.5x retry budget).
- `createJsonModel` now keeps process-level route health: a model that hung
  to the request timeout is retried last (successes clear the debt). Test
  pins the ordering across two stage calls with a mock provider.

Live check after the fixes: gemini remains bimodal in-job (one standalone
success, two in-job length-truncation chains; one qwen 120 s hang caught by
route health on the following attempt). No narrated scene completed; recorded
as provider-infrastructure baseline, ~$0.25 spend today. The grounded
knowledge → teaching → architect → board → representation → grounding prefix
has already been journaled OK live (2026-09-15 entries below); the director
remains the only unproven stage, awaiting stable provider routes.

Verification: `npm run typecheck` clean; `npm test` **303/303 pass, 0 fail**
(one new route-health test); `git diff --check` clean.

# Viewer resume UI, hash stability fix, live provider baseline, 2026-09-15

The Semantic Lab now offers "Resume from last checkpoint" for
error/interrupted/partial/cancelled teaching-compiler jobs (`POST
/api/semantic/jobs/:id/retry`, shown only for `teaching-compiler-v1` runs);
route and malformed-id behavior pinned by tests. Fixed two console errors on
the Semantic Lab page (CSP inline-style moved to a `.section-heading` class;
favicon request suppressed). Verified in-browser: resume button renders
hidden on a fresh page, zero console errors.

Root-caused and fixed a resume-critical defect: `stableHash` was not stable
across JSON round-trips — explicit `undefined`-valued keys survived in live
stage inputs but were dropped by journal serialization, so replayed stages
never matched their own journal entries. `stableJson` now skips undefined
object values and undefined array items, making input hashes round-trip
stable (proven by the 302-test suite; journal entries written after this fix
resume exactly).

Live provider baseline (4 grounded runs today, ~$0.18 total, all failures
preserved): the full grounded prefix — knowledge-compiler, teaching-architect,
whiteboard-planner, representation-guide, source-visual-grounding — completed
and journaled OK in the best run (gemini knowledge 43 s, architect 12 s);
journal resume replayed a completed knowledge stage at 0 ms cost with zero
model calls. Remaining blocker is provider throughput/latency, not contracts:
gemini intermittently emits verbose >12k-token knowledge JSONs that truncate
even at the 1.5x retry budget, and the qwen/deepseek fallbacks hang to the
120 s request timeout. No narrated scene completed; migration gates remain
unevaluated. Total provider spend remains under $1 for the whole program.

Verification: `npm run typecheck` clean; `npm test` **302/302 pass, 0 fail**;
`git diff --check` clean; browser QA at 127.0.0.1 with zero console errors.

# Phase 7 per-semantic-segment TTS timing, 2026-09-15

Narration is now synthesized per teaching beat (`src/semantic/
semantic-timing.ts`): each beat segment gets an exact real duration from TTS,
scene audio is concatenated deterministically (`joinWav`, strict RIFF/fmt
validation — mismatched formats refuse loudly), and the composed timeline gets
`timingSource:'semantic-segment'` with exact segment starts and proportional
word boundaries inside each segment. When a provider returns real word
timestamps (provider/aligner), those win verbatim, offset per segment.
Single-beat narration keeps the previous single-call path. Any segment
failure, mixed format, or invalid WAV propagates — a speech failure never
becomes silence. Existing buffered Supertonic/Piper providers and the optional
streaming adapter are untouched; `TimingSource`/`SpeechTimingSource` gained
`semantic-segment` additively.

Verification: `npm run typecheck` clean; `npm test` **302/302 pass, 0 fail**
(296 + 6 new in `test/semantic-timing.test.js`; fake speech mocks updated to
valid minimal WAVs via `test/wav.js`); `git diff --check` clean. Real bundled
voice-engine check: two-beat per-segment synthesis joined into one valid
RIFF/WAVE (4876 ms audio, 430 KB, 10 words, exact segment starts) in 2.5 s
wall time. The scene timeline now equals summed real segment durations
instead of one estimated whole-scene estimate.

# Phase 3 real teaching-architect model stage, 2026-09-15

Grounded runs now execute a real `architect` model stage per scene
(`src/semantic/planning/teaching-architect.ts`, prompt per the
`teaching-architect` skill): exactly one contract per beat in scene order,
each fixing learner delta, objective, prerequisites, strategy (enum), the
mechanism it explains, optional misconception and checkpoint, and evidence —
while narration stays owned by the semantic beats (the schema has no narration
field, and geometry/coordinates/unknown fields are schema-forbidden).
`validateArchitectOutput` rejects beat-order mismatches, wrong beat counts,
concepts outside the beat, unknown prerequisites/mechanisms/evidence. The
prompt-only pipeline keeps the deterministic projection; grounded source jobs
flow architect → whiteboard-planner → director with the Phase 8 one-attempt
owner repair. The flaky `semantic job lifecycle` waitFor budget was raised to
30 s to survive full-suite parallel load.

Verification: `npm run typecheck` clean; `npm test` **296/296 pass, 0 fail**
(292 + 4 new in `test/teaching-architect.test.js`, including the skill's
`eval:prereq-order`); `git diff --check` clean. No live provider run in this
change; architect live behavior rides the same OpenRouter route as knowledge.

# Live grounding baseline, chapter windows, and journal resume, 2026-09-15

Chapter windows for long grounded documents are implemented: `chapterWindows`
splits the source on paragraph bounds (~12k chars), one global ConceptGraph is
compiled once, then each window is planned against shared state with
`priorConcepts` continuity; `mergeGroundedPlans` deterministically unifies the
per-window plans (identical requirement/evidence meaning keeps one id; colliding
ids rename with a chapter suffix; colliding scene ids rename). Long-doc e2e
covered by tests (2 teaching calls, unique scene ids, cross-chapter keep).

Resume from the last validated journal boundary is implemented (Phase 9):
`executeStage(resume:true)` replays a prior validated journal entry with a
matching stage/input hash instead of re-running it (elapsedMs 0, appended to
the journal, re-gated); `SemanticJobStore.retry(id)` rebuilds options from the
persisted ingest artifact, copies the old journal into the new job, and
generateV2 replays the completed prefix. New API: `POST
/api/semantic/jobs/:id/retry`. Tests prove replay-without-rerun, mismatch
handling, and a full two-job resume (teaching stage 0 calls on retry).

Live provider baseline (photosynthesis text source, real OpenRouter + real
Supertonic narration attempts): code fixes landed during this work —
`c.aliases` non-optional spread crash, empty `section` rejection, same-model
length-retry at 1.5x completion budget (12000), knowledge hard caps
(≤32 concepts/24 claims/24 evidence), compactness rules, `relationFocus`
deterministic heal (drop mechanism ids, attach untaught relations to a
covering beat), knowledge-compiler stage timeout 420s, request timeout 120s,
and timeout-aborts now route to model fallbacks. One run produced a fully
valid grounded knowledge graph (alias collapse live: `plants→green_plants`,
`green_pigment→chlorophyll`) and a fully valid grounded teaching plan;
provider instability (gemini verbose >12k-token outputs hitting length,
qwen/deepseek 120s hangs) prevented a complete narrated PASS today. Final
state: `status error, calls 4, $0.066, 0 scenes` on job
`4ce5ec64-b94a-4739-90a6-b120b2740301` — recorded as a provider-infrastructure
baseline, not a quality result. Migration gates remain unevaluated.

Verification: `npm run typecheck` clean; `npm test` **292/292 pass, 0 fail**
(289 + 3 new in `test/harness-resume.test.js`); `git diff --check` clean.
Known flake: `semantic job lifecycle` occasionally fails under full-suite
parallel load and passes on rerun; needs a follow-up isolation fix.

# Phase 2 real source-grounded knowledge compiler, 2026-09-14

Grounded sources (PDF/text) now run a real knowledge-compiler model stage
(`src/semantic/planning/knowledge-compiler.ts`, prompt per the
`knowledge-compiler` skill): one canonical concept per meaning with
normalization-collapsed aliases, prerequisite DAG, causal mechanisms, claims
with verbatim evidence, quantities and terminology. Deterministic validation
merges spelling variants through `normalizeSemanticKey`, and rejects alias
forks, prerequisite cycles, orphan claims, unknown references and any evidence
quote absent from the source text. The model contract's schema forbids
coordinates, code, executable fields and unknown keys. The teaching stage is
then grounded: concept ids, required concepts, requirement ids and evidence ids
must all come from the compiled inventory (`planTeaching` with `conceptGraph`).
Prompt-only jobs keep the previous deterministic projection path unchanged.
Source figures are attached as provenance-tagged `sourceVisuals`.

The `knowledge` stage routes to the same strong outline model with the
configured fallback chain and shares the job budget; a gate failure triggers
the Phase 8 one-attempt owner repair with the findings appended.

Verification: `npm run typecheck` clean; `npm test` **286/286 pass, 0 fail**
(279 prior + 7 new in `test/knowledge-compiler.test.js`, including the skill's
`eval:alias-collapse` and invariant evals); `git diff --check` clean. Voice
engine: real bundled Supertonic synthesis verified directly (F3, 1397 ms for a
2926 ms sample, RTF 0.477; adapter returns a 258 KB WAV with explicitly
estimated word timing) plus a grounded narrated pipeline test through
`generateV2`. Not yet done: bounded chapter windows for 30-60 minute
documents, and any live provider run (requires `OPENROUTER_API_KEY`).

# Phase 4 whiteboard diffs now drive visual direction, 2026-09-14

The harness-owned `WhiteboardPlan` no longer dead-ends at validation. The
visual-director stage now receives the board in its model input, and the
director prompt carries `WHITEBOARD_ALIGNMENT_RULE` (never re-draw PRESERVED
concepts; one draw/reveal per INTRODUCE beat; every TRANSFORM realized as a
state-changing action with the required `toState`; RESET only at the declared
boundary). A deterministic `gateBoardAlignment` (`src/semantic/harness/gates.ts`)
checks the canonicalized scene beat for beat against the board: INTRODUCE keys
need a draw/reveal in their beat, TRANSFORM keys need an action reaching the
required `toState`, PRESERVE keys must not be re-drawn. Findings merge into the
visual-director gate, so a violation triggers the Phase 8 owner-scoped repair
with the exact findings before the job can fail.

Verification: `npm run typecheck` clean; `npm test` **279/279 pass, 0 fail**
(271 prior + 8 new in `test/board-alignment.test.js`); `git diff --check`
clean. One existing continuity test was updated to the new contract: a
preserved concept is now highlighted instead of re-drawn in the following
scene. Known limitation: the board still expresses intent that the legacy
director schema consumes only through prompt and gate pressure; full
diff-driven scene synthesis remains future work. No live provider run.

# Phase 8 targeted stage repair wired through the harness, 2026-09-14

`TeachingHarness` now executes the one-owner, one-attempt repair contract from
`PLAN_TO_IMPLEMENT.md` Phase 8. `executeStage` (`src/semantic/harness/stage.ts`)
accepts an optional owner-scoped `repair` callback; when a stage gate fails it
journals the failed attempt (`status:'FAIL'`, `attempt:0`), hands the owning
stage the original input, its failing gate and output, then re-validates the
repaired output as `attempt:1`. Without a `repair` callback behavior is a single
visible attempt, and stages whose policy sets `maxRepairs:0` never retry.
Repair ownership routes through `repairOwnerForStage` (semantic →
knowledge/teaching/whiteboard/director, representation → resolver, geometry →
compiler, timing → timeline, speech/provider → speech/router).

Wired owning-stage repairs: `knowledge-compiler` re-plans with the hard findings
appended to the teaching prompt; `visual-director` re-directs with the hard
findings appended to the director prompt. Both forbid unrelated regeneration and
keep narration, beat IDs and concept coverage unchanged. Cost/token/latency for
the repaired attempt stay attributed to the stage envelope. Provider failures
with no gate finding are rethrown, never repaired, so failures stay visible.

Verification: `npm run typecheck` clean; `npm test` **271/271 pass, 0 fail**
(264 prior + 7 new in `test/harness-repair.test.js`); `git diff --check` clean.
New tests prove one repair per failed stage, journaled `attempt:0`/`attempt:1`
records, exhaustion failure, no-op when `maxRepairs:0`, run-error routing, and
the ownership table. No live provider run in this change; migration gates and
the 144-run benchmark remain unevaluated.

# Harness-controlled teaching compiler refactor, 2026-09-14

Semantic V2 now runs through `TeachingHarness` (`teaching-compiler-v1`) while
V1 remains the default. The harness owns stage order, stage policy, learner
state, semantic registry, representation resolution, journal persistence,
gates, model accounting, and MP4 publication. The deterministic compiler and
pure renderer contracts were not rewritten.

Implemented runtime boundaries:

- Eleven typed stages from ingest through render, each with one owner,
  deadline, budget allocation, input/output hash, validator result, and at
  most one stage repair in policy.
- Full lesson teaching contracts and whiteboard plans are validated before the
  first visual scene. Expected learner state advances only after a scene passes.
- Canonical alias conflict and prerequisite-cycle rejection; evidence reference
  validation; persistent lesson-wide semantic identity and all six runtime
  continuity actions.
- Harness-owned representation candidate bundle and fixed resolver chain;
  constrained semantic synthesis rejects coordinates, SVG, scripts, URLs,
  HTML, CSS, and unknown fields.
- Append-only `stage-journal.ndjson`, separate per-stage input artifacts,
  per-scene manifests, raw model outputs, compiled scenes, audio, diagnostics,
  model routes, token/cost data, and final gate state under the existing job tree.
- Failed critical gates keep preview artifacts but cannot export MP4. A global
  85–115% target-duration gate prevents a short lesson from passing a 30- or
  60-minute request.
- Semantic UI accepts a PDF, target length, learner level, language/voice,
  grounding policy, goals, and budget; it shows stage/owner, gate, learner
  progression, cost, partial state, and MP4 withholding. SSE status now sends
  the complete additive snapshot instead of an incompatible partial shape.
- Live reports retain Truth, Teaching, Visual, Timing, Continuity, Reliability,
  Performance, and Cost separately and include per-stage P50/P95, tokens, and
  cost plus semantic coverage and case regressions.

Verification:

- `npm run typecheck`: pass.
- Full suite: 246 tests total. Sandboxed run 243 pass plus the three expected
  localhost `EPERM` suite failures; those exact suites pass 30/30 with loopback
  permission. Added duration-withholding, failed-stage-journal, prerequisite,
  canonical-alias, manifest-order, and persisted-artifact tests.
- Browser QA at 1280×720 on a fresh build: controls, advanced disclosure,
  plant golden, and responsive two-column layout render correctly.
- `git diff --check`: pass.

Reproducibility baseline: HEAD `26658c0189a22e6e0ecbe85ed9a8b85854407094`
on `v4-optimization`; schema hashes `a80157e...` and `0856e92...`; prompt
builder `05a855e...`; asset aggregate `17a2556...`; teaching-skill aggregate
`c3ca216...`. Sanitized route: outline/director
`google/gemini-3-flash-preview`; fallbacks
`google/gemini-3-flash-preview,qwen/qwen3.5-27b,deepseek/deepseek-v3.2`;
`V2_JSON_MODE=object`. No secret or full environment value was persisted.

Not yet release evidence: the knowledge call currently uses the compatible
TeachingPlan V2 response and the harness deterministically projects its
ConceptGraph/TeachingContracts; interrupted journals are inspectable but not
automatically resumed; source-figure IDs are grounded but figure crop/render
selection is not complete; local TTS is scene-buffered and word timing remains
explicitly estimated; independent comprehension evaluation, blind human
pairwise, the full narrated 48×3 rerun, and the 30/60-minute live document runs
remain pending. Keep `VISUAL_PIPELINE=explainer` as default.

# Skills manifest — flat folders + README grouping, 2026-09-14

Kept `skills/<name>/SKILL.md` flat (loader compatibility; no in-repo
recursive discovery). Added `skills/README.md`: pipeline-group manifest
(FOUNDATION/KNOWLEDGE/TEACHING/VISUAL/EVALUATION/OPERATIONS/META) plus role
table (reference/agent/critic/harness/orchestrator/meta) and the 15-skill
cap rule. No skill content changed. Validation: `git diff --check` clean.

# Skills expansion — 15-skill tree per feedback, 2026-09-14

Added 3 capabilities, strengthened 2 skills, no renderer changes. New:
`knowledge-compiler` (canonical concepts/aliases/prereq DAG/mechanisms/
claims-evidence/quantities before architect; alias collapse via
`normalizeSemanticKey`), `source-visual-grounding` (figure→entity→diagram→
fallback cascade with crop+provenance; renderer image shape explicit
follow-up), `multilingual-teacher` (STUB, promotes after pedagogy ~8/10).
Strengthened: `teaching-architect` (+retrievalPrompt/predictionPrompt/
learnerRecordUpdate/masteryEvidence, consumes compiler output),
`pedagogy-critic` (+8 video-failure checks incl. MECHANISM_NOT_EXPLAINED,
CONCEPT_IDENTITY_LOST, VISUAL_IS_CATEGORY_MARKER_ONLY; why/how probe).
Tree now matches spec: FOUNDATION 3, KNOWLEDGE 1, TEACHING 3, VISUAL 3,
EVALUATION 3, OPERATIONS 1, META 1. Validation: `npm test` 256/256,
`git diff --check` clean. Next: runtime seams (TeachingContract type,
SourceFigure bbox/crop/provenance, registry alias map), then wire
compiler→architect→planner prompts.

# Skills audit — 12-skill teaching pipeline, 2026-09-14

Audited and optimized `skills/` with no renderer changes and no generated
SVG/coords/code. Twelve native skills, each with purpose, when/when-not,
inputs, outputs (every field mapped to a runtime consumer), hard invariants,
decision procedure, failure conditions, repair behavior, success criteria,
and representative evals; `SKILL.md` files kept 67-102 lines with detail in
`references/`. Removed forced shape-mixing in `canvas` (semantic minimality +
persistent visual identity). `whiteboard-planner` consumes TeachingContract
and emits stable `semanticKey` alongside `contentSchema` fields.
`visual-director` prefers PRESERVE → TRANSFORM → INTRODUCE → RESET mapped to
runtime KEEP/TRANSFORM/REINTRODUCE/REPLACE. `video-generation` treats
`2 × minutes` as a planning target with logged deviation. `pdf-extraction`
is a conditional fallback (native `pdftotext` first). New:
`teaching-architect` (learner state/order/strategy/checkpoint),
`representation-guide` (relation→archetype reference map, no LLM stage),
`pedagogy-critic` (binary PASS/FAIL teaching checks), `skill-writer`
(meta-skill with overlap/determinism tests). `llm-evaluation` symlink
replaced by app-specific `eval-builder` (BLEU/ROUGE/Likert never primary);
`eval-audit` converted from symlink to scoped native wrapper (generic
hygiene; video gates deferred to eval-builder). Validation: full
`npm test` 256/256, `git diff --check` clean. No live provider run in this
change. Next: wire TeachingContract through planner prompts per HANDOFF
quality thread, then rerun smoke benchmark.

# Quality implementation — typed continuity/speech contracts + persisted live artifacts, 2026-09-14

Cost and long-source generation check, 2026-09-14: the DeepSeek V4.1 report
was ingested successfully from the stable Hugging Face PDF URL (161,123
characters, 37 mapped sections) and the recursive self-improvement survey was
ingested from arXiv (100,669 characters, 35 mapped sections). The requested
30-minute and 60-minute one-shot jobs both stopped at the first outline request
with OpenRouter HTTP 403. Each saved `job.json` records `costUsd: 0`, zero
model calls, zero TTS characters, and zero scenes. The CLI now exposes normalized
`costUsd`, `modelCalls`, `ttsCostUsd`, and `ttsMsByScene` fields. Local TTS is
free in the current setup, with CPU time recorded separately. The 60-minute
planner limit is now supported, but no 60-minute quality result exists until
provider access is repaired.

Voice and UI verification, 2026-09-14: the bundled voice engine was traced and
verified directly through `createVoiceEngineSpeech` with Supertonic English
(1.8s synthesis for a short sample, 5.1s WAV, estimated timing explicitly
marked). The Semantic Lab now exposes local narration and language controls,
loads scene audio for playback, and keeps narrated MP4 download in the live job
flow. Fresh narrated topic sets were exported at 1, 5, and 10 minutes; all
passed `ffprobe` with H.264 video plus AAC mono audio. Full `npm test` remains
256/256 after the UI and voice changes.

Added explicit `KEEP`, `MOVE`, `TRANSFORM`, `REPLACE`, `REMOVE`, and
`REINTRODUCE` continuity decisions with schema validation; transforms require
distinct states and replacements require a target representation. Added timing
source provenance (`provider`, `aligner`, `estimated`) and an optional streaming
speech adapter that keeps buffered providers compatible without fabricating TTFA.
Live runs now persist `input.json`, `run.json` hash metadata, and renderer-aligned
event/fixed-progress contact sheets under each run's `artifacts/` folder.
Validation: `npm run typecheck`, `npm run build`, affected tests 40/40, full
`npm test` 256/256 with local network permission, and `git diff --check` clean.
No provider-backed narrated benchmark was available during implementation.

The required narrated 144-run baseline was then attempted with
`node --env-file-if-exists=.env dist/scripts/live-v2-evaluation.js --narration
--runs 3 --budget 2 --out .data/eval/live/v2-narrated-144-20260914`. All 144
runs were recorded as provider errors (`fetch failed` while contacting the
OpenRouter model catalog); total cost was $0. The local voice engine is also
not installed. This is a valid failure record, not a quality benchmark: live
success, latency, and migration gates remain unevaluated until provider access
and a speech engine are configured.

Duration/export soak, 2026-09-14: compiled fixture topics were exported and
extended to 1 minute (photosynthesis), 5 minutes (matrix multiplication), and
10 minutes (HTTP request lifecycle). `ffprobe` verified H.264 960x540 at 12 fps
with measured durations 60.166667s, 300.166667s, and 600.166667s. These are
silent repeated-fixture renderer/export checks, not narrated model-quality
videos. Outputs are under `output/duration-soak-20260914/`.

# Quality implementation — retry isolation + live semantic coverage, 2026-09-14

Fixed the legacy planner test hang by adding an injectable `retryDelayMs` option
to `generateChapters`. Production behavior remains capped and abort-aware; the
deliberate provider-failure tests use zero delay. Added live-run semantic coverage
metrics for critical claims, concepts, required relations, preferred archetypes,
forbidden patterns, and critical asset roles, and included them in case-level
reports. Validation: `npm run typecheck` clean, generation suite 17/17, focused
semantic planning/live evaluation 23/23, full `npm test` 250/250 with local network
permission for server tests, and `git diff --check` clean. No live provider run yet.
Next: run the narrated baseline benchmark, then extend the representation resolver
with typed candidates and safe composition/template/synthesis tiers.

# Quality implementation — v4 parallel first-AV + auto MP4, 2026-09-13

Implemented per `docs/v4/critical_changes.md` P0-E: TTS and visual compile run
concurrently after the narration freeze (estimated compile lands first for
firstVisualReady; final timeline rebinds when speech timing arrives; TTS failure
still fails loudly, no silent fallback). Final MP4 assembles automatically for
`autoMp4` jobs (viewer sends it): `SemanticJobStore.exportMp4` (also serving the
existing export route) + best-effort background assembly recording
`mp4Status pending/ready/failed` + `mp4Url/mp4Error` on the snapshot without
failing the lesson; `export-semantic-job` accepts `--data-root` for isolation.
Validation: `npm run build` clean, focused 21/21, full suite 247/247,
`git diff --check` clean. No live provider run in this change. Known gaps: blind
preference gate, semantic PDF/URL ingestion, streaming TTS. Next: fresh live
comparison + MOVE/TRANSFORM continuity.

---

# Quality implementation — viewer/continuity stage, 2026-09-13

Implemented: semantic scene snapshots load through `GET /media/semantic/:job/:scene.json`
(viewer no longer uses `compile-from-job` or `/media/semantic-jobs/`); semantic export
fails loudly on missing/failed narration instead of silent fallback; concept continuity
bridged from semantic keys to runtime ids so kept concepts reuse previous geometry
(appearance changes still rejected). Validation: `npm run build` clean,
`node --test test/semantic-server.test.js` 5/5, `node --test test/semantic-continuity.test.js`
1/1, full suite 242/242. Known gaps: parallel TTS/visual, background encode + auto MP4,
blind preference gate, PDF/URL ingestion for semantic API. Next: parallel first-AV +
automatic final MP4 assembly.

---

# Quality implementation — correctness stage, 2026-09-13

Implemented: strict directed relationship/part/timing validation shared with critic repair;
removed geometry-to-model retry; ID canonicalization preserves topology/anchors/forms;
awaited atomic scene/audio persistence; request budget and cancellation reach model;
actual scene counts and nonduplicated costs; request-relative telemetry and honest
unavailable TTFA; separate normalization/static diagnostics; isolated evaluation reports.

Validation: full suite 239/239; focused critic 8/8. New live smoke: 11/18 complete,
$0.495662, silent estimated timing (`.data/eval/live/quality-correctness-20260913`).
Historical Wave 3: 13/18 under weaker contracts; this is NOT a quality improvement claim.
Normalized saved-output replay: 9/18; originals unchanged, source hashes recorded in
`.data/eval/live/quality-correctness-replay-normalized-20260913/report.json`.
Known gaps: DNA relation/part mismatch; other remaining director/schema failures;
representation, continuity, first-AV concurrency and automatic media still in progress.
Next: semantic-key model contracts and reusable representations, then a fresh comparison.

---

# Current handoff — 2026-09-13, single-MP4 download in both UIs

Every video now downloads as one MP4:
- Explainer UI already had it — verified working on the DeepSeek job
  (`output/b94c7267-deepseek.mp4`, 306s, h264+aac, 7.8MB).
- Semantic viewer: new `scripts/export-semantic-job.ts` (per-scene canonical
  render → narration mux → concat) + `GET /api/semantic/jobs/:id/export`
  (404 on unknown job, `{output:/output/<id>.mp4}` on success) + viewer
  "Download job MP4" button (appears on complete/partial, both SSE and polling
  paths). Verified on job `94117016` → `output/sem-94117016.mp4` (40.8s).
- Same delivery convention as explainer export (`/output/<uuid>.mp4` route).

Tests: 234/234 pass (library + export-404 pins). Server restarted fresh on :3000
(PID 25794, current build): `/src/shared/language.js` 200, `/api/jobs` library live.

Next: noise-cancelling quality pick (A/B/C); dna partial→complete.

---

# Current handoff — 2026-09-13, stuck-video fix + library + docs refresh

Stuck video (job `b94c7267`, frozen at 3094ms with `player.client-error` on every
seek): media verified healthy (29.7s valid PCM WAV, served 200, all 619 frames
render clean in node). Root cause class: the rAF loop had no guard — any frame
exception kills playback permanently — and the error reporter dropped the message,
so the cause was unknowable from logs. Fixes in code:
- `public/app.ts`: client errors now report message/stack (300 chars); frame body
  wrapped so one bad frame logs `frame-error`, shows a notice, and keeps the loop
  alive; audio stall recovery (paused-while-playing resume, frozen-clock re-sync,
  both bounded, `audio-stalled` telemetry); `waiting` listener.
- `src/server.ts`: `/api/client-events` accepts `audio-stalled`/`frame-error` +
  optional `detail` string (validated, length-capped).
- Immediate relief for the user: reload `/?job=b94c7267-…`; scenes + audio persist.

Library (minimal, as requested): `GET /api/jobs` lists the 20 most recent jobs
from disk (both pipelines, metadata only); UI "Your videos" section loads it,
replays via `/?job=<id>`, refreshes on job completion.

Docs: `ARCHITECTURE.md` rewritten to current (two pipelines, stage ownership,
player guards, storage, eval, constraints); `docs/README.md` index updated;
`V4_IMPLEMENTATION.md` currency note (append-only history preserved). Other
`docs/*.md` already carried historical banners — verified this pass.

Tests: `npm test` → 234/234 pass (new: served-imports drift test already in,
library listing test). Restart the server after build to pick everything up.

Next: noise-cancelling quality pick (A acoustic assets / B containment rendering /
C beat-action coverage); dna partial→complete.

---

# Current handoff — 2026-09-13, browser 404 fix (shared/language.js)

User log showed `GET /src/shared/language.js` → 404 (ENOENT under `public/`).
Root cause: `src/explainer/engine.ts` imports `../shared/language.js` at runtime
(script-general segmentation), but the `dist/` static whitelist in `src/server.ts`
listed only logger/model-router/types/voice-engine-client/vocabulary. One-word fix:
added `language` to the whitelist. Regression test added in
`test/semantic-server.test.js`: scans compiled browser-served trees for runtime
`../shared/*.js` imports (type-only imports are erased, so matches must load) and
asserts each serves 200 — future shared modules cannot drift into 404 silently.

Tests: `npm test` → 233/233 pass. Operational note: the running server in the user
log is a stale build — restart it (`npm run build` first) to pick up the fix; a
long-lived Node server never hot-reloads `dist/`.

Open quality thread: noise-cancelling video judged weak (all-label fallback boxes,
containment-as-arrow, static tails). Proposed A acoustic assets, B containment
rendering, C beat-action coverage — awaiting user pick.

---

# Current handoff — 2026-09-13, Wave 3 live benchmark + first novel-topic narrated video

Live Wave 3 smoke (6 cases × 3 runs, `google/gemini-3.8-flash`, silent): **fullJobSuccess
13/18 (72.2%) vs Wave 2 7/18 (38.9%)**, $0.420567. Per case: photosynthesis 3/3,
linear 3/3, mla 3/3 (was 1/3 — comparison demotion works), matrix 2 + 1 partial,
http 2/3 (was 0/3 — cycle return-arc works), dna 0/3. 37 representation fallbacks
counted. Artifacts: `.data/eval/live/wave3-3runs/`.

Root fixes added after the benchmark (all in code, never scene edits):
- `ensureAssetCompatibility` strips archetype-incompatible assets to labels AND
  degrades their relation anchors to center (fixed dna `Invalid semantic anchor`);
  unknown asset IDs still throw.
- Connector safety net: unroutable relations (incl. bad flow-port anchors) degrade
  to direct lines with diagnostics instead of killing the job.
- `fitLabel` floor raised to the 18px lint minimum (a 14px fit only traded a compile
  error for an export error); `artifacts.ts` mkdir recursive.
- Fail-closed pins kept: unknown assets, wrong-archetype matrix misuse, placement
  bounds. Two existing tests updated to the new degrade contracts.

dna recheck (2 runs, new code): error/error → partial/partial (compiles, fails a hard
lint — next lever is preflight-hard causes, likely clipping/collision).

First novel-topic video with real audio (out-of-manifest topic: noise-cancelling
headphones, 2 scenes): `output/noise-cancelling/` — `scene_detection` 30.8s +
`scene_cancellation` 32.8s, h264+aac, engine TTS (RMS 1658/1805, ~30s/32s WAVs),
4 model calls, $0.0476, 58.5s wall. Only advisories (static intervals, one label
truncation). Script: `scripts/generate-v2-video.ts` (`--prompt/--archetypes/--scenes/
--narration/--budget/--out`).

Tests: `npm run typecheck` clean; `npm test` → 232/232 pass.

Next: drive dna partial→complete via hard-lint causes; Wave 4+ (critic A/B,
multi-domain benchmark, performance + migration gate).

---

# Current handoff — 2026-09-13, Wave 3 Representation Resolver + fallback composition

Wave 3 done: representation no longer hard-fails. New `src/semantic/identity/representation.ts`
tiered resolver (strict union-archetype search → alias-substring asset match →
labeled-primitive fallback, always with a `representation fallback` warning) and new
`src/semantic/compiler/fallback.ts` deterministic composition repairs wired into
`compileScene`: flow cycles keep flow layout with the smallest-id feedback edge demoted
to a direct return arc (`visualForm none`, excluded from rank); comparison/transformation
overflow demotes extras to annotations; matrix scenes get a curated `math.matrix.v2`
assignment plus an injected `=` token (gated on matrix-family assets, so a wrong-archetype
misuse still fails closed); hero-less spatial/structural scenes promote one hero;
`fitLabel` shrinks/truncates instead of throwing; renderer title uses `fitLabel`.
`visual-director.ts` searches across all candidate archetypes, no longer throws
`No teaching asset for hero concept`, and appends a primitive-fallback note to the
director prompt. `generate.ts` emits a `representation` telemetry stage;
`metrics.ts` counts `representation fallback` diagnostics + telemetry into
`representationFallbackCount`.

Tests: `npm run typecheck` clean; `npm test` → 228/228 pass (217 prior + 11 new in
`test/representation-fallback.test.js`). One existing test updated to the new intended
behavior (flow cycle now degrades, `test/semantic.test.js`); fail-closed pins kept for
wrong-archetype matrix misuse and placement-level bounds.

Limitations:
- No live provider rerun in this pass (no paid calls made); Wave 2 smoke numbers stand
  until `npm run test:live:v2:smoke -- --runs 3 --budget 2.0 --out .data/eval/live/wave3-3runs`
  is executed with a key.
- Fallbacks trade layout fidelity for completion (return arcs, demoted annotations,
  structural promotion); teaching contracts (concepts, beats, narration) untouched.
- Branch/cause_effect/state_machine cycle ranking still throws; text truncation can
  clip a long token with ellipsis (warned, counted).

Next: Wave 3 smoke benchmark with provider key, then Wave 4+ per roadmap (critic A/B,
multi-domain benchmark, performance + migration gate).

---

# Current handoff — 2026-09-13, Wave 2 canonical semantic identity

Wave 2 done: runtime owns visual identity. New `src/semantic/identity/` modules
provide typed semantic references, runtime ID generation, and a canonicalization
pass that rewrites model-generated object/relation/action IDs into deterministic
runtime IDs. Models still emit the existing `VisualSceneV2` shape, but the runtime
replaces their IDs; semantic keys (`conceptId`) remain authoritative.

Key files:
- `src/semantic/identity/types.ts`: `SemanticIdentityRegistry`, typed
  `SemanticReferenceError`, `normalizeSemanticKey`.
- `src/semantic/identity/resolver.ts`: `resolveObjects/resolveRelations/resolveBeats`
  turn semantic-key intents into `VisualSceneV2` with runtime IDs.
- `src/semantic/identity/canonicalize.ts`: `canonicalizeVisualScene` rewrites a
  model-generated scene to runtime IDs; semantic parts degrade to `center` when an
  exact asset anchor is unavailable.
- `src/semantic/identity/canonical-schemas.ts`: model-facing `TeachingIntent`,
  `VisualIntent`, `ResolvedVisualDirection` contracts (not yet wired to prompts).
- `src/semantic/identity/registry.ts`: `canonicalToPlan` translator and legacy plan
  normalizer.
- `src/semantic/identity/references.ts`: reference utilities.
- `src/semantic/identity/index.ts`: public exports.
- `test/semantic-identity.test.js`: 6 tests.

Wired into `src/semantic/planning/generate.ts`: after `directVisual` succeeds,
`directed.scene = canonicalizeVisualScene(semantic.id, directed.scene, plan.conceptRegistry)`.

Tests: `npm test` → 217/217 pass; `npm run typecheck` clean.

Smoke benchmark (6 cases × 3 runs):
Config: `google/gemini-3.8-flash`, `V2_JSON_MODE=object`, silent timing.
- `fullJobSuccess` 7/18 (38.9%) — within sampling variance of Wave 1 8/18 (44.4%).
- `teachingPlanSuccess` 18/18 (100%).
- `sceneGraphSuccess` 7/18 (38.9%).
- `compileSuccess` 7/18 (38.9%).
- `ttsSuccess` 0/18 (silent runs).
- Total cost: $0.390277; mean/run $0.021682.
- Report: `eval/live/reports/wave2-3runs.md`; artifacts `.data/eval/live/wave2-3runs-fixed/`.

Regressions remain asset/archetype gaps, not ID-related:
- DNA replication: no hero asset for `dna_molecule`.
- Matrix multiplication: label width and operator-token primitive pipeline.
- DeepSeek MLA: comparison layout requires 2–4 primaries.
- HTTP lifecycle: flow-cycle detection and hero asset coverage.

Limitations:
- Continuity across multi-scene jobs is not yet remapped through canonical IDs.
- Director prompt still asks for IDs; runtime silently rewrites them. A future
  shrink of the director schema to semantic references will remove ID fields.
- Teaching plan IDs are not yet fully canonicalized.
- Visual success rate is bounded by the asset catalogue and primitive archetype
  coverage, which Wave 3 (Representation Resolver) addresses.

Next: Wave 3 — Representation Resolver and fallback composition/templates.

---

# Current handoff — 2026-09-13, Wave 1 live reliability harness

Wave 1 done: `eval/live/` harness with 48-case manifest (`eval/live/manifest.ts`),
runner (`eval/live/runner.ts`), metrics collector (`eval/live/metrics.ts`), and
aggregator/reporter (`eval/live/compare.ts`). Telemetry hooks added to
`src/semantic/planning/model-adapter.ts` (raw/healed/failure/provider-failure events)
and `src/semantic/planning/generate.ts` (per-stage telemetry). CLI:
`npm run test:live:v2:smoke -- --runs 3 --budget 2.0 --out <dir>`.

Smoke benchmark executed: 6 cases × 3 runs = 18 real provider calls.
Config: `google/gemini-3.8-flash`, `V2_JSON_MODE=object`, silent timing.
Results: fullJobSuccess 8/18 (44.4%).
- Always succeeds: teaching plan, mental model selection.
- Often fails: visual direction / compile for cases that need assets or specialized
  archetypes not yet covered (DNA hero asset, matrix operator token, flow cycle
  detection, comparison layout bounds).
- ttsSuccess 0/18 because runs were silent.
Cost: $0.367112 total; mean $0.020395/run.
Latency (fullPlayableMs): P50 ~14.8 s, mean ~14.7 s for complete runs.
Report: `eval/live/reports/latest.md`; raw artifacts under `.data/eval/live/smoke-3runs-v2/`.

Known limitations captured in report:
- Hero-asset gaps cause `No teaching asset for hero concept ...` errors.
- Matrix primitive pipeline requires operator/equals tokens.
- Flow compiler rejects cycles instead of suggesting cycle archetype.
- Label width clipping on dense comparison scenes.
- Metrics are structural success/failure; teaching quality and visual aesthetics
  are not judged.

Suite after Wave 1: 211 tests pass, build clean.

Next: Wave 2 — canonical semantic identity and shrink model-owned IDs.

---

# Current handoff — 2026-09-13, Wave 5 live run + model config

**First successful live end-to-end V2 job** through the new synchronous path
(`POST /api/semantic/jobs`, job `94117016`): status `complete`, 1 scene,
**$0.022144, firstPlayable 17.4 s, sceneReady 17.4 s**, estimated silent timing.
Scene: `convergence`, hero plant + sunlight/water/CO₂ supports, real assets,
correct anchors (sunlight->leaf.top, water->roots, CO₂->leaf.right), 5 beats
matching the teaching plan. One advisory diagnostic: narrated static interval
>3500 ms. Live call split: teaching 7.4 s, director 10.0 s, compile 0.4 ms.

**Root cause of the long failure streak (fixed):** `.env` routed V2 teaching to
`google/gemini-2.5-flash-lite`, too weak for the strict V2 schemas; two probes
proved `json_schema` strict mode on `gemini-3.8-flash` returns `{}` while
`json_object` returns full valid JSON. Config now: teaching + director +
vision = `google/gemini-3.8-flash`, `V2_JSON_MODE=object` (required — the
repo's custom schema subset is incompatible with the provider's strict
structured-output path; docs already said "JSON-object compatibility mode used;
strict local schemas still mandatory").

**Robustness added this pass (all deterministic, no paid repair):** schema heal
(arrays from objects, missing required arrays, version default, enum aliases
`part_of`/motion verbs, numeric clamping, parent/child sync, action target
purity, `hidden`->`neutral`); planner heal (derived `requiredConceptIds` and
relations from beats, continuity concept mapping, uncovered-critical
requirement attachment, implicit structural relations); director heal (missing
required relations accepted via hero anchors/subpart anchors/either-direction
concept pairs, stray relation-objects dropped, `prepareForNext` concept->object
mapping, invalid anchors degrade to `center`); one bounded re-direction when the
deterministic compiler proves anchors/zones cannot route; `length`-truncation
retry at x1.5. Suite: `npm test` 204/204 pass, build clean.

Next: critic A/B (DeepSeek-V4-Flash-Vision vs gemini-3.8-flash on the 9-case
calibration, `V2_CRITIC_BUDGET_USD` cap) — the actual Wave 5 deliverable; then
Wave 6 (Phase 15 multi-domain benchmark) and Wave 7 (performance + migration
gate). Remaining known issues: one advisory static interval in the live scene;
heals convert several former hard failures into warnings, so re-check whether
any heal is masking a genuine planning gap before the benchmark.

---

# Current handoff — 2026-09-13, Wave 4 richer visuals

Wave 4 done: morph/replace actions compiled + rendered with state badge; `before`
state renders dimmed part sets; multi-line equation renderer (per-line reveal,
completed dim, active wash); branch/cause_effect/state_machine layered graph
layout (deterministic Sugiyama-lite, no ELK dependency); general nudge/scale
repair for non-structural archetypes; assets 39 → 43 (refrigeration cycle trio
with flow ports, economy price level). Suite: `npm test` 204/204 pass, build
clean, `git diff --check` clean. NOTE: renderer changed — regenerate
`output/semantic-plant-accepted/` artifacts before new fixture claims. Next:
Wave 5 — model A/B within $5 (DeepSeek-V4-Flash-Vision vs Gemini-3.8-Flash on
critic calibration; per-stage tier table via `npm run router:report`), preceded
by one live end-to-end run through `POST /api/semantic/jobs` to confirm real
provider behavior on the Wave 3 path. Then Wave 6 (Phase 15 multi-domain
benchmark) and Wave 7 (performance + migration gate).

---

# Current handoff — 2026-09-13, Wave 3 synchronous progressive V2 jobs

Wave 3 done: `src/semantic/jobs.ts` (`SemanticJobStore`: durable snapshots,
2-active cap, taxonomy, per-scene commit on each generateV2 yield, firstPlayable
= first scene), server routes `POST/GET /api/semantic/jobs[/:id][/cancel]` +
SSE `/api/semantic/jobs/:id/stream` with `?from=N` offset resume and `end` event
on terminal states (also sent when the job is already complete on connect),
`/media/semantic/...` audio route, viewer live-generation panel (SSE + prebuffer
+ polling fallback). Language flows job → `createVoiceEngineSpeech`. Suite:
`npm test` 198/198 pass, build clean, `git diff --check` clean. Mock-model tests
only; no live provider run yet. Next: Wave 4 — richer visuals (state variants/
morph Task 6.5, ELK graph layout Task 7.5, general compiler repair Task 7.4,
asset registry growth toward Phase 15 domains, multi-line equation renderer);
then Wave 5 (model A/B within $5), Wave 6 (Phase 15 multi-domain benchmark),
Wave 7 (performance + migration gate). A live end-to-end run through the new
`POST /api/semantic/jobs` path should be done before Wave 5 to confirm real
provider behavior.

---

# Current handoff — 2026-09-13, Wave 2 critic-repair wiring

Wave 2 done: `src/semantic/contact-sheet.ts` (event-aligned sheet frames via the
pure renderer) and `src/semantic/critic-repair.ts` (lints-first $0 preflight,
pairwise A/B+ B/A judgment, ONE bounded director repair using `criticRepairPrompt`,
identity/narration protection, re-lint after repair). `generateV2` takes an
optional `judge`; critic activates with `V2_CRITIC=on` + judge supplied, adding
`criticMs`/`criticRepairs` to StageMetrics. Suite: `npm test` 191/191 pass, build
clean, `git diff --check` clean. No live calibration run executed in this change.
Next: Wave 3 — synchronous progressive V2 jobs (`POST /api/semantic/jobs`, SSE
scene push with offset resume, polling fallback, prebuffering client, language →
speech, firstPlayable = first scene ready); then Wave 4 (state variants/morph,
ELK graph layout, general compiler repair, asset growth), Wave 5 (model A/B
within $5: DeepSeek-V4-Flash-Vision vs Gemini on critic calibration), Wave 6
(Phase 15 multi-domain benchmark), Wave 7 (performance + migration gate).

---

# Current handoff — 2026-09-13, Wave 1 prompt builder

Wave 1 done: `src/semantic/planning/prompt-builder.ts` now generates the teaching
and director prompts (behavior-compatible refactor of the inline literals) with
teacher-voice rules (no "Step 1" meta-numbering, natural mechanism prose), math
pedagogy rules for equation/matrix scenes, visual richness rules and a shared
`chalk-ink-v2` style token. `criticRepairPrompt()` is pre-built for Wave 2
critic-repair wiring. `lintTeacherVoice` in `planning/validate.ts` deterministically
rejects slide-bullet narration before TTS. Drift-guard tests pin prompt vocabulary
to `types.ts`. Validation: `npm test` 183/183 pass, `npm run build` clean,
`git diff --check` clean. Next: Wave 2 — wire the calibrated vision judge into the
bounded one-repair path using `criticRepairPrompt` and contact sheets; then Wave 3
(synchronous progressive V2 jobs with SSE scene push), Wave 4 (state variants/morph,
ELK graph layout, general compiler repair, asset growth), Wave 5 (model A/B within
$5: DeepSeek-V4-Flash-Vision vs Gemini on critic calibration), Wave 6 (Phase 15
multi-domain benchmark), Wave 7 (performance + migration gate).

---

# Current handoff — 2026-09-12, V4 document implementation / semantic V2

Implementation continues on `v4-optimization`; V1 remains default. Read
[V4_IMPLEMENTATION.md](V4_IMPLEMENTATION.md) for the task matrix and constraints.
No commits or pushes made. The overall V4 plan is not complete.

Automatic plant run 09 passed all ten semantic checks and final-frame review: one
teaching call, two director calls, $0.03532815, 22.123 s scene ready. This is estimated
silent timing, not TTS latency. Failures 01–08 remain preserved. Replay runs are clearly
labeled as recorded-output replays, never new provider successes.

The registry now contains 39 original assets. All ordered Phase 14 archetypes are supported:
structural, convergence, transformation, comparison, cross-section, spatial-process, numbered
steps, flow, cycle, equation_walkthrough, matrix_operation, hierarchy, timeline and trajectory
(use their exact schema enum names in code). Eleven manual fixtures cover DNA, tectonics, MLA,
caching rules, HTTP request flow, water cycle, an equation walkthrough, matrix multiplication,
the memory hierarchy, a Roman timeline and gradient descent. Latest artifacts:
`output/semantic-archetypes-07/` (MP4s, event/fixed sheets, final PNGs, JSON and hashes).
Frame review corrected K/V semantics, mantle placement/label overlap, cycle port crossings,
and a normalized SVG path-length rasterization issue; added a deterministic equation primitive
renderer, `top`/`bottom` anchors and tree/rail/trail geometry. Manual fixtures do not establish
live multi-domain planning reliability or teaching efficacy.

Phase 12 critic is implemented and calibrated: `src/semantic/vision-judge.ts` + `src/semantic/calibration.ts`
plus `npm run calibrate:semantic:critic`. Live run 2 passed all nine known corruptions in both orders
(accuracy 1.0, 0 order flips, 18 calls / $0.0366, `output/semantic-critic-calibration-02/`); run 1
failed on `delay_reveal` and `reverse_relation` and is retained. The judge is not yet wired as an
automatic repair trigger.

Kokoro was removed from this repo on 2026-09-12 (files, npm scripts, live worker,
`.kokoro-venv`). Local narration now goes through a separate `voice-engine` project
at `voice-engine` (Supertonic 3 default, Piper fallback,
Nepali always Piper) via the async `src/shared/voice-engine-client.ts` / `src/semantic/speech.ts`
boundary. Engine timings are explicitly estimated. ElevenLabs was removed too
(2026-09-12), so narration is local-only: Supertonic 3 or Piper.

Validation: `npm test` passed 180 total / 180 pass / 0 fail / 0 skip, 76.461 s
(Kokoro/pool and ElevenLabs provider tests removed with those features).
This includes all V2 tests and the existing HTTP/provider regressions. Loopback access
is required for HTTP tests. `npm run build` and `git diff --check` also pass.

Next bounded task: wire the calibrated judge into a bounded critic-repair path; then the V2
speech adapter and progressive job lifecycle, followed by the full multi-domain benchmark.
Remaining: actual V2 speech adapter, progressive V2 job lifecycle/UI, full multi-domain
benchmark, measured live performance, blind human preference and migration gate.
Do not silently map unsupported operations to generic boxes or invent provider success.

Preview: `PORT=3014 VISUAL_PIPELINE=semantic npm start`; `/semantic.html` also works under explainer.
The current viewer is manual scene playback; it does not expose automatic generation.

---

# Current handoff — 2026-09-11, TTS reliability + planner boundary + gate consolidation (Phase 1-3)

**Suite:** `npm test` → **153 tests, 151 pass, 0 fail, 2 skip**.

**Run the server on the current build** (a long-lived Node server does NOT pick up rebuilt
`dist/`): after `npm run build`, `kill <pid>; nohup node --env-file-if-exists=.env
dist/src/server.js > .data/server.out 2>&1 & echo $! > .data/server.pid`. A stale server was the
cause of a reported 0/2 failure — the same prompt completes 2/2 on the current build.

**The 10-min / 20-scene path completes** (job `6308827e`, DeepSeek-V3 PDF): complete, 20/20, MP4 ✓.
A quality-gate exhaustion can no longer return 0 scenes: `planContent` commits the most recent
structurally-valid candidate with `planner.gates-deferred` logged (hard structural failures still
throw).

**What fixed completion**
- TTS: stable + bounded Kokoro pool (Phase 1). 17 GB Metal leak → `set_cache_limit(1024 MB)`.
- Outline: bounded repair loop + deterministic heals (Phase 2).
- Gates: `healSchemaFields()` normalizes `visualIntent`/`conceptId`/`evidenceIds` **before**
  `validatePlan` (they used to throw first and cost a 20-50 s repair each — fired 4× in the final
  run); shape diversity demoted to a **soft diagnostic** on the director-exhausted fallback
  (harness §36). `8d27af04`, `1283a4d2`, `9e5c560f`, `09ddb161` are all explained and closed.

**Local operations**
- `npm run kokoro-pool start 2` / `stop` / `status` — bounded, self-restarting workers.
  `KOKORO_SERVER_URLS` tells the job runner which workers to use. `/health` shows
  `cache_mb`/`peak_mb`/`requests_served`. `npm run bench:tts` replays saved narration at $0.

**Remaining (value order)**
1. **First-playable latency** — 10-min firstPlayable 64 s, 5-min 66 s vs harness <8 s target. The
   ≤2-min fast path (merge outline into content) + wider auto-director coverage (1/10 chapters still
   fell back to all-box) is the top lever. This is now the only real gap to Lamina.
2. **Repair rate** — 11 repairs / 10 chapters at ~20-50 s each. Continue gate consolidation:
   key-point, quantity and grounding gates still repair rather than heal.
3. Human playback review of `output/videos/gate-phase3b/arxiv-org-pdf-2412-19437-10min.mp4`.
4. Pool N≥3 degrades on this 24 GB box; default 2.

Full evidence and limitations: `docs/RESULTS.md` (Phase 3 entry, 2026-09-11).

---

# Current handoff — 2026-09-11, TTS reliability + planner boundary (Phase 1+2)

**Suite:** `npm test` → **150 tests, 148 pass, 0 fail, 2 skip** (up from 133/131).

**Run local Kokoro as a bounded pool, not a single leaking server:**
`npm run kokoro-pool start 2` (start/stop/status; memory-gated; workers self-restart).
`KOKORO_SERVER_URLS` (csv, default one URL) tells the job runner which workers to use.
`npm run bench:tts -- --servers http://127.0.0.1:8765,http://127.0.0.1:8766 --label pool-2`
replays saved narrations at zero API cost; `/health` reports `cache_mb`/`peak_mb`/`requests_served`.

**Root cause fixed (was mis-diagnosed three times):** the multi-chapter "provider timeout" was
**local Kokoro memory exhaustion**, not OpenRouter. A long-lived server held 17 GB of dirty Metal
buffers for an 82 M model (`mx.clear_cache` never called), the host went to 23.5 GB swap / 81 MB
free, and a 20-scene fan-out tripped a fixed 120 s deadline. Fixed by `mx.set_cache_limit(1024 MB)`
(cache now bounded at ~1 GB, measured 16 963 → 1 024 MB) + a bounded priority pool + per-scene
fail-soft to explicitly-estimated silent timing. No robot voice anywhere.

**Also fixed:** outline is now a bounded repair loop with deterministic heals (was a single call
that failed the whole job — three real saved failures now heal with 0 extra calls, including the
live `"+ 6O2"` entity-only key point); `finish_reason==='length'` retries at ×1.5 budget with
reasoning cut (was thrown as "incomplete or refused"); `require_parameters` is actually sent now
(the router had made the old guard always-false); outline budget 2250 → 3000.

**Measured today:** 1-min prompt **complete** $0.0017; 5-min prompt **complete** 10/10 scenes
$0.0043; 10-min DeepSeek-V3 PDF **partial 8/20** (was 0 scenes) $0.0163, MP4 exported, fallback 0.
TTS: 0 timeouts, 0 `unknown` errorKind.

**Remaining (value order):**
1. **Phase 3 gate consolidation** — the 10-min path still stops at 8/20 with `Invalid conceptId`
   after 12 repairs. Split the ~12 `planContent` validators into hard-correctness (reject/retry)
   vs quality-advisory (deterministic heal). This is the top blocker to 20/20.
2. **First-playable** — 5-min run firstPlayable 66 s vs harness <8 s target; needs the ≤2-min fast
   path (merge outline into content) + auto-director coverage.
3. **Human playback review** of the exported MP4s (`output/videos/gate-phase2/`) — last
   unautomated quality gate.
4. Multi-chapter outline/allocation cost: outline ~10 s and content sum ~40 s/chapter; hedged
   content (2 concurrent, first valid) would bound the 20-50 s variance.

Full evidence and limitations: `docs/RESULTS.md` (2026-09-11 Phase 1+2 entry).

---

# Current handoff — 2026-09-11, at Lamina-parity: 43-53s, $0.005, director-free

**Server**: rebuild + `node --env-file-if-exists=.env dist/src/server.js` at
`http://127.0.0.1:3000`. UI source intake (Prompt / Source text / **Public HTTPS link** /
**PDF document**) is visible by default; verified in-browser, 0 console errors.

**All events + per-call cost/time land in `app.log`** (gitignored, `APP_LOG_PATH`, 20 MB
rotation) plus per-job `log.jsonl`; `job.summary` has wall/first-playable/timeline/cost/
calls/tokens/spans. `npm run router:report` aggregates the ledger per task+model.

**Measured today (auto-directed, no director call):** URL 1-min 43.1/44.9/53.6s at
$0.0052–0.0054; PDF via API 44.8s at $0.0078 (4 figures + bigger map); PDF via
generate-video 43.4s, export ✓. Static intervals 2600/2600ms on the URL runs (limit 3500).

**Completed this stretch:** auto-director reliability (3/3 runs director-free; broader
kind hints + tolerance; engine-synthesized nodes excluded), per-item bullet reveal,
model router (`src/shared/model-router.ts`, `MODEL_ROUTER` JSON > per-task env > base) +
`npm run router:report`, `app.log` durable logging + `job.summary`, UI source-intake fix
(default AI planner + `/src/templates.js` whitelist + CSP inline-style), export-breaking
shape bug fixed (`deCollideKinds` clears icon shape on demotion; `normalizeShapes` safety
net). Suite 134 tests, 132 pass, 0 fail, 2 skip.

**Remaining (value order):**
1. **Outline cost** — ledger: outline gemini = **87% of run cost**, avg 5.0s; content qwen
   = 37% repair rate, avg 25.3s. Experiment: route outline to a cheap model via
   `MODEL_ROUTER`/`OPENROUTER_OUTLINE_MODEL` and compare cost/quality with `router:report`
   (a shell env override through `npm run` did NOT take effect in one test — set it in
   `.env` or verify the router path).
2. **Hedged content** (2 concurrent attempts, first valid wins) — bounds the 25s+repair
   variance; needs test request-count updates.
3. **Fast path ≤2 min** (merge outline into content) — removes ~5s and most of the cost.
4. Human playback review of the MP4s (last unautomated quality gate).

---

Server runs at `http://127.0.0.1:3000` (rebuild + `node --env-file-if-exists=.env
dist/src/server.js`). UI now defaults to **AI planner** so the Source dropdown (Prompt /
Source text / Public HTTPS link / PDF document) is visible; verified in-browser with 0
console errors (server whitelist was missing `/src/templates.js`).

All events append to **`app.log`** (gitignored, `APP_LOG_PATH`, 20 MB rotation) plus the
per-job `log.jsonl`. `job.summary` records wall/first-playable/timeline/scene-count/cost/
calls/tokens/spans for every completion and failure.

**Measured today (server URL runs, `app.log`):** best **55.7s** wall / $0.0075 / 3 calls
(outline+content+director, content first-try); worst 84s with one content repair. Auto-
director fires intermittently (skips the ~20s director) depending on content labels.
Static intervals 2600–5950ms (under/around the 3500 limit). Model tiers are env-routed:
outline gemini-3.8-flash (**~82% of cost**), content/director qwen3.7-flash (slow, cheap).

**Remaining tasks (value order):**
1. **Auto-director reliability** — make it fire on every composable chapter (biggest
   latency lever; would take wall to ~35s).
2. **Fast path ≤2 min** — merge outline into content; removes ~5s and ~$0.007/cost.
3. **Hedged content** — 2 concurrent attempts, first valid wins (bounds the 20-30s repair
   variance).
4. **Model router** — move outline to a cheap model; per-task cost/success from app.log.
5. Per-item bullet reveal; human playback review.

Full latency/cost/architecture analysis: `docs/PERFORMANCE_ANALYSIS.md`.

## 2026-09-14 — requested long-form paper generation attempts

- Requested one-shot 60-minute generation from [arXiv 2607.07663](https://arxiv.org/pdf/2607.07663).
- Source ingestion succeeded: 100,669 characters, 35 sections; job
  `ef8e3126-14dd-43f8-8845-0968c96e1079`.
- Generation stopped at the first OpenRouter outline request with HTTP 403. No
  scenes, audio, video, or billable model calls were produced; recorded cost was
  `$0.00`. Job evidence is in `.data/ef8e3126-14dd-43f8-8845-0968c96e1079/job.json`.
- The requested 30-minute local DeepSeek V4.1 PDF run has not started because its
  contents would be transmitted to the configured external model provider and
  requires explicit user approval for that transmission.
- After the OpenRouter limit was raised, a frontend-path smoke job accepted the
  new route and completed outline plus content calls (`$0.00509`, 2 calls) before
  being cancelled to avoid spending more diagnostic budget; it exposed a slow
  provider wait in the remaining chapter work, not another 403.
- Active shortlist is now `google/gemini-3-flash-preview`,
  `qwen/qwen3.5-27b`, and `deepseek/deepseek-v3.2`. Long-document outline and
  content are configured for DeepSeek after Google AI Studio returned a 504→400
  failure on a large source; Gemini remains on direction/vision, and Qwen remains
  available as the alternate content route. The list is exposed by `/api/config`;
  automatic cross-model failover remains a follow-up and is not claimed as complete.
- RCA for job `0c963f8e-3473-44b5-89b0-0c7fbf88bcc8`: Google AI Studio first
  timed out with provider `504`, then OpenRouter returned `400 INVALID_ARGUMENT`.
  The failure occurred in outline before any scene was committed. The legacy
  planner now preserves provider detail; `.env` routes outline/content to DeepSeek
  V3.2 to avoid this Google long-document path. Restart the server to load it.
- Follow-up live evidence showed DeepSeek V3.2 returned response headers but did not
  finish the 30-chapter outline body before the 150s timeout. Root cause isolation
  points to OpenRouter `cache_control` content parts on the Google path: the same
  strict-schema request shape succeeds without them. Google requests now always use
  plain-string system messages; the cache breakpoint remains enabled for compatible
  providers. Active outline/content route returned to Gemini for the next run.
- Cache metadata removal alone did not fix the large Gemini outline. Three 30-minute
  attempts returned Google `INVALID_ARGUMENT` with zero usage. The differentiator is
  the exact 30-item strict outline schema: small strict schemas succeed. Long-form
  outlines (>10 chapters) now request `json_object`; the existing local schema,
  semantic validation and bounded repair still decide acceptance.

---

Top quality debt root-caused and fixed: beats with no visual caused 8.3s/7.2s static
tails; `fillBeats()` now synthesizes a node from each uncovered beat's own narration.
Both live paths on the 53-page DeepSeek-V3 report now complete with **staticInterval
2600/2600ms (under 3500)**: PDF 1:28 wall / $0.0094 / first attempt; arXiv URL 1:15 /
$0.0095. New deterministic heals this pass: `healDanglingEdges`, `fillBeats`,
`keypoint-healed`, whole-source `grounding-autofix`, `conceptId` heal. Suite 128 tests,
126 pass, 0 fail, 2 skip. Full table in RESULTS.md (2026-09-11 RCA pass 2).

**Remaining tasks (value order):**
1. **Eval/router** — cost/success aggregation from the existing planner.call ledger, judge
   live, Gemini-vs-Qwen A/B (50 content + 50 director calls) before any model flip.
2. **Director latency** — 18-21s + occasional 20s repair is now the slowest stage; extend
   auto-director to handle note/directive labels (2 of 5 nodes blocked it this run).
3. **Machine-readable canvas contract** (`canvas-contract.ts`) — prompts/skills derive
   from one spec; tests prevent drift.
4. Optional: 5-min live run (multi-chapter concurrency); adaptive provider concurrency.

---

---

# Critical-bug pass — 2026-09-11 (post-Lamina-parity review)

**Fixed (committed):**
- **TTS no longer kills a planned job.** `scripts/kokoro_tts.py` word-timing alignment
  called `fail()` on unmatchable words (`O(1).`, `RuBisCO`), killing 2 fully-synthesized
  runs (165-170s, ~$0.007 each). The mapper is now wrapped: on mismatch it falls back to
  proportional word timings and keeps the audio.
- **Text no longer splits mid-word.** `wrapText` breaks at `/` and `_` (was
  `recurrence/conv|olution`, `parameter|s`).
- **Removed domain hardcoding**: the biology keyword regex in `src/explainer/auto-director.ts`.
- **Removed dead code**: `generateOpenRouterPlan` (zero callers), legacy Anthropic
  `generatePlan` (+ tests), stale `validatePlan` import.

**Measured finding (important):** the 53% content repair rate is driven by the **gate
stack**, not only the model — content on gemini-3.8-flash cost $0.014 and still needed a
repair, vs qwen $0.005. Do not "fix" reliability by buying a bigger model; reduce/repair
the gates.

**Remaining known issues (next session, in order):**
1. **Gate consolidation** — 12 validators in `planContent` are reject-and-retry loops.
   Keep correctness (anchors, edges, quantities, first-visual); make quality signals
   (pacing, key-point completeness, beat coverage) advisory with deterministic heals.
2. **Kind selection should be the model's job** — `src/explainer/auto-director.ts` guesses kinds
   from ~37 hardcoded keyword regexes. Move `kind`/`shape` into the content schema (the
   model emits them from the kind list already in the prompt); keep the compiler
   deterministic for layout/geometry only. This removes the regex table entirely.
3. **Skills/prompt drift** — `skills/*.md` never mention `evidenceIds`, `beats`,
   `sourceSections`, or the 28-char key-point rule. One machine-readable canvas contract
   should generate both the prompts and the skills.
4. **Multi-chapter pacing** — 10-min runs still show static intervals up to 7.5s and
   timeout under concurrency.

## 2026-09-14 handoff — long-form provider fix and completed narrated export

- The Google 30-chapter `INVALID_ARGUMENT` is fixed by using provider
  `response_format: { type: "json_object" }` only for outlines longer than ten
  minutes. Local schema validation and bounded repair are still enforced. Keep
  strict provider JSON schema for small outlines, content, and direction.
- Verified live job: `827ee077-6098-43f5-a7ea-735e515d0af6`, local DeepSeek V4.1
  report, target 30 minutes, 30 chapters / 60 scenes, narrated with `voice-engine`,
  first generation attempt complete. MP4 is under
  `output/deepseek-v41-30min/DeepSeek-V41-Tech-Report-pdf-30min.mp4`.
- Exact result: 34:07.865 timeline, first playable 80.625s, preparation 467.067s,
  total CLI time including export 594.163s, 81 Gemini 3 Flash Preview calls,
  526,120 prompt + 57,068 completion + 9,150 cached tokens, 27 repairs, and
  $0.425845 tracked model cost. Local voice cost is $0 provider spend.
- `ffprobe` confirms H.264 1280×720/12 fps and mono AAC/24 kHz, 2,047.916667s,
  50,935,451 bytes. Export generated 24,575 frames and all 60 scene SVGs.
- Remaining measured quality debt: duration overshot by 13.77%; five semantic
  findings were deferred after repair exhaustion; three direction fallbacks and
  six shape diagnostics occurred. Reliability passed (no missing scenes/audio,
  provider error, or export failure), but human teaching-quality review remains.
- Model defaults are Gemini 3 Flash Preview for outline/content/director/vision;
  Qwen 3.5 27B and DeepSeek V3.2 remain the configured alternates. Automatic
  cross-model failover is still not implemented and must not be claimed.

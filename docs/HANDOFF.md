# Handoff — state of the project, 2026-09-17

Written after a full read of `src/` (139 files, 14,269 LOC) by five read-only audits. Architecture authority: `Architecture_plan.md`; complete overview: `PLAN_TO_IMPLEMENT.md`. Structure reference: `docs/ARCHITECTURE.md`. Philosophy and non-goals: `AGENTS.md`.

## Waves landed

| wave | commit | result |
|---|---|---|
| **S0** baseline | `9905c41` | layout spacing fix, gate-before-teaching, docs reset, `test/layout-invariants.test.js` |
| **S1** failure ownership | `7041c86` | `classifyFailure` + harness ownership gate; preflight; `test/harness-routing.test.js` |
| **S1b** resolver/compiler contract | `a07bce9` | candidates scoped to the selected archetype; `test/representation-archetype.test.js` |
| **S1c** narrated end-to-end | `ecff8cb` | four more contract defects fixed; **a narrated 2-scene lesson now completes** |
| **V2 default** | `08e08a5` | semantic is the default; V1 frozen legacy (not deleted) |
| **S3** contract truthfulness | `528842e` | static relations render; unimplemented motions removed; continuity realisation documented + tested |
| **S2** heal visibility | `b943b60` | every `healSchema` rule reports `{path,rule,classification,before,after}`; SEMANTIC heals counted on the job snapshot |
| **S8** structured director contract | `bd83e23` | required relations/objects given in the output schema shape; stage enums reconciled |
| **P0** palette | `9534f0f` | theme roles + fill modes; golden SVG hashes pin byte-identity |
| **P1** normalizer | `3f900c4` | fail-closed sanitizer, path grammar, flattening, transforms, converter |
| **P2** embedded catalog | `4a6eda4` | `CompiledSceneV2.assetCatalog` + `resolveAsset(ref,catalog?)` threaded through compile and renderer |
| **P3a** retrieval policy | `15bb8c7` | fail-closed licence gate, collection profiles, retrieval modes, deterministic ranker |
| **S3b** routing before search | `f880e46` | `equation` concepts are not icon-searched and are not counted as degradations |
| **P3** external retrieval | `51ddfcc` | Iconify client, bounded per-concept resolution, wired into `representation-guide`; 13 failure-injection tests |
| **P3b** context-driven icons | `ec21b60` | model-chosen `visualQuery`, semantic suitability gate, icons preferred over compositions; **real library icons now render** |
| **S7** latency budgets | *(this commit)* | job-relative stage budgets, explicit route/flag logging, startup validation |
| **S6** bounded concurrency | *(this commit)* | `mapConcurrent` + TTS beats concurrent (measured: 6.5%, so default 1) |
| **S3c** flat-archetype heal | `0bc7e2c` | `numbered_steps`/`timeline`/`trajectory` flatten composed objects instead of failing |
| **S4** identity cleanup | *(this commit)* | dead identity paths removed; roles documented on every remaining module |
| **X1/X2** invariants | *(this commit)* | purity and cross-cutting invariants are enforced tests, not convention |
| **P5** representation telemetry | *(this commit)* | tier counts per scene, aggregated in the live metrics |
| **S9a** regression corpus | *(this commit)* | real model output captured from the logs as fixtures |


## W0 — semantic-v3 foundation (2026-09-17)

First wave of the target architecture (`Architecture_plan.md`), built alongside
V2 per the §69 migration rule. `VISUAL_PIPELINE=semantic-v3`; V2 stays default.

Landed:
- Single ingestion pathway moved to the neutral `src/shared/ingestion/source.ts`
  (`Architecture_plan.md` §4); `src/explainer/sources.ts` is now a re-export shim.
  Removes the `semantic/` → `explainer/` import violation. Behaviour-preserving.
- Versioned cache skeleton `src/semantic/cache/{keys,store}.ts` (§14, §42-43,
  §50-51). `put` refuses an unvalidated artifact. Not yet wired to any stage.
- Per-stage routing `loadV3ModelRouter` + `PLAN_MODEL_DEFAULTS` in
  `src/shared/model-router.ts` (§54): the plan's model IDs as defaults,
  overridable by `MODEL_ROUTER` or `OPENROUTER_*_MODEL`. V2 routing unchanged.
  **The plan IDs are not yet verified against OpenRouter** — an unresolvable
  route fails visibly, it is never replaced by a fixture.
- `test/frontend-v3-w0.test.js`: pipeline switch, routing precedence, cache-key
  determinism/version-sensitivity, cache validation refusal, and an enforced
  layering scan. Suite green (5 new tests).

Not started: W1 typed `SourceBlock` + retrieval, W2 graph reducer, W3 teacher
planner, W4 scene worker/TTS, W6 migration comparison. Next bounded task: W1.

## W1 — typed source + retrieval (2026-09-17)

Landed (all additive; nothing wired into a live job yet):
- `src/shared/ingestion/blocks.ts`: deterministic parser into
  heading/text/figure/table/equation/code blocks. `SourceDocument.blocks` is now
  populated by `ingestSource`; HTML is serialized to structured text (headings,
  fenced code, pipe tables, figure captions) before parsing. Figures are
  references/captions only — no image generation.
- `src/semantic/source/chunker.ts`: semantic chunker, ~1000 tokens target / 1500
  max, heading-scoped, indivisible code/table/equation/figure blocks kept whole.
- `src/semantic/retrieval/bm25.ts` + `sets.ts`: zero-dep BM25, RRF fusion over
  **injected** vectors, `CoverageSet` (one per top-level section), `FocusSet`
  (top-K), `graphContext` union. Pure; no I/O.
- `embedTexts` added to `planning/model-adapter.ts` (the single network module),
  key-gated and fail-soft to BM25-only.
- `src/semantic/source/cache.ts`: source-tier cache over `cache/{keys,store}.ts`.
- `test/semantic-source-retrieval.test.js` (5 tests). Suite green.

Honest gaps carried into W2: PDF figure/table *structural* extraction is still
absent (only text-derived blocks); OCR is detect-only (the existing
"Scanned PDFs need OCR" error); no reranker beyond BM25/RRF; retrieval is not yet
called by any generator.

Next bounded task: W2 — `GraphFragment` schema, parallel graph-map batches, one
`GraphReducer` → `BaseConceptGraph`, `FocusedConceptGraph`, persisted via the
source cache.

## W2 — knowledge stage (2026-09-17)

Landed (all additive; nothing wired into a live job yet):
- `src/semantic/knowledge/{types,schema}.ts`: `GraphFragment`,
  `BaseConceptGraph`, `FocusedConceptGraph` + model-facing JSON schemas.
  Claims/mechanisms require evidence; no coordinates/code.
- `graph-map.ts`: parallel graph maps, 1/2/4/8 calls by source size, never one
  per chunk; contiguous document-ordered batches.
- `reducer.ts`: deterministic merge (dedup, alias merge, evidence pruning,
  central concepts, thesis), `gateBaseGraph` (unsupported evidence, dangling
  relations, prerequisite cycles), `focusGraph` (prompt match + one hop, scoped
  by optional claim/mechanism `conceptKeys`). ASCII-only ordering so
  `baseGraphHash` is machine-independent.
- `graph-reduce.ts`: optional single model reducer; output is re-reduced
  deterministically and its evidence discarded, so a fabricated quote can never
  become valid evidence. Falls back to the deterministic reducer, no repair loop.
- `cache.ts`: `BaseConceptGraph` cached by source hash only after gate +
  `assertSchema`; base graph is built **without** the lesson objective so it is
  source-owned and reusable (§15).
- Two review passes found and fixed: objective-dependent base graph, envelope
  bug in the file cache (returned `{value}` wrapper), model-reducer evidence
  leak, optional-array crash, and a dead `knowledge` v3 route.
- Tests: `test/semantic-knowledge.test.js` (9 tests). Suite green.

Honest gaps: PDF figure/table structural extraction still absent; no live
embedding run (fake models only); `runGraphReducer` is not yet called by the
orchestrator (deterministic reducer is); nothing wired into `semantic-v3`.

Next bounded task: W3 — one Teacher Planner call → `LessonGraph` + `LessonBible`
+ `SceneContract[]`, duration→depth, title/intro policy.

## W3 — teacher planner (2026-09-17)

Landed (additive; not wired into a job):
- `src/semantic/teacher/{types,schema,gate,planner,index}.ts`: `LessonGraph`,
  `LessonBible`, `SceneContract` contracts and a model schema. **ONE**
  `teacherPlanner` call per lesson; a scene is a learner delta, never a concept.
- Duration→depth: `scenesForDuration` (~35s/scene) and `depthGuidance`;
  title/intro policy in the prompt and gate.
- `gateLessonPlan`: duration band, closed-world concept/mechanism/evidence/scene
  references across graph+bible+continuity, duplicate scene ids, prerequisite
  ordering, supported archetypes, title policy. `buildLessonPlan` caches by
  `lessonCacheKey`; a malformed cache entry is a miss.
- Tests: `test/semantic-teacher.test.js` (6).

## W4 — scene worker + TTS (2026-09-17)

Landed (additive; not wired into a job):
- `src/semantic/scene/worker.ts`: **ONE** `sceneWorker` call decides narration +
  visual intent for a batch. Output reuses the existing `VisualSceneV2`
  contract, so the trusted compiler is unchanged. `sceneBatches` = Scene 1 alone
  then pairs; parallelism capped at 8; the returned scene-id set must equal the
  batch's contract ids. `gateSceneIntent` enforces closed-world concepts,
  candidate archetypes, required-concept coverage and reference integrity.
- `src/semantic/scene/voice.ts`: `VoiceProfile` per lesson, `narrationForScene`
  (one narration per scene), version-sensitive `ttsCacheKey`.
- Tests: `test/semantic-scene.test.js` (5).

Review passes (three agents total across W2-W4) fixed: fabricated-evidence leak,
objective-dependent base graph, file-cache envelope bug, model-reducer evidence,
duplicate scene ids, prerequisite same-scene loophole, incomplete closed-world
bible checks, worker short-response drop, unbounded worker concurrency and
`laterBatchSize`, and a TTS key missing style/pause fields.

Honest gaps: **nothing is wired into a live job** — there is no `generateV3`
orchestrator and no `semantic-v3` job path; the compiler/export still run V2.
PDF figure/table extraction and OCR routing are absent. OpenRouter plan model
IDs were verified present (2026-09-17), but no live v3 call has run.

Next bounded task: W5 — wire the v3 modules into a `generateV3` behind
`VISUAL_PIPELINE=semantic-v3`, then W6 migration A/B against the gates.

## W5 — generateV3 wired behind the pipeline switch (2026-09-17)

Landed:
- `src/semantic/frontend/generate-v3.ts`: source → knowledge → one teacher call
  → scene-worker batches → `compileScene` → optional one-TTS-per-scene. Yields
  the same per-scene shape the V2 job loop consumes, so persistence, SSE and MP4
  export are unchanged. Knowledge/teacher/scene/compile gate failures **throw**;
  the manifest is not a fabricated PASS.
- `src/semantic/jobs.ts`: the store takes the pipeline; `run()` chooses
  `generateV3` only when `VISUAL_PIPELINE=semantic-v3` and a parsed source
  exists, else `generateV2` byte-identically. `sourceDoc` is captured at ingest
  and stripped from the snapshot. v3 `retry()` is rejected until resume artifacts
  exist.
- `src/server.ts` passes the resolved pipeline into the store.
- `src/semantic/scene/worker.ts`: each object must carry exactly one
  representation carrier; `assetRef` is rejected (no candidates supplied yet).
- Scene-tier cache: `generateV3` reuses a gated `VisualSceneV2` per lesson-graph
  + contract hash; `SemanticJobStore` supplies a file-backed `v3Cache`. A warm
  source+lesson+scene cache buys zero model calls.
- `skills/knowledge-compiler/SKILL.md`: the knowledge stage's hard invariants are
  a runtime skill, injected by `graph-map.ts` (§31, §33).
- Tests: `test/semantic-frontend-v3.test.js` (3).

Review pass (fourth agent across W2-W5) fixed: fabricated compile-gate PASS,
discarded teacher gate, hardcoded-zero metrics, unenforced archetype allowlist,
invented `assetRef`, `totalScenes` always 0, and unrestartable v3 retry.

Honest gaps at W5 close (all superseded by the W6/W5 follow-up sections below):
no live v3 run had occurred yet; session-id + prompt-cache prefixes were not yet
wired; the render tier and full skills consolidation were pending. The W6 sections
below record the first live runs, the A/B matrix and the session/cache landing.

Next bounded task: W6 — migration A/B: run `semantic` and `semantic-v3` on the
same cases and compare against `eval/live/gates.ts` before any default change.

## W6 (partial) — first live semantic-v3 run (2026-09-17)

A real OpenRouter run of the v3 front end (`generateV3`, no TTS, text source,
"Explain photosynthesis for a beginner", 1 minute):

| metric | value |
|---|---|
| scenes | **2 / 2 compiled**, all gates PASS |
| scene durations | 21.76s + 21.76s (estimated; no TTS) |
| model calls | 4 (1 graphMap, 1 teacherPlanner, 2 sceneWorker) |
| cost | **$0.0265** |
| route actually served | `google/gemini-3.8-flash` for every stage |

**Routing fact:** the plan primary `openai/gpt-5.6-luna` returns OpenRouter
`404 No endpoints found that can handle the requested parameters` when
`provider.require_parameters=true` + strict `json_schema` are set; the documented
fallback (`google/gemini-3.8-flash`) served every call. The failure is logged
(`provider-failure`) and never substituted — the fallback is exactly what
`Architecture_plan.md` §54 prescribes.

**Six real defects the live run exposed and that are now fixed** (each was
caught by a gate/compiler, not silently healed):
1. Teacher gate rejected a scene that introduces a prerequisite with its
   dependent (over-strict rule added from an earlier review) — reverted to
   cross-scene ordering.
2. Worker objects carried a bare `representation`; the compiler requires exactly
   one `primitiveRef`/`assetRef` — instruction + gate tightened.
3. `structural_diagram`/`convergence` need exactly one hero — now instructed and
   gated.
4. The teacher/worker prompts did not list the closed relation enum, so a model
   emitted an off-enum relation — the allowed types are now stated.
5. Action `fromState`/`toState` not in the object's `allowedStates` — now a
   logged deterministic width-heal plus a gate check.
6. Worker object ids were per-scene, so `keepFromPrevious` could never resolve —
   object ids are now canonicalised per concept (`obj_<conceptId>`), and
   untargeted objects get a logged reveal.

Regression tests added for the canonical ids, hero/carrier gate and reveal-heal.
Suite green (570). V2 remains the default and unchanged.

Next bounded task: W6 proper — A/B `semantic` vs `semantic-v3` over the live
matrix, then compare pass rates against `eval/live/gates.ts`.

## W6 — model research + first A/B (2026-09-17)

**OpenRouter capability research (445 models).** Every shortlist model advertises
`structured_outputs` + `response_format` + `reasoning`; none advertises a
`json_schema` supported-parameter flag (OpenRouter folds strict schema support
under `structured_outputs`). Direct probes of the exact v3 request (strict
`json_schema` + `provider.require_parameters=true` + `reasoning`) against
`openai/gpt-5.6-luna` returned **200** — so the earlier 404 was transient
endpoint/tier availability, not an unsupported parameter, and the documented
fallback is the correct handling. Verified working routes: `google/gemini-3.8-flash`
(primary fallback), `anthropic/claude-haiku-4.5`, `qwen/qwen3.5-27b`,
`qwen/qwen3.5-flash-02-23` (cheapest structured-output model), `deepseek/deepseek-v3.2`.

**A/B on the same text source ("Explain photosynthesis", 1 min, no TTS):**

| pipeline | scenes | wall | output | calls | cost | route |
|---|---|---|---|---|---|---|
| `semantic` (V2) | 2 | 70.0s | 56.9s | 6 | $0.0434 | gemini-3-flash-preview |
| `semantic-v3` | 2 | **14.2s** | 38.5s | **4** | **$0.0214** | gemini-3.8-flash (fallback) |

V3 is ~5x faster wall-clock, ~half the cost and 2 fewer calls. Caveat: without
TTS the v3 estimated output (38.5s) sits under the requested 60s, so the job-level
duration gate (`jobs.ts`) would mark it partial; V2's 56.9s passes. This is a
duration-budget issue in the teacher prompt, not a compiler defect, and is the
next thing to tune.

**Contract defects the A/B and follow-up runs exposed and that are now fixed**
(each caught by a gate/compiler, then healed deterministically and logged):
7. `object.state` not in `allowedStates` — state-declaration heal.
8. Structural archetypes with 0/2 heroes — hero heal plus gate.
9. `Illegal overlap` for nested containment — containment relations become real
   `parentId` + `collisionPolicy:'contain'` before compile; a three-tier compile
   recovery (flatten → single-hero → minimal single-object scene) guarantees a
   bad model shape cannot cost the lesson (loud `v3.compile.degraded` log).
10. Malformed continuity `transitions` — sanitised/dropped.
11. Two objects for one concept — deduped by prominence with reference remap.
12. Worker narration length variance — one bounded length repair re-asks the
    scene workers once and keeps whichever result is closer to the target
    (`v3.scene.length-repair`).

**Final v3 numbers (three fresh live runs, same source, 1-minute target, no TTS):**
58.0s (ratio 0.97, passes the ±15% duration gate), 74.1s (1.24) and 49.6s (0.83);
4-6 calls, $0.02-0.04 each. v3 never hard-failed a lesson after the recovery
tiers; duration variance remains the one open tuning item (the model swings
between ~75 and ~190 words for a ~108-word target).

Regression tests added for state/hero heals and dedupe. Suite green (572).

**W6 matrix — 3 topics, `semantic` (V2) vs `semantic-v3`, 1 min, no TTS.**
Reproducible with `npm run matrix:frontends -- --out eval/live/reports/frontends-v3.json`
(latest run saved there); the table below is that run and supersedes the earlier
exploratory one.

| case | v3 scenes / wall / output / gate | V2 scenes / wall / output / gate |
|---|---|---|
| photosynthesis | 2 / 32.0s / 53.5s / **pass (0.89)**, $0.0277 | 2 / 87.1s / 61.3s / pass (1.02), $0.0441 |
| HTTP lifecycle | 2 / 21.1s / 52.4s / **pass (0.87)**, $0.0272 | 1 / 103.7s / 31.2s / **FAIL** `Illegal overlap` |
| gradient descent | 2 / 16.6s / 59.1s / **pass (0.98)**, $0.0250 | 1 / 87.4s / 31.2s / **FAIL** `Action has no target` |

**v3 duration-gate passes: 3/3. V2: 1/3**, with one compile failure and one
director failure. v3 was 2.6-5.3x faster and ~1.6-1.9x cheaper. The earlier
single v3 miss (ratio 1.21) did not reproduce; the spread is the model's own
narration length, mitigated by the one bounded length repair. `temperature:0` for
v3 stages did not reduce it — Gemini does not honour it.

**Length-repair root cause + fix (2026-09-17).** A live v3 job with the real
`SemanticJobStore` failed the duration gate at 77s/60s even though the repair
existed. Two causes, both fixed:
1. the repair target was the **sum of the teacher's per-scene durations**, not
   the requested duration — a teacher budgeting 78s for a 60s request set the
   target so high that the repair never triggered. It now uses the requested
   duration; the teacher gate's duration band tightened 30% → 20%.
2. a warm **scene cache** suppressed the repair (`missing.length` guard), so a
   stale over-long lesson was sticky. The band check now runs on cache hits too,
   and only inside ±12% of the target (inside the job's ±15% window) so the
   repair fires before the gate can fail.

Verified end-to-end with `SemanticJobStore` (`semantic-v3`, silent, 1 min):
job **`4d4c5693`** → **status `complete`, finalGate `PASS`, publishable**, scenes
25s + 28s = 52.5s (ratio 0.88), 7 model calls, $0.0500, MP4 assembled
(`output/4d4c5693-…mp4`, 1280×720 h264). A prior failing job (`68371ba7`) remains
as the before/after evidence.

**Scene-worker model adherence (same contract, 54-word target per scene):**

| scene-worker model | words (2 scenes) | note |
|---|---|---|
| google/gemini-3.8-flash | 74 + 70 | current route; reliable JSON |
| deepseek/deepseek-v3.2 | 63 + 70 | closest to target, cheaper |
| anthropic/claude-haiku-4.5 | — | returned fenced JSON; **now fixed** (adapter strips one fence) |
| qwen/qwen3.5-27b | — | `parentId` shape rejected by the contract |
| openai/gpt-5.6-luna | — | transient 404 (endpoint/tier availability) |

No candidate follows the word target tightly: gemini over-writes ~30% here while
full runs sometimes under-write. The spread is the model's own, not a routing or
prompt bug, so the one bounded length repair (re-ask once, keep the closer
result) stands as the mitigation and the ±15% job gate correctly withholds an
out-of-window MP4. Accepted residual; re-tune only with a stronger length-following
model. The fenced-JSON fix is a real win found by this experiment.

**Reproducible tool:** `npm run matrix:frontends` (`scripts/compare-frontends.ts`)
runs the same source/prompt through V2 and v3 and writes a JSON+Markdown report
(`--case=<id>`, `--minutes=<n>`, `--out=<path>`). Live-validated on `http`
(v3 31.3s/$0.0276/pass vs V2 108.7s/$0.0466/pass). Needs `OPENROUTER_API_KEY`.

**W5 follow-up — session routing and prompt caching landed.** The OpenRouter
docs confirmed `session_id` (request body, ≤256 chars) plus `cache_control`
prefix breakpoints. `model-adapter.ts` now marks the byte-stable system prefix
(instructions + schema) with `cache_control:{type:'ephemeral'}` and sends a
`session_id`; `generateV3` uses `source:<hash>` for knowledge maps and
`lesson:<hash>` for teacher/scene stages. Live-confirmed working (a run with
both fields completed and routed to gemini-3.8-flash). Cache savings are visible
in `usage.prompt_tokens_details.cached_tokens` on OpenRouter.

**W5 close-out — render tier and skills.** The render cache is deliberately not
implemented: `renderSVG` is pure and <0.3% of job time, and export streams
frames to FFmpeg rather than re-rendering. The skills target classification
(runtime / deterministic-invariant / development-process / deferred) is recorded
in `skills/README.md`; the three deterministic-invariant skills stay code+tests,
and no unloaded runtime skill text is left unclassified. Deletion of superseded
markdown is deferred until each target stage fully replaces its V2 counterpart.

**Unimplemented archetypes are no longer advertised.** `simple_explanation` and
`chart` were listed in the V2 prompt vocabulary and the teaching/scene JSON
schemas although the compiler rejects them. The prompt vocabulary, the
teaching/scene schemas and the identity runtime schemas now use
`SUPPORTED_ARCHETYPES`; the two names remain declared in `ARCHETYPES` only for
legacy compatibility and are rejected before compile. `eval/live/runner.ts`
default archetypes changed from `simple_explanation` to supported ones.

Next bounded task: tune the teacher duration budget so v3 estimated output lands
inside the requested window, then run the full live matrix A/B.



### Wave 4 — three one-minute topic videos, one shot each

Three source PDFs were supplied with the request (one-minute cut of each, no
retries, failures tracked rather than repaired):

| # | source | prompt grounded in | archetypes | result |
|---|---|---|---|---|
| 1 | `llms-cant-jump.pdf` (Tom Zahavy, Google DeepMind, 27 Jan 2026) | E-J-A cycle, induction/deduction/abduction, GR case study | `cycle,cause_effect,comparison` | **FAILED** 50s, 0 scenes |
| 2 | `arxiv 2609.14858` — *Dream-RSI: Recursive Self-Improvement through Evolving Worlds* | replay simulator, off-policy feedback, self-improving loop | `cycle,cause_effect,transformation` | **COMPLETE** 48.6s, 2 scenes, $0.024, 3 calls |
| 3 | `DeepSeek_V41_Tech_Report.pdf` — *Pushing the Limits of KV Cache Compression* | 552B MoE, CED 16B decode / 8B prefill, CSA2 + FP4, 890 B/token | `comparison,cause_effect,numbered_steps` | **FAILED** 76s, 1 scene |

Every prompt was built from `pdftotext` extraction of the actual PDF, names the
paper and its authors, and states the paper's real claims and numbers. The
generator takes only `--prompt`, so grounding the prompt is the entire mechanism —
there is no document-ingest path yet.

**Topic 2 verified grounded in the rendered output**, not just the prompt:
`loop-scene/scene.json` is titled "Recursive Self-Improvement Loop", its goal is
"Explain the recursive self-improvement loop using the replay simulator", and its
narration says "accumulated discovery history can serve as a replay simulator",
"Dream-RSI performs 'dreaming' inside this simulator", and "reimplemented…
continuously expanding the simulator pool". Exported as 24.2s + 31.8s = **55.9s**,
h264 + aac, i.e. a one-minute lesson.

**Two new defect classes, unfixed by request (one shot, no repair):**

1. **`Invalid word timing`** (`v_llms_cant_jump`) — thrown during the compile
   stage after 4 model calls (52.5s of model time already spent). `elapsedMs` was
   0.49, so it is a deterministic timing-validation failure, not a model one, and
   the generation it rejected was thrown away. Same shape as the teaching-discard
   class fixed in wave 3, but on the TTS word-timing path.
2. **`Critical label would be truncated: object_deepseek-v4-1-flash`**
   (`v_deepseek_v41`) — the `cause_effect` director named the hero object after the
   model ("DeepSeek-V4.1-Flash"), and the critical-label fit guard refused it. The
   21-character label cannot fit the hero rect. The director gets one repair, which
   reproduced it. This is the label-fit family the 36-entry register describes, hit
   through a different door: a legitimate long proper noun rather than a layout
   formula.

**Timing audit (log span / model calls / model seconds):** #1 49s / 4 calls / 52.5s;
#2 46s / 3 calls / 41.8s; #3 76s / **5 calls including two teaching calls** / 77.4s.
Topic 3 bought a second teaching generation, so the wave-3 discard is not fully
closed — it is reduced, not eliminated. See `## 2` item 2 and `## 3`.

Tests unchanged: **535/535** (no source changed for this wave).

### Wave 6 - duration as a constraint, and three deterministic bugs it exposed

Goal: make the requested lesson length a constraint instead of a post-hoc
rejection. Three commits (`622fb4c`, `261295e`, `901e7f2`).

**The length contract.** The teaching prompt specified length as three
independent ranges - at most N scenes, 4-7 beats per scene, 12-20 words per beat -
which multiply out to 96-280 words for two scenes, i.e. 40s to 116s at speaking
rate. A one-minute request could be satisfied by any of them. `shared/language.ts`
now owns `NARRATION_WPM`, `wordsForMinutes()`, `scenesForMinutes()` and
`MAX_SCENES_PER_LESSON`, and the prompt states one total: "the ENTIRE lesson's
narration must total approximately N words". Scene count follows the length on
every path, and the 24-scene ceiling is lifted - it had silently made anything
past ~12 minutes unrepresentable, so a 30-minute request could never pass its own
gate. 1/10/30 min now yield 2/20/60 scenes, 108/1080/3240 words, a constant 54
words per scene.

**The word budget held; the speaking rate was the error.** Measured live, the
narration came in at 149 words against a 145-word target (1.03x) and the video
was still 86.5s instead of 60s. The voice engine delivers **107.7 wpm**, not the
145 the planner assumed (four lessons: 102.0, 103.3, 108.8, 120.8). Every lesson
was ~1.35x longer than intended. `NARRATION_WPM` is now 108 with the measurements
recorded so it can be re-derived. The static-interval limit, previously a bare
3500ms duplicated in `compile-scene.ts` and `evaluation.ts` and tuned to the wrong
pace, is one derived constant (`MAX_STATIC_WORDS = 8`).

**Three deterministic bugs found while verifying live:**

1. **The cycle ring heal was not idempotent.** It patched the ring arc by arc,
   correcting only the arcs it visited, so a node could be left with zero outgoing
   arcs and the compiler rejected the scene: "Cycle requires one outgoing relation
   per primary representation (object_x has 0 outgoing relations within the
   cycle)". It now clears every ring arc and closes the ring over the plan order -
   valid by construction, idempotent. (`visual-director.ts:117`)
2. **Flow and cycle disagreed about what an edge is.** Flow excluded
   `labels`/`compares_with` relations; cycle counted them, so a labelled cycle node
   looked like it had two outgoing arcs. One constant now:
   `NON_STRUCTURAL_RELATIONS` in `types.ts`.
3. **A stale 1-24 scene check** survived in `teaching-planner.ts:68` and defeated
   the lifted ceiling; it now uses `MAX_SCENES_PER_LESSON`.

**Still blocking a clean live run** (all Wave 4 / Wave 2 class, none of them
duration):
- `Illegal overlap: concept_1_dream_rsi_1/concept_1_exploration_policy_1` - child
  objects overlapping after cycle placement. The repair passes cannot move
  parented children, so this is unrecoverable, as the audit predicted.
- `Critical representation degraded: object_dream-rsi` - no catalog asset matches
  the concept, so it falls to a composition and trips the critical-representation
  gate. This is the visual-richness gap (measured earlier: 25 of 25 concepts in
  three runs resolved to `composition`, `external: 0`).
- `Scene scene-solution requires 5 primary concepts, which no candidate archetype
  (transformation) can represent` - archetype capacity, hit when the archetype set
  is narrowed.

Tests: **535/535**.

#### Wave 6b - the label block is measured now, and the placement fix is deferred

`LABEL_BLOCK=56` was a flat constant in `archetypes.ts` (flow and branch). It is
exactly the label extent for TWO lines at 20px: `26 - fontSize + lines *
(fontSize + 5)` = 56. But `fitLabel` will fit up to THREE lines, which needs 81px,
so every layout under-reserved 25px and manufactured the overlaps the compiler
then rejected. Layout runs before labels are fitted, so it must reserve the worst
case the fitter allows. `text.ts` now exports `labelBlock(lines,fontSize)`,
`LABEL_LINES_MAX` and `maxLabelBlock(fontSize)`, and both layouts reserve from it.

**A `structural_diagram`/`convergence` placement branch was written and
reverted.** It replaced the round-robin zone fallback with a bounded grid, but
that changed where roots land, which collided with objects that are placed
separately because they are not roots (annotations, decorations, parented
children keep falling through to `zoneRect`). The golden photosynthesis fixture
immediately failed with `Illegal overlap: water/leaf_label`. The real fix has to
place roots AND non-roots from one layout, or the two systems will keep
colliding; reverting keeps the baseline honest rather than papering over it with
fixture edits. The 36-entry register is unchanged, which confirms the label block
alone is not what makes those cases fail - the missing placement branch is.

Code graph regenerated after the wave-5 `src/` edits (`graphify update . --force`):
**1,920 nodes / 4,139 edges / 151 communities -> 2,048 nodes / 4,368 edges / 156
communities** (+128 nodes, +229 edges).

### Wave 5 — root cause of both one-shot failures, and the missing lesson artifact

Both failures were **our own deterministic validators destroying work that had
already been paid for**. Neither needed a model change.

**1. `Invalid word timing`** (`timeline.ts:10`). `timingFromSegments` shifted each
provider word by its segment `offset` but never clamped it to that segment's own
`durationMs`. A single word running past its segment pushed the *next* segment's
first word before the previous word's end, and the flat validator threw. The
validator ran at the TTS rebind (`generate.ts:296`), i.e. after every model call
was bought. Fixed at the producer (clamp into the segment) and at the validator
(`repairWordTimings` — clamp, force monotonic, re-label from the narration we
control), every change recorded as a diagnostic. A word-count mismatch is still
fatal.

**2. `Critical label would be truncated: object_deepseek-v4-1-flash`**
(`compile-scene.ts:56`). `wrapLabel` threw `Label token exceeds available width`
for any token longer than a line, `fitLabel` fell back to truncation, and a
`primary` object then failed the whole scene. A proper noun like
`DeepSeek-V4.1-Flash` is one token with no spaces, so it hit this every time.
`wrapLabel` now breaks long tokens at hyphens/dots/underscores/slashes before
resorting to truncation. Tokens that already fit are returned untouched, so
existing wrapping and the golden hashes are unchanged.

**3. There was no lesson artifact at all.** The pipeline exported one video per
scene and never joined them, so "generate a one-minute video" produced a folder of
thirty-second parts. `concatVideos` in `artifacts.ts` now emits
`output/<run>/lesson.mp4` and the report records `lesson`/`lessonParts`. (First
attempt exited 254: the concat demuxer resolves list entries relative to the list
file's directory, not the cwd — absolute paths now.)

**4. Duration was never requested.** `targetMinutes` has always existed on
`TeachingInput` and shapes the teaching prompt, but `generate-v2-video.ts` never
passed it, so the planner did not know whether it was writing a one-minute or a
thirty-minute lesson. Reported as `for approximately N minutes`. A `--minutes`
flag now wires it. **Wired and built, not yet re-verified live.**

**Verified after the fixes — 3 of 3 complete, one shot each, no retries:**

| video | scenes | lesson | wall | cost | calls |
|---|---|---|---|---|---|
| `llms-cant-jump` | 2/2 | **64.6s** | 74.7s | $0.057 | 4 |
| `dream-rsi` | 2/2 | **60.1s** | 50.4s | $0.024 | 3 |
| `deepseek-v4.1` | 2/2 | **93.5s** | 75.7s | $0.040 | 3 |

All `h264 960x540 + aac`, each naming its paper and its real claims in the rendered
narration (verified from `narration.txt`, not from the prompt). `deepseek-v4.1` runs
long because the duration flag was not set for that run.

**Parallelisation, re-measured on these runs** (`v2.telemetry`, `atMs`):

| run | span | model | tts | unaccounted |
|---|---|---|---|---|
| `v2_llms` | 71.1s | 3 calls / 21.9s | 2 / 20.2s | ~29s |
| `v2_dream` | 46.8s | 3 calls / 15.9s | 2 / 18.0s | ~13s |
| `v2_ds` | 70.2s | 3 calls / 22.2s | 2 / 31.5s | ~16s |

Model time is now only 16-22s per lesson, yet wall is 47-71s: **the bottleneck has
moved from model latency to serialization.** The known sites remain, in
`## 3` items A-H above — TTS across scenes (E), TTS beats inside a scene (D), and
parallel MP4 export (G) are now the largest, since teaching and director overlap
already landed in waves 2-3. Code graph: **1,900 nodes / 4,124 edges** (`graphify update . --force`).

### Wave 2 — latency, cache, benchmark, live matrix

**Where the time goes (measured, complete 2-scene narrated run):** teaching 23.7s (1 call) + director 16.6s (scene 1) + director 10.8s (scene 2) = **51.2s of model time**, plus ~24s of TTS/compile/render = **75.1s wall**. Model latency is 68% of wall, and the two director calls were serial for no reason — they only need the previous scene's SEMANTIC continuity, which the plan already declares.

**The fix.** `directVisual` is split into `directScene` (model call, no compilation) and `compileDirected` (deterministic, the only step needing the previous compiled scene). `generate.ts` now runs phase 1 — visual-model, representation, grounding and the director request — **for every scene concurrently**, passing `previousContinuity` from the plan, then phase 2 compiles and produces scenes in order so geometry reuse still works.

Measured after: the two director calls start 2.5s apart and overlap. **Serial sum 65.1s against a model wall span of 40.9s — 24.2s overlapped.**

**Ownership fix found while doing this.** Two live runs failed with errors the director owns but that were classified compiler-owned and therefore not repairable: a cyclic relation graph in a `cause_effect` scene and a spoken anchor that does not exist in the beat's own narration. Inverted the rule: **only a pure geometry invariant (`Illegal overlap`, `Canvas escape`) is non-repairable**; everything else thrown during compilation is a contract the director wrote and gets its one targeted repair. Retried geometry is still proven byte-identical.

**P4 icon cache** (`external/cache.ts`) — file or memory cache keyed by sha256, atomic writes, a corrupt entry a miss, cached assets re-validated before use. A second resolve performs zero fetches.

### Wave 3 — the discarded generation (biggest single latency and cost win)

Three senior audits (layout, latency, logging) ran against the tree. The latency
audit **corrected a claim this document made**: `## 3` said teaching was one call.
It is not. On every recent run the teaching stage generated a full plan, threw it
away over one deterministic reference error, and then regenerated a smaller one:

| run | teaching calls | teaching time | first-call fate |
|---|---|---|---|
| `final1` (failed) | 2 | 92.4s | discarded — knowledge window failure |
| `final8` (complete) | 2 | 60.4s | **discarded at 42.3s on a deterministic check** |
| `final11` (complete) | 2 | 56.0s | discarded |

The two errors that discarded it were both pure reference checks, not model
judgement: a `centralConceptId` missing from its own `requiredConceptIds`, and a
`requiredConceptIds` member that no beat taught. Both are now deterministic heals
in `validate.ts`, the same shape as the existing relation-focus heal, and both are
recorded as warnings.

**Measured effect.** `final13` (same prompt as `final8`/`final11`, 2 scenes, narrated):

| run | wall | cost | teaching | model calls |
|---|---|---|---|---|
| `final8` | 92.8s | $0.060 | 2 calls, 60.4s | 4 |
| `final11` | 97.9s | $0.047 | 2 calls, 56.0s | 5 |
| **`final13`** | **67.2s** | **$0.053** | **1 call, 18.3s** | 4 |

Both scenes exported and narrated (27.2s + 29.6s ≈ 57s, h264+aac). Director calls
now overlap: serial sum 66.7s against a model wall span of 58.8s.

A spoken anchor the model named but never wrote (`"ensure"`, from the same family
the wave-2 ownership fix already hit) no longer fails the scene: `timeline.ts`
degrades it to the beat start and records a diagnostic. Failing it bought a
director repair that reproduced the same anchor.

**Observability was broken in two ways and both are fixed.** The per-job
`log.jsonl` had never been written for a single semantic job: the logger wrote to
`.data/<jobId>` while V2 keeps jobs under `.data/semantic/<jobId>`. The job now
supplies `logDir`. And every stage telemetry event was handed only to the job
store's hook, which discarded everything but the stage name — per-stage timing,
diagnostics, timing kind and failure text never reached the log. They are now
emitted as `v2.telemetry` (28 events on `final13`).

Tests: **535/535**.

#### Wave 7 - visual richness, source grounding, and a four-duration attempt

**The visual layer works now.** Measured on the MLA lesson: `trusted-asset 1,
substring-asset 2-3, composition 0` in both scenes. Before this wave it was
`trusted-asset 0, composition 9`. Four causes, all fixed:

1. The archetype was a HARD filter on asset lookup, in THREE places that each had
   to be found: `assets/search.ts`, `compiler/fallback.ts` (which demoted a known
   asset to a bare label), and `planning/visual-director.ts` (which refused any
   pick that did not NAME the archetype). 37 of 43 catalog assets declared two or
   three layouts and `cause_effect`, `numbered_steps` and `hierarchy` appeared on
   almost none of them, so a `cause_effect` scene was offered no assets at all.
2. `VISUAL_ICONS` defaulted to `off`, so the Iconify path never ran. Default is
   now `balanced`.
3. A false match the widening exposed: `Discovery Loop` matched
   `physics.compressor.v2` on the tag `cycle` alone. A tag-only match no longer
   qualifies.
4. A source document could not be passed at all - the CLI only took `--prompt`.
   `--source <file>` now grounds a run, and `sourceId` is sanitised to the plan
   schema's id pattern (a filename with a dot failed as an invalid string).

**Five more gates healed, all the same class - fail rather than heal:**
architect delta out of beat (`teaching-architect.ts`), critical beat without
evidence (`validate.ts`), dangling evidence reference (`knowledge-compiler.ts`),
continuity a scene cannot honour (`visual-model.ts`), and a chaptered source
compared against the WHOLE lesson budget instead of its share
(`teaching-planner.ts`) - which made a "one-minute" lesson 213 words and 95.5s.

**Four-duration run from the MLA fixture, one shot each, no retries:**

| target | result | wall | lesson | cost | scenes |
|---|---|---|---|---|---|
| 1 min | **complete** | 68s | 36.8s | $0.041 | 2 |
| 1 min (after three more heals) | **complete** | 80s | 31.6s | $0.041 | 2 |
| **1 min (clean run, wave 8)** | **complete** | **57s** | **56.3s** | **$0.030** | 2 |
| 5 min | failed - whiteboard `VISUAL_SUPPORT` | 104s | - | - | 0 |
| 10 min | failed - `Illegal overlap: concept_1_kv_cache_1/concept_1_latent_vector_1` | 84s | - | - | 1 |
| 20 min | failed - `Persistent representation changed without transition: memory-bandwidth` | 139s | - | - | 2 |

Those three gates were then healed (whiteboard VISUAL_SUPPORT, unannounced
representation drift, child collisions between two parents) and the run repeated:
**1 min still completes** (31.6s, $0.041, 2 scenes); 5/10/20 min still fail. Two
distinct problems remain:

- **Child collisions on a cycle ring.** `Illegal overlap:
  concept_1_memory_bandwidth_1/concept_1_latent_vector_1`, and the same shape under
  other names. Relocating a parent by 32-64px cannot clear two subparts whose
  parents sit adjacent on a ring of radius 380x155: the ring must place a child on
  the side FACING AWAY from its neighbour, or widen for scenes with subparts.
- **The narration undershoots** - FIXED. The cause was the beat COUNT, not the
  word count: every beat came back at exactly the 11 words asked for, but there
  were three per scene instead of five, so a one-minute lesson totalled 66 words
  and ran 31.6s. The prompt now states a beat TOTAL and the refinement note gives
  beats and words together. Measured after: **56.3s**, inside the 60s +/-15%
  window, and 52.4s on an earlier pass.
- **Wave 8 also raised the long-form token ceiling** (12000 -> 20000, retries 1 ->
  2; a twenty-minute lesson needs ~2,160 words of narration and failed with
  'truncated again 2 times: length'), gave a stage TIMEOUT the running stage's one
  bounded retry (a timeout is transient; a rate limit or dead route is not), healed
  dual representations, healed an archetype no candidate could carry, healed
  continuity naming a concept that does not exist yet, and added a child-vs-child
  resolver.

The 1-minute lesson also came in SHORT (36.8s, 75 words against a 108 budget):
the length refinement fired at 66 words and re-asked, and the model still
undershot. The refinement needs a floor, not only a re-ask.

#### Wave 6e - the length refinement, and a verified one-minute lesson

Two more compiler repairs and the last piece of the duration contract.

- **Child repair** (`compile-scene.ts`): children were excluded from every pass
  because moving them freely breaks containment, so a child overlap was
  unrecoverable - `Illegal overlap: concept_1_dreaming_loop_1/
  concept_1_discovery_history_1` killed a live scene. A child is now shrunk and
  re-seated toward a quadrant INSIDE its parent until it clears.
- **A broken ring is laid out, not refused** (`archetypes.ts`): the cycle layout
  threw when the graph did not walk as one closed ring, on the theory the director
  would repair it. It cannot - the director synthesises the ring before the
  compiler's composition fallbacks run, and a fallback that drops a node breaks the
  ring it just built. The compiler now prefers the graph's ring and otherwise lays
  the primaries out as a ring over a deterministic order. The test asserting the
  refusal was rewritten, not deleted: it now proves a broken ring still lays out
  with zero collisions.
- **Length refinement** (`teaching-planner.ts`): the prompt states the word budget
  but the model does not reliably hit it. Measured 149 words against a 145 target
  on one run and **65 against 108** on another - a 40s lesson for a sixty-second
  request. If the total lands outside 0.85-1.15x the budget the stage re-asks once,
  stating the measured total and the direction to move. This is the one targeted
  repair the stage is allowed.

**Verified end to end:** `status complete`, 2/2 scenes, **lesson 62.9s from 103
words against a 108-word budget** - inside the 60s +/-15% window for the first
time. Wall 67.3s, cost $0.037, 3 model calls, h264+aac. The layout register is
36 -> 8.

#### Wave 6d - the layout register is 36 -> 8

Five repairs, each preserving byte-identical output for scenes that already fit
(the golden hashes are the guard, and they caught one attempt that changed a
working fixture - it was rewritten to leave that fixture alone):

| repair | site | fixed |
|---|---|---|
| fit-to-safe: shrink an object whose `visualBounds` leave the band, about its own centre, and re-fit | `compile-scene.ts` | structural/convergence n=2/n=4 long, flow n=4/n=5 long flat |
| nested zones: `nestedZoneRect` - `nest` 0 is `zoneRect`, so the ninth unplaced object no longer lands on the first | `zones.ts` | (enabler) |
| equation pitch from the measured label block, not a fixed 14px gap | `archetypes.ts` | equation n=4, n=6 short |
| label width bounded by the NEARER safe edge, not a flat 180px | `compile-scene.ts` | cross_section, spatial_process n=2/n=4 long |
| crowded structural hero: past 8 supports the hero gives ground (330x440 -> 220x300) | `compile-scene.ts` | structural/convergence n=12 long |
| `COLLISION_GAP` shared, and the row pitch clears label block + gap | `collisions.ts` | equation n=6 short |

**Remaining 8:** `structural_diagram`/`convergence` n=12 short (4) - eleven
supports against eight zones cannot be resolved while the hero's own label reaches
into the bottom zone, so these need the real grid placement rather than a wider
hero. `spatial_process` n=12 long (2) and `equation_walkthrough` n=6 long (2) - the
scaled pitch rounds to 503px against a 498px band, so the last row is one
rounding step outside; the scale needs to be applied to the total, not row by row.

#### Wave 6c - fit-to-safe repair, nested zones, and a register that shrinks

**10 of the 36 layout defects are fixed and removed from the register (36 -> 26).**
The bidirectional assertion caught it exactly as designed: it failed with "these
were fixed - remove them from KNOWN_DEFECTS" and listed the ten.

- `compile-scene.ts` - fit-to-safe repair. The structural hero is 440px inside a
  498px safe band, so a three-line label (81px) beneath it needs 521px. Objects
  whose `visualBounds` leave the safe band are shrunk about their own centre and
  re-fitted until they fit. Only escaping objects are touched, so scenes that
  already fit keep byte-identical geometry (golden hashes unchanged).
  Fixed: `structural_diagram` n=2/n=4 long, `convergence` n=2/n=4 long,
  `flow` n=4/n=5 long flat.
- `zones.ts` + `compile-scene.ts` - nested zone allocation. `zoneRect` was reused
  by the round robin (`SUPPORT_ZONES[support++ % 8]`), so the ninth unplaced
  object landed on exactly the first claimant's rect - a guaranteed illegal
  overlap no repair pass could fix. `nestedZoneRect(zone,w,h,nest)` returns
  `zoneRect` unchanged for `nest` 0, so existing scenes stay byte-identical, and
  later claimants shrink toward a deterministic corner inside their zone.

**Still open (26):** `equation_walkthrough` n=4/n=6 (8) - note rows are 34px with a
14px gap, so the label block (31px for one line, 81px for three) hangs into the
next row; the pitch has to be derived from the band and the label budget, not
fixed. `structural_diagram`/`convergence` n=12 (8) - the layout still has no
placement branch, so roots go through the zone fallback. `spatial_process` (6) and
`cross_section` (4) - a support whose label is wider than its 120px rect escapes
horizontally; the fit width is `max(rect.w,180)` regardless of the space beside it.


**P6 representation benchmark** (`scripts/bench-representation.ts`, `npm run bench:representation`) — 75 concepts, 9 domains, 17 archetypes. Headline on the authored corpus: **82.7% primitive-label**, law/governance **0/10** trusted, and four abstractions that reach a trusted asset when they arguably should not (`Blood Pressure → physics.compressor.v2` is a tag collision).

**S9b live matrix** (`scripts/live-matrix.ts`, `npm run matrix:live`) — one command produces job success rate, compile success, P50/P95 wall and first-playable latency, cost, model calls, top failure reasons and a PASS/FAIL line per measurable migration gate. Failed runs stay in the denominator; unmeasurable gates report PENDING rather than being faked.

### Measured: one narrated 1-minute lesson

| run | status | scenes | wall | cost | calls |
|---|---|---|---|---|---|
| `narrated-2sc-f` (before concurrency) | complete | 2 | **75.1s** | **$0.039** | 3 |
| `final6` (after, "how a bill becomes law") | complete | 2 | **127.0s** | **$0.070** | 5 |

Both exported narrated MP4s (scene 1 is 27.25s h264+aac). `final6` drew **53.8s of overlap** (serial sum 119.9s against a 66.1s model wall span) — the concurrency works. Its wall is longer because the first teaching call took **66.1s** against 21–24s in earlier runs, and it needed two repairs: **provider latency variance dominates, not our serialisation.**

**Job success rate is the real problem, not speed.** Six consecutive attempts at a 2-scene narrated lesson produced four different failure modes, every one a model-output contract violation: an unresolvable spoken anchor, an omitted required relation, a hero with no representation, and a repair whose window was truncated. Two of those are now healed deterministically (composition derived from `semanticType`; a single wrong arc for a required concept pair corrected in place). The budget's per-stage floors were also wrong at first — it cut a repair off at 10.5s against a call that needs ~15s, which is a guaranteed failure; floors are now 20–30s for model stages and the default allowance is 3× the lesson length (180s for one minute).

**Next bounded task:** the remaining hard gates. `gateVisual`'s hero degradation and the board-alignment checks fail a whole job on a single model omission. Each needs either a deterministic recovery like the two above, or a downgrade from hard to advisory with a recorded degradation, so one bad field cannot cost a lesson.

### Parallel wave — S4, X1/X2, P5, S9a

Four file-disjoint workstreams run in parallel, then built and verified centrally. All tests green (`npm test`; never hardcode a count).

**S4 — one identity authority.** `identity/references.ts` deleted (fully orphaned), along with dead exports `normalizeLegacyTeachingPlan`, `canonicalizeRelation`, `normalizeSemanticPart`, `remapContinuityIds`, `buildVisualScene`, `CanonicalRelation`, `VisualIntent`, `ResolvedVisualDirection`; several internal-only types un-exported. **−171 lines.** Every remaining identity module carries a one-line role comment. The premise about `artifacts.ts` was wrong and the agent said so: it has four live importers (`scripts/export-example-video.ts`, `scripts/generate-v2-video.ts`, `scripts/bench-semantic-archetypes.ts`, `eval/live/runner.ts`) and was left alone. `harness/registry.ts` remains the runtime authority, untouched.

**X1/X2 — invariants become tests.** `test/purity.test.js` scans the source of `compiler/` and `renderer/` and fails if either imports a model/provider/fs module, touches a clock, `Math.random`, `process.env`, or if the SVG renderer stops being synchronous. `test/invariants.test.js` groups five cross-cutting rules (archetypes compile, `MOTIONS` excludes unimplemented motions, static relations render, the renderer is deterministic and non-mutating, a geometry failure is compiler-owned).

**P5 — representation telemetry.** `representation-metrics.ts` classifies every concept into one of six tiers (`trusted-asset`, `substring-asset`, `composition`, `external`, `primitive-label`, `not-applicable`); `generate.ts` logs a per-scene `v2.representation.tiers`; `eval/live/metrics.ts` aggregates them. This is the measurement that was missing when icon breadth looked like the problem.

**S9a — regression corpus from real output.** `test/real-output-regressions/` holds verbatim `{direction, decisions}` responses captured from the live logs, with the run they came from and what went wrong. **Of the 42 distinct director outputs collected, every one carried actions with `relationRefs` and no `conceptKeys`** — the defect that used to kill whole jobs. Six tests replay the real bytes through the same heal the adapter applies.

**A limitation the corpus surfaced honestly:** the logger redacts narration, so a captured beat reads `"[REDACTED]"` and spoken anchors can never resolve. The corpus therefore proves conversion, structural validity and composition repair, and **asserts the redaction explicitly so a skipped fixture is never mistaken for a passing one**. Future captures should set `V2_REPLAY_DIR`, which writes the raw response before redaction.

### S7 — the job now has a latency budget

`harness/budget.ts` derives an allowance from `targetMinutes` (`V2_JOB_BUDGET_MS` overrides, `V2_JOB_BUDGET_FACTOR` scales; default 2x the lesson length, so **120s for a one-minute video**). Every stage timeout becomes a share of *what is left*, floored at 8s, so the absolute ceilings are unreachable:

| stage | ceiling before | now bounded by |
|---|---|---|
| knowledge-compiler | 600s | at most 40% of remaining |
| visual-director | 360s | at most 35% of remaining |

When the remainder is thin the budget **sheds repairs first** (a repair is a second full model call), and an exhausted budget **fails explicitly** rather than starting work it cannot finish. `semantic-job.routes` is logged at creation with the resolved route for every task, the fallback chain, `visualIcons` and the budget, and `VISUAL_ICONS` is validated at creation instead of mid-generation.

### S6 — concurrency, with a negative result worth keeping

`harness/concurrency.ts` provides `mapConcurrent`: bounded workers, **results placed at their input index**, first failure stops scheduling. TTS beats now use it, and the audio is byte-identical to the serial join (asserted).

**But the measurement says it barely helps:** six beats on the real local engine — **10,943ms serial vs 10,226ms at three in flight (6.5%)**, with per-call generation time tripling. The bundled voice engine is CPU-bound, so concurrency buys contention rather than throughput. The default is therefore **1**, with `V2_TTS_CONCURRENCY` to raise it for a network voice where the cost is I/O, not compute.

**Teaching windows were deliberately not parallelised.** They look independent — separate model calls, deterministic ordered merge — but each window's prompt carries `priorConcepts` from the windows before it, so it is a real dependency. The plan says to parallelise only when they are independent; they are not, and that is recorded rather than forced.

### S3c — the flat archetypes accept whatever the resolver produced

`numbered_steps`/`timeline`/`trajectory` require every object to be a label. The heal stripped **assets only**, so a composed object (`representation` plus a rectangle) still failed — which became common once the resolver began composing most concepts, and which cost a live run. They are now flattened properly: assets and compositions dropped, parenting cleared, relative collision policies reset, all recorded as diagnostics.

### P3b — retrieval is driven by the model, and it now works

**Direct answer to "is it hardcoded or searched from context":** it is **searched from context**, and until this commit it barely was — the hardcoded 43-asset registry was the primary source and the search was gated behind it, so a live run resolved five of six concepts to procedural shapes and never issued a useful query.

| change | why |
|---|---|
| **`visualQuery` on the concept contract** — the model picks ONE concrete noun per concept from the lesson context (`bill → document`, `committee → users`, `reconciliation → handshake`) | icon libraries are indexed by concrete nouns; `Legislative Bill` matches nothing |
| **semantic suitability gate** (`external/suitability.ts`) — an icon is eligible only when its name is the query once style vocabulary is removed | literal matching is confidently wrong: `floor` returns `floor-lamp`, `bill` returns `bill-x` |
| **tier policy** — a concept that only reached a procedural composition is searched for too when it names an *object* (entity/material/location/role); a real icon replaces the composition, and the composition stays the fallback when the search misses | compositions were preempting icons for exactly the nouns icons are good at |
| **provider relevance** as `providerRank` | the ranker scored a whole collection identically and then discarded Iconify's own ordering |

**The bug that blocked every icon:** the sanitizer rejected `xmlns="http://www.w3.org/2000/svg"` as an "external URL". That is a namespace declaration, not a fetch — every real icon carries it, so **100% of provider SVGs were refused**. Namespace declarations are now stripped before the URL check; a genuine `href`, `url(...)` or external URL is still rejected.

**Live verification (`VISUAL_ICONS=balanced`, "how a bill becomes law"):**

```
complete · 1 scene exported · $0.017 · 2 model calls

bicameral-legislature → external.tabler.building   (stroke_native)
legislative-bill      → external.carbon.document   (mixed)
reconciliation        → external.lucide.handshake  (stroke_native)
committee review      → composition:component_group
floor debate          → composition:signal
```

All three render in the chalk-ink palette because a converted part carries `strokeRole: 'outline'`. `legislature` found nothing under its query and kept its composition — the fail-visible path working as designed.

Also threaded the catalog through the last two generation-path `getAsset` sites (`narration.ts`, `lintCompiledScene`) and every `canonicalAnchor` call, or a catalog-only asset threw `Unknown asset` during validation.

### P3 — external retrieval, and what the live run taught us

Built: `external/iconify.ts` (the only network boundary — injectable fetch, per-request timeouts, aborts, size caps), `external/search.ts` (hits → metadata, licences taken from the reviewed profiles, never the provider), `external/resolve.ts` (one search, ≤3 fetches, convert, validate, every rejection reported), `planning/representation-external.ts` (bounded to 4 concepts per scene, builds the embedded catalog). `VISUAL_ICONS=off|strict|balanced|broad`, default `off`; with `off` no client is constructed and no request is made.

**Live verification (`VISUAL_ICONS=balanced`, "how a bill becomes law", 1 scene):** job **completed**, 1 scene exported, $0.017, and **zero external icons landed.** The single concept that reached the external tier (`reconciliation`) had no Iconify match. The final scene:

```
legislature  → composition:system      floor debate → composition:signal
bill         → composition:quantity    law          → composition:quantity
committee    → composition:container   reconciliation → primitive:label
```

**The finding: the external tier is consulted too late.** It only sees concepts the local resolver could not represent *at all*. On this scene five of six concepts received a **composition** — a procedural shape — so they never reached the external tier even though `bill`, `committee` and `legislature` are exactly the concrete nouns an icon collection covers. The earlier `primitive-heal` events I read as resolver failures were in fact the *director* choosing primitives.

**A real bug found by the live run:** the ranker scored every candidate from a collection identically, so `rankCandidates` fell through to its `collection`/`name` tie-break and **discarded the provider's own relevance order**. Fixed: `providerRank` is carried from the search response and adds up to +12. It cannot override a licence or collection refusal.

**A quality risk the probes exposed:** Iconify name-matching is literal. `floor` returns `floor-lamp` and `floor-plan`; `legislature`, `committee`, `sensory` and `abduction` return **nothing**. So external icons help concrete technical nouns (`database`, `server`, `client` all return good stroke sets) and can be actively wrong for others.

**Recommended next step (not done):** change the tier policy so an `entity`-typed concept prefers a concrete icon over a procedural composition, with a semantic suitability check before adopting it. That is what would make the picture genuinely richer — and it is exactly where the `floor`→`floor-lamp` risk has to be handled (the plan's P5 suitability gate).

### S3b — and a correction the live logs forced

`resolveRepresentation` ignored `semanticType` and went straight to icon search, so an `equation` concept searched for an icon, failed, and emitted `REPRESENTATION_DEGRADATION` for something that was never an icon. It now returns `fallback: 'not-applicable'` with no warning, and the representation gate excludes that from both the hero check and the findings — **the false signal is what hid the real gaps**.

**The synthetic measurement was wrong, and the live logs corrected it.** My fixture sweep (below) suggested equations were 6 of 11 misses, so I built the routing fix first. Then I counted the actual `primitive-heal` events in the live runs:

| run | objects healed to a label primitive |
|---|---|
| `s8-live` (how a bill becomes law) | **legislature, bill, committee, floor** — concrete nouns |
| `s3-live` | world-model, sensory-experience, discovery-process — abstract nouns |
| `narrated-2sc-f` | discovery-process, world-model |

**Not one equation.** The live misses are `entity`-typed nouns. So the routing fix is correct but low-impact, and **icon breadth (P3) is the real lever** — exactly the opposite of what the fixture sweep implied. The lesson: fixture objects are hand-authored and already carry their representation, so sweeping them measures the resolver against concepts it never actually resolves.

### Fixture sweep (kept for the record, with its caveat)

Across 50 hand-authored fixture objects the resolver reaches a trusted asset for **39 (78%)**; of the 11 misses, 6 are equations/symbols, 3 are annotation labels and 2 are genuine entity gaps (`Client`, `CPU registers`). Treat this as a lower bound on need, not as evidence of live behaviour.

### P3a — the deterministic half of external retrieval

Nothing here performs I/O, so the decisions a future fetch depends on are testable now:

| module | behaviour |
|---|---|
| `external/license.ts` | **fail-closed**: explicit allow-list only. MIT/ISC/BSD/Apache-2.0/CC0/Unlicense → `auto`; CC-BY/OFL → `attribution`; **share-alike, non-commercial, derivatives and anything unknown → `blocked`**. `assertPermitted` throws rather than warns. |
| `external/policy.ts` | curated collection profiles (licence + drawing style per collection). `collectionsFor(mode)` returns an ordered, blocked-free list: `off` → none, `strict` → stroke-only only, `balanced` → stroke-only then the rest, `broad` → all permitted. No `if (prefix === …)` tables. |
| `external/rank.ts` | deterministic scoring: stroke-native `+20`, fill-only `−15`, duotone `−10`, complexity penalties, attribution `−5`, unprofiled collection `−25`, preferred-collection bonus from position. Ties break on `collection` then `name`, so the same candidates always produce the same order. Blocked and unpermitted candidates are **rejected with a reason**, counted separately from the ranked set. |

**Measured before building it** (and it changed the plan): across 50 fixture objects the resolver already reaches a trusted asset for **39 (78%)**. Of the 11 misses, **6 are equations/symbols**, **3 are annotation labels**, and only **2 are genuine entity gaps** (`Client`, `CPU registers`). Icon *breadth* is therefore a smaller lever than it looked — the resolver is asked for an icon for things that were never entities, and that false `REPRESENTATION_DEGRADATION` signal is what hides the real gaps.

**Honest limit:** icon libraries do not fix abstract concepts. There is no icon for "abduction"; Iconify would supply a *symbol* (lightbulb, brain, network). For abstract topics the composition families remain the primary representation.

**Next, with the corrected priority:** **P3 (the network half)** is the real lever — the live misses are concrete nouns (`bill`, `committee`, `floor`, `legislature`) that an icon collection would cover directly. It needs three decisions: the `VISUAL_ICONS` rollout (`off` default then `balanced`?), whether to use OpenMoji (share-alike), and who signs off P7 promotion. After that, **S6/S7** for throughput.

### Icon system P0–P2 — representation can now come from outside the static registry

| phase | delivered | gate |
|---|---|---|
| **P0** | `renderer/palette.ts`; `AssetPart.strokeRole/fillRole/fillMode/fillOpacity`; `stroke` optional | **byte-identical SVG across all 12 fixtures** (`test/golden-svg-hashes.json`), and every fixture on disk must be pinned |
| **P1** | `assets/normalize/{sanitize,path,geometry,transform,colors}.ts` + `assets/external/convert.ts` | sanitizer fail-closed on 18 attack vectors; conversion is deterministic and clock-free |
| **P2** | `CompiledSceneV2.assetCatalog`; `resolveAsset(ref, catalog?)` threaded through `compile-scene`, `fallback`, `illustrations`, `relations`, `render-svg` | an asset that exists **only** in the catalog renders identically in-process, in a fresh process (export) and after a JSON round-trip (browser) |

Two defects found while writing the tests: the transform argument guard was inverted, and an arc whose endpoints coincide divided by zero and produced NaN points (the spec says to omit such an arc).

Still inert by design: nothing produces a catalog yet. P3 (external retrieval) is the first phase that does, and it is the one that adds network, licences and caching — deliberately not started.

### S8 — one shape from prompt to validator

| change | before | after |
|---|---|---|
| required relations | serialised into a prose sentence with **different field names** (`fromConceptId`/`relationType`/`targetAnchor`) than the output schema (`fromConcept`/`relation`/`targetPart`) | structured `requiredRelations` input in the **output field names**, so the model echoes rather than translates |
| required objects / hero role | implied by the plan | explicit `requiredObjects: [{conceptKey, role}]` |
| stage enums | `Stage` (model calls) looked like a stale duplicate of `HarnessStage` | documented as deliberately the model-callable subset; `STAGE_OWNERS` remains the canonical list |

Measured: the prompt that failed twice on `Missing semantic relation rel-bill-to-committee` **now completes** — 1 scene, 44.5s, 2 calls, $0.018.

Prompt sizes from that run: teaching 3,440 / director 4,703 prompt tokens. The director instruction is ~4.0k chars; the rest is structured data, not prose.

### S2 — no deterministic correction is silent any more

`healSchema` (`schemas.ts`) rewrote model output with ~12 rules and **zero reporting**. Every rule now reports, classified:

| class | meaning | rules |
|---|---|---|
| `NORMALIZATION` | shape only, same meaning | unknown-key-dropped, empty-optional-dropped, number-clamped, version-defaulted, hidden-state-normalised, list-joined, object-to-array, part-of-normalised, motion-alias |
| `SAFE_DETERMINISTIC` | the contract already implied it | parent-child-linked, orphan-children-dropped, relative-policy-degraded, mixed-target-pruned, object-action-to-trace, relation-action-to-reveal |
| `SEMANTIC` | invents or alters instructional content | required-concepts-derived |

Each event is emitted at the model boundary as a `heal` stage event and tallied by `healCounts()`; `semanticRepairCount` is persisted on the job snapshot. Verified on a real run: **6 heal events, all classified, `semantic: 0`**.

**Drift caught by this work:** `MOTION_ALIASES` mapped `move_to → 'move'`, but S3.2 had removed `move` from `MOTIONS` — so that alias would heal valid-looking output onto a motion the renderer cannot animate. Removed, with a permanent test asserting every alias target is an implemented motion.

### S3 — advertised capability now equals runtime capability

| change | before | after |
|---|---|---|
| relations with no animating action | silently not drawn (`relations.ts` returned early) | **VISIBLE_STATIC** — drawn fully once both endpoints are visible |
| `move` / `split` / `merge` | in the prompt + schema, **no renderer branch** | removed from `MOTIONS`; rejected by both schemas; dead `destination` field deleted |
| continuity actions | computed + validated, renderer read none | realisation documented in `ContinuityAction` and proven by test for KEEP/REMOVE/REINTRODUCE |

Live verification (same prompt, 2 scenes, narrated): complete, 2/2 exported, 37.4s + 29.4s = 66.8s, 6 calls, $0.069. The scene now draws **4 flow relations** where the previous run drew 1 arrow.

### First complete narrated lesson (live paid route)

`dist/scripts/generate-v2-video.js --prompt "…scientific discovery…" --scenes 2 --narration --budget 1.5`

| | value |
|---|---|
| status | **complete**, 2/2 scenes exported |
| video | `inference-modes` 38.5s + `grounding-models` 21.9s = **60.4s** h264+aac |
| wall | 75.1s |
| model calls | 3 (1 teaching + 2 director) |
| cost | $0.039 |

Reproduce: `node --env-file-if-exists=.env dist/scripts/generate-v2-video.js --out output/lesson --prompt "…" --archetypes cause_effect,flow,structural_diagram,comparison --scenes 2 --narration --budget 1.5`

### S1 measured effect (routing)

Same live prompt, 1 scene, before vs after routing:

| | before | after |
|---|---|---|
| director model calls | **2** | **1** |
| director ms | 37,858 | 16,122 |
| retries on a non-director failure | 2 | **0** |

Structural proof: `classifyFailure()` now has a production caller (`executeStage`, `stage.ts:91`). Before S1 it had **zero** — grep and the graph both agreed.

## 0. Cleanup performed this session

- Removed `output/` (415 MB), `.data/` (13 MB), `dist/` (1.2 MB). Rebuilt `dist/`.
- Deleted stale docs. `docs/` now holds only: `ARCHITECTURE.md`, `HANDOFF.md`, `ICON_SYSTEM_PLAN.md`. Root: `README.md`, `AGENTS.md`, `PLAN_TO_IMPLEMENT.md`.
- `tasks.md` deleted (its content was duplicated in the old `V4_IMPLEMENTATION.md`).
- Code graph adopted: `graphify` MCP in `opencode.json`, regenerate with `graphify update . --force`.

## 1. What genuinely works (verified)

- **The central constraint holds.** Models emit validated semantic data; all geometry is compiled by trusted deterministic code; `renderSVG(scene, timeMs)` is pure. No `Date`/`Math.random`/`performance.now`/DOM inside `renderer/` or `compiler/` (grep-verified).
- **V2 has a real spine.** One orchestrator (`planning/generate.ts:85`) threads every stage through one harness (`harness/stage.ts:38`) with per-stage owner/timeout/budget/repair policy (`harness/stage.ts:11-23`), one journal, one manifest. Two disjoint pipelines are enforced at `semantic/pipeline.ts:8`.
- **Deterministic layer is verified by tests**: compiler, renderer determinism/escaping, validators, geometry/collision/timeline math, representation fallbacks, harness resume/cancel, cost/route accounting.
- **A real scene has rendered and exported.** Run `59ca93e3` compiled and rendered scene 1 (`Abduction / Sense Experience / Axioms / Induction / Deduction / World Models`, 40.98s) with local TTS audio.

## 2. What is broken or incomplete

Ordered by impact on "generate a clean video".

1. **Layout formula manufactured overlaps.** `compiler/archetypes.ts:56-72` pitched rows at `400/group.length` (100px for a 4-node rank) under 110px rects with a ~166px rect+label block. The layout itself produced the overlaps the compiler then rejected as `Illegal overlap`, and the repair pass could not fix them (hero immovable, `.8` scale floor insufficient, only 6 zones). **This was misdiagnosed in prior handoffs as "director variance".** Fixed this session (bounded layered grid).
2. **Wasted model calls dominate latency.** On the last failed run, **97 of 174 seconds (56%) produced nothing**: a teaching window re-planned after a knowledge failure, and the director called 4× on a scene that could never compile. Validation fires only *after* full generation (`planning/model-adapter.ts:56-60`).
3. **Director action contract is ambiguous to the model.** The model attaches relation refs to `draw`/`morph` actions; resolution then yields a relation-only target, rejected by `validate.ts:80-82`. Seen in 4 of 4 raw director outputs.
4. **Renderer never reads `continuity.transitions`.** They are derived (`generate.ts:287`) and validated (`validate.ts:124`) but ignored by `renderer/scene-state.ts`. The non-animating motions `move`/`split`/`merge` were removed from `MOTIONS` rather than left advertised (`types.ts:6-10`).
5. **Relations render as VISIBLE_STATIC when no action animates them** (`renderer/relations.ts:8-27`) — the old "edges vanish silently" defect is fixed.
6. **`structural_diagram` and `convergence` now have an explicit zone strategy** (`zones.ts:47`) with a dedicated collision pass (`compile-scene.ts:143`). `simple_explanation` and `chart` remain declared but rejected (`zones.ts:43`).
7. **Identity layer is half-wired**: `identity/{canonicalize,resolver,types}.ts` remain largely test-facing behind `harness/registry.ts`; the old `identity/references.ts` and its dead exports were deleted in S4, and `artifacts.ts` has four live importers.
8. **`healSchema` (`schemas.ts:66`) mutates model output**, but every rule now reports `{path,rule,classification,before,after}` through an optional reporter, and SEMANTIC heals are counted on the job snapshot.

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

- `npm test` builds and runs the whole fixture/mock suite — **no test ever calls a real model**; never hardcode the count. Real verification lives in `scripts/live-v2-evaluation.ts` (48-case manifest), outside the default gate.
- **Proven:** deterministic layer, harness resume/cancel, route accounting.
- **Not proven:** that a real LLM produces schema-valid, semantically faithful output; grounding/anti-fabrication; visual adequacy; latency.
- Tests are plant-heavy (`plant` appears 203×; `abduction`/`einstein` 0×). The demo topic leaks into the "generic" eval layer (`semantic/evaluation.ts:21-24`, `semantic/calibration.ts:9-17`).

## 5. Icon system: P0–P3b landed

`docs/ICON_SYSTEM_PLAN.md` status table is stale. Verified in source: `renderer/palette.ts`, `assets/normalize/*` and `assets/external/*` (Iconify client, licence gate, ranker, suitability) exist, `CompiledSceneV2.assetCatalog` threads resolved geometry, and external retrieval is wired into the `representation-guide` stage (`generate.ts:241`). The P4 cache module (`external/cache.ts`) has no live caller; P7 promotion into the static registry is not started. `assets/validator.ts` now supports colour roles, though one comment still claims external SVG is unsupported.

Current behaviour: 43 static assets plus runtime-computed scoring/retrieval over the registry. Unmatched concepts degrade to a composition family or a labelled primitive. Dynamic representation is **partly** wired; see `docs/ICON_SYSTEM_PLAN.md` §14 for the open decisions.

## 6. Skills: mostly dead markdown

14 `SKILL.md` files exist; **4 load** and only their `# Hard invariants` section (≤10 lines) is injected (`semantic/skills.ts:31-45`). Loaded into `knowledge-compiler` (v3 graph maps), `teaching-architect`, `visual-director`; `whiteboard-planner`, `pedagogy-critic`, `source-visual-grounding` stages receive **no** skill text although docs exist for them.

## 7. Open questions — needs a decision before more code

1. **Docs set.** Canonical: `Architecture_plan.md` (target authority), `PLAN_TO_IMPLEMENT.md` (target overview), `docs/{ARCHITECTURE, HANDOFF, ICON_SYSTEM_PLAN}.md`, root `README.md`, `AGENTS.md`. You had said "only two files" — confirm before deleting anything else.
2. **Icon system: build it or not?** It is the largest single capability gap (dynamic representation for unseen concepts). P4+ in the plan needs decisions on `VISUAL_ICONS` rollout, OpenMoji licence and P7 sign-off. Do you want it prioritised over fixing visual quality?
3. **V1 pipeline:** 4,493 LOC, frozen legacy (code default is `semantic`; `VISUAL_PIPELINE=explainer` opts into V1). Delete, freeze, or keep as reference?
4. **Latency target:** what is "Lamina-level" for a 1-minute video — 30s? 60s? This determines how aggressively to cut `maxScenes` and windows.
5. **Budget:** the OpenRouter account's monthly spend cap blocks paid routes; only free routes work, and they are too slow/unreliable for the knowledge stage. This must be raised before any real end-to-end run.

## 8. Waves S0–S1c — what changed

```
src/semantic/harness/contracts.ts   STAGE_OWNERS: the one stage->owner map
src/semantic/repair.ts              classifyFailure(), RoutedStageFailure; RepairOwner retired to = StageOwner
src/semantic/harness/stage.ts       repairIfOwned(): a foreign failure is routed, never repaired
src/semantic/compiler/zones.ts      SUPPORTED_ARCHETYPES is the executable subset
src/semantic/compiler/archetypes.ts rank cap derived from label width (4 -> 6), layered grid from real height
src/semantic/compiler/compile-scene.ts  child geometry never reused verbatim; overlap error carries real rects
src/semantic/identity/intent-adapter.ts a parented child is normalised off the 'forbid' policy
src/semantic/planning/visual-model.ts   unsupported archetypes rejected before the director call
src/semantic/planning/visual-director.ts archetype-scoped candidates; absent required relation synthesized;
                                        post-compile integrity typed REPRESENTATION; defensive failure dump
src/semantic/planning/generate.ts   concept graph gated before teaching; preflight before the director
```

Routing rules, in precedence order: a gate finding names its own stage → `PipelineError.failureClass` names the class → a provider/budget error is `harness`-owned → otherwise the running stage owns it. Rule 4 preserves genuinely stage-owned repairs (the teaching repair executed inside the knowledge stage still works).

Synthesis rules, both recorded: an *entirely absent* required relation is realized (a present-but-wrong one stays strict); a child's geometry is always re-derived from its parent.

### What still limits output quality

The lesson completes but reads thin: on the same run, four of five concepts render as bare label pills because **no asset exists for `abduction`, `axiom`, `induction`, `deduction`**. That is the 43-asset static-registry ceiling, not a layout or routing defect. Relations now render as VISIBLE_STATIC even without an animating action (`renderer/relations.ts:8-27`), so graph edges no longer vanish.

### Next: P4 wiring / P7 promotion, or visual quality

P3 external retrieval landed (see §P3, §P3a, §P3b above), so the "missing icon source" framing is superseded. What remains from the icon track: wire the P4 cache (`assets/external/cache.ts` has no live caller), then decide whether P7 promotion into the static registry is worth it. `VISUAL_ICONS=off|strict|balanced|broad` — **code default is `balanced`** (`src/semantic/planning/representation-external.ts:34-38`), the plan text says `off`.

**Three decisions are still open** (from `docs/ICON_SYSTEM_PLAN.md` §14):
1. `VISUAL_ICONS` default and rollout mode.
2. OpenMoji (CC BY-SA) — use with attribution, or do not use.
3. Who signs off promoting a frequent winner into the static registry (P7).

S6/S7 (bounded concurrency + job-relative latency budgets) have landed; throughput work now moves to the remaining serialisation sites in §3 and the `gateVisual`/board-alignment hard gates named in the "Next bounded task" above.

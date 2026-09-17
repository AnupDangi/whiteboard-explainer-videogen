# Handoff — state of the project, 2026-09-16

Written after a full read of `src/` (96 files, 9,791 LOC) by five read-only audits. Structure reference: `docs/ARCHITECTURE.md`. Philosophy and non-goals: `AGENTS.md`.

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

Tests unchanged: **535/535** (no source changed for this wave). Code graph: **1,900 nodes / 4,124 edges** (`graphify update . --force`).

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

Four file-disjoint workstreams run in parallel, then built and verified centrally. **525/525** (was 511).

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

The lesson completes but reads thin: on the same run, four of five concepts render as bare label pills because **no asset exists for `abduction`, `axiom`, `induction`, `deduction`**. That is the 43-asset static-registry ceiling, not a layout or routing defect. Relations also render only when an action animates them (`renderer/relations.ts:8`), so the graph is richer than the picture.

### Next: P3 external retrieval, or S6/S7 throughput

The icon track has reached the point where the only thing missing is a **source** of candidate icons: P0–P2 give the palette, the safe converter and the embedded catalog, but nothing yet produces a catalog entry. **P3** adds Iconify search + fetch behind `VISUAL_ICONS=off|strict|balanced|broad` (default off), with a hard licence gate and the sanitizer as the only ingest path. It introduces network, licences and caching — the first phase that can fail in ways the deterministic layers cannot.

**Before P3, three decisions are needed** (the plan's blockers, minus the one that disappeared with `docs/v4/`):
1. `VISUAL_ICONS` default and rollout mode — the plan recommends `off`, then `balanced`.
2. OpenMoji (CC BY-SA) — use with attribution, or do not use.
3. Who signs off promoting a frequent winner into the static registry (P7).

If representation breadth is less urgent than speed, **S6/S7** (bounded concurrency + job-relative latency budgets) are the alternative: a 1-minute lesson still costs 30–140s of wall time with no latency budget, and the harness still allows a 600s knowledge timeout for a 60s video.

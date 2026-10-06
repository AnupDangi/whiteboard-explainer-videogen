# Teaching Compiler V2 architecture

This checkout is the independent hypothesis implementation described in
`claude_pipeline.md`. It is not Lamina Labs source code. The current source of
truth for implementation status, measured runs, and deviations is
[`HANDOFF.md`](HANDOFF.md); this document describes the code as it exists.

## Runtime path

`pnpm run run:lesson -- ...` builds and starts the source-generated lesson
runner. V2 is selected explicitly with `TEACHING_COMPILER_VERSION=v2` and its
feature flags. `scripts/v2-benchmark.mjs` supplies those flags for frozen cold
runs. V1 remains a supported path; changing the default or deleting V1 is not
part of this architecture pass.

```text
source files / URL
       │
       ▼
S1 intake + source bundle ── optional RAG sidecar
       │
S1b syllabus and duration budget
       │
S2 concept graph → S3 teaching contracts
       │
S3b Visual Discovery → per-scene depiction vocabulary
       │
S4 beat plan + locked narration
       │
       ▼
S5 speech + word alignment + duration fit
       │
       ▼
scene representation dispatch
       ├── all visual beats use supported state_transition → typed SemanticOps → deterministic BoardOps
       └── unsupported or mixed families → S6 legacy BoardOps preview (draft only)
       │
       ▼
          BoardOps + persistent board state
                      │
          deterministic compile and layout
                      │
          audio-master timeline and gates
                      │
            verified lesson.lock.v2.json
                      │
           deterministic raster + encode
```

The source-to-plan stages live under `src/plan/` and `src/pipeline/`.
`src/narration/` compiles beat text, claim spans, and semantic phrase anchors. `src/audio/` owns speech,
alignment, and audio timing. `src/planner/board.ts` builds the board-planning
contract and validates model output. `src/pipeline-v2/` runs V2, compiles
BoardOps against the retained board, writes the V2 lock, and verifies replay
inputs. `src/pipeline-v2/semanticExecution.ts` dispatches the implemented typed
provider and labels unsupported families before they reach the legacy S6
preview. Board state and operations are defined in `src/visual-v2/board-*`;
geometry and deterministic rendering are in `src/visual-v2/layout/`,
`src/visual-v2/kits/`, and `src/visual-v2/renderer/`. Export code is under
`src/export/`.

By default, the V2 `plannerModel` is shared by beat narration and S6 BoardOps.
The CLI now supports `--s6-planner` to override only BoardOps; the benchmark
harness maps `V2_BENCH_PLANNER` to that option and records both model IDs.
This isolated route has passed typecheck and offline suite verification but
does not yet have a live scaled trial under the per-lesson budget cap.

Beat narration makes sequential provider calls, one for each planned beat. Each
call receives only that beat's contract, the earlier beats' accepted speech,
and the next beat's teaching goal. Schema checks, claim semantics, number and
screen-reference checks, phrase-anchor validation, and pointer-scoped repairs
run against that beat object. A repair cannot change a later beat or another
field that has not failed; if a sentence repair invalidates its phrase anchor,
the anchor is repaired in a later bounded call. Reports, usage, repair traces,
and raw responses are aggregated for the scene. The complete scene is checked
again before compilation. The compiler allocates the scene's word-time budget
by the larger of each beat's claim count and required semantic-change count,
with a minimum weight of one. This is a deterministic structural heuristic;
it is not a measured speaking time or a human-validated estimate.
For a measured runtime revision, local ceilings instead follow each beat's
allocated revision-word target at the measured speaking rate, keeping the
local validation budgets consistent with the requested split.

Each required semantic change has a stable event ID (`<beatId>.eN`) and one
exact, unique phrase copied from a nominated sentence. Compilation stores
absolute character offsets. The runner rejects missing or inconsistent
compiled anchors before audio generation, and v9 lock verification recomputes
those identities and offsets against the pinned beat plan. This checks span
integrity; it does not prove that the phrase entails the planned state change.
After final TTS and word alignment, `v2-alignment/v2` stores the language and
the first/last aligned word times for each phrase. Lock verification recomputes
those times from the pinned narration character spans and aligned words, so a
rehash cannot silently move an event anchor. Beat timing artifacts carry the
resolved phrase intervals for downstream scheduling. The current timeline
scheduler still schedules BoardOps from sentence cues; it does not yet schedule
meaning changes directly from event phrases. Independent semantic-realization
review remains separate work.

## Representation selection

Each teaching beat carries a question, a cognitive operation, and a required
representation family. The topic-independent registry in
`src/teaching/beat-plan/representationRegistry.ts` records the 19 planned
families and the generic learner operations each family can support. S3b is
prompted to choose from the beat question and operation, and the planner
rejects unknown families or incompatible operation/family pairs before S4.
The V2 lock rechecks that compatibility from pinned beat data, so rehashing a
bad selection does not make it valid. There is no fallback family when the
choice is missing or incompatible.

This is the first selection gate, not the completed provider architecture.
It checks structural compatibility, not the semantic fit of the question or
whether a family actually depicts the mechanism. The generic provider boundary
in `src/teaching/representation/providerRegistry.ts` defines schema-checked
family models, suitability, visible mechanism requirements, semantic
compilation, and an explicit family fallback. Its availability inventory lists
all 19 planned families; a missing provider returns `provider_unavailable`
instead of generating a generic BoardOps substitute.

The registry currently activates only `state_transition` v2, for `introduce`,
`transform`, and `separate` changes; merge and other change kinds and the other
18 families stay unavailable. V2 routes a scene through that provider only
when every visual beat in the scene selects `state_transition` and all required
changes are supported. It derives the family model from pinned beat changes,
compiles and replays `SemanticOp`s, then lowers them to BoardOps. A separation
names one source and uses the beat's ordered first-reveal entities as its two
to six results; a newly revealed source must first be introduced in that beat.
The lowerer checks the source's exact visible state, removes that state value,
splits the source into canonically bound result entities, and retains selected
catalog icon IDs for rendering. A provider or lowering failure is hard and
does not fall through to generic BoardOps. Mixed or unsupported families are
explicitly recorded as `legacy-boardops-preview`, run through S6 for
diagnostics, and carry a draft failure. They are not reported as typed-provider
output. Broad family coverage and live visual verification remain open.

## Semantic representation IR

`src/teaching/semantic-ir/types.ts` defines stable claim-bound entities,
scene state, relations, plot values, feedback loops, annotations, and a strict
meaning-level operation union. The operation contract covers introduction,
focus, comparison, flow, transformation, movement, separation/merge, quantity
and relation-weight updates, selection/finalization, plotting/thresholds,
causality, feedback, and annotation. Plot fields are semantic data values;
the schemas have no screen coordinates, renderer objects, or BoardOps ids.

`applySemanticProgram` replays a proposed operation sequence against a fresh
scene state. It checks identity and claim references, earlier-event
dependencies, lifecycle, exact before-state/value/unit, semantic movement,
and operation-specific preconditions. It returns a pointer-scoped failure
without mutating the input state when a transition is invalid. The supported
state-transition route uses this replay before lowering, and V2 locks pin the
provider record with the beat plan and captured operations.

The state-transition provider in `src/teaching/representation/stateTransition.ts`
maps beat-bound introduction, transformation, and separation changes to
semantic operations. It checks exact entity and state identity, derives
separation outputs from the pinned beat reveal order, and replays its output
before returning it. Merge and other transition kinds remain unsupported.

`src/teaching/semantic-ir/toBoardOps.ts` currently lowers introduction,
transformation, separation, focus/selection, and finalization to deterministic BoardOps.
For introductions it requires canonical concept labels and emits an entity
element bound to the beat's claims. If S3b selected a library icon, the lowerer
preserves its exact entry id and validates the entity type; the existing V2
renderer and rights path resolve and lock that same asset. Separation checks
the source's exact visible state, removes its old state value, emits a
deterministic split into canonically bound result entities, and preserves their
concept bindings for icon resolution. Unknown mechanisms, missing visible
state, mismatched values, or overlong state text fail closed.
After layout, V2 audits selected icon IDs against drawable renderer output. An
icon selected for a concept used by a visual beat must resolve to that exact
pictorial asset; missing or label-only output blocks encoding, and lock replay
recomputes the same requirement from the pinned beat plan and captured states.
The scene record and pinned lesson context store provider version, semantic
operations, phrase-derived sentence cues, exact selected asset ids, and a hash
of the emitted BoardOps. Lock verification re-derives the state-transition
operations and lowering and compares them with the captured timeline.

## Ownership and trust boundaries

Models decide teaching order, claims, narration, and representation intent.
The state-transition provider turns its pinned beat changes into typed
semantic operations; only the explicitly marked legacy preview asks S6 for
BoardOps directly. Models do not provide final coordinates, paths, timing
milliseconds, worker commands, or export instructions. Every model
response is parsed against a bounded schema and checked against source
evidence, the board state, and the spoken beat. Bounded repairs may adjust
invalid responses; repair or deterministic fallback remains recorded and
cannot be silently counted as a pass.

Source-grounded BoardOps text also passes a conservative semantic-signal check
in `src/visual-v2/provenance/ground.ts`: recognized polarity, comparison,
change-direction, temporal/spatial, quantifier, extreme, and condition cues may
not contradict or be dropped from the matching quoted proposition. This is a
finite English lexicon layered on lexical grounding; it does not establish
general entailment or verify every paraphrase. Canonical `essentialClaims` now
carry derived `ClaimSemantics` for explicit polarity, comparison operators and
values, every detected temporal relation, quantities with recognized units,
change direction, spatial relation, quantity scope, extremes, and
condition/exception cues. Beat narration checks the sentence anchored to each
claim for cue reversals, unit changes,
unsupported qualifiers, and quantities added beyond the claim. The parser
handles decimal,
exponent, grouped-digit, Unicode-negative, and spelled numbers; preserves SI
prefix case; recognizes powered and compound units plus spelled temperatures;
checks each comparison in a chain independent of conjunction order, binds
values to their comparator, parses whitespace-multiplied compound units such
as `kg m/s²`, accepts comparator aliases without mistaking them for negation,
and rejects newly added protected cues. “No/none” and count-zero wording are
equivalent only when the normalized claim matches after substituting that
count phrase; extra zero-valued facts and measured-zero units remain distinct.
This exact-remainder exception may reject other faithful paraphrases.

V2 now derives claim identity from canonical graph-linked concept IDs, their
labels, and directed relations in `src/evidence/claimIdentity.ts`; it never
trusts identity metadata supplied by the model. Beat validation ties entities
and relations to claims cited by that beat. Anchored narration checks explicitly
named concepts and recognized directed predicates. Visual bindings must stay
within the linked claim concepts, and factual edge endpoints/direction/predicate
are checked when their endpoint identities resolve; edges without a canonical
directed claim relation fail. Entity labels that exactly name a different graph
concept are also rejected. At lock verification, the
pinned context is joined to scene beats, narration anchors, BoardOps and
claim/concept bindings. The verifier reapplies BoardOps across scene transitions
and compares the resulting states with the capture, so recomputing file and lock
hashes does not make an inconsistent capture valid.

The relation forms are a finite lexical inventory; broad semantic entailment,
unrecognized paraphrases, and ambiguous aggregate visual endpoints remain open.
This remains a finite safeguard rather than general meaning verification.
Comprehensive visual realization checks and broad entailment validation remain
open. Player telemetry records
first browser playback after verified-frame
readiness and a user gesture. The CLI persists a trustworthy request-acceptance
epoch in `run-start.json`; review bundles include and validate later browser
telemetry against it. A live request-to-first-audio sample is still unmeasured,
and browser telemetry does not prove physical speaker output. Resolved source evidence now
carries SHA-256 digests for the exact quote and, when present, its document;
live-run S6 verifies these digests along with source offsets. Legacy citations
without digests remain readable but are checked against the in-memory source.
Generated canonical claims now require an explicit `epistemicType`:
`direct_source`, `derived_relation`, `pedagogical_bridge`,
`illustrative_example`, `analogy`, or `unverified_explanation`. The S3 contract rejects a missing type,
direct/derived relation mismatches, and examples or analogies without visible
framing. The anchored narration sentence is checked for the same framing. These
checks are structural and lexical; they do not prove that a statement is true or
entailed by its source. Claim `sourceRefs` are rebuilt only from explicitly
cited spans backed by the linked graph concepts or relations; model-provided
refs are discarded.

`unverified_explanation` is a bounded exception for an otherwise source-backed
lesson: it has no source refs, must say it is “not verified by the supplied
source,” and may not introduce a graph relation. It must appear once, alone,
in a narration-only beat. S3 omits its semantic visual intent; a scene made up
only of open claims also omits `visualForm`. That beat cannot have BoardOps,
and no visual or factual edge may bind to the claim. The V2 runner checks these rules before
audio and BoardOps; lock verification repeats them against the pinned plan,
narration, semantic scene and captures, so recomputing hashes alone cannot pass
an inconsistent open claim. The source document and concept graph remain
required; source-free lesson generation is not supported.

Before audio generation, V2 projects canonical claims into
`src/evidence/ledger.ts`, validating the plan reference and dropping its
`spanId` only from the compact ledger representation. It validates the ledger
digest and policy, then joins each hash-pinned reference back to exact resolved
graph evidence and the source document. For bundled inputs, each source span
retains its original document digest and offsets rather than inheriting the
concatenated bundle hash. New runs write `lesson-context/v9`; v8 locks retain
their historical compatibility contract. Lock verification
requires each claim's explicit type and derived verification status, checks
its source refs against the claim's cited spans, verifies the beat learner
question, before/after state, stable order, and compiled dependency IDs, and
joins S3b-selected asset ids back to the concept metadata captured in each
scene. It also validates compiled entities and semantic changes against strict
schemas, recomputes scene-scoped ids from stable identity keys, and checks
within-scene concept continuity, first-reveal order, declared persistence ids,
and each beat's exact evidence-span union from its cited canonical claims.
For hierarchical lessons, v8/v9 also lock Lesson → Chapter → Scene → Beat
membership, chapter budgets, measured scene speech/window timings, and
end-of-chapter cumulative concept/claim/terminology checkpoints. Lock
verification recomputes the chapter partition and those projections from the
canonical plan, beat plans, graph, alignment, and scene locks; the lesson lock
also pins `v2/lesson-hierarchy-input.json` separately and checks hierarchy mode
and chapter metadata against that projection of the syllabus and prepared
modules. Flat synthetic or compatibility runs carry one explicit
compatibility chapter. These checkpoints record structural coverage, not
learner mastery. Semantic changes are not yet
checked against rendered BoardOps, and scene-local identity does not establish
cross-scene continuity; those remain later semantic compiler work.
The separate input artifact provides cross-file consistency, not a signature
authenticating original model output if every artifact and hash is rewritten.
`lesson-context/v2` through `/v7` remain readable through compatibility paths.
The CLI carries grounding mode through request and run
identity. `STRICT_SOURCE` and `SOURCE_PLUS_BACKGROUND` are accepted:
direct-source and derived-relation claims require primary-only citations;
pedagogical bridges may cite primary or explicitly role-marked background
sources. A factual claim cannot mix in a background citation, even if a primary
reference is also present. `OPEN_EXPLANATION` allows only the bounded,
explicitly unverified explanation described above; direct and derived factual
claims still require primary citations, and bridges still require source
provenance. Frozen benchmark runs remain pinned to `STRICT_SOURCE`.
During S3 validation, claim refs are reconstructed from the claim's cited spans
and linked graph evidence; model-supplied refs are not used to satisfy policy.
Confidence is optional informational metadata, is not calibrated, and does not
certify claim truth. Legacy refs without both document and quote hashes cannot
enter the new ledger.

Software owns evidence resolution, icon retrieval, board reduction, layout,
edge routing, exact audio-derived timing, SVG generation, rasterization, and
encoding. It does not branch on lesson titles or insert lesson facts. A
deterministic fallback can retain a diagnostic draft, but hard provenance,
alignment, geometry, readability, rights, or sync findings keep the run from
passing.

The V2 board persists across scenes. A new operation is applied through the
shared reducer; the next scene starts from the retained state. Identity and
geometry are carried forward where valid. The runner currently plans this
chain sequentially because each board depends on the previous one. It does not
create independent boards concurrently.

V2 results carry an additive `artifact-status/v1` decision alongside
the legacy lowercase run status. A video stays `DRAFT` when fallback was used,
required scorecard evidence is missing, or the full G1–G12 semantic QA suite is
unmeasured. `FAILED` means the run did not produce a valid video artifact.
`PASSED_REVIEW` requires the exact UTF-8 review report bytes, a matching SHA-256,
and a report bound to the same artifact hash. This verifies content integrity
and artifact binding, but not reviewer identity or authenticity. The CLI does
not yet ingest a review report, so current V2 runs cannot reach this state.
The benchmark's persisted-certificate verifier requires the canonical automatic
gate IDs to be present exactly once and passed before it counts either pass
state; review reports, when integrated, must be pinned as
`human-review-report.json` in the run manifest.

`scripts/v2-review-bundle.mjs` exports an independent run directory into a
portable bundle with the lock, run manifest, evaluation, hash-indexed
artifacts, derived timing summary, and repair evidence. Its verifier checks
the internal run hashes, V2 lock, media streams, identities, and the outer
file inventory. The outer SHA-256 is a tamper-evident digest only; it is not
signed or bound to a trusted reviewer. First-audible player latency remains
unmeasured, and derived repair evidence is explicitly incomplete until every
salvage path is captured in the run artifacts.

## Speech provider routing

The lesson CLI reads `TTS_PROVIDER` and `TTS_FALLBACK_LOCAL` from the same
environment file as provider configuration (`HYPOTHESIS_ENV_FILE`, or `.env`
by default). Explicit process environment values take precedence, and `--tts`
takes precedence over the file setting. The default provider remains local
synthesis.

ElevenLabs keys are read from `ELEVENLABS_API_KEY_1` through `_9` (with the
legacy unsuffixed key also accepted), deduplicated, and selected by the shared
credit reservation pool. Refused, invalid, quota-exhausted keys are retired for
the current process; a repeated HTTP 429 advances to another key after one
retry per key. A lost response, unusable success response, or HTTP 5xx is
recorded as uncertain; its estimated credit hold remains reserved and that key
is skipped for the rest of the process while the next configured key is tried.
An uncertain attempt is never counted as a success. If the ElevenLabs key pool
is exhausted, local synthesis carries the scene by default and records a soft
fallback finding; setting `TTS_FALLBACK_LOCAL=0` keeps that failure hard.
Uncertain attempts and estimated credits at risk are included in run metrics.
Fallback does not convert a duration, alignment, or other quality-gate failure
into a pass.

## Clock, layout, and rendering

Measured narration audio is the clock. Word alignment maps beats and claims to
time; visual operations are scheduled around those intervals and checked for
late or missing reveals. Estimated duration is not a substitute for measured
audio. If speech does not fit the requested runtime, the runner may perform a
bounded narration revision and resynthesis; otherwise it records a hard
duration failure.

Layout uses deterministic geometry and text measurement. Arrows and their
labels, readable text, safe-area placement, collision checks, and kit ink are
part of the geometry gate. V2 SVG rendering is a pure function of the locked
state and time. The lock pins input artifacts, renderer/tool versions, SVG
bytes, and representative raster samples. Replay verifies hashes before
export; rendering does not call models, retrieval services, or remote APIs.

Raster workers are bounded by `HYPOTHESIS_RASTER_CONCURRENCY`; the reusable
pool is in `src/export/rasterPool.ts`. The manual P13 benchmark script,
`scripts/render-bench.mjs`, measures raster frames per second and process peak
RSS for worker counts against a verified source-generated V2 lock. It does not
measure lesson planning, TTS, or encode time. Its results must be recorded
separately from end-to-end lesson timing.

## Assets and rights

The legacy V1 route separates S6 representation intents from S7 resolution.
The beat-mode V2 route runs S3b Visual Discovery before narration and carries
its per-scene vocabulary into either the typed lowerer or the S6 preview. The
S6 prompt receives concept kind and depiction guidance without catalog IDs.
When S3b selected an icon for a
canonical `entity`, BoardOps validation requires a live bound `entity` element
by the end of each beat that names it; tokens, labels and kit bindings cannot
stand in for that picture. Non-entity kinds keep their selected structure or
label lane.

Icon library inputs are vendored for offline rendering; retrieval and SVG
normalization are deterministic. For a concept without an exact catalog match,
retrieval offers library vocabulary; the depiction director proposes drawable
nouns, code resolves each noun to an exact catalog entry, and a separate judge
must approve the referent-picture pair. Asset IDs stay out of S6 prompts. V2
uses the exact scene-vocabulary entry for eligible entity rendering, subject to
the existing semantic-type, exact/curated selection, domain and licensing
gates. The locked concept metadata captures the selected asset and scene style,
and replay uses the pinned selection. New runs write
`lesson-context/v9`; historical contexts remain readable. The diagnostic
`v2/scene-icon-families.json` records each scene's family.

An icon being present in a local catalog is not evidence that it is cleared for
release. Rights review is an independent human gate. Missing, mismatched or
unapproved pictures remain labelled fallbacks. This path proves asset selection
and replay consistency; it does not prove that an icon is semantically correct
or visually clear. Wrong-icon review, muted comprehension and human rights
review remain open. The production catalog has 19,058 entries across 11 enabled
libraries; the larger ~24k local-dev catalog includes review-only libraries and
is not release evidence.
`representationFamily` describes the teaching picture (such as a process or
comparison); `houseFamily` is the illustration style shared by the scene's
icons. The production catalog has 19,058 entries across 11 enabled libraries;
the larger ~24k local-dev catalog includes review-only libraries and is not
release evidence.

## Locks and publication

The verified V2 lock is the execution record. It binds source and plan
artifacts, operations, persistent board state, narration, word timing, audio,
geometry, render inputs, SVG hashes, and raster pins. A modified or incomplete
lock is not renderable. Post-encode files are recorded in the run manifest and
render-artifact report; the lock itself is not amended after rendering.

The current runner publishes after the full lesson lock is ready. It records
request acceptance in `run-start.json`; a browser player event is tied to the
run, first locked frame, and audio, and is emitted only after unmuted playback
advances. The portable review bundle validates that event and derives
request-to-first-audible timing. Stage A now gates on this validated metric;
scene readiness remains a separate diagnostic and cannot satisfy the audio
gate. No live event has yet supplied a measurement, and browser playback does
not prove acoustic output at the device. Progressive scene publication and
overlap with encoding are not implemented. Literal parallel board planning
conflicts with persistent board state and remains a documented deviation. See
[`HANDOFF.md`](HANDOFF.md).

## Evaluation and current evidence

The offline suite checks contracts, deterministic replay, data provenance,
geometry, fallback visibility, and export plumbing. Passing offline tests
establishes code behavior only; it does not establish generated lesson
quality. Frozen source sets and every cold attempt stay separate from
mechanism fixtures and diagnostic runs. Reports preserve infrastructure
failures and incomplete artifacts.

New benchmark runs seal runner evidence as v2. Each trial captures a
Git-HEAD-relative test and baseline change inventory before and after execution;
the report includes the base commit, changed paths and content hashes, inventory
stability, and the sidecar hash. Stage A marks legacy v1 trials unmeasured and
fails if inventory changes during a trial or differs across the grid. This is
disclosure against the recorded HEAD, not a signature or an independent
approved test-baseline commit; test changes still require human review. No
qualifying grid using this evidence has been run yet.

The plan's live acceptance gates include the 5-topic × 3 cold grid, an
untouched held-out set, muted-board human review, rights review, two-reviewer
alignment calibration, and cost per finished minute. Missing artifacts or
review votes are `unmeasured`, not inferred passes. Current per-run outcomes
and exact remaining work are listed in [`HANDOFF.md`](HANDOFF.md).

## Local commands

```sh
pnpm run typecheck:hypothesis
pnpm run test:hypothesis
pnpm run baseline:verify
node scripts/v2-benchmark.mjs verify cold-v2
node scripts/v2-benchmark.mjs report cold-v2 --batch=<recorded-batch>
node scripts/render-bench.mjs <source-generated-v2-run-dir> --sizes=1,2,3,4 --frames=40
```

The render benchmark is a manual measurement tool and intentionally has no
package script. Never use a fixture lock as evidence of live worker throughput.
The available 120-frame × 3 report selects eight workers from a single 10-core
host; cross-host throughput and thermal behavior remain unmeasured. The latest
bounded V2 domain outcomes and current gates are in [`HANDOFF.md`](HANDOFF.md).

## S6 failure containment (2026-10-04)

A BoardOps draft passes through four layers, each recorded and none able to turn a failure into a pass:

1. **Validators (unchanged, fail closed):** schema, source evidence, bindings, dependencies, concept coverage, layout and move paths.
2. **Deterministic salvage** (`visual-v2/ops-plan/salvage.ts`, `structuredCall` `salvage` hook): re-cites an unchanged assertion where accepted evidence exists, drops unsupported factual operations and their dependents, and uses a generic fallback only if the complete draft validates. It cannot relabel an unsupported source assertion as illustrative or shorten its wording. Changes are coercion-ledger entries, the call reports `firstTryValid=false`, and the run records a soft `board-ops-salvaged` failure.
3. **Pointer-scoped model repair** (two attempts), as before.
4. **Fallback board** (`ops-plan/fallback.ts`): a concept-only board from the scene's own data when 1-3 fail. Soft failures `board-ops-repair-failed-fallback` + `v2-board-fallback`, metric `v2.fallbackScenes`; the lesson stays `DRAFT`. `V2_BOARD_FALLBACK=0` makes a failing scene fail the run (strict benchmark mode). Later Phase 0 work removed semantic label/token shortening; current code preserves the approved text and lets repair or failure handle an unfit label. Earlier Oct. 4 samples used a different pipeline digest and are historical diagnostics, not results for this current behavior.

Layout facts the validators rely on: band heights follow what each band must draw; children keep their slot while siblings leave; kits grow until their children's text fits; a move whose straight path would cross another element follows a deterministic quadratic detour computed by `moveRoutesFor` (shared by validation and the renderer, derived from locked rectangles).

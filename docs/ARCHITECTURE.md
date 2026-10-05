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
S4 beat plan + locked narration
       │
       ▼
S5 speech + word alignment + duration fit
       │
       ▼
S6 semantic board planning (sequential, retained board)
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
`src/narration/` compiles beat text and markers. `src/audio/` owns speech,
alignment, and audio timing. `src/planner/board.ts` builds the board-planning
contract and validates model output. `src/pipeline-v2/` runs V2, compiles
BoardOps against the retained board, writes the V2 lock, and verifies replay
inputs. Board state and operations are defined in `src/visual-v2/board-*`;
geometry and deterministic rendering are in `src/visual-v2/layout/`,
`src/visual-v2/kits/`, and `src/visual-v2/renderer/`. Export code is under
`src/export/`.

By default, the V2 `plannerModel` is shared by beat narration and S6 BoardOps.
The CLI now supports `--s6-planner` to override only BoardOps; the benchmark
harness maps `V2_BENCH_PLANNER` to that option and records both model IDs.
This isolated route has passed typecheck and offline suite verification but
does not yet have a live scaled trial under the per-lesson budget cap.

## Ownership and trust boundaries

Models decide teaching order, claims, narration, representation intent, and
semantic board operations. They do not provide final coordinates, paths,
timing milliseconds, worker commands, or export instructions. Every model
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
`illustrative_example`, or `analogy`. The S3 contract rejects a missing type,
direct/derived relation mismatches, and examples or analogies without visible
framing. The anchored narration sentence is checked for the same framing. These
checks are structural and lexical; they do not prove that a statement is true or
entailed by its source. Claim `sourceRefs` are rebuilt only from explicitly
cited spans backed by the linked graph concepts or relations; model-provided
refs are discarded.

Before audio generation, V2 projects canonical claims into
`src/evidence/ledger.ts`, validating the plan reference and dropping its
`spanId` only from the compact ledger representation. It validates the ledger
digest and policy, then joins each hash-pinned reference back to exact resolved
graph evidence and the source document. For bundled inputs, each source span
retains its original document digest and offsets rather than inheriting the
concatenated bundle hash. New runs write `lesson-context/v3`; lock verification
requires each claim's explicit type and checks its source refs against the
claim's cited spans. `lesson-context/v2` remains readable through the
compatibility path. The CLI carries grounding mode through request and run
identity. `STRICT_SOURCE` and `SOURCE_PLUS_BACKGROUND` are accepted:
direct-source and derived-relation claims require primary-only citations;
pedagogical bridges may cite primary or explicitly role-marked background
sources. A factual claim cannot mix in a background citation, even if a primary
reference is also present. `OPEN_EXPLANATION` remains unsupported until
uncited claims have an explicit unverified status in the ledger and lock.
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

S6 emits representation intents, not catalog IDs. S7 resolves those intents
against the enabled asset registry, validates semantic fit and style family,
and retains a labelled fallback when no safe picture is available. Icon
library inputs are vendored for offline rendering; retrieval and SVG
normalization are deterministic. Usage context filters libraries whose
rights are still under review. An icon being present in a local catalog is not
evidence that it is cleared for release. Rights review is an independent
human gate. V2 probes the scene's concrete entities against the vendored
catalog, considers only exact or curated approved pictures, and chooses the
most common non-exempt `houseFamily` with a stable tie-break. It then resolves
each type-eligible pictorial entity using that family and the lesson domain. A
picture selected only by similarity is still refused; missing or mismatched
pictures remain labelled fallbacks. `houseFamily` is written to the captured
scene concepts, so the lock hashes it and replay uses the same style family. A diagnostic
`v2/scene-icon-families.json` records the per-scene choice. This is asset
selection and replay evidence, not a golden visual-quality verdict:
wrong-icon review, muted comprehension and human rights review remain open.
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

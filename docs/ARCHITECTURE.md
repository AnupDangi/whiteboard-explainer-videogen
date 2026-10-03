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
       ├─────────────────────────────┐
       ▼                             ▼
S5 speech + word alignment      S6 semantic board planning
       └──────────────┬──────────────┘
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

## Ownership and trust boundaries

Models decide teaching order, claims, narration, representation intent, and
semantic board operations. They do not provide final coordinates, paths,
timing milliseconds, worker commands, or export instructions. Every model
response is parsed against a bounded schema and checked against source
evidence, the board state, and the spoken beat. Bounded repairs may adjust
invalid responses; repair or deterministic fallback remains recorded and
cannot be silently counted as a pass.

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
human gate.

## Locks and publication

The verified V2 lock is the execution record. It binds source and plan
artifacts, operations, persistent board state, narration, word timing, audio,
geometry, render inputs, SVG hashes, and raster pins. A modified or incomplete
lock is not renderable. Post-encode files are recorded in the run manifest and
render-artifact report; the lock itself is not amended after rendering.

The current runner publishes after the full lesson lock is ready. Playback of
a published lock and audio synchronization are implemented, but this does not
measure time to first audible playable scene or overlap board preparation with
encoding. Literal parallel board planning conflicts with persistent board
state and remains a documented deviation. See the P14 entry in
[`HANDOFF.md`](HANDOFF.md).

## Evaluation and current evidence

The offline suite checks contracts, deterministic replay, data provenance,
geometry, fallback visibility, and export plumbing. Passing offline tests
establishes code behavior only; it does not establish generated lesson
quality. Frozen source sets and every cold attempt stay separate from
mechanism fixtures and diagnostic runs. Reports preserve infrastructure
failures and incomplete artifacts.

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

# Simi-Clone100% / ExplainCanvasLab — Teaching Compiler V2 Implementation Plan

## 1. Objective

Build an independent, source-grounded visual teaching compiler that reaches Simi/Lamina-class quality in:

- teaching clarity,
- progressive visual explanation,
- narration synchronization,
- deterministic rendering,
- low latency,
- low cost,
- reproducibility,
- cross-domain generalization.

This is **not a rewrite** of the existing S1–S12 architecture.

The main architectural replacement is the middle visual-teaching layer:

```text
CURRENT

TeachingSceneContract
        ↓
Narration
        ↓
Static Board IR
        ↓
Mention-marker timing
        ↓
Add-only visual timeline


TARGET

TeachingSceneContract
        ↓
TeachingBeatPlan
        ↓
Locked NarrationBeat[]
       /                 \
      /                   \
TTS + Alignment       Visual Compiler
      │                   │
      │                BoardOps
      │                   │
      └─────────┬─────────┘
                ↓
        Semantic Timeline
                ↓
      Persistent Board State
                ↓
   Kits + Assets + Layout
                ↓
           RenderPlan
                ↓
        lesson.lock.json
                ↓
       SVG / resvg / FFmpeg
```

The renderer stays deterministic. The main problem is the semantic representation before rendering.

---

# 2. Current diagnosis

The current system already has strong infrastructure:

- S1 source intake,
- source hashing/provenance,
- S1b syllabus and duration budget,
- S2 concept graph,
- S3 teaching contracts,
- S4 narration,
- S5 TTS + alignment,
- AssetBridge,
- deterministic layout,
- seeded Rough.js,
- lesson lock,
- SVG rendering,
- resvg,
- FFmpeg,
- cost accounting,
- caching,
- deterministic replay,
- evaluation gates.

The main weaknesses are:

1. S3 semantic fields are mostly advisory instead of compiled into executable visual semantics.
2. Current Board IR is too weak.
3. Timeline is mostly reveal/add-only.
4. Persistent board state is effectively absent.
5. Narration is locked before visuals, then S6 searches narration for mention markers.
6. Resolver is too text-similarity-driven.
7. R10 labelled boxes are counted as "drawn", inflating quality metrics.
8. Runtime VLM asset checking is expensive and symptom-oriented.
9. Worked illustrative examples are blocked by source-only lexical provenance rules.
10. Evaluation has been repeatedly tuned on a small development set.
11. Rendering rasterizes too many unchanged frames.
12. Several long-form stages remain unnecessarily sequential.

The project should therefore become **Teaching Compiler V2**, while preserving the successful infrastructure around it.

---

# 3. Hard architectural invariants

## 3.1 Models own judgment

Models may decide:

- teaching order,
- claims,
- learner delta,
- misconception risk,
- mental model,
- cognitive operation,
- representation family,
- semantic relationships,
- narration,
- semantic reveal order,
- illustrative-example intent.

Models must not decide:

- final x/y coordinates,
- pixel dimensions,
- SVG paths,
- final font metrics,
- exact edge routes,
- animation milliseconds,
- renderer commands,
- FFmpeg commands.

---

## 3.2 Deterministic software owns execution

Software owns:

- asset resolution,
- kit instantiation,
- geometry,
- layout,
- collision avoidance,
- edge routing,
- typography,
- interpolation,
- exact timing,
- SVG generation,
- rasterization,
- encoding.

No production model-generated:

- arbitrary JavaScript,
- arbitrary TypeScript,
- arbitrary HTML,
- Manim code,
- unrestricted SVG,
- canvas code,
- final pixel coordinates.

---

## 3.3 Audio remains the master clock

Exact visual timing is derived from:

- locked narration,
- TTS,
- word/phrase alignment,
- beat boundaries,
- BoardOp dependencies.

The model may specify semantic order, but not exact milliseconds.

---

## 3.4 `lesson.lock.json` remains the execution truth

After the lock exists:

- no LLM calls,
- no web calls,
- no VLM calls,
- no provider lookups,
- no asset search,
- no semantic reinterpretation,
- no random layout,
- no unseeded Rough.js,
- no environment-dependent font fallback.

---

# 4. Benchmark strategy

Before changing the architecture further, establish three separate benchmark groups.

---

## 4.1 Mechanism development fixtures

These may be used repeatedly during development.

| Fixture | Capability being tested |
|---|---|
| Recursion stack | push/pop, state persistence |
| Osmosis | compartments, movement, equilibrium |
| Pythagorean construction | geometry + equations |
| Attention toy example | weighted links |
| Feedback/control loop | cyclic state updates |

These are **not held-out benchmarks**.

---

## 4.2 Frozen 5 × 3 cold benchmark

Use five new topics, three independent generations each.

Recommended set:

| Domain | Topic | Main capability |
|---|---|---|
| Mathematics | Completing the square | equation transformation |
| Biology | Action potential | state transition |
| Computer Science | LRU cache | state/data movement |
| Systems | TCP congestion window | feedback + timeline |
| Physics | RC circuit charging | quantity/plot/causality |

Freeze:

```text
benchmark-v2/
  cold-v1.json
  source-sha256.json
  prompts-sha256.json
  scoring-rubric-v1.json
```

Never place these topic names or expected solutions into production prompts.

---

## 4.3 Final untouched held-out benchmark

Create another 5-topic suite and do not inspect it until release-candidate evaluation.

Include at least:

- mathematics,
- life science,
- physical science,
- computer/software/system topic,
- non-STEM explanatory topic.

If a code change is made after seeing held-out failures, version a new held-out set.

---

# 5. Global scorecard

Every run should emit:

```text
evaluation-bundle.json
scorecard.json
```

Recommended composite weighting:

| Category | Weight |
|---|---:|
| Grounding / factual integrity | 15 |
| Teaching / learner delta | 15 |
| Representation correctness | 20 |
| Mechanism visibility | 15 |
| Narration ↔ visual synchronization | 15 |
| Layout/readability | 10 |
| Reliability/determinism | 5 |
| Latency/cost | 5 |
| Total | 100 |

Composite score must never override hard blockers.

---

# 6. Hard release blockers

Any of these should force the run to remain `draft`:

```text
unsupported major factual claim > 0
wrong semantic icon > 0
major claim represented only by R10 text/box > 0
schemaConstrained = false
silent semantic coercion > 0
hard overlap/clipping > 0
meaning-changing truncation > 0
major narration/visual mismatch > 0
deterministic replay mismatch > 0
unresolved asset provenance/licensing error > 0
```

R10 labelled primitives must no longer count as meaningful visual coverage.

---

# Phase 0 — Freeze V1 baseline

## Goal

Create a stable reference implementation before V2 changes.

## Tasks

- Commit all current work.
- Tag the baseline.
- Save representative artifacts.
- Save raw model outputs.
- Save lesson locks.
- Save timing and cost reports.
- Save contact sheets.
- Save evaluation reports.
- Remove benchmark-specific Q/K/V wording from production prompts.
- Add version flag:

```ts
TEACHING_COMPILER_VERSION = "v1" | "v2";
```

- Change R10 accounting:
  - text-supported = true,
  - drawnCoverage = false,
  - mechanismCoverage = false.

## Exit criteria

Given the same V1 lock:

```text
geometry hash = 100% identical
event hash = 100% identical
asset hash = 100% identical
audio hash = 100% identical
```

Inside a pinned environment:

```text
artifact hash = 100% identical target
```

---

# Phase 1 — Make the harness truthful

Do this before rebuilding visual intelligence.

## 1.1 Provider-specific strict schema compiler

Create:

```text
src/structured/
  providerSchema.ts
  openaiStrict.ts
  normalizeNullable.ts
```

Transform optional schema fields into provider-supported strict forms.

Requirements:

- all properties explicit,
- optional fields represented as nullable where required,
- `additionalProperties: false`,
- normalize null back to undefined after validation.

Every model call must record:

```ts
{
  schemaConstrained: true,
  schemaVersion: "...",
  provider: "...",
  model: "..."
}
```

Production output with `schemaConstrained=false` remains draft.

---

## 1.2 Preserve raw outputs

Save separately:

```text
raw-model-output.json
validation-errors.json
repair-patches.json
validated-output.json
```

Never overwrite the raw result.

---

## 1.3 JSON-pointer repairs only

Do not regenerate whole documents.

Example repair path:

```text
/s3/scenes/4/beats/2/representation
```

Maximum:

```text
2 repairs per failing semantic unit
```

---

## 1.4 Coercion ledger

Every mutation must emit:

```ts
{
  path,
  oldValue,
  newValue,
  reason,
  semanticRisk
}
```

Allowed silent normalization:

- whitespace,
- semantically equivalent casing,
- null → undefined.

Not allowed silently:

- unknown enum → default,
- invalid strategy → generic flow,
- missing relation → dropped,
- wrong evidence → nearest quote,
- invented IDs.

---

## Phase 1 benchmark gates

| Metric | Gate |
|---|---:|
| Production calls schema-constrained | 100% |
| Silent semantic coercions | 0 |
| Repair attempts | ≤2/unit |
| S3 first-try schema validity | ≥95% |
| S4 first-try schema validity | ≥98% |
| S6 first-try schema validity | ≥95% |
| Raw outputs retained | 100% |
| Replay fixtures emitted | 100% |

Do not begin the semantic V2 migration until these metrics are measurable.

---

# Phase 2 — Introduce `TeachingBeatPlan`

S3 should no longer produce only high-level scene semantics.

It should compile each scene into semantic teaching beats.

```ts
type TeachingBeat = {
  beatId: string;
  sceneId: string;
  claimIds: string[];

  learnerDelta: string;

  beatType:
    | "motivate"
    | "introduce"
    | "demonstrate"
    | "transform"
    | "contrast"
    | "counterexample"
    | "connect"
    | "summarize";

  cognitiveOperation:
    | "identify"
    | "compare"
    | "classify"
    | "trace"
    | "transform"
    | "quantify"
    | "predict"
    | "infer"
    | "explain_cause"
    | "understand_system";

  representationFamily:
    | "literal_object"
    | "process"
    | "state_transition"
    | "sequence"
    | "topology"
    | "hierarchy"
    | "comparison"
    | "causal_chain"
    | "feedback_loop"
    | "quantity"
    | "spatial_model"
    | "equation"
    | "plot"
    | "code"
    | "scientific_diagram";

  entities: EntityRef[];
  relationships: RelationSpec[];

  stateBefore?: StateSpec;
  stateAfter?: StateSpec;

  misconceptionIds: string[];

  narrationGoal: string;
  visualInvariant: string;
  mutedMeaning: string;

  persistence:
    | "beat"
    | "scene"
    | "lesson";

  pauseIntent:
    | "none"
    | "micro"
    | "think"
    | "scene_close";
};
```

S3 owns **what changes in understanding**.

It does not own:

- wording,
- coordinates,
- assets,
- timestamps,
- SVG.

## Phase 2 exit criteria

```text
100% major claims → at least one beat
100% beats → learnerDelta
100% beats → representationFamily
100% beats → visualInvariant
100% visual beats → mutedMeaning
0 dangling claim IDs
0 unsupported evidence IDs
```

---

# Phase 3 — Beat-addressable narration

S4 remains the Narration Director.

Flow:

```text
TeachingBeatPlan
      ↓
S4
      ↓
NarrationBeat[]
```

Schema:

```ts
type NarrationBeat = {
  beatId: string;
  sentenceIds: string[];
  text: string;
  speakingStyle?: {
    emphasisTerms: string[];
  };
};
```

Invariant:

```text
TeachingBeat B17
↔
NarrationBeat B17
```

Remove/reduce reliance on:

- mention-marker searching,
- verbatim phrase hunting,
- nearest narration phrase,
- LLM word-count contracts.

The audio determines real duration.

## Phase 3 gates

```text
beat ↔ narration coverage = 100%
orphan narration beat = 0
orphan teaching beat = 0
unsupported narration major facts = 0
word-count hard failures = 0
```

---

# Phase 4 — BoardOps V2

Replace static-board-only semantics with a stateful operation language.

```ts
type BoardOp =
  | AddOp
  | ConnectOp
  | MoveOp
  | TransformOp
  | ReplaceOp
  | RemoveOp
  | HighlightOp
  | DeemphasizeOp
  | StrikeOp
  | UpdateValueOp
  | SplitOp
  | MergeOp
  | EquationStepOp
  | RevealRegionOp
  | ClearRegionOp;
```

Example:

```ts
{
  op: "move",
  target: "particle-7",
  from: "left-compartment",
  to: "right-compartment"
}
```

Not:

```ts
{
  x1: 456,
  y1: 319,
  x2: 728,
  y2: 319
}
```

Every operation must contain:

```text
opId
beatId
semantic target
preconditions
postconditions
```

The layout engine still owns coordinates.

---

# Phase 5 — Persistent Board State

Create:

```text
src/visual-v2/board-state/
  types.ts
  reducer.ts
  validate.ts
  hash.ts
```

Core structure:

```ts
type BoardState = {
  elements: Map<ElementId, ElementState>;
  relationships: Map<EdgeId, EdgeState>;
  regions: Map<RegionId, RegionState>;
};
```

Each element tracks:

```text
createdAtBeat
updatedAtBeat[]
removedAtBeat?
persistence
```

Scene transitions should support:

- retain entire board,
- retain selected region,
- move viewport/camera,
- clear region,
- fade previous context,
- explicit clean board.

Do not clear the board merely because the scene changes.

## Phase 5 fixture

Recursion must reproduce:

```text
[]
[f4]
[f4,f3]
[f4,f3,f2]
[f4,f3,f2,f1]
[f4,f3,f2]
[f4,f3]
[f4]
[]
```

Stable IDs must persist through the whole transformation.

---

# Phase 6 — Mechanism Kit Library

Create:

```text
src/visual-v2/kits/
```

Initial kits:

| Kit | Uses |
|---|---|
| compartment | membranes, diffusion, containers |
| stack | recursion, calls, undo |
| queue | messaging, scheduling, BFS |
| array | algorithms, sequences, tensors |
| tree | hierarchy, recursion |
| graph | network/system/dependencies |
| layered-stack | neural networks, layered systems |
| equation | derivation/transformation |
| axes-plot | quantities/distributions |
| cycle | feedback/process loops |
| comparison | before/after/tradeoffs |
| weighted-links | attention/influence/probability |

Kits receive semantic parameters.

Example:

```ts
CompartmentKit({
  regions: [
    { id: "outside", particles: 12 },
    { id: "inside", particles: 3 }
  ],
  boundary: {
    kind: "semipermeable"
  }
});
```

The LLM selects:

```text
representation + semantic parameters
```

Deterministic code creates geometry.

Rough.js may style generated geometry afterward.

## Do not create topic-specific renderers

Avoid:

```text
osmosis.ts
attention.ts
recursion.ts
```

Build generic mechanisms.

---

# Phase 7 — Type-first asset resolver

Change:

```text
text similarity
→ nearest asset
```

into:

```text
concept type
→ representation family
→ domain constraints
→ allowed source class
→ semantic candidates
→ similarity ranking
```

Suggested rules:

| Semantic type | Resolver |
|---|---|
| Concrete object | icon eligible |
| Person/animal | icon eligible |
| Process | mechanism kit |
| Abstract role | topology/shape |
| State transition | mechanism + BoardOps |
| Quantity | quantity/plot |
| Math | equation/geometry |
| Code | code representation |
| Hierarchy | tree/container |
| Feedback | cycle |
| Architecture | graph/topology |

## Move VLM checks offline

Asset Lab should store:

```ts
{
  assetId,
  conceptId,
  semanticRoles,
  approved,
  confidence,
  provenance
}
```

Runtime VLM icon checking should be zero.

## Phase 7 gates

```text
wrong icon on golden fixtures = 0
R10 major-claim fallback = 0
runtime VLM asset validation = 0
unlicensed production asset = 0
```

---

# Phase 8 — Illustrative Example Lane

Create evidence classes:

```ts
type EvidenceClass =
  | "source"
  | "derived"
  | "illustrative"
  | "metaphorical";
```

Example:

```ts
{
  provenance: "illustrative",
  purpose: "demonstrate Pythagorean equality",
  payload: {
    a: 3,
    b: 4,
    c: 5
  },
  verification: {
    method: "computation",
    passed: true
  }
}
```

Possible verification:

- numeric computation,
- symbolic algebra,
- type/property validation,
- source-grounded derivation.

Illustrative examples must never be presented as sourced facts.

---

# Phase 9 — Layout V2

Use two layout layers.

## Mechanism kits

Own their internal geometry.

## General graph/system layouts

Use a compound graph layout engine such as ELK.

The deterministic layout engine still owns:

- x/y,
- size,
- spacing,
- text bounds,
- safe regions,
- routing,
- grouping.

Add **ink-aware** validation.

Validate:

```text
text ↔ ink collision
edge ↔ text collision
edge ↔ unrelated node collision
arrowhead ↔ label collision
equation ↔ title collision
safe-area violation
minimum visual gap
minimum readable font size
```

## Phase 9 gates

Across all 15 cold runs:

```text
hard overlaps = 0
clipping = 0
safe-area violations = 0
unreadable text = 0
edge-through-unrelated-node = 0
```

---

# Phase 10 — Semantic Timeline V2

Do not search narration for concept words.

Compile by stable beat identity:

```text
TeachingBeat B17
↔
NarrationBeat B17
↔
aligned interval
↔
BoardOps B17
```

Timeline input:

```ts
{
  beatId,
  alignedStart,
  alignedEnd,
  boardOps,
  dependencies,
  pauseIntent
}
```

S9 decides exact milliseconds.

Example:

```text
B17: 04.12–08.50

04.00 membrane already visible
04.18 particles begin appearing
05.70 first particle moves
06.60 reverse particle movement
07.30 net-flow arrow emphasized
08.30 hold
08.50 next beat
```

Add instructional pause policies:

```text
micro       100–250 ms
think       ~300–800 ms
scene-close ~400–1000 ms
```

These are compiler policies, not LLM-generated milliseconds.

## Phase 10 gates

```text
major late reveal failures = 0
BoardOps without beat = 0
major visualizable beats without visual = 0
beat/audio mapping coverage = 100%
```

---

# Phase 11 — `lesson.lock.json` V2

Expand the lock:

```json
{
  "teachingPlan": {},
  "beats": [],
  "narrationBeats": [],
  "audio": {},
  "alignment": {},
  "visualProgram": {},
  "boardOps": [],
  "boardStates": [],
  "resolvedAssets": [],
  "geometry": {},
  "timeline": [],
  "renderPlan": [],
  "versions": {}
}
```

After lock creation:

```text
NO LLM
NO web
NO VLM
NO asset search
NO semantic repair
NO random layout
NO unseeded Rough
```

---

# Phase 12 — Event-driven RenderPlan

Do not rasterize all frames blindly at 30 FPS.

Compile:

```ts
type RenderSegment =
  | {
      kind: "hold";
      stateHash: string;
      durationMs: number;
    }
  | {
      kind: "transition";
      fromStateHash: string;
      toStateHash: string;
      durationMs: number;
      fps: number;
      easing: Easing;
    };
```

Example:

```text
transition 420 ms
hold       3100 ms

transition 380 ms
hold       4200 ms

transition 600 ms
hold       2000 ms
```

For holds:

```text
render once
```

not dozens or hundreds of identical frames.

## State hashing

Hash:

```text
geometry
visibility
styles
transform state
```

If state hash is unchanged, do not invoke resvg again.

---

# Phase 13 — Warm Renderer Workers

Keep renderer state warm:

```text
fonts loaded
asset metadata loaded
parsed SVG fragments cached
renderer process alive
```

Use a bounded worker pool.

Benchmark worker count against:

- throughput,
- RAM,
- CPU contention,
- thermal throttling.

Do not default to all available cores without measurement.

---

# Phase 14 — Parallel Scene Preparation

After global teaching order is fixed:

```text
global S1/S2/S3
        ↓

scene1 S4 → S5
scene1 S6 → S7 → S8
        ↓
       S9

scene2 S4 → S5
scene2 S6 → S7 → S8
        ↓
       S9

scene3 ...
```

Maintain one shared lesson-level authority for:

- terminology,
- concept IDs,
- visual identity,
- color semantics,
- pedagogical order.

---

# Phase 15 — Per-scene Clips

Produce:

```text
scene-001.mp4
scene-002.mp4
scene-003.mp4
...
```

Then deterministic ordered concat.

Benefits:

- parallel encoding,
- localized retry,
- scene caching,
- progressive availability,
- partial invalidation.

If scene 8 changes, do not rerender scenes 1–7.

---

# Phase 16 — Progressive Playback

Optimize first useful output.

Target:

```text
lesson outline
      ↓
scene 1 complete
      ↓
PLAYBACK STARTS
      ↓
scene 2 buffered
scene 3 compiling
scene 4 planning
```

Maintain roughly 1–2 prepared scenes ahead.

---

# 7. Performance benchmark ladder

Use a standardized 60-second lesson first.

## Stage A — minimum acceptable

| Metric | Gate |
|---|---:|
| Time to first playable | ≤20 s |
| Full 60-s generation | ≤60 s |
| Render + encode | ≤10 s |
| Hard semantic failures | 0 |
| Major R10 fallbacks | 0 |
| Wrong icons | 0 |

## Stage B — competitive target

| Metric | Target |
|---|---:|
| Time to first playable | ≤12 s |
| Full 60-s generation | ≤40 s |
| Render + encode | ≤5 s |
| S3 + S4 planning | ≤10 s |
| TTS + alignment | ≤10 s |
| Visual compile + layout | ≤10 s |
| Repairs/scene | <0.1 average |

## Stretch

```text
TTFP < 8 s
full 60 s < 20 s
render + encode < 3 s
```

Do not compromise semantic quality for latency.

---

# 8. Teaching-quality benchmarks

## Grounding

```text
major unsupported facts = 0
illustrative examples explicitly classified = 100%
claim → evidence traceability = 100%
```

## Learner delta

Every major scene must have:

- one clear learner delta,
- one primary cognitive operation,
- one primary representation goal.

Human evaluator agreement:

```text
"What should the learner understand after this scene?"
≥90%
```

---

# 9. Visual-quality benchmarks

Release targets:

| Metric | Target |
|---|---:|
| Major claims with meaningful visual representation | ≥90% |
| Major claims R10-only | 0% |
| Wrong icons | 0 |
| Generic-box fallback among visual beats | ≤10% |
| Appropriate state-changing beats actually animated | ≥80% |
| Persistent identity across related beats | ≥95% |
| Unnecessary text-only diagrams | ≤10% |

Do **not** optimize for icon percentage.

Optimize for meaningful representation.

---

# 10. Muted-board benchmark

For each scene:

1. Show final board without audio.
2. Ask two independent reviewers:
   - What process/relationship is shown?
   - What changed?
   - What conclusion should I notice?
3. Compare answers against `mutedMeaning`.

Score:

```text
0 = wrong
1 = partly understandable
2 = essentially correct
```

Release target:

```text
≥80% of scenes receive 2/2 from both reviewers
0 major scenes receive 0/2 from both reviewers
```

---

# 11. Narration ↔ visual sync benchmark

For each major beat record:

```text
audio interval
visual interval
```

Targets:

```text
major late reveal failures = 0
visual ops without teaching beat = 0
major visualizable beats without visual = 0
```

The key visual should appear slightly before or during the spoken explanation, not after it has passed.

---

# 12. Determinism benchmark

Replay the same lock 20 times.

Require:

```text
BoardOp hash     100%
geometry hash    100%
timeline hash    100%
asset hashes     100%
audio hash       100%
```

Inside the pinned render environment:

```text
final artifact hash = 100% target
```

If codec internals prevent byte-identical MP4s, require decoded frame/audio equality plus identical manifests.

---

# 13. Reliability benchmark

Cold benchmark:

```text
5 topics × 3 runs = 15 independent runs
```

Required:

```text
15/15 complete artifact
15/15 no infrastructure crash
15/15 no silent repair
≥14/15 release-passing
```

Then run the untouched held-out suite.

---

# 14. Cost benchmark

Track:

```text
S1/S2 cost
S3 cost
S4 cost
S6 cost
repair cost
TTS cost
VLM cost
render cost
total cost / finished minute
```

Initial release ceiling:

```text
≤ $0.10 per finished minute
```

Cost optimization comes after semantic-quality gates.

---

# 15. Simi behavior benchmark

Do not compare pixel appearance.

Measure both Simi reference scenes and our scenes using:

| Metric | Meaning |
|---|---|
| meaningful elements / scene | information density |
| pictorial vs text ratio | representational richness |
| generic labelled-box ratio | fallback dependence |
| semantic transitions / scene | progressive explanation |
| stable objects across beats | persistence |
| state-changing operations | real teaching animation |
| words on canvas | text dependence |
| visible relationships | topology quality |
| reveal cadence | pacing |
| muted comprehension | standalone visual clarity |

Goal:

```text
behavioral teaching parity
```

not screenshot imitation.

---

# Phase 17 — Optional renderer backend bake-off

Only do this after semantic parity is reached.

Keep:

```text
resvg = canonical reference renderer
```

Add:

```ts
interface RendererBackend {
  render(state: RenderState): Promise<RenderedFrame>;
}
```

Then compare:

```text
ResvgBackend
SkiaBackend
```

Promotion criteria:

```text
≥1.5–2× render speedup
AND
0 semantic differences
AND
0 meaningful visual regression
AND
acceptable memory use
AND
acceptable deployment complexity
```

If not, stay on resvg.

---

# 16. Proposed V2 module structure

```text
hypothesis_claude/
  src/

    teaching/
      scene-contract/
      beat-plan/
        types.ts
        prompt.ts
        validate.ts
        compile.ts

    narration/
      beat-narration/
        types.ts
        generate.ts

    visual-v2/
      intent/
        types.ts

      board-ops/
        types.ts
        validate.ts

      board-state/
        types.ts
        reducer.ts
        hash.ts

      kits/
        compartment.ts
        stack.ts
        queue.ts
        array.ts
        tree.ts
        graph.ts
        layered-stack.ts
        equation.ts
        plot.ts
        cycle.ts
        comparison.ts
        weighted-links.ts

      resolver/
        type-gate.ts
        strategy.ts
        asset-resolver.ts

      layout/
        elk.ts
        kit-layout.ts
        ink-validator.ts

      timeline/
        compile.ts

      render-plan/
        types.ts
        compile.ts
        hash.ts

      renderer/
        interface.ts
        resvg.ts
        skia-experimental.ts

    evaluation/
      grounding.ts
      beat-coverage.ts
      muted.ts
      sync.ts
      visual-mechanism.ts
      layout.ts
      determinism.ts
      performance.ts
      scorecard.ts
```

---

# 17. Feature flags

Use independent flags:

```text
TEACHING_BEATS_V2
BOARD_OPS_V2
PERSISTENT_BOARD_V2
TYPE_RESOLVER_V2
LAYOUT_V2
RENDER_PLAN_V2
SKIA_EXPERIMENTAL
```

Do not enable every architectural change simultaneously during early benchmarking.

---

# 18. Exact implementation sequence

```text
P0  Freeze V1 baseline
 ↓
P1  Strict structured-output harness
 ↓
BENCHMARK
 ↓
P2  TeachingBeatPlan
 ↓
BENCHMARK
 ↓
P3  Beat-addressable narration
 ↓
BENCHMARK
 ↓
P4  BoardOps
 ↓
P5  Persistent Board State
 ↓
BENCHMARK recursion + osmosis
 ↓
P6  Mechanism kits
 ↓
BENCHMARK mechanism fixtures
 ↓
P7  Type-first resolver
 ↓
BENCHMARK wrong-icon suite
 ↓
P8  Illustrative provenance
 ↓
BENCHMARK math/CS examples
 ↓
P9  Layout V2 + ELK + ink validation
 ↓
BENCHMARK geometry suite
 ↓
P10 Semantic timeline + pauses
 ↓
BENCHMARK sync suite
 ↓
P11 lesson.lock V2
 ↓
DETERMINISM TEST
 ↓
P12 Event-driven RenderPlan
 ↓
PERFORMANCE TEST
 ↓
P13 Warm workers + parallel clips
 ↓
PERFORMANCE TEST
 ↓
P14 Progressive playback
 ↓
5 × 3 COLD GRID
 ↓
Human muted review
 ↓
HELD-OUT SUITE
 ↓
ARCHITECTURE LOCK
 ↓
Optional renderer bake-off
```

---

# 19. Activities to stop during V2 implementation

Until semantic benchmarks pass:

```text
No more QKV-specific prompt patches.
No topic-specific visual hacks.
No more static template proliferation.
No Rough.js aesthetic tuning.
No LLM-generated SVG/JS/Manim.
No runtime VLM icon repair loop.
No blindly enabling thousands of icons.
No 30-minute generation as primary benchmark.
No silent coercions.
No whole-object repair.
No changing five components in one benchmark iteration.
No declaring success from a single demo.
```

---

# 20. Simi-parity milestone

Define the first parity milestone as:

```text
60–90 second lessons

5 unrelated cold domains
3 independent runs each

0 wrong icons
0 major R10-only visual fallbacks
0 hard grounding failures
0 hard geometry failures
0 major late-reveal failures

≥90% meaningful visual coverage
≥80% human muted comprehension

15/15 artifacts complete
≥14/15 release-passing

TTFP ≤12 s target
full 60 s ≤40 s target

deterministic replay passes
```

Only after this should 30-minute generation become the primary benchmark again.

---

# 21. "Better than Simi" milestone

Do not define superiority as more attractive drawings.

Target:

```text
Simi-level visual clarity
+
source grounding
+
explicit provenance
+
verified illustrative examples
+
stateful scientific/mechanical diagrams
+
equation evolution
+
persistent semantic board
+
long-form lesson structure
+
deterministic reproducibility
```

That is the stronger product opportunity.

---

# 22. Final architectural decision

Proceed with **Teaching Compiler V2**.

Do not rewrite S1–S12.

The main redesign is:

```text
S3 semantic intent
       ↓
TeachingBeatPlan
       ↓
S4 locked beat narration
       ↓
S5 audio/alignment
        \
         \
S6 Visual Teaching Model
       ↓
BoardOps
       ↓
Persistent Board State
       ↓
Mechanism Kits + Assets
       ↓
Deterministic Layout
       ↓
Semantic Timeline
       ↓
RenderPlan
       ↓
lesson.lock.json
       ↓
SVG / resvg / FFmpeg
```

The first engineering work should therefore be:

1. **Freeze V1.**
2. **Fix structured-output truthfulness and repair accounting.**
3. **Implement `TeachingBeatPlan`.**
4. **Make narration beat-addressable.**
5. **Implement BoardOps + persistent state.**
6. **Build generic mechanism kits.**
7. **Fix asset resolution.**
8. **Upgrade layout/timing.**
9. **Optimize the renderer only after semantic quality is working.**

The renderer is not the first problem to solve.

The next major milestone is a compiler that can express and execute:

> what changed in the learner's mental model, and what must visibly change on the board to make that understanding obvious.

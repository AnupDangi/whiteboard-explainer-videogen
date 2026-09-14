# Explain Canvas Lab V2.1 — Architecture Stabilization & Execution Plan

## 0. Mission

Do NOT build V3.

Do NOT redesign the renderer.

Do NOT add more animation types, languages, visual effects, VLM critics, or hundreds of manually-authored assets yet.

V2.1 exists to make the existing semantic teaching compiler:

1. reliable on live model output
2. capable of representing unseen concepts
3. simpler for LLMs to control
4. faster to first narrated playback
5. measurable across a real multi-domain benchmark

The existing deterministic renderer, compiler, semantic timeline, asset system, SSE job model, browser/export parity and V2 SceneGraph remain.

The primary architectural correction is:

```text
LLM       -> meaning / pedagogy
Resolver  -> representation
Compiler  -> geometry
Renderer  -> pixels
Runtime   -> IDs / references / validation
```

Do not let these responsibilities collapse into one model call.

---

# 1. Definition of the current problem

The current system has demonstrated that:

* deterministic rendering works
* manual semantic scenes can work
* automatic plant generation can work
* equation generation can work
* English and Hindi can work
* progressive scene delivery works
* 200+ implementation tests pass

But live generation exposed structural weaknesses:

```text
large cross-referenced LLM contracts
        +
model-generated IDs
        +
small exact asset vocabulary
        +
broad deterministic heals
        +
serial latency
        +
fixture-heavy evaluation
```

This produces:

```text
schema drift
invalid references
synthetic hero assets
partial jobs
unnecessary retries
large repair counts
poor first narrated playback latency
```

V2.1 must fix these causes rather than adding more symptom-specific heals.

---

# 2. Architecture invariant

Preserve:

```text
SOURCE
  ↓
SOURCE UNDERSTANDING
  ↓
TEACHING PLAN
  ↓
SEMANTIC STORYBOARD
  ↓
MENTAL MODEL
  ↓
REPRESENTATION RESOLVER      ← strengthen/add
  ↓
VISUAL DIRECTION
  ↓
SCENEGRAPH
  ↓
DETERMINISTIC COMPILER
  ↓
TIMELINE
  ↓
PURE RENDERER
```

After representation feasibility is established:

```text
                  ┌→ narration finalize → TTS ──┐
FEASIBLE SCENE ───┤                             ├→ PLAYABLE AV
                  └→ visual compile ────────────┘
```

TTS and detailed visual compilation must not unnecessarily block each other.

---

# 3. Non-goals

Do not:

* rewrite into Manim
* replace TypeScript SVG renderer
* move geometry into LLM output
* allow unrestricted generated SVG
* generate JavaScript/React from models
* make an agent for every primitive
* add hundreds of assets before resolver works
* solve failures by increasing retry counts
* send geometry problems to LLM repair
* send every failure back to Teaching Planner
* treat VLM critic as the quality solution
* optimize MP4 export before first playback
* expand language coverage before core reliability is established
* delete V1 yet

---

# 4. Workstream P0-A — Build the live reliability harness FIRST

## Objective

We currently know unit/fixture reliability.

We need to know real generation reliability.

Create:

```text
eval/live/
  cases/
  runner.ts
  metrics.ts
  manifest.ts
  compare.ts
  reports/
```

## Benchmark corpus

Create approximately 48 cases across:

```text
structural
spatial process
transformation
flow
cause/effect
cycle
comparison
hierarchy
timeline
equation
matrix
trajectory
list/facts
```

Include at minimum:

```text
photosynthesis
cell anatomy
DNA replication
plate tectonics
water cycle
refrigeration cycle

linear equation
quadratic equation
matrix multiplication
gradient descent

transformer attention
KV cache
DeepSeek MLA
expert routing
RAG
HTTP lifecycle
cache hit/miss
TCP congestion

bank transfer
inflation feedback

Roman Empire causal timeline

robot path planning
projectile trajectory
```

Add sufficiently different additional cases to reach ~48.

For each case define:

```ts
interface LiveEvalCase {
  id: string
  prompt: string
  category: string

  sourceFixture?: string

  mustExplain: string[]
  requiredRelations?: SemanticRelationRequirement[]
  expectedConcepts?: string[]

  preferredArchetypes?: VisualArchetype[]
  forbiddenPatterns?: string[]

  criticalAssetRoles?: string[]
}
```

Do NOT enforce exact wording.

Do NOT enforce exact coordinates.

---

# 5. Reliability metrics

Every generation must emit stage-level metrics.

Required:

```text
sourceUnderstandingSuccess
teachingPlanSuccess
storyboardSuccess
mentalModelSuccess

representationResolutionSuccess

visualDirectionSuccess
sceneGraphSuccess

compileSuccess
timelineSuccess

ttsSuccess

fullJobSuccess
partialJob
```

Also record:

```text
plannerRepairCount
directorRepairCount
representationFallbackCount
geometryRepairCount
timelineRepairCount
ttsFallbackCount

invalidReferenceCount
missingRepresentationCount
schemaRetryCount
modelRetryCount
```

Performance:

```text
sourceReadyMs
teachingPlanReadyMs
scenePlanReadyMs

firstRepresentationReadyMs
firstVisualReadyMs

narrationReadyMs
firstAudioByteMs
ttsCompleteMs

firstAVPlayableMs
fullPlayableMs
exportMs

costUsd
promptTokens
completionTokens
```

IMPORTANT:

Do not call a silent scene "firstPlayable" when evaluating the narrated product.

Use:

```text
firstVisualReadyMs
firstAudioReadyMs
firstAVPlayableMs
```

separately.

The headline product latency metric is:

```text
firstAVPlayableMs
```

---

# 6. Run protocol

Initially:

```text
48 cases
×
3 runs each
=
144 generations
```

Run with the same model configuration.

Persist every:

```text
input
model output
validated IR
repair
compiler output
metrics
failure
cost
latency
```

Do not silently discard failed generations.

Generate:

```text
eval/live/reports/latest.json
eval/live/reports/latest.md
```

Report:

```text
success by stage
success by archetype
success by topic

repair histogram
failure taxonomy

P50/P95 latency
P50/P95 cost

case-level regressions
```

Do NOT report only averages.

---

# 7. Initial reliability target

Before adding features target:

```text
teachingPlanSuccess      >= 98%
representationResolution >= 98%
sceneGraphSuccess        >= 97%
compileSuccess           >= 99%
fullJobSuccess           >= 95%
```

Later:

```text
fullJobSuccess >= 98%
```

No release decision may be made from hand-selected demos.

---

# 8. Workstream P0-B — Reduce the model-facing semantic contract

## Problem

The model currently controls too many cross-referenced objects.

Concept IDs, object IDs, relation IDs, beat IDs and anchor references create unnecessary failure states.

## New rule

Models express semantics.

Runtime owns identity.

Bad:

```json
{
  "relationId": "rel_plant_4",
  "fromObjectId": "object_water_8",
  "targetAnchor": "plant_root_anchor_03"
}
```

Preferred model output:

```json
{
  "fromConcept": "water",
  "relation": "enters",
  "toConcept": "plant",
  "targetPart": "roots"
}
```

Runtime transforms this into canonical internal references.

---

# 9. Introduce Canonical Semantic Keys

Create:

```text
src/semantic/identity/
  canonicalize.ts
  registry.ts
  references.ts
  resolver.ts
```

Model-facing semantic key:

```ts
type SemanticKey = string
```

Examples:

```text
plant
water
sunlight
carbon_dioxide
leaf
roots
```

Internal IDs are generated deterministically.

Example:

```text
concept:plant
scene:02/object:03
scene:02/relation:02
scene:02/beat:04
```

Model must not invent these IDs.

---

# 10. Runtime reference resolution

Implement:

```ts
resolveConceptReference()
resolveObjectReference()
resolveSemanticPart()
resolveRelationReference()
resolveBeatReference()
```

Errors must be typed.

Example:

```ts
type ReferenceFailure =
  | "UNKNOWN_CONCEPT"
  | "AMBIGUOUS_CONCEPT"
  | "OBJECT_NOT_IN_SCENE"
  | "SEMANTIC_PART_UNAVAILABLE"
```

No stringly-typed generic errors.

---

# 11. Shrink schemas

Separate:

```text
TeachingIntent
SceneTeachingIntent
VisualIntent
ResolvedVisualDirection
VisualSceneV2
CompiledSceneV2
```

Do not ask one LLM call to create compiler-ready SceneGraph.

Recommended boundary:

```ts
TeachingIntent {
  lessonGoal
  requiredClaims
  requiredMechanisms
  concepts
  scenes
}
```

Scene:

```ts
SceneTeachingIntent {
  teachingGoal
  learnerChange
  beats
  conceptKeys
  relationRequirements
}
```

Visual intent:

```ts
VisualIntent {
  mentalModel
  primaryConcept
  supportingConcepts
  representationNeeds
  semanticRelations
  continuityIntent
}
```

Only after deterministic representation resolution create:

```text
ResolvedVisualDirection
```

---

# 12. Workstream P0-C — Representation Resolver

This is the largest V2.1 change.

Create:

```text
src/semantic/representation/
  types.ts
  resolver.ts
  candidates.ts
  composition.ts
  templates.ts
  synthesis.ts
  abstraction.ts
  diagnostics.ts
```

Do NOT rename the entire architecture.

This subsystem bridges:

```text
semantic concept
     ↓
drawable representation
```

---

# 13. RepresentationCandidate

Implement:

```ts
interface RepresentationRequest {
  conceptKey: string

  semanticType: string
  role: "hero" | "support" | "material" | "annotation"

  mentalModel: string
  archetype: VisualArchetype

  requiredParts?: string[]
  requiredStates?: string[]
  requiredAnchors?: string[]

  styleFamily: string
}

interface RepresentationCandidate {
  source:
    | "asset"
    | "composition"
    | "template"
    | "generated"
    | "abstraction"

  ref: string

  semanticScore: number
  archetypeScore: number

  anchors: string[]
  states: string[]

  confidence: number
}
```

---

# 14. Representation fallback chain

Resolution must follow:

```text
1. exact trusted asset
2. semantic asset candidate
3. composed representation
4. domain template
5. constrained declarative synthesis
6. semantic abstraction
```

Only then:

```text
representation failure
```

Do NOT immediately convert a missing hero into a generic label.

Do NOT fail a job because the exact string:

```text
concept_inputs_group
```

does not exist in the registry.

Interpret what it semantically means.

---

# 15. Asset retrieval

Existing assets remain useful.

Improve search using:

```text
canonical alias
semantic type
semantic tags
mental-model compatibility
archetype compatibility
required semantic parts
required states
required anchors
style compatibility
```

Do NOT search only by English asset name.

Language-specific text must not determine asset identity.

Example:

```text
जल
water
पानी
eau
水
```

should resolve to the same semantic concept when source semantics establish equivalence.

---

# 16. Composed representations

Support concepts that do not need bespoke illustrations.

Examples:

```text
inputs to plant
=
plant
+ sunlight
+ water
+ CO2
```

The system does NOT need an asset called:

```text
concept_inputs_group.svg
```

Represent this as composition.

Similarly:

```text
client/server request
molecule interaction
router/expert selection
vector compression
comparison
pipeline
```

may use existing semantic components.

---

# 17. Domain templates

Create reusable representation families.

Initial templates:

```text
input_to_system
system_to_output

before_after
compression

container_and_parts
cross_section

cause_chain
feedback_cycle

equation_derivation
matrix_operation

timeline

trajectory

selection_from_pool

state_transition

comparison
```

These are not fixed slides.

They define semantic composition constraints.

---

# 18. Constrained synthesis

Do not permit raw unrestricted SVG.

Define a safe declarative representation DSL.

Example:

```ts
interface SynthesizedIllustrationSpec {
  semanticSubject: string

  parts: {
    key: string
    primitive:
      | "path"
      | "ellipse"
      | "rect"
      | "polygon"
      | "line"

    semanticRole: string
  }[]

  requestedAnchors: string[]
}
```

Model outputs semantic structure.

Trusted deterministic code creates geometry.

Generated geometry must pass:

```text
no scripts
no foreignObject
no external URL
bounded path complexity
valid viewBox
valid finite coordinates
valid anchors
safe fill/stroke tokens
```

Cache validated synthesized representations by semantic/style hash.

---

# 19. Abstraction fallback

If detailed illustration is not needed, fallback to semantic abstraction.

Example:

```text
"model weights"
```

may be:

```text
stacked parameter blocks
```

not a random icon.

Example:

```text
"latent representation"
```

may be:

```text
compact vector strip
```

not a generic box.

Fallback must retain semantic meaning.

---

# 20. Representation feasibility gate

Before narration freeze assert:

```text
hero representable
critical concepts representable
critical semantic anchors resolved
required states available
required relations renderable
archetype supported
```

If failure:

```text
resolver tries alternate representation
```

Then:

```text
visual director may change mental model
```

Only after bounded alternatives fail:

```text
scene fails
```

Partial job is an operational safety mechanism.

It is not the normal representation strategy.

---

# 21. Workstream P0-D — Targeted repair system

Create:

```text
src/semantic/repair/
  types.ts
  router.ts
  semantic-repair.ts
  representation-repair.ts
  timeline-repair.ts
```

Every validator error must have:

```ts
{
  class:
    | "SEMANTIC"
    | "REPRESENTATION"
    | "GEOMETRY"
    | "TIMING"
    | "SPEECH"
    | "PROVIDER",

  stage: string,

  code: string,

  message: string,

  context: {}
}
```

---

# 22. Repair ownership

Use:

```text
wrong concept
wrong relation
wrong archetype
missing semantic requirement
    ↓
semantic stage

missing asset
missing state
missing anchor
    ↓
representation resolver

collision
routing
text clipping
overflow
    ↓
compiler

late visual action
static interval
anchor mismatch
    ↓
timeline

TTS/provider problem
    ↓
speech layer
```

Do not route everything back to the Visual Director.

---

# 23. Bounded semantic repair

When an LLM produced invalid semantics, provide ONLY:

```text
original stage input
stage output
exact validation failure
allowed correction scope
```

Example:

```text
Required relation:
water → plant.roots

Generated:
water → plant.leaf

Repair only this relationship.
Do not regenerate the lesson.
```

Maximum initially:

```text
1 targeted repair/stage
```

If it remains invalid, fail visibly.

Do not add endless retries.

---

# 24. Delete symptom heals carefully

Do not delete existing heals immediately.

First instrument them.

Every heal must emit:

```text
healType
stage
reason
before
after
```

Run live harness.

Classify:

```text
legitimate deterministic normalization
vs
masking model/schema defect
```

Remove only the second class after root cause is fixed.

Target:

```text
repair/heal rate trending toward zero
```

---

# 25. Workstream P0-E — Parallel first-AV architecture

Current narrated latency is unacceptable.

Separate:

```text
firstVisualReady
firstAudioReady
firstAVPlayable
```

Main UX metric:

```text
firstAVPlayable
```

---

# 26. Change execution DAG

After a scene has:

```text
valid semantic beats
+
feasible representation
```

freeze narration.

Then immediately:

```text
               ┌→ TTS
scene feasible ┤
               └→ detailed visual direction/compile
```

Do not wait for final compile before starting speech.

Do not wait for full TTS output before doing visual work.

---

# 27. Streaming TTS interface

Refactor speech abstraction if required.

Desired API:

```ts
interface StreamingSpeechProvider {
  start(request: SpeechRequest): AsyncIterable<SpeechEvent>
}
```

Events:

```ts
type SpeechEvent =
  | { type: "audio"; bytes: Uint8Array }
  | { type: "word"; word: TimedWord }
  | { type: "complete"; durationMs: number }
  | { type: "error"; error: SpeechError }
```

The renderer must remain provider-independent.

---

# 28. TTS provider benchmark

Do NOT replace Supertonic blindly.

Benchmark:

```text
Supertonic
Piper
current cloud candidate(s)
```

Measure:

```text
TTFA
total generation ms
RTF
word timing availability
voice quality
language coverage
cost/minute
failure rate
```

Supertonic may remain:

```text
offline/local fallback
```

It does not need to remain the production low-latency default.

---

# 29. Timeline integration

Prefer actual provider word timestamps.

Priority:

```text
provider timestamps
    ↓
external alignment
    ↓
estimated timing
```

Preserve:

```ts
timingSource:
  | "provider"
  | "aligner"
  | "estimated"
```

Never label estimated timing as true alignment.

---

# 30. Latency targets

Phase targets:

```text
first visual:
P50 < 8 s

first narrated AV:
P50 < 12 s initially
goal < 8 s

full one-minute preparation:
< 40–60 s initially
```

Track P95 as well.

Do not optimize the average while leaving severe tail latency.

---

# 31. Progressive scene scheduling

Scene N+1 should usually finish before Scene N playback ends.

Desired:

```text
generation(scene N+1)
<
playbackRemaining(scene N)
```

Use bounded concurrency.

Never start all scenes simultaneously and destroy cost/latency predictability.

---

# 32. Workstream P1 — Multi-scene continuity

After P0 is stable, strengthen continuity.

Introduce canonical:

```ts
interface PersistentVisualIdentity {
  conceptKey: string
  representationRef: string
  styleRole: string
  state: string
  semanticParts: string[]
}
```

For every next scene determine:

```text
KEEP
MOVE
TRANSFORM
REPLACE
REMOVE
REINTRODUCE
```

Do not redraw a continuing hero as an unrelated object.

---

# 33. Continuity benchmark

Cases:

```text
photosynthesis:
plant → leaf → chloroplast

attention:
tokens → Q/K/V → attention matrix → output

HTTP:
browser → DNS → server → DB → response

DNA:
helix → fork → replication progression
```

Measure:

```text
continuityBreakCount
unnecessarySceneResetCount
representationIdentityChanges
```

---

# 34. Workstream P1 — Timing quality

The >3500 ms static interval is diagnostic.

For every narrated beat determine:

```text
what changes?
what is emphasized?
what relation is being explained?
```

Possible meaningful action:

```text
draw
trace
flow
highlight
fill
move
morph
replace
```

Do NOT create meaningless motion solely to satisfy timing diagnostics.

---

# 35. Timing metrics

Record:

```text
anchorLagP50Ms
anchorLagP95Ms
maxLateAnchorLagMs

longestNarratedNoChangeMs

meaningfulVisualBeatsPerMinute

actionCoverage
```

The 3500ms threshold remains an initial advisory/gate depending on case.

It is not a universal cognitive law.

---

# 36. Workstream P1 — Critic calibration

Only after representation/reliability work.

Before trusting the VLM judge, test it.

Generate controlled corruptions:

```text
relationship reversal
wrong semantic part
missing critical object
asset mismatch
late reveal
label swap
clipping
generic-box downgrade
irrelevant decoration
continuity reset
```

Pairwise:

```text
good vs corrupted
corrupted vs good
```

Track:

```text
judgeCalibrationAccuracy
judgePositionFlipRate
judgeFalsePositiveRate
judgeFalseNegativeRate
```

Do not use critic output as a release gate until calibrated.

---

# 37. Workstream P1 — Human evaluation

Blind pairwise:

```text
V1 vs V2.1
previous V2 vs V2.1
V2.1 model configuration A vs B
```

Primary question:

```text
Which version helps you understand the mechanism more clearly?
```

Secondary flags:

```text
factual error
confusing visual
clutter
narration mismatch
```

Target:

```text
V2.1 >= 70% preference over V1
```

on representative subset before default migration.

---

# 38. Workstream P1 — Learning efficacy

Small subset only.

After video ask:

```text
3 factual questions
1 mechanism question
1 transfer question
```

Record:

```text
factualScore
mechanismScore
transferScore
```

This is eventually more important than visual similarity to Simi.

---

# 39. Development sequence

Execute exactly in this order:

```text
WAVE 1
live harness + metrics

WAVE 2
canonical semantic identity
remove model ownership of most IDs

WAVE 3
Representation Resolver

WAVE 4
fallback composition/templates

WAVE 5
targeted repair routing

WAVE 6
parallel TTS/visual execution

WAVE 7
word alignment + timeline tuning

WAVE 8
multi-scene continuity

WAVE 9
critic calibration

WAVE 10
human + learning evaluation
```

Do not work on Wave N+1 until Wave N has:

```text
tests
live benchmark
before/after report
known limitations
```

---

# 40. Mandatory workflow for every wave

Before editing:

```text
1. inspect relevant implementation
2. identify exact existing interfaces
3. write baseline test
4. record baseline metrics
```

Then implement.

After implementation:

```text
1. typecheck
2. unit tests
3. relevant integration tests
4. selected live cases
5. compare metrics
6. inspect regressions
```

Commit only once the wave is coherent.

---

# 41. Mandatory report format

After each wave return:

```text
WAVE:
STATUS:

FILES CHANGED:

ARCHITECTURE CHANGE:

WHY:

TESTS ADDED:

TESTS:
x/x passing

LIVE CASES:
x/x complete

BEFORE:
...

AFTER:
...

REGRESSIONS:
...

HEALS/REPAIRS:
...

LATENCY:
...

COST:
...

KNOWN LIMITATIONS:
...

NEXT HIGHEST IMPACT:
...
```

Never report:

```text
"done"
```

without benchmark evidence.

---

# 42. Stop conditions

Stop and investigate rather than patch if:

```text
same failure appears >=3 times
repair count increases after a change
schema gets larger to fix model behavior
new asset is being added only to fix one prompt
generic fallback rate rises
partial jobs rise
latency improves by sacrificing semantic quality
```

These are signs of architectural regression.

---

# 43. Architectural rules

Maintain these invariants permanently:

```text
Models do not own geometry.

Models do not emit executable code.

Models do not invent asset IDs.

Models should not manually manage cross-stage identifiers.

Concept != asset.

Semantic relation != connector.

Beat != animation.

Visual intent != pixel layout.

Critic != validator.

Partial success != normal success.

Tests != product quality.

Beautiful != educational.
```

---

# 44. V2.1 completion gate

V2.1 is complete only when a multi-domain live benchmark demonstrates approximately:

```text
fullJobSuccess >= 95%, then 98%

compileSuccess >= 99%

critical claim coverage = 100%
for benchmark-critical requirements

required relation coverage = 100%
for benchmark-critical relationships

missing-representation hard failures ≈ 0

generic-box fallback low

P50 firstAVPlayable <= 12 s initially

repair rate materially reduced

browser/export determinism preserved
```

And qualitative evidence shows:

```text
structural concepts look structural
processes look like processes
transformations visibly transform
math looks mathematical
spatial explanations use spatial representation
```

Only then expand:

```text
asset libraries
languages
camera movement
style families
motion grammar
advanced transitions
production-scale deployment
```

---

# 45. First task to execute NOW

Do not make architecture changes yet.

Start with:

```text
WAVE 1 — LIVE RELIABILITY HARNESS
```

Inspect the existing:

```text
scripts/live-evaluation*
scripts/bench-semantic*
src/semantic/evaluation*
src/semantic/planning/*
src/semantic/jobs*
docs/V4_IMPLEMENTATION*
```

Reuse what exists.

Do not create a parallel evaluation framework unnecessarily.

Deliver:

```text
48-case manifest
live runner
stage metrics
failure taxonomy
machine-readable results
Markdown comparison report
3-run support
model/config/hash recording
```

Then run a smaller smoke set first:

```text
plant
linear equation
DNA replication
matrix multiplication
HTTP lifecycle
DeepSeek MLA
```

3 repetitions each.

That gives:

```text
18 real runs
```

Use those results to determine the first V2.1 implementation change.

Do NOT guess which subsystem is failing most.

Measure it.

---

# 46. Final engineering principle

The system should behave as a compiler pipeline, not as an LLM hoping to generate perfect JSON.

The model should answer:

```text
What should the learner understand?
How should that idea be represented?
```

The program should answer:

```text
What exact object represents it?
What is its ID?
Where does it go?
How is it routed?
When does it appear?
How is it rendered?
```

Every future architectural decision must preserve that separation.

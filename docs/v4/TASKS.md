# Explain Canvas Lab V2 — Implementation Tasks

## 0. Execution rule

This file is ordered.

Do not jump directly to VLM critics, more models, more prompts, or more SVG assets.

Each phase exists to isolate one failure class.

Keep V1 behind a feature flag until V2 is proven better.

After every task, report:

```text
FILES CHANGED
ARCHITECTURAL CHANGE
TESTS ADDED
TESTS PASSING
BENCHMARK BEFORE
BENCHMARK AFTER
KNOWN LIMITATIONS
NEXT HIGHEST-IMPACT TASK
```

Never report "done" without benchmark evidence.

---

# Phase 0 — Freeze baseline

## Task 0.1
Tag or record the current V1 baseline.

Capture:
- current commit SHA
- model config
- prompts
- schema versions
- renderer version
- asset versions

## Task 0.2
Render baseline cases:
- photosynthesis
- attention
- DNA replication
- plate tectonics
- DeepSeek MLA/compression
- HTTP request lifecycle

Save:
- final MP4
- Scene JSON
- compiled JSON
- contact sheet
- timing manifest
- cost
- first playable
- static interval report

Do not edit these fixtures after capture.

---

# Phase 1 — Create V2 types without changing rendering

## Task 1.1
Create:

```text
src/v2/types.ts
src/v2/schemas.ts
```

Implement:
- TeachingPlanV2
- ConceptIdentity
- SemanticScenePlan
- SemanticBeat
- VisualSceneV2
- VisualObject
- VisualRelation
- VisualBeat
- VisualAction
- AssetRef
- SceneContinuity

## Task 1.2
Add strict JSON schemas.

Requirements:
- additionalProperties: false
- bounded object/beat/action counts
- enum-only archetypes/actions/roles
- validated concept/object IDs
- no URLs in assetRef
- no raw SVG in normal VisualSceneV2 output

## Task 1.3
Preserve V1.

Add:

```text
VISUAL_PIPELINE=v1|v2
```

V2 may still adapt down into V1 temporarily.

---

# Phase 2 — Teaching planner V2

## Task 2.1
Replace "2 scenes with 2–6 nodes" planning with semantic scene planning.

Planner output must specify:
- central question
- learner assumptions
- required claims
- required mechanisms
- scene teaching goals
- semantic beats
- misconceptions if relevant
- evidence refs

It must not output:
- coordinates
- node shapes
- raw visual primitives

## Task 2.2
Create global concept registry.

For each concept:
- stable concept ID
- canonical name
- aliases
- semantic type
- preferred visual family
- source evidence

Validate concept consistency across scenes.

## Task 2.3
Add beat quality checks.

Deterministic checks:
- each critical requirement covered by >=1 beat
- beat has a pedagogical purpose
- no duplicate near-identical beats
- excessive concept density warning
- evidence IDs valid
- state/process requirements represented

---

# Phase 3 — Visual mental-model selection

## Task 3.1
Create:

```text
src/v2/planning/visual-model.ts
```

Inputs:
- semantic scene
- concept registry
- previous scene continuity
- allowed archetypes

Output:
- primary mental model
- candidate archetypes
- hero/support semantic roles
- relation strategy
- required object states

Example:

```json
{
  "mentalModel": "A plant is the central system receiving light, water and carbon dioxide",
  "candidateArchetypes": ["structural_diagram", "convergence"],
  "heroConceptIds": ["plant"],
  "supportConceptIds": ["sunlight", "water", "carbon_dioxide"]
}
```

## Task 3.2
Reject generic graph representation when the benchmark forbids it.

Examples:
- photosynthesis -> not generic box flow
- plate tectonics -> cross-section/spatial process
- DNA replication -> transformation/stateful structural diagram
- five caching rules -> list/numbered steps
- matrix multiplication -> matrix/equation
- interest-rate feedback -> causal cycle

---

# Phase 4 — Asset registry

## Task 4.1
Create modules:

```text
src/v2/assets/registry.ts
src/v2/assets/search.ts
src/v2/assets/types.ts
src/v2/assets/validator.ts
src/v2/assets/illustrations/
src/v2/assets/icons/
src/v2/assets/templates/
```

## Task 4.2
Define AssetDefinition.

Store:
- semantic tags
- archetype compatibility
- style family
- viewBox
- semantic anchors
- drawable parts
- state variants
- licensing/source metadata

## Task 4.3
Build first curated benchmark assets.

Minimum:
- plant
- sun
- water droplet
- CO2 molecule/label treatment
- leaf/chloroplast
- glucose cube
- oxygen
- human/lungs simplified
- DNA helix/fork
- plate cross-section
- mantle convection arrows/material
- token
- Q/K/V representation
- matrix
- vector
- compressed latent vector
- router
- expert pool
- server/database/cache
- bank/money flow

Do not build 500 assets before the pipeline is proven.

Start with ~30–50 high-value assets.

## Task 4.4
Every complex asset must expose semantic anchors.

Plant:
- roots
- stem
- leaf.top
- leaf.left
- leaf.right
- canopy

Router:
- input
- expert.0...N
- selectedExperts
- output

Matrix:
- row.i
- column.j
- cell.i.j

## Task 4.5
Implement deterministic retrieval.

Search by:
- exact alias
- tags
- semantic type
- archetype
- style family

Optional later:
- text embedding retrieval

Return candidate IDs, not file paths.

---

# Phase 5 — Manual plant golden before LLM integration

## Task 5.1
Create:

```text
eval/visual-bench/cases/photosynthesis-plant.json
examples/v2/photosynthesis-plant.scene.json
```

Manually author the ideal SceneGraph.

Do not use the planner.

## Task 5.2
Required objects:
- plant hero
- sunlight
- water
- CO2
- leaf label
- roots label
- short "three ingredients" takeaway if composition allows

## Task 5.3
Required relations:
- sunlight -> plant leaf
- water -> plant roots
- CO2 -> plant leaf

## Task 5.4
Required beat sequence:
1. establish plant
2. sunlight
3. water
4. CO2
5. combine/restate inputs

## Task 5.5
Benchmark question:

```text
Can our compiler/renderer create a rich teaching scene
without the LLM?
```

Do not continue until this is visibly strong.

---

# Phase 6 — Illustration renderer V2

## Task 6.1
Add deterministic part sequencing.

Each AssetPart:
- order
- durationWeight
- fillAfter
- semanticRole

## Task 6.2
Use path length to allocate stroke duration.

Recommended package:
- svg-path-properties or equivalent

## Task 6.3
Implement path-based draw.

Use:
- stroke-dasharray
- stroke-dashoffset

## Task 6.4
Implement optional cursor/pencil on active geometry.

Cursor:
- point at active path distance
- tangent determines angle
- hidden when no drawable path is active

Do not route cursor around bounding rectangles.

## Task 6.5
Add state variants:
- neutral
- highlighted
- filled/activated
- before/after variants as applicable

---

# Phase 7 — Composition compiler V2

## Task 7.1
Create:

```text
src/v2/compiler/compile-scene.ts
src/v2/compiler/zones.ts
src/v2/compiler/collisions.ts
src/v2/compiler/routing.ts
src/v2/compiler/text.ts
src/v2/compiler/occupancy.ts
```

## Task 7.2
Implement hero-first composition.

Order:
1. reserve title/caption/safe regions
2. place hero object
3. fit major support objects
4. resolve semantic anchors
5. route relations
6. place annotations
7. place takeaways
8. run local geometry repair
9. validate occupancy/hierarchy

## Task 7.3
Replace global disjointness with CollisionPolicy.

Implement:
- forbid
- allow
- contain
- overlay
- touch

## Task 7.4
Local deterministic repair loop.

Try before any LLM repair:
- move annotation
- swap annotation side
- reduce secondary scale
- reroute connector
- move support object within zone
- tighten whitespace
- shrink non-critical text to minimum
- change secondary support placement

Only semantic failures go back to the model.

## Task 7.5
Keep actual graph layout algorithms only for graph archetypes.

ELK.js or equivalent is appropriate for:
- dependency graph
- hierarchy
- complex flow graph

Do not use graph layout for:
- plant
- anatomy
- cross-section
- structural illustration
- matrix/equation
- spatial physics scenes

---

# Phase 8 — Visual Director V2

## Task 8.1
Create:

```text
src/v2/planning/visual-director.ts
```

Inputs:
- semantic scene
- mental model
- concept registry
- previous scene memory
- design tokens
- candidate asset metadata/contact sheet
- allowed archetypes

Output:
- archetype
- object inventory
- object roles
- selected asset IDs
- relations
- semantic anchors
- visual states
- visual actions
- continuity

Never output coordinates.

## Task 8.2
The director must answer explicitly:

```text
What is the central teaching object?
What should the learner look at first?
Which concepts need an illustration?
Which concepts only need a label?
Which relations need motion?
What remains visible across beats?
What changes state?
What should NOT be drawn?
```

## Task 8.3
Asset feasibility must influence direction.

The director may choose:
- asset candidate A
- alternate asset B
- template C
- composed primitives

If no candidate can teach the concept:
- request bounded SVG synthesis
- or choose a simpler valid representation

Do not silently degrade into generic boxes.

---

# Phase 9 — Narration finalization

## Task 9.1
Move narration freeze point.

Old:
- content prose validates
- narration becomes immutable
- TTS starts

New:
- semantic beats valid
- mental model selected
- critical asset feasibility confirmed
- final narration generated from beats
- narration immutable
- TTS starts

## Task 9.2
Narration finalizer sees:
- beat purposes
- visual objects
- relationships
- terminology
- source evidence

It does not see pixel coordinates.

## Task 9.3
Board labels and narration are separate.

The finalizer should avoid reading every label.

---

# Phase 10 — Semantic timeline compiler

## Task 10.1
Create:

```text
src/v2/compiler/timeline.ts
```

Input:
- VisualSceneV2
- actual word timing

Output:

```ts
interface CompiledVisualAction {
  id: string;
  type: MotionKind;
  objectIds: string[];
  startMs: number;
  durationMs: number;
  easing: EasingKind;
  fromState?: ObjectState;
  toState?: ObjectState;
}
```

## Task 10.2
Resolve spoken anchors beat-locally.

Avoid global fuzzy matching when a beat-local match exists.

## Task 10.3
Timing rules.

Default:
- visual can lead the spoken term slightly
- avoid late reveals
- persistent objects may already exist
- relation movement begins when relationship is taught

## Task 10.4
Add deterministic static-interval detection.

Flag:
- narrated no-visual-change >3500ms initially
- except intentionalPause

---

# Phase 11 — Renderer V2

## Task 11.1
Keep:

```ts
renderSVG(compiledScene, timeMs): string
```

pure.

## Task 11.2
Split renderer modules:
- primitives
- illustrations
- relations
- equations
- charts
- highlights
- cursor
- captions
- scene-state

## Task 11.3
No browser-only animation state.

Seeking directly to t=18.2s must render the same SVG whether or not 0..18.1s was previously played.

---

# Phase 12 — V2 critic

## Task 12.1
Run deterministic lints first.

Never pay a model to detect:
- NaN
- clipping
- invalid IDs
- missing asset
- target outside timeline
- obvious text collision
- malformed path

## Task 12.2
Generate event-aligned contact sheets.

Frames:
- initial
- after each major beat
- final

Keep 0/25/50/75/100 snapshots separately for renderer regression.

## Task 12.3
Critic rubric:
- teaching clarity
- representation correctness
- hero clarity
- relationship correctness
- layout/hierarchy
- readability
- continuity
- semantic motion
- asset appropriateness

## Task 12.4
Critic repair may change:
- archetype
- asset
- object role
- relation
- visual action
- beat grouping
- label
- emphasis
- preferred zones

One bounded repair initially.

---

# Phase 13 — Automatic planner plant benchmark

## Task 13.1
Now enable planner/director for:

```text
Explain how plants make food to a middle-school student.
```

## Task 13.2
Require:
- plant hero
- root/leaf semantic anchors
- sunlight/water/CO2
- correct relations
- no generic box-flow representation

## Task 13.3
Compare automatic SceneGraph with the manual golden semantically.

Do not require pixel identity.

---

# Phase 14 — Expand archetypes

Implement in this order:

1. structural_diagram
2. transformation
3. cross_section / spatial_process
4. numbered_steps
5. flow
6. comparison
7. cycle
8. equation_walkthrough
9. matrix_operation
10. hierarchy
11. timeline
12. trajectory

Why:
- first four directly attack current V1 weaknesses
- generic flow is already comparatively well handled

---

# Phase 15 — Multi-domain benchmark

Add cases:
- photosynthesis
- cell anatomy
- DNA replication
- plate tectonics
- transformer attention
- DeepSeek MLA
- expert routing
- matrix multiplication
- gradient descent
- RAG
- HTTP lifecycle
- cache hit/miss
- bank transfer
- inflation loop
- Roman Empire causal timeline
- water cycle
- refrigeration cycle
- robot path planning

For each case store:
- mustExplain
- requiredRelations
- preferredArchetypes
- forbiddenPatterns
- requiredAssets/assetRoles if critical
- source evidence when source grounded

---

# Phase 16 — Performance optimization only after visual quality

## Task 16.1
Record:
- sourceExtractionMs
- outlineMs
- storyboardMs
- visualModelMs
- assetSearchMs
- narrationFinalizeMs
- ttsMs
- directorMs
- compileMs
- criticMs
- sceneReadyMs
- firstPlayableMs
- fullPlayableMs
- exportMs

## Task 16.2
Optimize first playable:
- cache stable prompts
- local asset search
- bounded scene concurrency
- speculative work only after semantic freeze
- reuse TTS when narration unchanged
- compile locally
- render only preview frames needed for critic

## Task 16.3
Transport improvements come later.

SSE/WebSocket can replace full polling if profiling proves useful.

It is not a visual-quality task.

---

# Final migration condition

V2 may become default only when:
- plant manual renderer benchmark passes
- plant automatic benchmark passes
- V2 beats V1 in blind pairwise teaching-clarity evaluation
- critical semantic coverage remains high
- no source-grounding regression
- no browser/export determinism regression
- first playable remains within target
- fallback-to-generic-box rate is acceptably low

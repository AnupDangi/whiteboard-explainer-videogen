# Explain Canvas Lab V2 — Architecture

## 0. Purpose

This document is the architectural contract for upgrading Explain Canvas Lab from a
deterministic node/edge explainer into a high-quality, source-grounded visual teaching
compiler capable of Simi-class whiteboard explanations while remaining deterministic,
editable, fast, testable, and safe.

The target is not to imitate Simi's private implementation. We do not know Lamina Labs'
internal renderer, scene representation, model stack, asset system, or TTS stack.

What is publicly supported:
- Lamina describes Simi as "structured video generation".
- Simi accepts prompts/documents and produces whiteboard explainers.
- Lamina says the output is paced, drawn scene by scene, and narrated end to end.
- YC describes Simi as writing the script, drawing illustrations, animating them, and
  adding narration.
- The public product advertises approximately one minute of 1080p output in ~40 seconds.

Use Simi as a quality/performance benchmark, not as a source of private implementation claims.

Public references:
- https://www.laminalabs.ai/
- https://www.ycombinator.com/companies/lamina-labs
- Mayer / Fiorella multimedia learning principles:
  https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/
- VBench multi-dimensional evaluation:
  https://arxiv.org/abs/2311.17982

---

# 1. Product thesis

Explain Canvas Lab is not a generic AI video generator.

It is a:

> source-grounded teaching planner
> + visual mental-model selector
> + semantic storyboard compiler
> + trusted illustration/asset system
> + deterministic composition engine
> + speech-aligned action timeline
> + pure vector renderer
> + rigorous multimodal evaluation harness

The renderer should never be asked to "make something look educational" after the semantic
plan is already frozen into generic boxes.

The model decides:
- what must be taught
- what mental model will make it understandable
- what objects/relations/states matter
- what should stay on screen
- what should change
- which available assets/archetypes are appropriate
- what is spoken versus what is only shown

Deterministic code decides:
- exact geometry
- exact coordinates
- text wrapping
- collision handling
- connector routing
- z-order
- path lengths
- animation interpolation
- safe regions
- render time
- final SVG pixels
- browser/export parity

Invariant:

```text
same semantic scene + same timing + same seed
=
same SVG at the same time
```

No wall-clock-dependent animation.
No unseeded randomness.
No generated executable animation code.

---

# 2. Non-goals

Do not:
- rewrite the project into Manim
- move the runtime renderer to Python
- generate arbitrary JavaScript/TypeScript/React from the LLM
- let the model emit unrestricted SVG
- ask the model for pixel coordinates as the normal path
- create one autonomous agent per primitive
- treat every topic as a graph
- solve visual quality by adding more node shapes
- treat icons as a substitute for illustration
- use diffusion video for final teaching pixels
- optimize transport or TTS before the visual representation bottleneck is fixed
- use a VLM critic to compensate for an incapable scene schema
- hardcode a single provider/model into the architecture

Python may be used later for offline asset preprocessing or geometry tooling, but the
canonical production renderer remains TypeScript + deterministic SVG.

---

# 3. Current architectural mistakes to remove

## 3.1 Node/edge is too weak as the universal representation

V1 effectively reduces educational content to:

```text
nodes[]
edges[]
visualIntent:string
layout
kind
shape
emphasis
```

This is valid for some network diagrams.

It is invalid as the universal representation for:
- plants
- anatomy
- cross-sections
- physical systems
- chemical transformations
- data compression
- matrices/equations
- state machines
- before/after transformations
- causal processes
- multi-stage mechanisms
- persistent illustrations
- semantic subparts
- overlays and containment

V2 must treat semantic objects, relations, states and actions as first-class objects.

## 3.2 Visual Director currently arrives too late

The content planner currently creates the scene topology before the visual director can
decide the correct visual mental model.

The visual director must not merely decorate pre-existing nodes.

It must be allowed to choose:
- archetype
- object inventory
- hierarchy
- asset family
- relations
- persistent objects
- states
- visual actions
- continuity
- on-canvas text versus narration-only content

## 3.3 Narration freezes too early

TTS must not start simply because prose is valid.

Narration should become immutable only after:
- the semantic beats are valid
- the visual mental model is selected
- critical assets/archetypes are feasible
- the visual plan can actually teach the concept

Then TTS and final visual compilation may proceed concurrently.

## 3.4 Global no-overlap rules are wrong

Some overlap is semantically required:
- chloroplast inside leaf
- annotation leader touching target
- highlight behind text
- particles emerging from a source
- child objects inside a container
- overlays and badges

V2 requires semantic collision policies, not universal rectangle disjointness.

## 3.5 Illustrations cannot be "large nodes"

Hero illustration geometry must drive composition.

Wrong:

```text
grid slot
  -> put illustration in slot
  -> enlarge if room
```

Correct:

```text
place hero illustration
  -> use intrinsic bounds and semantic anchors
  -> place support objects around it
  -> route relations
  -> place labels last
```

## 3.6 Timing must be beat/action driven

A connector should not appear because both endpoint nodes happened to appear.

It should appear because the teacher is explaining the relationship.

Visual actions belong to semantic beats and spoken anchors.

---

# 4. Target pipeline

```text
SOURCE / PROMPT
      |
      v
SOURCE UNDERSTANDING + RETRIEVAL
      |
      v
GLOBAL TEACHING ARC
      |
      v
GLOBAL CONCEPT / VISUAL BIBLE
      |
      v
SEMANTIC STORYBOARD
      |
      v
VISUAL MENTAL-MODEL SELECTION
      |
      v
ASSET / TEMPLATE CANDIDATE RETRIEVAL
      |
      v
VISUAL FEASIBILITY CHECK
      |
      +---------------------------+
      |                           |
      v                           v
FINAL NARRATION              VISUAL DIRECTOR V2
      |                           |
      v                           v
TTS + WORD TIMING            VISUAL SCENEGRAPH V2
      |                           |
      +-------------+-------------+
                    |
                    v
          CONSTRAINT / COMPOSITION COMPILER
                    |
                    v
            SEMANTIC TIMELINE COMPILER
                    |
                    v
              COMPILED SCENE
                    |
                    v
              renderSVG(t)
                    |
          +---------+----------+
          |                    |
          v                    v
       browser               export
```

Progressive playback is preserved:
- scene 1 should become playable as early as practical
- later scenes should prepare while previous scenes play
- the system does not need the full video before playback starts

---

# 5. Teaching model

The first question is never:

> What shapes should I draw?

It is:

> What mental model must the learner form?

Every explanation must answer these fields before visual layout:

```ts
interface TeachingPlanV2 {
  lessonGoal: string;
  learnerAssumption: string;
  centralQuestion: string;

  requiredClaims: ClaimRequirement[];
  requiredMechanisms: MechanismRequirement[];

  conceptRegistry: ConceptIdentity[];
  scenes: SemanticScenePlan[];

  misconceptions?: Misconception[];
  evidenceRefs?: EvidenceRef[];
}
```

Each semantic scene:

```ts
interface SemanticScenePlan {
  id: string;
  teachingGoal: string;

  learnerShouldUnderstand: string;
  mentalModel: string;

  beats: SemanticBeat[];

  requiredConceptIds: string[];
  requiredRelations: SemanticRelationRequirement[];

  candidateArchetypes: VisualArchetype[];

  continuity: {
    keepFromPrevious?: string[];
    prepareForNext?: string[];
  };
}
```

Each beat must represent one meaningful teaching change:

```ts
interface SemanticBeat {
  id: string;
  purpose: string;

  narrationDraft: string;

  introduce?: string[];
  reinforce?: string[];
  transform?: StateChangeRequirement[];

  relationFocus?: string[];
  evidenceRefs?: string[];

  intentionalPause?: boolean;
}
```

Rule:
- one beat may involve several drawable paths
- one beat should usually introduce only one primary conceptual change

---

# 6. Concept identity / visual bible

A concept is not the same as an asset.

Example:

```text
concept: plant
asset: biology.plant.sapling.v2
```

Concept identity survives scene changes even if asset representation changes.

```ts
interface ConceptIdentity {
  id: string;
  canonicalName: string;
  aliases: string[];

  semanticType:
    | "entity"
    | "material"
    | "process"
    | "state"
    | "quantity"
    | "equation"
    | "location"
    | "role";

  visualFamily?: string;
  preferredColorRole?: string;
}
```

The visual bible controls consistency:
- same concept identity across scenes
- same role/color family unless meaning changes
- same labels/terminology
- persistent object IDs when the same object continues across beats/scenes

---

# 7. Visual archetypes

Do not force arbitrary content into graph layouts.

Initial archetype vocabulary:

```ts
type VisualArchetype =
  | "simple_explanation"
  | "numbered_steps"
  | "flow"
  | "cause_effect"
  | "branch"
  | "convergence"
  | "comparison"
  | "hierarchy"
  | "timeline"
  | "cycle"
  | "structural_diagram"
  | "cross_section"
  | "spatial_process"
  | "transformation"
  | "state_machine"
  | "equation_walkthrough"
  | "matrix_operation"
  | "chart"
  | "trajectory";
```

Archetypes are semantic.

They are not pixel templates.

Example:

```text
photosynthesis scene 1
mental model: plant as a central food-making organism receiving three inputs
archetype: structural_diagram + convergence
```

The compiler may combine archetype behaviors.

---

# 8. Visual SceneGraph V2

```ts
interface VisualSceneV2 {
  id: string;
  title?: string;

  teachingGoal: string;
  mentalModel: string;
  archetype: VisualArchetype;

  objects: VisualObject[];
  relations: VisualRelation[];
  beats: VisualBeat[];

  continuity?: SceneContinuity;
}
```

Object:

```ts
interface VisualObject {
  id: string;
  conceptId?: string;

  role:
    | "hero"
    | "support"
    | "structure"
    | "material"
    | "data"
    | "equation"
    | "annotation"
    | "label"
    | "decorative_support";

  assetRef?: string;
  primitiveRef?: string;

  parentId?: string;
  children?: string[];

  state?: string;
  allowedStates?: string[];

  semanticAnchors?: string[];

  importance: "primary" | "secondary" | "tertiary";

  preferredZone?: LayoutZone;
}
```

Relations:

```ts
interface VisualRelation {
  id: string;

  from: ObjectAnchorRef;
  to: ObjectAnchorRef;

  relationType:
    | "causes"
    | "flows_to"
    | "contains"
    | "part_of"
    | "transforms_to"
    | "depends_on"
    | "labels"
    | "compares_with"
    | "activates"
    | "inhibits"
    | "moves_toward";

  visualForm?: "arrow" | "flow" | "leader" | "brace" | "containment" | "none";
}
```

Visual beat:

```ts
interface VisualBeat {
  id: string;
  narration: string;

  actions: VisualAction[];

  spokenAnchors?: SpokenAnchor[];
}
```

---

# 9. Semantic action grammar

The renderer should not be driven by "node entrances".

Use semantic actions:

```ts
type MotionKind =
  | "draw"
  | "reveal"
  | "trace"
  | "flow"
  | "move"
  | "fill"
  | "highlight"
  | "pulse"
  | "split"
  | "merge"
  | "morph"
  | "replace"
  | "fade";
```

Meaning:

```text
draw       construct visual geometry
reveal     show label/support content
trace      explain a path/relation
flow       show material/data movement
move       relocate a persistent object
fill       accumulation/activation/quantity
highlight  direct attention
pulse      short emphasis
split      decomposition
merge      combination
morph      continuous transformation
replace    discrete state change
fade       de-emphasize/remove support
```

Generic fade is not the default.

---

# 10. Asset system

The asset engine is a core subsystem, not a folder of icons.

Asset tiers:

```text
Tier 0  renderer primitives
Tier 1  trusted icons
Tier 2  trusted reusable illustrations
Tier 3  domain templates / diagrams
Tier 4  composed assets
Tier 5  constrained SVG synthesis fallback
```

Do not use arbitrary web SVG in the runtime path unless sanitized/licensed and added to the registry.

Asset definition:

```ts
interface AssetDefinition {
  id: string;

  type:
    | "icon"
    | "illustration"
    | "diagram_template"
    | "composed"
    | "generated_validated";

  semanticTypes: string[];
  aliases: string[];
  tags: string[];
  archetypes: VisualArchetype[];

  viewBox: string;

  parts: AssetPart[];
  anchors: Record<string, AssetAnchor>;

  states?: Record<string, AssetState>;
  variants?: Record<string, string>;

  styleFamily: string;

  source?: string;
  license?: string;
}
```

Asset part:

```ts
interface AssetPart {
  id: string;
  primitive: SvgPrimitive;

  semanticRole?: string;

  order: number;
  durationWeight?: number;
  fillAfter?: boolean;

  parentPartId?: string;
}
```

Semantic anchors are mandatory for complex teaching assets.

Plant example:

```text
plant.roots
plant.stem
plant.leaf.top
plant.leaf.left
plant.leaf.right
plant.canopy
```

A relation must be able to target:

```text
water -> plant.roots
```

not merely:

```text
water -> plant bounding-box center
```

---

# 11. Asset retrieval

Asset retrieval happens before final direction when visual feasibility matters.

Input:

```text
concept
semantic role
mental model
archetype
style family
```

Search:
- exact alias
- tag match
- semantic type
- embedding/text retrieval if needed
- archetype compatibility

Return 5–12 candidates.

The visual director may receive:
- candidate metadata
- optionally a generated contact sheet

The director outputs asset IDs only.

It does not invent file paths or arbitrary SVG.

If no suitable asset exists:

```text
trusted icon
-> trusted illustration
-> diagram template
-> composed primitives
-> constrained SVG synthesis
-> semantic text/shape fallback
```

A generic rectangle is the final fallback, not the normal representation.

---

# 12. Constrained SVG synthesis

Use only as a bounded fallback for missing assets.

The LLM may emit a declarative SVG AST under a strict schema.

Disallow:
- scripts
- event handlers
- foreignObject
- external URLs
- HTML
- arbitrary CSS
- embedded fonts
- runtime SVG animation
- huge/unbounded path complexity

Generated assets are static geometry only.

The renderer owns animation.

Every synthesized asset must:
- validate
- normalize viewBox
- expose bounds
- pass path complexity limits
- use design tokens
- optionally receive semantic anchor annotations
- be cached by content hash

---

# 13. Composition compiler

The compiler must be a composition engine, not only a graph-layout engine.

Inputs:
- archetype
- hero/support roles
- object intrinsic bounds
- semantic anchors
- relations
- layout zones
- safe regions
- text metrics
- continuity state

Responsibilities:
- hero-first placement
- zone assignment
- scale
- text measurement
- wrapping
- semantic collision handling
- containment
- connector routing
- annotation placement
- z-order
- visual hierarchy
- occupancy
- whitespace budget
- export-safe coordinates

The model should express constraints such as:

```text
plant = hero / center
sun = upper-left of plant
water = lower-left of plant
CO2 = upper-right of plant
sun connects to plant.leaf.top
water connects to plant.roots
```

The compiler chooses exact coordinates.

---

# 14. Semantic collision policies

Replace universal disjointness.

```ts
type CollisionPolicy =
  | "forbid"
  | "allow"
  | "contain"
  | "overlay"
  | "touch";
```

Examples:

```text
label / label            forbid
unrelated hero / hero    forbid
highlight / target       overlay
child / container        contain
leader / target          touch
particle / source        allow
badge / parent           overlay
```

Illegal overlap is a compiler error.
Intentional overlap is expected.

---

# 15. Illustration drawing engine

Complex illustrations must be drawable part-by-part.

For every drawable path:
- know exact path length
- allocate duration using path length and semantic importance
- draw outline before fill where appropriate
- preserve deterministic ordering
- expose active point/tangent for optional cursor

Recommended TypeScript path geometry:
- svg-path-properties or equivalent deterministic library

Rendering concept:

```text
stroke-dasharray  = totalPathLength
stroke-dashoffset = totalPathLength * (1 - progress)
```

Pencil/cursor:
- optional
- follows the active path geometry
- does not follow the asset bounding rectangle

The cursor is polish, not a teaching primitive.

---

# 16. Timeline compiler

TTS word timing is the final time authority.

Each action belongs to:
- a beat
- one or more target objects
- optional spoken anchor

Action timing preference:

```text
meaningful reveal:
typically slightly before or around the spoken anchor

preferred:
roughly -300ms to +300ms around the anchor

warning:
large positive lag unless semantically intentional
```

Persistent context can appear earlier.

Metrics:
- signed anchor lag
- max narrated no-change interval
- visual beats/minute
- action coverage
- continuity breaks

Do not time relations from endpoint node start times.

---

# 17. Narration policy

Narration is not an independent content generator.

The planner creates:
1. teaching goal
2. semantic beats
3. mental model
4. visual feasibility
5. final narration

Final narration should:
- be source grounded
- be concise
- avoid reading every label aloud
- avoid duplicating all board text
- make explicit causal/mechanistic relationships
- align one meaningful explanation change with each beat

Board text:
- short labels
- quantities
- equation terms
- structural anchors
- short takeaways

Captions/subtitles:
- accessibility/player layer
- may mirror narration
- should not be treated as board teaching text

---

# 18. Multimedia-learning design principles

Use these as design principles, not brittle universal numeric gates.

## Coherence
Remove visuals/text that do not support the immediate teaching objective.

## Signaling
Use highlights, arrows, motion, emphasis and spatial grouping to direct attention.

## Spatial contiguity
Place labels near the visual components they describe.

## Temporal contiguity
Coordinate narration and corresponding visual change in the same temporal window.

## Redundancy
Avoid filling the board with a verbatim transcript.
Keep accessibility captions separate from the teaching canvas.

## Segmenting
Break complex mechanisms into learner-controlled or naturally paced semantic beats.

---

# 19. Style system

Visual consistency comes from tokens and asset families, not forcing random shape diversity.

Design tokens must define:
- base canvas
- stroke widths
- corner radii
- typography roles
- semantic color roles
- outline/fill behavior
- annotation style
- arrow style
- highlight style
- easing
- spacing
- title/footer/caption regions

A scene may correctly use repeated similar shapes.
Do not add circles just to make a scene "diverse".

The target style should feel:
- intentional
- coherent
- high contrast
- easy to scan
- illustrated when the concept benefits from illustration
- diagrammatic when the concept benefits from structure
- sparse when sparse is pedagogically correct

---

# 20. Performance architecture

Target metrics:
- first playable scene: <8s median initially
- excellent target: 5–6s
- one-minute full prep: 40–60s initial target
- later scene preparation < previous scene playback duration
- 1080p30 production output

Concurrency:
- global outline: sequential
- concept registry: sequential
- scene storyboards: bounded concurrent
- asset retrieval: local/fast
- narration finalization: per scene/chapter
- TTS and detailed direction: parallel after visual feasibility
- compiler: local
- critic: bounded
- export: worker queue

Caching by content hash:
- source extraction
- retrieval results
- outline
- concept registry
- storyboard
- asset search
- synthesized validated assets
- TTS
- compiled scene
- preview/contact-sheet frames

---

# 21. First benchmark: Simi-style plant scene

Do not begin with arbitrary documents.

Acceptance case:

```text
Prompt:
Explain how plants make food to a middle-school student.
```

Scene target:
- central illustrated plant
- visible roots and leaves
- sunlight
- water
- CO2
- semantic relations to correct plant subparts
- progressive path drawing
- short labels
- no generic concept boxes
- no arbitrary node-edge graph
- coherent accumulation over beats

The first engineering question is:

> Can a manually authored V2 SceneGraph render a scene of this quality?

If no:
- asset/compiler/renderer problem

If yes, then ask:

> Can the planner generate that semantic SceneGraph automatically?

If no:
- teaching/storyboard/director problem

Do not mix these two failure classes.

---

# 22. Definition of done

V2 is not done because JSON validates or tests pass.

It is ready to become the default only when:
- deterministic compiler gates pass
- benchmark semantic coverage passes
- no malformed or unsafe assets
- no clipping/invalid geometry
- no critical source-grounding failures
- critical relations are visually represented
- static narration intervals are within target unless intentional
- browser/export parity is preserved
- human pairwise evaluation prefers V2 over V1 by a meaningful margin
- plant + structural + transformation + math + flow benchmarks all demonstrate
  representation-appropriate visuals
- latency remains compatible with progressive playback

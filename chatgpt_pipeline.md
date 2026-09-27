# ChatGPT Visual Pipeline Hypothesis — Experimental Specification

## Purpose

This document defines **one falsifiable visual-generation hypothesis** to test against the alternative Claude pipeline in `claude.md`.

The goal is **not** to prove this pipeline correct by implementation. The goal is to build the smallest vertical slice that can prove or disprove the architectural assumptions with the same frozen lessons, assets, audio, references, and evaluation harness used for the Claude hypothesis.

The central hypothesis is:

> High-quality Simi-like teaching videos require visual reasoning to begin **before final narration is realized**, and the canonical visual representation should be an open, hierarchical `VisualProgram` rather than a closed template scene. Assets, procedural diagrams, formulas, source figures, and sketch styling are representation backends; they are not the core scene model.

RAG is explicitly out of scope for this experiment.

---

# 1. Core hypothesis

The proposed pipeline is:

```text
SOURCE / FROZEN INPUT
        │
        ▼
Teaching Architecture
        │
        ▼
TeachingBeat[]
        │
        ▼
GLOBAL VISUAL STORYBOARD
        │
        ├───────────────┐
        ▼               ▼
Narration Plan      VisualStoryIntent[]
        │               │
        └───────┬───────┘
                ▼
       Narration Realization
                │
                ▼
               TTS
                │
                ▼
          Word Alignment
                │
                ▼
         VisualProgram[]
                │
                ▼
     Representation Router
   ┌────────┬────────┬────────┬─────────┐
   ▼        ▼        ▼        ▼         ▼
 Asset   Formula  Procedural  Source   Compound
                              Figure
   └────────┴────────┬────────┴─────────┘
                    ▼
                LayoutPlan
                    │
                    ▼
                 DrawPlan
                    │
                    ▼
                  SceneIR
                    │
                    ▼
             BoardState(t)
                    │
                    ▼
                 Renderer
                    │
                    ▼
                  Video
```

The important distinction is:

```text
TeachingBeat → visual reasoning → narration + visual realization
```

instead of:

```text
final narration → find visuals that accompany it
```

---

# 2. What is being tested

This pipeline makes six testable claims.

1. **Visual planning before final narration improves teaching clarity.**
2. **A hierarchical VisualProgram generalizes better than a fixed set of scene templates.**
3. **Representation routing is more important than asset coverage.** A concept may be best shown as an asset, formula, chart, procedural schematic, source figure, or compound visual.
4. **Progressive DrawPlans improve the whiteboard/tutor feel**, but drawing style is secondary to visual reasoning.
5. **Rough.js should be selective**, primarily for procedural geometry, not blindly applied to every rich illustration.
6. **Source-specific visuals are first-class**, so novel documents do not need a pre-existing icon for every important concept.

---

# 3. Experimental scope

## In scope

- Frozen TeachingBeats / lesson inputs
- Existing narration or regenerated narration from frozen semantic beats
- Iconify
- Streamline
- MathJax 4
- Rough.js
- svg2roughjs as a spike only
- perfect-freehand
- svg-path-properties
- ELK / Dagre comparison
- source figures supplied directly by fixture
- current TTS / alignment
- SVG renderer
- resvg export benchmark
- deterministic cache
- pairwise evaluation

## Out of scope

- RAG
- new embeddings/index architecture
- new document chunking pipeline
- new vector database
- image-generation models
- arbitrary LLM-generated SVG
- Manim
- Remotion migration
- production queue / Redis
- full production refactor
- topic-specific hardcoded visuals

---

# 4. Test mode input

For fair A/B testing, use the same frozen input contract as the Claude hypothesis.

```ts
interface VisualPipelineTestInput {
  lessonId: string;
  title: string;
  targetDurationMs: number;

  teachingBeats: TeachingBeat[];

  sourceContext?: {
    text?: string;
    equations?: string[];
    figures?: SourceFigure[];
  };

  narrationSeed?: string;
  audio?: {
    wavPath: string;
    wordTimings?: WordTiming[];
  };
}
```

No retrieval is performed. `sourceContext` is directly supplied by fixtures.

---

# 5. Stage A — TeachingBeat → Global Visual Storyboard

The first new semantic artifact is not a scene.

```ts
interface GlobalVisualStoryboard {
  schemaVersion: 'global-visual-storyboard/v1';
  lessonId: string;
  visualArc: VisualArcBeat[];
  sceneBoundaries: SceneBoundary[];
  recurringMotifs: string[];
  persistentEntities: string[];
}
```

Each `VisualArcBeat` answers:

- What should the learner understand now?
- What changes on the board?
- What should remain from the previous state?
- Does this require a reset, zoom, transform, comparison, derivation, or simulation?

This stage deliberately happens **before final narration wording is frozen**.

---

# 6. Stage B — VisualStoryIntent

```ts
interface VisualStoryIntent {
  schemaVersion: 'visual-story-intent/v1';

  id: string;
  teachingBeatId: string;

  proposition: string;
  learnerInference: string;

  operation:
    | 'introduce'
    | 'compare'
    | 'decompose'
    | 'transform'
    | 'trace'
    | 'aggregate'
    | 'derive'
    | 'zoom'
    | 'simulate'
    | 'counterexample'
    | 'cause-effect'
    | 'route'
    | 'summarize';

  focalConcepts: string[];
  priorState: string[];
  resultingState: string[];

  persistence:
    | 'continue-board'
    | 'partial-reset'
    | 'new-board';

  representationHints?: RepresentationHint[];
}
```

Example:

```json
{
  "proposition": "A query compares against several keys.",
  "learnerInference": "One query evaluates multiple candidate keys before weighting values.",
  "operation": "compare",
  "focalConcepts": ["query", "keys"],
  "priorState": ["query"],
  "resultingState": ["query", "key-1", "key-2", "key-3", "connections"],
  "persistence": "continue-board"
}
```

This is the main semantic artifact to evaluate against Claude's `SceneSpec` planning approach.

---

# 7. Stage C — Narration realization

Narration is realized **after** the storyboard and VisualStoryIntents exist.

The narration writer receives:

- TeachingBeat
- learnerInference
- planned visual operation
- source evidence
- duration budget

The writer must not describe implementation instructions.

Output:

```ts
interface NarrationBeat {
  teachingBeatId: string;
  spokenText: string;
  visualAnchorPhrases: Array<{
    id: string;
    phrase: string;
  }>;
}
```

Then TTS + alignment creates exact word anchors.

---

# 8. Stage D — VisualProgram

`VisualProgram` is the canonical scene representation.

It is **not template-first**.

```ts
interface VisualProgram {
  schemaVersion: 'visual-program/v1';
  sceneId: string;
  purpose: string;

  groups: VisualGroup[];
  elements: VisualElement[];
  relations: VisualRelation[];
  actions: VisualAction[];

  layoutHints?: LayoutHint[];
}
```

## VisualGroup

```ts
interface VisualGroup {
  id: string;
  role?: 'hero' | 'primary' | 'secondary' | 'annotation';
  layout:
    | 'row'
    | 'column'
    | 'radial'
    | 'layered'
    | 'grid'
    | 'overlay'
    | 'free-constraint';
  children: string[];
}
```

Groups may nest.

## VisualElement

```ts
type VisualElement =
  | AssetElement
  | PrimitiveElement
  | FormulaElement
  | ChartElement
  | TokenStripElement
  | MatrixElement
  | GraphElement
  | CompoundElement
  | SourceFigureElement
  | TextElement;
```

The LLM is never allowed to emit raw SVG path data or pixel coordinates.

---

# 9. Stage E — Representation Router

The resolver answers:

> What representation teaches this concept best?

not:

> Which icon best matches this label?

```ts
type RepresentationKind =
  | 'asset'
  | 'rich-illustration'
  | 'procedural'
  | 'formula'
  | 'chart'
  | 'source-figure'
  | 'compound'
  | 'text';
```

Initial routing policy:

| Concept class | Preferred representation |
|---|---|
| Small concrete object | Iconify → Streamline icon |
| Person / hero / rich object | Streamline illustration |
| Formula | Math renderer |
| Process / relationship | Procedural |
| Quantity / trend | Meter / chart / plot |
| Abstract concept | Metaphor → compound → procedural |
| Novel architecture | Graph / source figure |
| Proprietary figure | Source figure + annotation |

Wrong asset selection is worse than using a correct procedural representation.

---

# 10. Stage F — Compound representations

Compound visual synthesis expands coverage without image generation.

Examples:

```text
secure database = database + lock
failed authentication = person + lock + X
memory bottleneck = memory stack + narrow passage
document approval = document + checkmark
AI hospital = hospital + chip
```

```ts
interface CompoundRepresentation {
  base: RepresentationRef;
  overlays: RepresentationRef[];
  arrangement:
    | 'badge'
    | 'side-by-side'
    | 'inside'
    | 'above'
    | 'overlay';
}
```

---

# 11. Stage G — Procedural visual vocabulary

P0 primitives:

```text
box
circle
pill
line
arrow
brace
bracket
axis
curve
text

tokenStrip
matrix
vector
meter
threshold
pipeline
fanOut
fanIn
weightedSum
plot
network
hierarchy
cycle
```

P1 only after P0 is proven:

```text
fieldLines
reactionCurve
neuralLayer
stateMachine
decisionTree
timeline
feedbackLoop
```

No topic-specific functions such as `photosynthesisDiagram()` or `attentionDiagram()`.

---

# 12. Stage H — Math

Use MathJax 4 behind an adapter.

```ts
interface MathRenderer {
  render(latex: string): Promise<MathVisual>;
}
```

`MathVisual` must expose SVG and logical term groups where possible so the formula can be revealed by meaning rather than as a single bitmap.

Initial animation:

```text
whole formula SVG
→ reveal logical term groups
→ highlight relevant term
```

Do not attempt simulated handwritten glyph-by-glyph math in v1.

---

# 13. Stage I — Source visuals

Novel uploaded documents are a first-class use case.

```ts
interface SourceFigureElement {
  figureId: string;
  crop?: Rect;
  focusRegion?: Rect;
  treatment?:
    | 'native'
    | 'desaturate'
    | 'annotate';
}
```

In test mode, the fixture directly supplies the selected source figure. No RAG is needed.

The experiment must include one unseen source whose central mechanism cannot be represented well by ordinary stock icons.

---

# 14. Stage J — Layout

The model specifies semantic topology, not coordinates.

Three layout engines are available:

```text
1. custom constraints
2. reusable grammar layout
3. ELK for complex architecture
```

Dagre is a benchmark comparator only.

`LayoutRouter` rule:

```text
small/simple composition → custom constraints
known topology → grammar strategy
complex nested graph → ELK
```

Useful grammar hints:

```text
fan-out
fan-in
pipeline
cause-effect
threshold
comparison
cycle
hierarchy
aggregation
weighted-blend
input-transform-output
zoom-inside
```

These are strategies, not the canonical scene language.

---

# 15. Stage K — Freeform composition

No universal card container.

Assets and procedural objects are placed directly on the board.

Semantic sizing:

```text
hero        1.6–2.0x
primary     1.2–1.5x
secondary   0.8–1.0x
annotation  0.5–0.7x
```

Boxes are used only when they carry semantic meaning, such as modules, stages, tokens, databases, or containers.

---

# 16. Stage L — DrawPlan

`DrawPlan` is separate from `VisualProgram`.

```ts
interface DrawPlan {
  schemaVersion: 'draw-plan/v1';
  elementId: string;
  phases: DrawPhase[];
}

type DrawPhase =
  | StrokeReveal
  | MaskReveal
  | FillReveal
  | FreehandStroke
  | FadeReveal;
```

Drawing policy:

| Representation | Draw treatment |
|---|---|
| Rough primitive | Stroke reveal |
| Simple icon | Native or selective svg2rough + reveal |
| Rich illustration | Native SVG + mask/group reveal |
| Formula | Term-by-term reveal |
| Plot | Procedural stroke/grow |
| Source figure | Fade + highlight + annotation |
| Teacher annotation | perfect-freehand |

---

# 17. Stage M — Sketch styling

Rough.js is selective.

Use it initially for:

```text
arrows
boxes
axes
curves
circles
brackets
highlights
procedural diagrams
```

Use a deterministic seed:

```text
seed = hash(sceneId + elementId)
```

Generate rough geometry once, then animate the precomputed geometry.

Do not regenerate random rough geometry every frame.

`svg2roughjs` remains an experimental adapter. It must not become the default until it wins a benchmark on both simple Iconify assets and rich Streamline assets.

---

# 18. Stage N — Marker / drawing illusion

Use `svg-path-properties` to derive:

- total length
- point at length
- tangent at length

The marker follows the semantic path skeleton while the final ink is revealed behind it.

`perfect-freehand` is reserved for teacher-like annotations:

```text
underline
circle
checkmark
cross
scribble emphasis
freehand arrow
```

---

# 19. Stage O — Timeline

Audio remains the master clock.

```text
word timing
→ narration anchor
→ VisualAction
→ DrawPlan phase
```

Unlike a fixed global idle rule, deliberate holds are allowed:

```ts
interface VisualAction {
  anchor: string;
  action: string;
  holdForInspection?: boolean;
}
```

A static interval is only a failure when it is unexplained by teaching intent.

---

# 20. Stage P — Persistent board state

```text
state(t + Δ) = applyActions(state(t), actionsDuringΔ)
```

Support:

```text
continue-board
partial-reset
new-board
```

The scene is a persistent evolving visual state, not a sequence of disconnected slides.

---

# 21. Renderer

Canonical representation remains SVG.

Benchmark:

```text
existing rasterizer
vs
@resvg/resvg-js
```

Frame rates:

```text
12
15
24
30 fps
```

Resolutions:

```text
1280x720
1920x1080
```

Choose the lowest perceptually acceptable frame rate after human review.

In-app playback should eventually use live SVG/Canvas animation; MP4 export is a separate concern.

---

# 22. Stage artifacts

Every run must persist:

```text
runs/<runId>/
  input.json
  global-storyboard.json
  visual-story-intents.json
  narration.json
  aligned-audio.json
  visual-program.json
  representation-plan.json
  resolved-assets.json
  layout-plan.json
  draw-plan.json
  timeline.json
  final-scene.svg
  video.mp4
  contact-sheet.png
  metrics.json
```

Every artifact has:

```text
schemaVersion
stageVersion
modelId where applicable
promptVersion where applicable
content hash
```

---

# 23. Cache

Cache each stage independently:

```text
hash(
  input artifact
  + schemaVersion
  + stageVersion
  + promptVersion
  + modelId
)
```

Changing Rough.js parameters must not rerun the LLM or asset lookup.

Changing the story prompt must not invalidate downloaded SVGs.

---

# 24. Golden cases

Use exactly the same cases for both hypotheses.

## G1 — Transformer Attention

Stresses:

- token strips
- Q/K/V
- one-to-many relation
- scores
- softmax
- weighted combination

## G2 — Gradient Descent

Stresses:

- formula
- plot
- moving point
- gradient direction
- mathematical derivation

## G3 — Photosynthesis

Stresses:

- rich illustrations
- zoom
- mechanism
- input/output flow

## G4 — Electromagnetic Induction

Stresses:

- scientific procedural geometry
- field lines
- direction
- movement

## G5 — Unseen source document

Stresses:

- novel architecture
- source figure
- unknown terminology
- no topic-specific code

Initial clips are 20–30 seconds, not full lessons.

---

# 25. Experimental variants

Render the same difficult clip as:

```text
A CURRENT
current cards + current resolver + current fade

B FREEFORM
same semantic plan/assets, no universal cards

C ROUGH
freeform + Rough.js procedural geometry

D DRAW
freeform + native/rough representations + DrawPlan + marker

E STORY
VisualStoryIntent + RepresentationRouter + DrawPlan

F FULL
story + formula/procedural/source + adaptive layout + DrawPlan
```

This lets us attribute gains instead of implementing everything and guessing why it improved.

---

# 26. Metrics

## Story

```text
learnerInferenceRepresented
visualClaimCompleteness
mechanismVsList
```

## Representation

```text
representationChoiceCorrect
genericFallbackRate
semanticMismatchRate
sourceFigureUsefulness
```

## Layout

```text
collisionCount
connectorCrossings
textOverflow
focalScale
inkCoverage
whitespaceBalance
```

## Progression

```text
meaningfulMutationsPerMinute
maxUnexplainedStaticMs
boardResetCount
carryOverConsistency
```

## Drawing

```text
visualJitter
drawDistortion
markerPathCoherence
roughPathInflation
```

## Performance

```text
storyMs
programMs
resolveMs
layoutMs
drawPlanMs
renderMs
encodeMs
```

---

# 27. Evaluation questions

Primary pairwise questions:

1. Which visual better explains the mechanism?
2. Which makes the causal/relational structure easier to infer?
3. Which develops the board more logically?
4. Which better represents abstract or novel concepts?
5. Which is more visually coherent?
6. Which uses drawing progression purposefully rather than decoratively?
7. Which generalizes better to the unseen source?

Simi resemblance is secondary, not the primary product metric.

---

# 28. Promotion criteria

Do not merge this architecture into production unless:

- at least 4/5 golden cases are pairwise preferred to legacy for mechanism clarity;
- unseen-document case works without topic-specific code;
- repeated render is deterministic;
- no serious clipping/layout regressions;
- generic fallback is lower than legacy;
- runtime is operationally acceptable;
- visual-story artifacts are inspectable and explain failures cleanly.

---

# 29. What would falsify this hypothesis?

The hypothesis should be considered weakened if:

- pre-narration visual planning gives no measurable improvement;
- the open VisualProgram produces more failures than a fixed template system;
- adaptive representation routing introduces instability without clarity gains;
- source figures/procedural forms are rarely useful in unseen documents;
- DrawPlan complexity adds latency but no meaningful preference gain;
- a simpler template-first SceneSpec consistently beats it on clarity, speed, and generalization.

If those occur, prefer the Claude architecture or a hybrid of the two.

---

# 30. Minimal implementation order

```text
1. Baseline freeze
2. Freeform renderer
3. Rough.js primitive adapter
4. DrawPlan + marker reveal
5. MathJax formula representation
6. RepresentationRouter
7. VisualStoryIntent
8. VisualProgram
9. Constraint / grammar / ELK LayoutRouter
10. SourceFigure support
11. Five-case benchmark
12. 1-minute validation only if short clips win
13. 5-minute continuity only if 1-minute wins
```

RAG is added only later at the source-understanding layer and must not require changes to the visual pipeline contracts.

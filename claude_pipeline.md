# Claude Pipeline Hypothesis — Experimental Specification

## Purpose

This document captures the **Claude architecture hypothesis** from the supplied audit pack as a testable implementation specification.

It must be evaluated against `chatgpt_pipeline.md` using the same frozen lessons, source fixtures, asset access, audio, Simi references, and evaluation harness.

The central hypothesis is:

> A staged deterministic pipeline can reach Simi-like quality if final narration is scripted first, word-aligned audio becomes the master clock, a strong Scene Planner maps each narrated scene into a constrained template-based Scene DSL, an asset-resolution ladder grounds objects, and deterministic layout/timeline/render stages execute the plan.

This experiment should remain faithful to that hypothesis rather than silently adopting ChatGPT's pre-narration visual-story architecture.

RAG is not required for the visual comparison. Frozen source fixtures may be used.

---

# 1. Pipeline overview

```text
[PDF / DOCX / PPTX / MD / prompt]
          │
S1  INGEST ───────────────► SourceDoc
          │
S2  UNDERSTAND ───────────► ConceptGraph
          │
S3  TEACHING PLAN ────────► TeachingPlan
          │
S4  SCRIPT ───────────────► NarrationScript
          │
S5  VOICE + ALIGN ────────► AlignedAudio        ◄── master clock
          │
S6  SCENE PLANNER ────────► SceneSpec[]
          │
S7  RESOLVE ──────────────► ResolvedScene[]
          │
S8  LAYOUT ───────────────► LaidOutScene[]
          │
S9  TIMELINE COMPILE ─────► Timeline
          │
S10 RENDER ───────────────► frames / live player
          │
S11 ENCODE ───────────────► MP4 + captions
          │
S12 QA GATES ─────────────► pass / fail + report
```

Every stage emits a typed, content-addressed artifact.

---

# 2. Experimental mode

For fair testing against ChatGPT's hypothesis, the full ingestion pipeline may be bypassed.

Use frozen inputs corresponding to:

```text
SourceDoc
ConceptGraph
TeachingPlan
NarrationScript
```

or generate these once and freeze them.

The critical comparison begins at:

```text
NarrationScript
→ Voice + alignment
→ Scene Planner
→ SceneSpec
→ Resolve
→ Layout
→ Timeline
→ Render
```

The Claude hypothesis must preserve this ordering.

---

# 3. Stage artifacts

## S1 — SourceDoc

```ts
type SourceDoc = {
  id: string;
  title: string;
  lang: string;
  blocks: Array<
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'para'; text: string }
    | { kind: 'equation'; latex: string; context?: string }
    | { kind: 'table'; rows: string[][] }
    | { kind: 'figure'; caption?: string; imageRef?: string }
    | { kind: 'code'; lang?: string; text: string }
  >;
};
```

## S2 — ConceptGraph

```ts
type ConceptGraph = {
  concepts: Array<{
    id: string;
    label: string;
    kind: 'entity'|'process'|'quantity'|'formula'|'event'|'role'|'rule';
    definition: string;
    latex?: string;
  }>;

  relations: Array<{
    from: string;
    to: string;
    type:
      | 'causes'
      | 'feeds'
      | 'contains'
      | 'compares'
      | 'transforms'
      | 'requires'
      | 'produces'
      | 'opposes';
  }>;

  prerequisites: Array<{
    concept: string;
    needs: string;
  }>;
};
```

## S3 — TeachingPlan

```ts
type TeachingPlan = {
  targetDurationSec: number;

  intro: {
    sourceTitle: string;
    sections: string[];
  };

  sections: Array<{
    id: string;
    title: string;
    goal: string;
    conceptIds: string[];
    budgetSec: number;
  }>;

  recap: {
    keyPoints: string[];
  };
};
```

---

# 4. Stage S4 — Script with explicit visual mentions

Claude's architecture binds visuals to speech through script markers.

```ts
type NarrationScript = {
  scenes: Array<{
    sceneId: string;
    sectionId: string;
    text: string;
  }>;
};
```

Narration text contains markers such as:

```text
[[q|the query]]
[[k1|the first key]]
[[softmax|softmax]]
```

Markers are stripped before TTS but their character/word offsets are preserved.

This is the contract connecting S4, S5, and S6.

---

# 5. Stage S5 — Voice + alignment

```ts
type AlignedAudio = {
  wavPath: string;
  durationMs: number;

  words: Array<{
    w: string;
    startMs: number;
    endMs: number;
  }>;

  mentions: Array<{
    sceneId: string;
    mentionId: string;
    startMs: number;
    endMs: number;
  }>;
};
```

Audio is the master clock.

Use current TTS. If it lacks word timestamps, use forced alignment.
Validate every measured word interval before resolving mentions. Empty, non-finite, out-of-range, non-positive, or out-of-order intervals are hard S5 failures. If any scene has a hard S5 alignment failure, skip paid S6 planning for the generated lesson; emit only a clearly marked diagnostic fallback with a hard failure. This saves planner calls without turning an incomplete-clock run into a publishable result.

---

# 6. Stage S6 — Scene Planner

The Scene Planner is the strongest-model stage.

It receives:

1. scene narration with mentions;
2. scene concept subgraph;
3. top-k catalog candidates per object concept;
4. available templates and slot definitions;
5. few-shot examples;
6. hard output rules.

It emits a constrained Scene DSL.

This hypothesis assumes **final narration exists before scene planning**.

### Demonstration boundary and E5 prompt experiments

**Current state (2026-09-24):** new generated lessons default to zero-shot. The five old Attention/math demonstrations have been removed from the runtime prompt and E5 choices at the user's direction; their old rendered outputs must not be used as planner-quality evidence. Historical fixtures remain frozen for traceability only. A separate versioned cross-domain exemplar bank supports optional `text`, `mechanism`, and `diverse` retrieval arms. Bank v2 records per-example provenance and independent factuality, visual, license, leakage, and human review states; approval is rejected unless every state passes with reviewer and timestamp. Every current entry remains experimental, not human-approved, and does not establish visual quality. S6 records the exact prompt, context hash, example IDs/order/scores and versions; a fail-closed lexical guard rejects copied visible phrases and numeric values unless the target's own evidence supports them. Paraphrase-level leakage still requires human review.
The lesson runner also exposes `--example-order=ranked|reverse` for E5 order-sensitivity checks; the selected order affects context and cache/run identity. This is experiment plumbing only, not evidence that either order or retrieval improves lesson quality.
For controlled pairs, use separate `--out` directories with the same `--stage-cache` directory so content-addressed S1–S5 source, plan, script, and audio artifacts are reused while S6 treatment keys differ. Manifests record the prompt arm/order/model and audio hash; the E5 pair gate verifies same source, narration, audio, voice, render, and content model. No pair has yet passed the human timed-video review.

E5 remains unmeasured. Once fresh generated runs can be produced, compare zero-shot and the optional retrieval arms on held-out sources, matching narration, voice, duration, catalog, renderer, judge protocol, and model. Judge finished timed videos and successful-video cost. Frozen source documents may be reused as inputs, but pre-existing fixture renders and hand-authored SceneSpecs are not generated-planner results and are excluded from quality scores. Save selected example IDs/hashes, provenance, retrieval scores, ordering, prompt version, model, and output artifacts. Include order-sensitivity and anti-copy perturbation checks. No demo from the held-out evaluation set may enter the prompt library.

“Agent learning” means reviewed, versioned example-bank promotion followed by offline evaluation. It does not mean self-editing prompts in production or treating judge self-scores as truth. Promote an exemplar only after human review of evidence, correctness, visual quality, licensing, and leakage; keep prior versions and failed candidates. The running agent cannot edit or promote its own bank, and no exemplar is currently approved.

---

# 7. Scene DSL

```ts
type SceneSpec = {
  sceneId: string;
  title: string;
  template: TemplateId;
  elements: Element[];
  edges: Edge[];
  focus?: string[];
  carryOver?: string[];
};
```

## Element types

```ts
type Element = {
  id: string;
  slot?: string;
  anchor: `mention:${string}` | `after:${string}` | 'sceneStart';
  label?: string;
  fill?: PaletteToken;
} & (
  | { prim: 'box'; text?: string; glyph?: '?'|'!'|'✓'|'✗'|'$'|'Σ' }
  | { prim: 'pill'; text: string }
  | { prim: 'tokenStrip'; tokens: string[]; highlight?: number[] }
  | { prim: 'operator'; symbol: '×'|'+'|'−'|'÷'|'Σ'|'∫'|'='|'→'|'softmax' }
  | { prim: 'meter'; values: number[]; labels?: string[] }
  | { prim: 'matrix'; rows: string[][] }
  | { prim: 'formula'; latex: string }
  | { prim: 'container'; children: string[]; style: 'solid'|'dashed' }
  | { prim: 'cylinder'; text?: string }
  | { prim: 'stack'; count: number; text?: string }
  | { prim: 'axis'; kind: 'line'|'curve'|'bars'; points?: number[][] }
  | { prim: 'hill'; peaks: number[]; marker?: number }
  | { prim: 'object'; concept: string; badge?: Badge; count?: number }
  | { prim: 'text'; text: string; size: 'title'|'body'|'note' }
);
```

```ts
type Badge = '✓'|'✗'|'?'|'!'|'$'|'⚠'|'↑'|'↓'|'⏱'|'🔒'|'★'|'+'|'−';

type Edge = {
  from: string;
  to: string;
  label?: string;
  style?: 'solid'|'dashed';
  anchor?: Element['anchor'];
};
```

---

# 8. Template hypothesis

Claude's architecture assumes a relatively small template set covers most teaching scenes.

Primary templates:

```text
title_card
hub_spoke
chain
convergence
fan_out
list_icon
compare_2
threshold
weighted_blend
layered_stack
cycle
formula_focus
```

Templates are code-defined composition skeletons.

The model:

```text
chooses template
fills slots
chooses primitives / candidate objects
anchors elements
```

The model does not output final coordinates.

This is one of the main hypotheses to compare against ChatGPT's open hierarchical VisualProgram.

---

# 9. Scene Planner hard rules

Initial planner rules:

```text
≤ 9 elements per scene
labels ≤ 4 words
every element has an anchor
object concepts must use catalog candidates or primitive/text fallback
```

Validation:

```text
SceneSpec
→ zod
→ one repair call if invalid
→ deterministic fallback if repair fails
```

Fallback may be a simple `list_icon` or `chain` scene built from the concept graph.

---

# 10. Stage S7 — Asset resolution ladder

Non-object primitives always resolve procedurally.

Object resolution:

```text
Rung 2
catalog exact / alias / embedding ≥ τ_high
        ↓
asset

Rung 3
catalog ≥ τ_mid + badge composition
        ↓
composed asset

Rung 4
styled text box
        ↓
always resolves

Async gap
        ↓
offline asset factory for future catalog entry
```

Optional small-model reranking may choose among top candidates or return `NONE`.

Every resolution records:

```ts
{
  rung,
  assetId,
  score
}
```

---

# 11. Catalog

```ts
type CatalogEntry = {
  id: string;
  names: string[];
  tags: string[];
  meaning: string;
  svg: string;
  strokePaths: number;
  source: 'iconify:<set>'|'streamline:<family>'|'generated'|'manual';
  license: string;
  embedding: number[];
  qa: {
    semanticScore: number;
    styleScore: number;
    reviewedBy: 'vlm'|'human';
  };
};
```

The Claude hypothesis places high value on a normalized, curated catalog and calibrated semantic thresholds.

---

# 12. Asset normalization

The Claude pipeline's normalizer is intended to make hybrid asset sources coherent.

For the experiment, preserve the conceptual goal:

```text
sanitize
normalize viewBox / scale
normalize stroke treatment where safe
map colors to house palette where safe
classify stroke/fill paths
measure bounds
record license
```

Because rich illustrations can be damaged by aggressive flattening, implementation should keep two experimental normalization lanes:

```text
simple symbol normalization
rich illustration normalization
```

The Claude hypothesis remains catalog-centric even if the normalizer is made safer for rich assets.

---

# 13. Style tokens

Use one global style file.

Representative initial tokens:

```ts
const STYLE = {
  canvas: { w: 1920, h: 1080, bg: '#FDFDFB', safe: 64 },

  stroke: {
    color: '#1A1A1A',
    width: 4,
    cap: 'round',
    join: 'round'
  },

  palette: {
    blue: '#9CCDF0',
    yellow: '#FFE77A',
    green: '#A8E08A',
    orange: '#FFB35C',
    purple: '#C9A8F0',
    red: '#FF7A6B',
    grey: '#D9D9D9'
  },

  font: {
    family: 'Kalam',
    uppercaseLabels: true
  },

  roughness: 0
};
```

Roughness is an experimentally selected style parameter, not an assumed requirement.

---

# 14. Stage S8 — Layout

Layout procedure:

```text
1. template produces initial relative slot boxes
2. measure actual element sizes
3. preserve slot order/alignment
4. push overlaps along primary template axis
5. scale composition into occupancy band
6. route edges between object boundaries
7. preserve carry-over positions
8. fail if overlap/safe-area remains
```

ELK may be used only for larger chain/convergence cases.

The central layout hypothesis is:

> template-guided deterministic layout is sufficient for most teaching scenes.

---

# 15. Stage S9 — Timeline compiler

Reveal starts are tied to mention anchors.

```text
revealStart = mentionTime - lead
```

Initial reveal modes:

| Kind | Reveal |
|---|---|
| Stroke paths | dash-offset draw-on |
| Fills | fade after outline |
| Text | left-to-right wipe |
| Formula | term / clip wipe |
| Meter | grow |
| Emphasis | ring / underline draw-on |

Initial heuristic constraints:

```text
≤ 2 simultaneous reveals
idle intervals may trigger emphasis
scene transition = erase/wipe or clear-and-redraw
```

Timeline is pure data:

```ts
Array<{
  elementId: string;
  track: 'stroke'|'fill'|'wipe'|'grow'|'emphasis';
  t0: number;
  t1: number;
  params?: unknown;
}>
```

---

# 16. Stage S10 — Renderer

Two modes share the same scene graph.

## Export mode

```text
renderFrame(scene, timeline, t)
→ SVG
→ @resvg/resvg-js
→ PNG frames
→ ffmpeg image2pipe
→ MP4
```

## Live mode

```text
same scene/timeline
→ browser SVG
→ requestAnimationFrame
→ audio.currentTime as clock
```

The live player is intended to reduce perceived latency while export happens separately.

---

# 17. Hand-written renderer-first proof

The implementation order must prove the renderer before relying on an LLM planner.

Start with three hand-written SceneSpecs:

```text
Why Attention
Query Meets Keys
Blending the Values
```

If hand-authored scenes cannot reach the target visual quality, do not tune the planner yet.

This is a central Claude implementation principle.

---

# 18. Package spikes

Test packages before admitting them to the engine.

Core spikes:

```text
zod
svgo
svgson
svg-path-properties
@resvg/resvg-js
ffmpeg-static / system ffmpeg
roughjs
mathjax@4 or current MathJax source package
opentype.js / fontkit as needed
elkjs
@iconify/json
@iconify/utils
p-limit / worker pool
```

Optional:

```text
svg2roughjs
Remotion
flubber
local embeddings
```

Every package must have a small executable spike and measured result.

---

# 19. Golden sets

Use the same benchmark cases as the competing ChatGPT hypothesis.

Minimum comparison set:

```text
G1 Transformer Attention
G2 Gradient Descent
G3 Photosynthesis
G4 Electromagnetic Induction
G5 Unseen source document
```

Also preserve the historical broader benchmark where available:

```text
10 frozen 1-minute lessons
4 frozen 5-minute lessons
```

---

# 20. Deterministic gates

Keep the Claude harness philosophy: every architectural claim must become a measurable experiment.

Core gates:

```text
schema validity
no unresolved final elements
no invalid overlap
safe-area compliance
minimum readable text
palette/style compliance
all anchors resolve
A/V end alignment
license allowlist
cost ceiling where applicable
```

Heuristics such as occupancy, element count, label length, idle window, and simultaneous reveal count should be recorded and tested rather than blindly treated as universal laws.

---

# 21. Metrics

Record at least:

```text
resolution rung distribution
semantic match
style coherence
teaching clarity
template diversity
reveal-word lag
render speed
wall time
cost
cache hit rate
```

Additionally record:

```text
mechanism-vs-list classification
template mismatch rate
wrong-metaphor rate
fallback text-box rate
```

These directly test Claude's scene-template and catalog assumptions.

---

# 22. Failure taxonomy

Use Claude's stage-oriented taxonomy:

```text
F-ING  ingestion
F-CON  concept extraction
F-PED  pedagogy
F-SCR  narration
F-ALN  alignment
F-LIST scene is a list instead of mechanism
F-TPL  wrong template
F-META wrong metaphor
F-GAP  missing asset
F-LAY  layout
F-TIM  timing
F-STY  style
F-ENC  encoding
```

Every failed clip receives exactly one primary code.

---

# 23. Key experiments specific to Claude hypothesis

## C1 — Template sufficiency

Can the fixed template vocabulary represent all five golden cases without awkward forcing?

Measure:

```text
clarity
template mismatch rate
number of fallback scenes
```

## C2 — Narration-first scene planning

Does planning the SceneSpec after final narration produce sufficiently coherent visual storytelling?

Compare to ChatGPT's pre-narration visual-story approach.

## C3 — Catalog ladder quality

Does exact/semantic asset retrieval + badge composition + text-box fallback maintain semantic correctness with low unresolved rate?

## C4 — Template-guided layout

Does deterministic template layout outperform open constraint / adaptive layout on quality and stability?

## C5 — Mention-anchored timeline

Does `[[mention]]` alignment create a stronger tutor-like reveal than beat-level timing?

## C6 — Renderer-first proof

Can three hand-written SceneSpecs reach the target visual quality before planner automation?

---

# 24. What would support Claude hypothesis?

Evidence supporting Claude's architecture would include:

- hand-written SceneSpecs achieve high visual quality;
- the fixed template vocabulary covers most scenes naturally;
- narration-first scene planning matches or beats pre-narration visual story planning;
- catalog + primitive ladder resolves concepts accurately without needing a broad representation router;
- template-guided layout is more stable and equally clear on unseen content;
- mention anchors provide strong synchronization with low complexity;
- overall pipeline is faster / cheaper with no clarity loss.

---

# 25. What would falsify Claude hypothesis?

The hypothesis is weakened if:

- scenes repeatedly become entity lists despite strong planner models;
- novel or source-specific mechanisms do not fit available templates;
- fixed narration prevents strong visual explanations;
- too many important concepts collapse to text boxes or wrong metaphors;
- unseen architectures require ad hoc template expansion;
- template-first scenes are consistently less clear than an open VisualProgram;
- source figures / formulas / diagrams require special handling that the Scene DSL cannot express cleanly.

If those occur, prefer ChatGPT's architecture or a hybrid.

---

# 26. Minimal implementation order for fair comparison

```text
1. Freeze shared golden inputs
2. Build style tokens + renderer primitives
3. Hand-write 3 SceneSpecs
4. Prove renderer / reveal quality
5. Implement 7 primary templates
6. Implement catalog / asset ladder
7. Implement mention-aligned timeline
8. Implement strong-model Scene Planner
9. Add remaining templates + formula primitive
10. Run five-case comparison
11. Only then run full 1-minute / 5-minute evaluation
```

Do not add RAG before this visual hypothesis is validated.

---

# 27. Fair-test constraints

For direct comparison with `chatgpt_pipeline.md`:

- same lesson/source fixtures;
- same TTS voice;
- same target durations;
- same Iconify/Streamline access;
- same Simi references;
- same output resolution;
- same evaluation prompts;
- same cost accounting;
- same human/VLM judges;
- no topic-specific hardcoding;
- no cross-contamination of semantic architecture.

In particular, Claude's experiment must not quietly adopt a pre-narration `VisualStoryIntent` stage, because that is one of the hypotheses being tested.

---

# 28. Final comparison outputs

For each golden case produce:

```text
claude/
  narration.json
  aligned-audio.json
  scene-spec.json
  resolved-scene.json
  layout.json
  timeline.json
  final-scene.svg
  video.mp4
  contact-sheet.png
  metrics.json
```

The final report compares these outputs directly against the corresponding ChatGPT pipeline artifacts.

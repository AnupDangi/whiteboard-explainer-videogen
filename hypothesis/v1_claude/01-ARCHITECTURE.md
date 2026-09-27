# 01 — Architecture

The target: any document or prompt → a narrated whiteboard video whose frames are indistinguishable in style from Simi, with diagrams that teach, under the cost ceilings in `00-README.md`.

---

## 1. Pipeline overview

```
 [PDF / DOCX / PPTX / MD / prompt]
          │
 S1  INGEST ───────────────► SourceDoc        (text blocks, headings, figures, equations, tables)
          │
 S2  UNDERSTAND ───────────► ConceptGraph     (concepts, relations, formulas, prerequisites)
          │
 S3  TEACHING PLAN ────────► TeachingPlan     (sections, learning goals, time budget per section)
          │
 S4  SCRIPT ───────────────► NarrationScript  (spoken text per scene, with [[mention]] markers)
          │
 S5  VOICE + ALIGN ────────► AlignedAudio     (wav + word timestamps)      ◄── master clock
          │
 S6  SCENE PLANNER ────────► SceneSpec[]      (Scene DSL: template, elements, edges, anchors)
          │
 S7  RESOLVE (ladder) ─────► ResolvedScene[]  (every element has concrete, normalized geometry)
          │
 S8  LAYOUT ───────────────► LaidOutScene[]   (x, y, w, h per element; no overlaps)
          │
 S9  TIMELINE COMPILE ─────► Timeline         (per-element reveal tracks in ms, from word anchors)
          │
 S10 RENDER ───────────────► frames / live player
          │
 S11 ENCODE ───────────────► MP4 (+ captions .vtt)
          │
 S12 QA GATES ─────────────► pass / fail + report
```

Every arrow is a **typed artifact on disk** (JSON), content-addressed. Every stage is a pure function `stage(inputs, config) → artifact`. That gives you: resumability, caching, A/B per stage, and a harness that can replay any stage in isolation.

### Where LLMs are used (and nowhere else)

| Stage | Model tier | Output | Why this tier |
|---|---|---|---|
| S2 Understand | Mid | ConceptGraph JSON | Extraction; mid models are fine |
| S3 Teaching plan | Mid–strong | TeachingPlan JSON | Pedagogy order matters |
| S4 Script | Mid | NarrationScript | Prose; cheap to regenerate |
| S6 Scene planner | **Strongest affordable** | SceneSpec JSON (DSL) | This is where "Query Meets Keys" is decided |
| S7 Resolve (rung 2/3 choice) | Small or embeddings only | candidate choice | Retrieval does most of the work |
| Offline asset factory | Strong + VLM judge | catalog entries | Not per video |

Everything from S7 onward is deterministic code (except the optional small-model rerank in S7).

---

## 2. Stage contracts (TypeScript, validated with zod at every boundary)

```ts
// S1
type SourceDoc = {
  id: string; title: string; lang: string;
  blocks: Array<
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'para'; text: string }
    | { kind: 'equation'; latex: string; context?: string }
    | { kind: 'table'; rows: string[][] }
    | { kind: 'figure'; caption?: string; imageRef?: string }
    | { kind: 'code'; lang?: string; text: string }
  >;
};

// S2
type ConceptGraph = {
  concepts: Array<{ id: string; label: string; kind: 'entity'|'process'|'quantity'|'formula'|'event'|'role'|'rule'; definition: string; latex?: string }>;
  relations: Array<{ from: string; to: string; type: 'causes'|'feeds'|'contains'|'compares'|'transforms'|'requires'|'produces'|'opposes' }>;
  prerequisites: Array<{ concept: string; needs: string }>;
};

// S3
type TeachingPlan = {
  targetDurationSec: number;
  intro: { sourceTitle: string; sections: string[] };        // tutor-style intro
  sections: Array<{ id: string; title: string; goal: string; conceptIds: string[]; budgetSec: number }>;
  recap: { keyPoints: string[] };
};

// S4 — mentions are how visuals attach to words
type NarrationScript = {
  scenes: Array<{ sceneId: string; sectionId: string; text: string }>; // text contains [[id|spoken words]]
};

// S5
type AlignedAudio = {
  wavPath: string; durationMs: number;
  words: Array<{ w: string; startMs: number; endMs: number }>;
  mentions: Array<{ sceneId: string; mentionId: string; startMs: number; endMs: number }>;
};
```

`[[q|the query]]` in the script is the contract between S4, S5 and S6: the planner references `q`, the aligner finds when "the query" is spoken, and the element with anchor `mention:q` is revealed then.

---

## 3. The Scene DSL (S6 output — the heart of the system)

### 3.1 Shape

```ts
type SceneSpec = {
  sceneId: string;
  title: string;                       // hand-lettered title band
  template: TemplateId;                // composition skeleton
  elements: Element[];
  edges: Edge[];
  focus?: string[];                    // elements to emphasize at end of scene
  carryOver?: string[];                // element ids persisting from previous scene
};

type Element = {
  id: string;
  slot?: string;                       // template slot name (e.g. 'hub', 'spoke', 'left', 'right')
  anchor: `mention:${string}` | `after:${string}` | 'sceneStart';
  label?: string;                      // ≤ 4 words, uppercase in render
  fill?: PaletteToken;                 // 'blue'|'yellow'|'green'|'orange'|'purple'|'red'|'none'
} & (
  | { prim: 'box'; text?: string; glyph?: '?'|'!'|'✓'|'✗'|'$'|'Σ' }
  | { prim: 'pill'; text: string }
  | { prim: 'tokenStrip'; tokens: string[]; highlight?: number[] }
  | { prim: 'operator'; symbol: '×'|'+'|'−'|'÷'|'Σ'|'∫'|'='|'→'|'softmax' }
  | { prim: 'meter'; values: number[]; labels?: string[] }
  | { prim: 'matrix'; rows: string[][] }
  | { prim: 'formula'; latex: string }
  | { prim: 'container'; children: string[]; style: 'solid'|'dashed' }
  | { prim: 'cylinder'; text?: string }                     // databases/stores
  | { prim: 'stack'; count: number; text?: string }         // layers
  | { prim: 'axis'; kind: 'line'|'curve'|'bars'; points?: number[][] }
  | { prim: 'hill'; peaks: number[]; marker?: number }      // energy diagrams, loss curves
  | { prim: 'object'; concept: string; badge?: Badge; count?: number } // resolved by ladder
  | { prim: 'text'; text: string; size: 'title'|'body'|'note' }
);

type Badge = '✓'|'✗'|'?'|'!'|'$'|'⚠'|'↑'|'↓'|'⏱'|'🔒'|'★'|'+'|'−';
type Edge = { from: string; to: string; label?: string; style?: 'solid'|'dashed'; anchor?: Element['anchor'] };
```

### 3.2 Templates (composition skeletons)

Measured against Simi frames, ~12 templates cover almost every scene:

| Template | Simi example | Slots |
|---|---|---|
| `title_card` | "WHY ATTENTION / The cat sat on the mat" | title, subtitle, strip |
| `hub_spoke` | robot → arrows → math / bug / experts | hub, spokes[≤6] |
| `chain` | ID verified → reset password → STOP | nodes[≤5] |
| `convergence` | keys + query → × → softmax → meter | inputs[], operator, outputs[] |
| `fan_out` | CAT → three arrows | source, targets[] |
| `list_icon` | ⏱ quickly / ✓ reliably / $ cheaply | items[≤5] |
| `compare_2` | smartest model ✗ vs cheap system $ | left, right, verdict |
| `threshold` | task → intelligence threshold bar | subject, bar, marker |
| `weighted_blend` | chests + weights → weighted sum → new vector | inputs[], weights[], combiner, result |
| `layered_stack` | network layers, OSI stack | layers[] |
| `cycle` | photosynthesis, immune loop | nodes[3–6] |
| `formula_focus` | derivation with annotated parts | formula, callouts[] |

Templates are **code**, not LLM output: each template has slot geometry rules (relative positions, spacing, alignment) that the layout solver (S8) refines. The LLM only picks a template and fills slots.

### 3.3 Planner prompt contract (S6)

The planner receives:
1. The scene's narration text with `[[mentions]]`.
2. The concept subgraph for the scene.
3. **Catalog candidates**: for each concept, top-k (k=8) catalog objects retrieved by embedding similarity, with tags — this is the grounded metaphor vocabulary.
4. The template list with slot definitions and 2 few-shot examples per template (from your Simi-analysis set).
5. Hard rules: ≤ 9 elements per scene, labels ≤ 4 words, every element anchored, object concepts must come from candidate list or be expressed as primitive/text.

Output is validated with zod; on failure, one repair call with the validation errors; on second failure, fall back to a deterministic `list_icon` / `chain` scene built from the concept subgraph (never an empty scene).

---

## 4. Asset resolution ladder (S7)

```
element.prim !== 'object'  ──► PRIMITIVE renderer (always resolves)
element.prim === 'object':
   rung 2  catalog.lookup(concept)            exact / alias / embedding ≥ τ_high  → asset
   rung 3  compose(base, badge)               base from catalog ≥ τ_mid + badge  → asset
   rung 4  styledTextBox(label)                                                  → always
   (async) enqueue gap → offline asset factory (rung 5) → future catalog entry
```

- τ_high / τ_mid are **calibrated by the harness** (E4 in file 03), not guessed.
- Optional: a small-model rerank of the top-3 candidates ("Which of these best depicts X in a teaching diagram? or NONE"). NONE is a valid, rewarded answer.
- Every resolution records `{ rung, assetId, score }` for metrics.

### 4.1 Catalog

```ts
type CatalogEntry = {
  id: string;                        // 'key', 'treasure_chest', 'kettlebell', 'brain'
  names: string[]; tags: string[];   // synonyms, domains
  meaning: string;                   // "represents access, unlocking, identifiers"
  svg: string;                       // NORMALIZED svg (see 4.2)
  strokePaths: number;               // for reveal timing
  source: 'iconify:<set>'|'streamline:<family>'|'generated'|'manual';
  license: string;                   // stored, checked at build time
  embedding: number[];               // of names+tags+meaning
  qa: { semanticScore: number; styleScore: number; reviewedBy: 'vlm'|'human' };
};
```

Target: 300 objects for week 1, 800 by month 2. Seed list = concrete nouns that recur in teaching (people/roles, buildings, documents, money, tools, science objects, body, nature, tech hardware, security, transport, time, communication).

### 4.2 Normalizer (the thing that makes hybrid sources coherent)

For every incoming SVG:
1. `svgo` cleanup, flatten transforms, remove `<style>`, ids, masks, gradients.
2. Scale into a 100×100 viewBox.
3. Classify each path: **stroke-type** (has stroke, no/none fill) or **fill-type**.
4. Re-style: stroke `#1a1a1a`, `stroke-width` = 4 (in 100-unit space), round caps/joins; fills mapped to nearest palette token or `none`; one accent fill allowed per asset.
5. Reject if: > 40 paths, any path with bbox < 2% (detail that dies at video size), or style-judge score < threshold.
6. Precompute path lengths for reveal timing.

---

## 5. Style system (design tokens — one file, used by everything)

```ts
export const STYLE = {
  canvas: { w: 1920, h: 1080, bg: '#FDFDFB', safe: 64 },
  stroke: { color: '#1A1A1A', width: 4, cap: 'round', join: 'round' },
  palette: { blue:'#9CCDF0', yellow:'#FFE77A', green:'#A8E08A', orange:'#FFB35C', purple:'#C9A8F0', red:'#FF7A6B', grey:'#D9D9D9' },
  font: { family: 'Kalam', weight: 700, uppercaseLabels: true, sizes: { title: 64, body: 40, label: 32, note: 28 } },
  element: { objectSize: [150, 220], boxMinW: 180, gap: 64 },
  occupancy: { min: 0.45, max: 0.75 },
  roughness: 0,               // 0 = clean (Simi-like). If >0, fixed seed per element id.
  motion: { strokeSpeedPxPerSec: 900, fillFadeMs: 250, textWipeCharMs: 35, arrowMs: 400 },
} as const;
```

Font: choose after E7 (file 03) between Kalam, Patrick Hand, Gochi Hand, Architects Daughter (all OFL). Convert text to paths with opentype.js at render so output is font-independent.

---

## 6. Layout (S8)

1. Template gives initial slot boxes in relative coordinates.
2. Measure real element sizes (text metrics via opentype.js, asset sizes from style tokens).
3. Constraint pass: keep slot order/alignment, enforce `gap`, resolve overlaps by pushing along the template's primary axis, scale the whole composition to hit the occupancy band.
4. Edge routing: straight or single-bend arrows between element boundary points (not centers); labels at midpoint offset. Use elkjs only for `chain`/`convergence` scenes with > 6 nodes.
5. Carry-over elements keep their positions across scenes (continuity like Simi's CAT box).
6. Output fails the gate if any overlap or out-of-safe-area remains.

---

## 7. Timeline compiler (S9)

For each element: `revealStart = anchorTime − lead` (lead ≈ 150 ms so the drawing starts as the word starts).
Reveal duration by kind:

| Kind | Reveal mode | Duration |
|---|---|---|
| Stroke paths (objects, boxes, brackets, arrows) | `stroke-dashoffset` draw-on, paths sequenced | total length / strokeSpeed, clamped 300–1500 ms |
| Fills | fade in after its outline completes | 250 ms |
| Text / labels | left→right clip-mask wipe | chars × 35 ms, ≤ 900 ms |
| Formula (filled glyphs) | clip-mask wipe per term | ≤ 1500 ms |
| Meter | bar grows from 0 to value | 500 ms |
| Emphasis | ring / underline draw-on | 400 ms |

Rules: reveals never overlap more than 2 at once; if a scene has idle time > `maxIdleMs` (e.g., 2500 ms), the compiler inserts an emphasis on the currently discussed element. Scene transitions: wipe/erase or clear-and-redraw, 300 ms.

The timeline is **pure data**: `Array<{ elementId, track: 'stroke'|'fill'|'wipe'|'grow'|'emphasis', t0, t1, params }>`.

---

## 8. Renderer (S10) — two modes, one scene graph

**Mode A: Export renderer (MP4).** `renderFrame(scene, timeline, t) → SVG string` is a pure function. Rasterize with `@resvg/resvg-js` in a worker pool, stream PNG frames to ffmpeg via stdin (`image2pipe`), mux with audio. No per-frame process spawning.

**Mode B: Live player (browser).** The same `renderFrame` runs in the browser on `requestAnimationFrame` synced to `<audio>.currentTime`. Video appears the moment S9 completes — no encode wait. MP4 export happens in the background or on demand.

Why both: Mode B is how you get near-instant perceived latency (likely how a product claiming ~20–40 s per minute feels fast), and it is what your learning-platform integration needs anyway. Mode A is what you share/download and what the harness scores.

Remotion is an alternative for Mode A (evolvePath, frame-accurate). Decide via spike S-7 in file 04 (speed and license).

---

## 9. QA gates (S12) — summary (full detail in file 03)

Deterministic on every video: zero placeholders, zero overlaps, occupancy band, min font size, palette compliance, every element anchored, max idle, audio/visual end aligned (±200 ms), schema-valid artifacts.
Sampled: VLM judge (semantic match, style coherence, teaching clarity).

---

## 10. Repository layout

```
packages/scene-engine/
  src/contracts/        zod schemas for all artifacts (single source of truth)
  src/stages/
    s1-ingest/  s2-understand/  s3-plan/  s4-script/  s5-voice/
    s6-scene-planner/   (prompts/, fewshots/, repair.ts)
    s7-resolve/         (ladder.ts, catalog.ts, compose.ts, normalize.ts)
    s8-layout/          (templates/*.ts, solver.ts, edges.ts)
    s9-timeline/
    s10-render/         (frame.ts, primitives/*.ts, reveal.ts, text.ts, math.ts)
    s11-encode/
    s12-gates/
  src/runner/           dag.ts (stage graph), cache.ts (content-addressed), budget.ts (global)
  src/style/tokens.ts
catalog/                entries/*.json, svg/*.svg, embeddings.bin, licenses.json
harness/                goldens/, experiments/, judge/, reports/
player/                 browser live player (Mode B)
```

Keep `experiments/visual-system-benchmark` read-only as the historical baseline; port its frozen 10 lessons into `harness/goldens/`.

---

## 11. Scaling later (after quality is proven — not before)

| Concern | Design |
|---|---|
| Concurrency | Job queue (BullMQ + Redis). Each stage = a job type; workers are stateless. |
| Idempotency | Stage outputs stored by content hash (S3/R2/local); a retried job is a cache hit. |
| Long videos | Sections planned and rendered in parallel; concatenate at encode. 60-min = ~20 sections × parallel. |
| Rendering cost | CPU workers, resvg; scale horizontally. Player mode avoids rendering entirely for in-app viewing. |
| LLM cost | Prompt caching, model-per-stage routing, re-plan only failed scenes. |
| Asset growth | Gap queue → offline factory → judge → catalog; catalog versioned, embeddings rebuilt nightly. |
| Personalization (learning platform) | TeachingPlan takes learner profile (level, pace, prior concepts); everything downstream unchanged. |
| Multilingual | Script + TTS per language; scene specs reused (labels translated); layout re-measured. |
| Observability | Per-stage timing, cost, cache hit rate, gate failures, rung distribution — one dashboard. |

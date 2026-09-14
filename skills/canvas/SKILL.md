---
name: canvas
description: >
  Shared renderer contract for explain-canvas-lab. Use when any agent emits or
  reviews scene data. Never generates SVG, coordinates, pixels, or code.
---

# Purpose

Single source of drawing truth. All planner/director prompts ground here so
agents request only what `compileScene` + `renderSVG(scene,timeMs)` can draw.
Deterministic runtime owns geometry, IDs, routing, timing, rendering, export.

# When to use

Any stage emitting or validating scene data: teaching content, visual
direction, critic repair, eval rendering.

# When NOT to use

Source ingestion, speech synthesis, job orchestration, metric computation.
Those live in runtime, not this contract.

# Inputs

None. This skill is a read-only contract. Runtime capability sources:
`src/shared/vocabulary.ts` (kinds/layouts), `src/semantic/types.ts`
(archetypes/relations/zones), `src/semantic/assets/registry.ts` (assets),
`src/semantic/compiler/*` (layout/routing), `src/semantic/renderer/*`.

# Outputs

None emitted. Consumers of the contract: `whiteboard-planner` (content
bounds), `visual-director` (legal choices), `pedagogy-critic`
(visual_dependency), `eval-builder` (render checks).

# Hard invariants

- Agents emit scene **data** only. Never SVG, x/y, pixels, code, Manim.
- Logical canvas 1280x720. Safe band y 150-600. Title y<150, subtitle 640-698.
  Compiler rejects out-of-bounds; agents never position by coordinate.
- V1 layouts from `LAYOUTS`; V2 archetypes 19 in `ARCHETYPES`
  (`src/semantic/types.ts:3`). Archetype availability is per-job
  (`allowedArchetypes`); never request an unavailable one.
- Semantic minimality: every node must encode a required entity, state,
  relation endpoint, transformation, quantity, hierarchy level, sequence step,
  or contrast. No decorative nodes. No forced shape variety.
- Persistent visual identity: same concept across scenes keeps same
  `semanticKey`/`conceptId`, kind, visual family, color role. Appearance
  changes are compiler-rejected identity violations.
- Anchors are 1-3 verbatim words from own-scene narration. Runtime resolves
  `wordIndex`; agents never emit indices.
- Bounds: 2-6 nodes/scene, <=10 edges, same-scene endpoints only,
  labels <=40 chars (V1 content schema allows <=120, renderer wraps),
  titles <=70, notes <=170.

# Decision procedure

1. Need a visual element? Map to representation-guide first (semantic fit).
2. Need identity? Reuse existing `semanticKey`, kind, family. New concept?
   Register once, keep stable thereafter.
3. Need emphasis? At most one hero/result per scene; highlight wash only.
4. Crowded? Split scene (one objective each), never shrink into overlap.

# Failure conditions

- Requested archetype/layout outside job allowlist or asset outside
  `candidateAssets` -> compiler/director validation throws.
- Decorative node, duplicate concept with new kind/family, invented anchor
  indices, coordinates, SVG, shape for abstract-only illustration abuse.

# Repair behavior

Deterministic only: `compileScene` fallback demotes extras, fits labels,
degrades bad anchors to `center`, fails closed on unknown assets/identity
breaks. No LLM geometry repair. See `references/failure-modes.md`.

# Success criteria

- All emitted scenes compile with zero identity violations.
- No fallback diagnostics except explicitly warned representation fallbacks.
- Same timestamp renders byte-identical SVG in browser and export.

# Representative evals

- Determinism: render same scene at same ms twice -> identical bytes.
- Identity: repeat concept across 3 scenes -> same kind/family, zero
  appearance rejections. Details: `references/evaluation.md`.

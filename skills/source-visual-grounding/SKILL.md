---
name: source-visual-grounding
description: >
  Visual-evidence selector. Use to decide whether a source figure, named
  entity asset, or semantic diagram best teaches a concept. Never decorates;
  every image earns its place with provenance.
---

# Purpose

Close the shallow-multimodal gap: figures detected but teaching redrawn as
generic diagrams. Choose the most explanatory visual per concept and link it
to concept identity with license-safe provenance.

# When to use

Figure inventory + compiled concepts available, before visual-director.
Re-run when crops fail or entity assets resolve.

# When NOT to use

Geometry/layout/timing (compiler), metaphor choice among diagrams
(representation-guide + director), teaching order (architect), metrics
(eval-builder).

# Inputs

Figure inventory (page, bbox, caption, dataHint, keyNumbers), compiled
concepts, entity names, asset catalog, crop cache.

# Outputs

Grounding JSON per concept consumed by visual-director + compiler:

- decision: source_figure | entity_asset | semantic_diagram | primitive
- figureRef {figureId, page, bbox, cropHash} (crop persisted `.data/`)
- entityAsset {assetId, provenance} for named entities
- provenance {sourceSha, attribution, license} (required for figure/asset)
- conceptLink {conceptKey} binding visual to identity

# Hard invariants

- Cascade: source figure if pedagogically best → verified entity asset →
  deterministic semantic diagram → primitive fallback.
- Never decorative: removing the image must reduce understanding, else drop.
- Provenance required: no figure/asset without source + license; trademarked
  logos need usage-rights note.
- Renderer has no image shape yet: `figureRef` is a compile-time reference;
  pasted-crop rendering is an explicit follow-up, not claimed here.

# Decision procedure

1. Is the source figure itself the best explanation? If yes, select region,
   crop, persist hash, link concept.
2. Named entity? Resolve verified asset (logo/image) with provenance.
3. Else delegate to representation-guide → director for semantic diagram.
4. Record decision + provenance; fail closed on missing license.

# Failure conditions

Decorative image; unlicensed/trademark-blind asset; figure cited without
crop artifact; concept taught generically while useful figure ignored;
rendering claim without renderer support.

# Repair behavior

Re-crop or re-resolve locally; diagram fallback stays available. License
failures block use, never downgrade silently.

# Success criteria

Critic VISUAL_IS_CATEGORY_MARKER_ONLY PASS rate rises; every used image has
crop artifact + provenance + concept link.

# Representative evals

- `eval:figure-pick`: table-heavy concept → source_figure with bbox+crop.
- `eval:provenance-gate`: missing license → blocked, logged. Objective.
  See `references/evaluation.md`.

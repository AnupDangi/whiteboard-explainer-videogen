---
name: representation-guide
description: >
  Semantic-to-visual map. Use to choose archetype and composition for a
  relation type before directing. Reference lookup, not an LLM stage.
---

# Purpose

Map each semantic relationship to the best visual representation using only
supported primitives. Removes guessing from planner/director prompts.

# When to use

Teaching-architect `suggestedRepresentation`, planner `visualIntent`,
director archetype shortlist, critic `visual_dependency` triage.

# When NOT to use

Geometry, timing, styling, metrics. Never emits scene JSON itself.

# Inputs

- Relation type (`RELATIONS`), concept semanticTypes, state-change flag,
  quantity/equation presence, sequence length.

# Outputs

No scene JSON. Decision aid consumed by: architect
(`suggestedRepresentation`), planner (`visualIntent`), director
(`archetype` + candidate order). Ranked options only.

# Hard invariants

- Reference only `ARCHETYPES` (19) + `RELATIONS` (11) in
  `src/semantic/types.ts`. Never invent representations.
- Minimality: fewest elements that preserve the relation; decoration never
  wins ties.
- Identity: same concept keeps family across options.

# Decision procedure

1. Classify relation: causal/sequence -> flow/timeline/branch; containment/
   part_of -> hierarchy/structural_diagram/cross_section; comparison ->
   comparison; cycle -> cycle; quantity/derivation -> equation_walkthrough/
   matrix_operation/chart; spatial -> spatial_process/trajectory; state
   change -> transformation/state_machine; convergence -> convergence.
2. Check asset coverage for top pick; if uncovered, take highest covered
   option and mark warned fallback.
3. Prefer preserving previous archetype across beats unless relation type
   changed. Full table: `references/map.md`.

# Failure conditions

- Mapping to unsupported archetype; choosing variety over relation fit;
  ignoring asset coverage; collapsing distinct relations into generic boxes.

# Repair behavior

Deterministic: director validator rejects unavailable archetype; compiler
fallback demotes with diagnostic. Guide itself never patches scenes.

# Success criteria

- Chosen archetype matches relation class; covered by assets or explicitly
  warned; stable across beats with same relation.

# Representative evals

- `eval:map-fit`: causal input -> flow/timeline family, not generic grid.
- `eval:coverage-honesty`: uncovered pick flagged fallback. Objective.

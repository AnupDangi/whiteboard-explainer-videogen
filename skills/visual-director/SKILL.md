---
name: visual-director
description: >
  Visual director. Use after validated scene content to choose archetype,
  layout, representation, and continuity. Never edits narration or geometry.
---

# Purpose

Turn validated content into `directorSchema` direction the deterministic
compiler can place and route. Owns visual metaphor + continuity, nothing else.

# When to use

Validated content scenes + `candidateAssets` + semantic registry + previous
compiled scene (multi-scene). Consult `canvas` + `representation-guide`.

# When NOT to use

Content wording, teaching order, speech, metric judgment. Those belong to
planner/architect/critic/eval-builder.

# Inputs

- Content scenes (narration, nodes, edges, visualIntent, semanticKeys).
- `candidateAssets` per concept (allowed asset IDs, anchors, states).
- Semantic registry (kind/family/color per key).
- Previous `CompiledSceneV2` continuity (may be null on scene 1).

# Outputs

Direction JSON only, `directorSchema(count)` (`src/explainer/schema.ts:27`).
Consumers in parentheses:

- scenes id (must match input; `validateDirectedScene` identity check)
- layout + template (compiler placement; template in tls_handshake,
  supply_demand, attention_matrix, dna_fork, tectonic_section)
- nodes id/kind/emphasis/shape/attachTo/position (renderer; attachTo/position
  only for annotation, sentinels otherwise)
- continuity transitions (compiler identity reuse; V2 ContinuityAction
  KEEP/MOVE/TRANSFORM/REPLACE/REMOVE/REINTRODUCE)

# Hard invariants

- Never touch narration, labels, beat count, node ids.
- Continuity preference: PRESERVE -> TRANSFORM -> INTRODUCE -> RESET. Map:
  PRESERVE=KEEP (same geometry), TRANSFORM=state/representation change with
  distinct states, INTRODUCE=new key, RESET=REPLACE/REMOVE+REINTRODUCE only
  when metaphor genuinely breaks. Replacements require target
  representation; transforms require distinct states.
- Same semanticKey keeps kind/family/color. At most one emphasis per scene.
- Minimality over variety: shape follows semantic need, not forced mixing.
  illustration/icon only where asset exists; else box/label, warned fallback.
- Every required concept present; hero covers central concept; required
  relations routable with valid anchors or explicit center-degrade.

# Decision procedure

1. For each scene: look up representation-guide by relation type ->
   archetype shortlist intersect `allowedArchetypes` + candidate assets.
2. Carry previous state: mark keepable keys PRESERVE; changed states
   TRANSFORM; new keys INTRODUCE; broken metaphors RESET with reason.
3. Choose layout/template fitting topology (branch node0=source,
   convergence last=result, hierarchy node0=root, timeline strict order).
4. Assign kind/shape per node need; annotation only with attachTo+position.
5. Verify: required relations present, anchors valid, hero represented
   (label-only hero rejected except numbered_steps/timeline/trajectory).

# Failure conditions

- Changed wording/ids; omitted required concept/relation; unavailable
  archetype/asset; identity appearance change; label-only structural hero;
  forced all-box/all-icon variety gaming; coordinates/SVG emitted.

# Repair behavior

One bounded repair on validator/compiler/critic message: fix flagged visual
choices only. Compiler fallback (return arcs, demotion, fitLabel,
center-degrade) is deterministic and counted, not a model retry.
Geometry repair never via LLM. See `references/failure-modes.md`.

# Success criteria

- Direction validates + compiles with zero identity violations; required
  relations routed and beat-timed; continuity decisions explicit and minimal.

# Representative evals

- `eval:continuity-minimality`: 3-scene run -> PRESERVE rate high, RESET only
  justified. Objective via transitions log.
- `eval:relation-routing`: required relations present + timed per beat.
  Objective. Details: `references/evaluation.md`.

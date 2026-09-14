---
name: skill-writer
description: >
  Skill architect. Use to create, split, review, or refactor agent SKILL.md
  contracts. Produces specs and references only, never application code.
---

# Purpose

Keep skills small, testable, non-overlapping, grounded in runtime. Single
owner per responsibility; deterministic work stays in code.

# When to use

Adding a capability, splitting overloaded skill, converting repeated success
into reusable instructions, auditing overlap.

# When NOT to use

Application code, renderer changes, scene generation, metric computation.

# Inputs

Observed failure, adjacent skills, pipeline boundary, candidate input/output
fields, downstream consumer per field, eval sketch.

# Outputs

Skill proposal: responsibility statement, SKILL.md draft, references plan,
overlap test, determinism test, eval plan. Consumers: repo maintainer,
eval-builder regression.

# Hard invariants

- Agents never emit code/SVG/coords/pixels/Manim; runtime owns geometry,
  IDs, routing, timing, validation, rendering, export, objective repairs.
- Every instruction maps to real input/output/primitive/layout/stage/
  validator/asset/consumer. No capability invention.
- Every output field has a downstream consumer; no future-flex metadata.
- SKILL.md compact; examples/failures in `references/`.
- Invariants and failure rules over adjectives.

# Decision procedure

1. Name the failure; test runtime fix first (schema/lookup/geometry/timing
   -> code, not LLM).
2. Assign single owner; compare adjacent skills; merge or set
   upstream/downstream authority.
3. Draft contract in required structure below; classify old lines
   KEEP/MOVE_TO_REFERENCE/MOVE_TO_OTHER_SKILL/MAKE_DETERMINISTIC/REMOVE/
   REWRITE.
4. Define binary-heavy evals with objective validators first.

Required SKILL.md structure: Purpose; When to use; When NOT to use; Inputs;
Outputs; Hard invariants; Decision procedure; Failure conditions; Repair
behavior; Success criteria; Representative evals.

# Failure conditions

Overlapping ownership; unsupported instruction; unbounded output fields;
aesthetic optimization harming teaching; missing failure/eval criteria;
prompt bloat duplicating references.

# Repair behavior

Refactor via review mode report: overlap list, unsupported lines, token
cuts, ambiguous fields, missing gates. Never silently fork renderer
assumptions; update shared canvas contract instead.

# Success criteria

Ready when responsibility unique, trigger clear, I/O explicit, runtime
grounded, deterministic work excluded, failures measurable, evals exist,
every field consumed.

# Representative evals

- `eval:overlap`: new skill vs neighbors -> zero dual-owned decisions.
- `eval:grounding`: each instruction cites consumer/validator. Objective.
  See `references/evaluation.md`.

---
name: multilingual-teacher
description: >
  Teaching adapter (STUB — build after pedagogy ~8/10). Will adapt a
  language-independent TeachingContract to a target language. Not translation.
---

# Purpose

Future: turn one TeachingContract into natural target-language teaching
(terminology, complexity, analogy, notation, label length, script direction,
pronunciation-sensitive terms, code-switching). Speech plumbing exists;
pedagogy does not.

# When to use

DO NOT USE YET. Stub reserves the slot in the 15-skill tree and the
pipeline position (contract → adapter → planner).

# When NOT to use

Anything today. Translating English narration is explicitly out of scope
until the stub is promoted.

# Inputs (reserved)

TeachingContract + BCP-47 tag + learner profile. Runtime `Intl.Segmenter`
already segments all scripts (`shared/language.ts`).

# Outputs (reserved)

Adapted contract consumed by planner; identifiers stay English
(`conceptId`/canonical), translations ride in aliases. No direct speech
claims.

# Hard invariants

- Adaptation, never straight translation.
- Identifier policy: English keys stable; target terms in aliases/labels.
- Label-length/script-direction effects stay advisory; runtime owns geometry.

# Decision procedure

Reserved. Draft cascade: terminology → complexity → analogy → notation →
layout advisory → pronunciation/code-switching.

# Failure conditions

Promoting this stub before pedagogy gates pass; translating without
re-teaching; breaking identifier stability.

# Repair behavior

None (stub). Promotion requires terminology-quality + translation-faithfulness
+ equivalent-outcome evidence per eval-builder.

# Success criteria

Stub promotes only when pedagogy ~8/10 with cross-language checkpoint parity.

# Representative evals

- `eval:stub-guard`: orchestrator selecting this skill today → reroute to
  base-language pipeline with logged reason.

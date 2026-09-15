---
name: multilingual-teacher
description: >
  Language policy owner for the teaching pipeline. Use when a lesson targets a
  language other than English. Defines how narration, labels, terminology and
  voice selection adapt to a BCP-47 language while canonical identifiers stay
  English. Not a translation stage and not before pedagogy is sound.
---

# Purpose

Own one thing: how a language-independent TeachingContract and ConceptGraph are
expressed in a target language without breaking canonical identity, and which
voice serves that language. It does not order beats, write scene content, choose
visuals, or translate text wholesale.

# When to use

Any run whose language tag is not `en` (narration, labels, terminology,
checkpoints), and any future adaptation work (complexity, analogy, notation,
script direction, pronunciation-sensitive terms, code switching).

# When NOT to use

Beat ordering/strategy (teaching-architect), narration/scene wording
(whiteboard-planner), visual choices (visual-director), validation
(pedagogy-critic), metrics (eval-builder). Never use it to bypass the
base-language pipeline or to translate without re-teaching.

# Inputs

TeachingContract + ConceptGraph + BCP-47 language tag + learner profile.
Runtime already segments every script through `shared/language.ts`
(`Intl.Segmenter`).

# Outputs

Language policy applied to stage prompts and job options. Consumers:

- teaching/knowledge/architect/director prompts: narration, titles, key points,
  labels and learner-facing text written in the target language.
- Concept identity: canonical ids and `canonicalName` stay English; translated
  surface forms ride in `aliases`.
- Speech layer: language tag selects the voice (`en/hi/fr/de` Supertonic,
  `ne/zh` Piper); buffered and streaming adapters unchanged.
- UI: language selector value flows through the job input additively.

# Hard invariants

- Adaptation, never straight translation: the lesson is re-taught in the target
  language, not converted sentence by sentence.
- Identifier policy: English concept keys/canonical names are stable across
  languages; translated terms live in `aliases`/labels only.
- Every learner-facing string uses the language tag; never mixed-language
  narration unless the contract declares it.
- Label-length and script-direction effects stay advisory; runtime owns
  geometry, fitting and text measurement.
- Speech must report the language it used; a missing voice for the language is
  a visible failure, never a silent English fallback.

# Decision procedure

1. Read the language tag; if `en`, no adaptation beyond the defaults.
2. Keep concept keys/canonical names English; add translated aliases.
3. Write narration, titles, key points, labels and checkpoints in the tag.
4. Select the voice that serves the language; if none exists, fail loudly.
5. Preserve terminology consistency: one translated term per concept across
   all scenes; no synonym drift.
6. Leave complexity/analogy/notation adaptation to a future promotion until
   cross-language checkpoint parity is measured.

# Failure conditions

Translating without re-teaching; changing canonical ids per language; mixing
languages inside one narration; silently narrating English when the requested
voice is unavailable; synonym drift for one concept; layout assumptions from
English text length.

# Repair behavior

Re-express the affected learner-facing field in the target language while
keeping ids, evidence and beat structure unchanged; never regenerate the whole
lesson for a wording defect.

# Success criteria

Cross-language checkpoint parity: a learner of the target language reaches the
same expected LearnerState as the English run, with identical canonical ids and
evidence. Until that is measured, adaptation stays documented policy, not a
release gate.

# Representative evals

- `eval:identifier-stability`: same concept keys in `en` and `hi` runs.
- `eval:no-mixed-language`: narration language matches the job tag.
- `eval:voice-missing`: request an unsupported language → visible failure.
- `eval:stub-guard` (historical): selecting this skill before pedagogy gates →
  reroute to the base-language pipeline with a logged reason.

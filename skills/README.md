# Skills manifest

Physical folders stay flat: `skills/<name>/SKILL.md`. Overflow detail lives in
`skills/<name>/references/` (progressive disclosure). Grouping below is logical
only.

This file records the **target classification** from `Architecture_plan.md`
§31-36 and §70: a tiny set of runtime skills that actually instruct a model
decision, everything else as deterministic code or developer documentation. Only
the `# Hard invariants` section of a runtime skill is injected into a prompt
(`src/semantic/skills.ts`); full documents are never loaded wholesale (§34, §71).

## Runtime model skills (what actually loads)

| skill | loaded by | role |
|---|---|---|
| `knowledge-compiler` | `src/semantic/knowledge/graph-map.ts` (semantic-v3) | graph-fragment invariants |
| `teaching-architect` | `src/semantic/planning/teaching-architect.ts` (V2 teacher role) | teaching-contract invariants |
| `visual-director` | `src/semantic/planning/visual-director.ts` (V2 scene role) | scene-direction invariants |
| `teaching-architect/references/knowledge-compiler.md` | `src/semantic/planning/knowledge-compiler.ts` (V2) | knowledge invariants |

Per §32 the names are not churned during migration: `teaching-architect` is the
current implementation of the Teacher Planner role, `visual-director` of the
Scene Director role. In semantic-v3 the scene worker carries its own inline
invariants (`src/semantic/scene/worker.ts`); a `scene-director` runtime skill is
only added if it earns its prompt cost. `vision-extractor` is conditional on VLM
extraction, which does not exist yet. Target: **3-4 runtime skills** (§31).

## Deterministic invariants (code + tests, never a prompt)

These have `SKILL.md` files but **no runtime caller**; their rules already live
in code and are enforced by tests (§28-30, §35):

| skill | where the rule actually lives |
|---|---|
| `whiteboard-planner` | `src/semantic/harness/state.ts` + `harness/gates.ts` (`gateWhiteboard`, `gateBoardAlignment`) |
| `representation-guide` | `src/semantic/identity/representation.ts` + `compiler/archetypes.ts` |
| `pedagogy-critic` | `src/semantic/harness/gates.ts` (`gateLesson`) |

Do not wire these into a prompt. If an invariant is missing, add it to the code
path and its test.

## Development / process documentation (not runtime)

`canvas`, `prompt-builder`, `video-generation`, `eval-audit`, `eval-builder`,
`skill-writer`. These describe engineering process; they must not increase
user-generation token cost (§35). Keep them as developer documentation.

## Deferred feature policy

`multilingual-teacher` and `pdf-extraction` stay disabled until the feature is
deliberately activated (§36, §70). `multilingual-teacher` is currently only read
by `test/skill-wiring.test.js`; language handling otherwise lives in the Teacher
Planner + `VoiceProfile`.

## Loading contract

`skillContract(name)` loads `skills/<name>/SKILL.md`; `skillDoc(relativePath)`
loads any document under `skills/`. Both hash the exact file content into stage
envelopes and expose the document's Hard invariants as bounded, non-executable
prompt instructions. An unloaded `SKILL.md` is still part of this classification
record — it is documentation, not dead code to delete without replacing its rule.

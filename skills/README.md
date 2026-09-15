# Skills manifest

Physical folders stay flat: `skills/<name>/SKILL.md`. Overflow contract detail
lives in `skills/<name>/references/` (progressive disclosure). Grouping below is
logical only.

## Pipeline order

```text
FOUNDATION
canvas
prompt-builder
pdf-extraction

KNOWLEDGE (owned by teaching-architect)
teaching-architect
  references/knowledge-compiler.md
  references/knowledge-compiler-evaluation.md
  references/source-visual-grounding.md
  references/source-visual-grounding-evaluation.md

TEACHING
teaching-architect
whiteboard-planner
multilingual-teacher

VISUAL
representation-guide
visual-director

EVALUATION
pedagogy-critic
eval-audit
eval-builder

OPERATIONS
video-generation

META
skill-writer
```

## Roles

| Skill | Role | Meaning |
|---|---|---|
| canvas | reference | Load knowledge only; emits nothing |
| representation-guide | reference | Lookup map; emits no scenes |
| prompt-builder | reference | Deterministic enrich; no LLM call |
| pdf-extraction | reference | Conditional fallback; not auto-loaded |
| teaching-architect | agent | May invoke model; owns knowledge compilation + source grounding references; emits TeachingContract |
| whiteboard-planner | agent | May invoke model; emits scene content |
| multilingual-teacher | agent | Language policy owner; applies target-language adaptation |
| visual-director | agent | May invoke model; emits direction |
| pedagogy-critic | critic | Validates artifacts; binary PASS/FAIL |
| eval-builder | harness | Run-level gates and reports |
| eval-audit | harness | Generic pipeline-hygiene audit |
| video-generation | orchestrator | Controls sequence and budgets |
| skill-writer | meta | Authors/reviews skill contracts |

Harness rules: reference → knowledge only; agent → may invoke model;
orchestrator → controls sequence; critic → validates artifacts.

## Ownership rule

Every responsibility has exactly one owner. Knowledge compilation and source
grounding are contract sections inside `teaching-architect/references/`, not
separate skills; language policy lives only in `multilingual-teacher`. If two
skills decide the same thing, merge them or make the authority explicit.

## Runtime loading

`skillContract(name)` loads `skills/<name>/SKILL.md`; `skillDoc(relativePath)`
loads any document under `skills/` (used for the relocated references above).
Both hash the exact file content into stage envelopes and expose the document's
Hard invariants as bounded, non-executable prompt instructions.

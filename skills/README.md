# Skills manifest

Physical folders stay flat: `skills/<name>/SKILL.md`. No nested groups —
discovery is flat and untested for recursion. Grouping below is logical only.

## Pipeline order

```text
FOUNDATION
canvas
prompt-builder
pdf-extraction

KNOWLEDGE
knowledge-compiler

TEACHING
teaching-architect
whiteboard-planner
multilingual-teacher        (stub — promotes after pedagogy ~8/10)

VISUAL
representation-guide
source-visual-grounding
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
| knowledge-compiler | agent | May invoke model; emits knowledge JSON |
| teaching-architect | agent | May invoke model; emits TeachingContract |
| whiteboard-planner | agent | May invoke model; emits scene content |
| multilingual-teacher | agent (stub) | Reroute to base pipeline until promoted |
| visual-director | agent | May invoke model; emits direction |
| source-visual-grounding | agent | May invoke model; emits grounding JSON |
| pedagogy-critic | critic | Validates artifacts; binary PASS/FAIL |
| eval-builder | harness | Run-level gates and reports |
| eval-audit | harness | Generic pipeline-hygiene audit |
| video-generation | orchestrator | Controls sequence and budgets |
| skill-writer | meta | Authors/reviews skill contracts |

Harness rules: reference → knowledge only; agent → may invoke model;
orchestrator → controls sequence; critic → validates artifacts.

No new skills beyond these 15 unless an eval trace exposes a repeated
failure with no clear existing owner.

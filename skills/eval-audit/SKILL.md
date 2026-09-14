---
name: eval-audit
description: >
  Generic eval-pipeline auditor. Use when inheriting or doubting an eval
  system (missing error analysis, unvalidated judges, vanity metrics).
  Never builds video-quality gates; that is eval-builder.
---

# Purpose

Surface prioritized problems in an existing eval pipeline with concrete
fixes. Hygiene layer above app-specific gates.

# When to use

Eval artifacts exist (traces, judge prompts, dashboards) and trust is
unclear, or no eval infrastructure exists and triage is needed.

# When NOT to use

Building explain-canvas-lab video gates (use eval-builder), per-lesson
repair (use pedagogy-critic), or new evaluators from scratch without error
analysis first.

# Inputs

Eval artifacts via observability MCP (Phoenix/Braintrust/LangSmith) or
local files (CSVs, trace exports, notebooks, eval scripts).

# Outputs

Findings report ordered by impact per area (error analysis, evaluator
design, judge validation, human review, labeled data, pipeline hygiene),
each `{status, explanation, fix}`. Consumed by maintainer + eval-builder
gate design. No video verdicts emitted.

# Hard invariants

- Inspect artifacts; never checklist-audit blind.
- Binary pass/fail judges over Likert; code checks over LLM judges for
  objective criteria; TPR/TNR over raw accuracy; train/dev/test split.
- No evaluators before error analysis; no LLM judges for checkable criteria.

# Decision procedure

1. Gather artifacts. 2. Run six-area diagnostics. 3. Order findings by
   product impact with skill/article-linked fixes. Full checklist:
   `references/checklist.md` (upstream detail:
   `.agents/skills/eval-audit/SKILL.md`).

# Failure conditions

Generic advice detached from artifacts; judges before error analysis;
similarity metrics as generation proof; set-and-forget evaluators.

# Repair behavior

Route to error-analysis / write-judge-prompt / validate-evaluator /
generate-synthetic-data / build-review-interface; re-audit after pipeline
changes.

# Success criteria

Each finding links evidence to a fix; video-gate overlap explicitly
deferred to eval-builder; re-audit cadence set.

# Representative evals

- `eval:trace-grounding`: every finding cites an artifact span. Objective.
- `eval:boundary`: zero video-quality gates claimed here. Script.

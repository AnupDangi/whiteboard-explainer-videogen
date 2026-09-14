---
name: eval-builder
description: >
  Video-lesson evaluator. Use to measure teaching and rendering success for
  explain-canvas-lab runs. Never uses BLEU/ROUGE/Likert as primary metrics.
---

# Purpose

Replace generic LLM eval with application-specific gates: stage success,
repair taxonomy, grounding, continuity, timing, export integrity, teaching
delta. Complements `eval-audit` (generic pipeline hygiene) and
`pedagogy-critic` (per-lesson binary checks).

# When to use

After runs: smoke benchmarks, critic A/B, multi-domain suites, performance
+ migration gates, release review.

# When NOT to use

Per-lesson repair routing (pedagogy-critic), generic eval-pipeline audit
(eval-audit owns), text-similarity scoring as quality proof.

# Inputs

- Run artifacts: job.json, telemetry, costs, contact sheets, MP4s.
- Manifest cases (48-case live manifest, smoke subset 6).
- TeachingContracts + checkpoints for delta scoring.

# Outputs

Report (`eval/live/reports/*.md` + json) consumed by HANDOFF/RESULTS and
router (`router:report`): stage rates (plan/direct/compile/TTS/fullJob),
repair histogram, failure taxonomy, fallback counts, cost/latency
percentiles, critic A/B verdicts, gate PASS/FAIL. No averaged-away critical
errors.

# Hard invariants

- Primary metrics are objective/deterministic first: schema validity,
  anchor resolution, evidence verbatim, compile success, fallback counts,
  static-interval timing, ffprobe codec/duration, frame counts.
- BLEU/ROUGE/BERTScore/cosine and Likert NEVER primary; allowed only as
  secondary retrieval/text signals with explicit limits.
- Judge verdicts need validation (TPR/TNR on held-out sets, train/dev/test
  split); unvalidated judges labeled exploratory.
- Fixture throughput never reported as LLM/TTS performance; estimated timing
  labeled; provider failures visible with $0-cost failure records.
- Human teaching/aesthetics judged blind where claimed; disagreements kept.

# Decision procedure

1. Collect stage telemetry + costs; compute success rates and repair/fallback
   histograms.
2. Run objective validators (schema, anchors, grounding, compile, timing,
   export).
3. Run judge validators only for semantic delta/aesthetics with validated
   judges; record alignment stats.
4. Gate: teaching gates (critic PASS, checkpoint answer) + reliability gates
   (compile/export) + budget gates must all pass; no compensation across
   critical failures.

# Failure conditions

Vanity metrics, unvalidated judge as gate, accuracy-only alignment on
imbalanced sets, fixture-as-live claims, silent fallback success, averaged
critical errors.

# Repair behavior

Failing gate routes to stage owner (architect/planner/director/compiler/
speech), not metric reshaping. Re-run error analysis after pipeline changes;
re-validate judges on fresh labels.

# Success criteria

Report states environment, inputs, commands, observations, limits; gates
PASS/FAIL explicit; next bounded task named.

# Representative evals

- `eval:smoke-6x3`: 6 cases x 3 runs stage rates + cost/latency.
- `eval:critic-ab`: A/B+B/A order, accuracy 1.0 target on known corruptions.
- `eval:export-gate`: ffprobe + frame checks. See `references/metrics.md`.

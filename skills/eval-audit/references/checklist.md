# Audit checklist (condensed)

Upstream protocol: `.agents/skills/eval-audit/SKILL.md`.

1. Error analysis: labeled traces, observed (not brainstormed) failure
   categories; ~100 traces for saturation.
2. Evaluator design: binary pass/fail; one failure mode per judge; code
   checks for objective criteria; no ROUGE/BERTScore/cosine as generation
   proof.
3. Judge validation: human labels, TPR/TNR, train/dev/test split, ~50
   pass + ~50 fail for reliable rates.
4. Human review: domain experts, full traces, formatted UI.
5. Labeled data: random + cluster + outlier + feedback sampling.
6. Hygiene: re-run analysis + re-validate judges after model/prompt/feature
   changes.

Boundary: app video gates (stage rates, grounding, timing, export,
critic A/B) live in `eval-builder`; per-lesson binary checks in
`pedagogy-critic`.

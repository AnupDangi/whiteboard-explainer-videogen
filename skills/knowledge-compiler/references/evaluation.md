# Knowledge-compiler evals

- `eval:alias-collapse`: fixture with `v41-flash`, `v41_flash`,
  `v41-flash-total`, `active-params`, `active_p` → 2 canonical keys.
  Objective via registry key set.
- `eval:dag-valid`: script checks prerequisites acyclic + every prereq key
  defined + every claim has evidence span substring of source.
- `eval:transition-sharing` (judge-assisted): rerun DeepSeek-style chapter
  set → count adjacent transitions sharing >=1 concept; must rise vs 13/59
  baseline. Report only, not a gate until architect wiring lands.

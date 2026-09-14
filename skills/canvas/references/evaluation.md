# Canvas evals

- `eval:render-determinism`: two renders, same scene+ms -> identical bytes.
  Objective, no judge.
- `eval:identity-stability`: 3-scene lesson repeating 2 concepts -> same
  kind/family/color, zero identity rejections. Objective via diagnostics.
- `eval:minimality`: scene with decorative node proposed -> critic flags
  removal; compiled node count drops, beat coverage unchanged.

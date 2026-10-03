# Codex project instructions

Read and follow [`CLAUDE.md`](CLAUDE.md), which is the canonical project rule set for this repository. In particular, keep lesson-specific content out of runtime branches, preserve frozen baselines, and treat missing evidence or hard gate failures as failures rather than successful output.

## STCC — constitutional authority

Before making architecture-sensitive changes, read
[`docs/architecture/SIMI-TEACHING-COMPILER-CONSTITUTION.md`](docs/architecture/SIMI-TEACHING-COMPILER-CONSTITUTION.md)
(call it **STCC**). Precedence: explicit human instruction > STCC >
stage contract/schema > repository implementation (including CLAUDE.md) >
tests/evals > external docs > model assumptions. Do not reinterpret or
silently override STCC. If repository reality contradicts STCC, report
`ARCHITECTURE_DRIFT` (expected / observed / files / impact / owner stage)
and stop; do not silently rewrite either side.

Before changing code, read `docs/HANDOFF.md` and then `docs/ARCHITECTURE.md`. Verify with `pnpm run typecheck:hypothesis` and `pnpm run test:hypothesis`; record exact evidence and limitations in the existing `docs/HANDOFF.md`. Keep this experimental track separate from the production runtime until its validation gates pass.

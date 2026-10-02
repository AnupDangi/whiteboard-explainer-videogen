# Codex project instructions

Read and follow [`CLAUDE.md`](CLAUDE.md), which is the canonical project rule set for this repository. In particular, keep lesson-specific content out of runtime branches, preserve frozen baselines, and treat missing evidence or hard gate failures as failures rather than successful output.

Before changing code, read `docs/HANDOFF.md` and then `docs/ARCHITECTURE.md`. Verify with `pnpm run typecheck:hypothesis` and `pnpm run test:hypothesis`; record exact evidence and limitations in the existing `docs/HANDOFF.md`. Keep this experimental track separate from the production runtime until its validation gates pass.

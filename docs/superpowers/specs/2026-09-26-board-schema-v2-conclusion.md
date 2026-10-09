# Board schema v2 — conclusion (initial, unmeasured)

Required by `2026-09-26-board-schema-v2-design.md` §8.

- **Status:** `unmeasured`. The spec's paid validation (five new held-out 60s sources, S2–S4 cache reusable, MP4 + contact sheets + Simi side-by-side) has not been run in this worktree. No user "works / doesn't work" verdict recorded.
- **OBSERVED (not spec evidence):** existing diagnostics (`output/stcc-proof/physics-rc` draft, HANDOFF `icons*/tfm*/fix*/rich*` runs) are development/diagnostic runs, not the spec's held-out set. They must not be substituted.
- **Pipeline semantics unchanged:** S5 stays hard-fail until human alignment calibration exists; no run labeled `passed` on calibration grounds. User review, when it happens, recorded separately as hypothesis verdict.
- **Next:** run the spec §8 paid set only with explicit approval, then append run IDs, hashes, contact-sheet paths, and the verbatim user verdict here + `docs/HANDOFF.md`. Phase 5 v1-path removal stays gated on a "works" verdict.

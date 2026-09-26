# Plan amendments

## 2026-09-26 — Approved source-grounded, duration-aware long-form scope

- **Scope:** Implement a single source-grounded teaching-video pipeline for 1, 5, 10, and 30 minute requests, including working document/URL RAG, hierarchical duration-aware teaching plans, speech timing, bounded parallel scene/audio/visual generation, richer mathematical visuals, run-level cost/latency accounting, and staged validation/cleanup. Work phase by phase; do not begin the next phase until the current phase is implemented and verified.
- **User approval (2026-09-26):** “PLEASE IMPLEMENT THIS PLAN:” (followed by the full plan in the user message); “now start implementing complete one by one don't jump without completing one”.
- **Applied:** Phase 0 run accounting is complete. Every lesson execution has run-unique output and summary paths, reusable stage cache remains shared, provider stage intervals are recorded, S4 scene costs are visible, cache spend is separated from original artifact spend, and the manifest distinguishes preparation from pipeline/full wall time.
- **Applied:** Phase 1 source intake and evidence retrieval is complete. Multiple local files and public HTTPS sources produce a hashed bundle with ranked exact citations and native locations; PDF/Office/HTML embedded images carry provenance and can be indexed along with tables and equations by the optional RAG-Anything sidecar. When that sidecar is unavailable, evidence uses explicitly labeled local text retrieval.
- **Applied:** Phase 2 duration-aware planning is implemented in `plan/hierarchical.ts` and `pipeline/lesson.ts`. The supported 60/300/600/1800-second requests use a validated syllabus with stable concept IDs, prerequisite order, source evidence, and exact 1- or 5-minute module budgets; modules receive bounded graph/plan/script calls and merge into a global lesson bible with requested/planned duration and coverage reason. Cost caps are now duration-aware and shorten with the planned duration.
- The frozen plan file remains unchanged. Phase 3 is the next bounded phase: measured word alignment, persistent speech workers, and audio-master module budget adjustment. Do not begin Phase 4 until Phase 3 tests, architecture documentation, and handoff are complete.

## 2026-09-26 — Phase 4 work deferred until Phase 3 is complete

- **User direction:** “complete one by one don't jump without completing one,” clarified after an earlier instruction to continue following review remediation.
- **Decision:** Phase 4 must wait until Phase 3 is complete, including its two-human timing calibration and aligner decision. Review defects in workers, abort handling, RAG evidence mapping, and syllabus recall validation were fixed because those remediate the review and current phases; the Phase 4-only bounded planner/event experiment was removed from the worktree. No calibration data was changed and no generated lesson was marked passed.
- **Current gate:** the five-source pack has two participant pages, but the review directory contains no exported vote JSONs or scored report. Continue Phase 3; do not proceed to Phase 4 yet.

## 2026-09-26 — Sequencing decision superseded: parallel engineering while calibration remains open

- **User approval (2026-09-26):** “PLEASE IMPLEMENT THIS PLAN” (the user's approved plan directs that later engineering may proceed while human calibration is pending; Phase 3 and publication remain gated).
- **Decision:** supersede the prior stop-work direction. Phase 4 and Phase 5 engineering may proceed in parallel on disjoint files after their shared event/visual contracts are agreed. Keep Phase 3 incomplete and publication blocked until two independently produced human vote files are scored, candidate errors and reviewer agreement are inspected, and every release gate passes.
- **Coordination:** configure user-level Codex implementer, tester, and reviewer roles, cap concurrent subagents at three, and keep the parent responsible for shared interfaces, integration, handoff, and acceptance status. Preserve all existing uncommitted work. Do not commit, push, deploy, edit frozen plans, or create human labels.
- **Validation:** offline tests verify software contracts only. Phase completion and `passed` run status require the phase-specific measured and human evidence in the original plan.

## 2026-09-25 — Task 5 example bank version assertion

- **Scope:** Update the existing `scene-context.test.ts` assertion for `EXAMPLE_BANK_VERSION` from `/v3/` to `/v4/`, matching Task 5's planned `mechanism-bank/v4` bump.
- **Reason:** The frozen plan explicitly required bank v4, while the existing assertion still expected v3. The Task 5 brief required reporting the mismatch before editing the assertion.
- **User approval (2026-09-25):** “Yes, update it (recommended)”
- **Applied:** `src/experimental/hypothesis/v1_claude/__tests__/scene-context.test.ts` now asserts `/v4/`.

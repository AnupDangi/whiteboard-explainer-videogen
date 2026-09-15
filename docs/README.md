# docs index

Authoritative documents (in priority order):

- `../PLAN_TO_IMPLEMENT.md` — **the implementation plan** (11 phases, contracts,
  test/acceptance plan). Source of truth for what is being built.
- `HANDOFF.md` — current state, next bounded task, known issues.
- `ARCHITECTURE.md` — current module map, pipeline flows, logging ledger.
- `mermaid-diagram.png` — **target architecture diagram** (the system this plan
  builds). Referenced by `ARCHITECTURE.md`.
- `RESULTS.md` — append-only evidence log of live runs.
- `V4_IMPLEMENTATION.md` — append-only V2 build log (currency note at top).
- `HYPOTHESES.md`, `EXPERIMENTS.md` — research framing and experiment record.
- `v4/` — V4 spec reference package (contracts, not implementation status).
- `README.md` (this file).

Supporting evidence / plans:

- `PERFORMANCE_ANALYSIS.md` — measured latency/cost, model-router and
  parallelism plan.
- `SOURCE_INTELLIGENCE_PLAN.md` — LD1–LD8 source-intelligence program.
- `REVIEW_CORPUS.md` — fixed review corpus.
- `OPTIMIZATION_PLAN.md` — original V2 roadmap; Phases B–H never implemented.
- `VIDEO_QUALITY_REVIEW.md` — 2026-09-09 quality review.

Superseded/invalid documents are deleted rather than archived, so the index
never points at stale guidance. If a document is no longer authoritative, move
its still-relevant facts into `HANDOFF.md`/`RESULTS.md`, then delete it.

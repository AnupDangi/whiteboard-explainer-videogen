# Lamina Labs Clone (archived research project)

Status: **archived**. Development moved to a fresh Python implementation. This repository documents what was built and what was learned.

## What this was
An attempt to reproduce the behaviour of a narrated, hand-drawn whiteboard explainer-video product ("Simi" / Lamina Labs) as a deterministic, source-grounded pipeline: source text, then evidence, concept graph, teaching plan, narration, audio alignment, board layout, timeline, SVG, MP4.

## What exists in this repository
- TypeScript pipeline (V1 compiler, experimental V2 board-ops path) with stage caches, content-hashed locks, a fail-closed cost ledger and a validation harness.
- An icon/asset resolver over several catalogs.
- A frozen benchmark definition and run harness.
- Handoff documents in `docs/` (`BRANCH-HANDOFF.md`, `HANDOFF.md`, `ARCHITECTURE.md`).

## Outcome (measured, small sample)
- 8 of 8 benchmark lessons produced an MP4 with 0 hard failures, all graded `draft` (none `passed`); 60-80 s videos, about 180-260 s cold generation, about $0.02 per lesson.
- Visually the boards remained label/box-heavy compared with the illustrated reference style. The frozen benchmark scorer did not pass (contract gaps, not a benchmark pass).
- The experimental V2 path produced no accepted output.

## Tags and branches
- `stcc-charter-v1`: final state of this line (this is `main`).
- `v0.01`, `v0.0.2`, `v0.0.3`, `v0.3.0`, `v1.0.0`, `v0.2.0`: earlier milestones.
- `archive/*`: preserved copies of every former branch.

## Licensing note
Third-party icon sets and reference imagery appear in this repository's history. They remain under their own licences and are not offered for reuse.

# Explain Canvas Lab v4 handoff package

Source-grounded visual teaching compiler. Not Simi source code; Simi is a
quality/performance benchmark only. See `AGENTS.md`.

Current implementation note (2026-09-14): semantic V2 is wrapped by the
versioned `teaching-compiler-v1` harness with typed learner, identity, stage,
journal, representation, gate, and accounting contracts. This is an additive
compatibility refactor; the 48×3 narrated and human migration gates remain open,
so V1 is still the default. Exact evidence and limitations are in
`../HANDOFF.md` and `../RESULTS.md`.

| Doc | Contract |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Production architecture: semantic storyboard, mental-model selector, concept/visual bible, asset engine, SceneGraph V2, hero-first composition compiler, semantic collisions, path drawing, timing compiler, progressive playback, plant benchmark. |
| [TASKS.md](TASKS.md) | Ordered implementation sequence. Manual plant golden (Phase 5) is the first milestone. |
| [TESTS.md](TESTS.md) | Test layers T0-T9 by failure class, incl. evaluator corruption tests. |
| [EVALUATION.md](EVALUATION.md) | Results contract: Truth, Teaching, Visual, Timing, Reliability, Performance kept separate. |
| [HARNESS.md](HARNESS.md) | Bounded model-stage behavior and prompt contracts. |

Core rule: models produce validated scene data; deterministic code computes
geometry; `renderSVG(scene, timeMs)` stays pure. No arbitrary generated
Python/JavaScript execution and no Manim pipeline.

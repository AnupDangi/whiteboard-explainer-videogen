# Implementation plan and status

Date: 2026-09-07. Goal: test a data-driven whiteboard explainer architecture, then publish a new repository for Anup Dangi.

## Central hypothesis

An AI can choose conceptual scenes, objects and narration anchors while a fixed engine resolves geometry and draws a timed explanation. Incremental scene preparation can make playback available before the entire explanation is ready. This may avoid the fragility of generating a complete animation program per request.

## Milestones

| Milestone | Status | Evidence / next action |
|---|---|---|
| Research register with 23 hypotheses | Complete | `docs/HYPOTHESES.md`; distinguishes company claims from our experiments. |
| Reproducible experiment protocol | Complete | `docs/EXPERIMENTS.md`, E01–E08. |
| Scene validator, layout and deterministic renderer | Implemented and unit-tested | `src/engine.js`; render at explicit timestamps. |
| Useful offline examples | Complete | Attention and photosynthesis fixtures; `examples/attention.plan.json`. |
| Local UI and background jobs | Implemented; server lifecycle tested | `public/`, `src/jobs.js`, `src/server.js`; live browser QA pending. |
| Optional model and speech adapters | Implemented; mocked contract tests pass | Real credentials and provider run required. |
| MP4 export | Silent path tested | 945 frames, 1280×720, 12 fps, 78.75 seconds. Real narration mux QA pending. |
| Measured findings and limitations | Complete | `docs/RESULTS.md`. |
| Continuation handoff | Complete | `AGENTS.md`, `docs/HANDOFF.md`. |
| New GitHub repository and push | Blocked by available creation/authentication capability | User already authorized this; see README publication command. |

## Next bounded implementation cycle

1. Review current tests and rendered example before changing architecture.
2. Run browser checks for play/pause/seek and buffer stall/resume; then repeat with real narration.
3. Run one live model request and preserve its plan, usage and elapsed time privately.
4. Replace heuristic text measurement after a failing label demonstrates the need; validate across both render targets.
5. Run the 20-prompt quality corpus. Expand primitives only to address concrete failures.
6. Publish to a newly created private GitHub repository once creation is available; record actual URL and commit SHA.

## Non-goals for this cycle

Foundation-model training, Manim code generation, cloud deployment, subscriptions, user accounts, arbitrary illustration generation, an infinite canvas editor and a broad autonomous multi-agent system.

## Definition of a reviewable result

The next agent can run the demo without keys, reproduce core tests, regenerate the export with documented dependencies, identify which claims remain hypotheses, and choose one next experiment without reconstructing this conversation.

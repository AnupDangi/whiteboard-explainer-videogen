# Instructions for the next agent

This is Anup Dangi's independent research prototype, not Lamina Labs source code.

1. Read `docs/HANDOFF.md`, then `docs/ARCHITECTURE.md`, `PLAN_TO_IMPLEMENT.md`, and `docs/ICON_SYSTEM_PLAN.md`. These four are the only project documents; do not recreate the deleted history files.
2. Run `npm test` before editing. No provider keys or installed dependencies are required for the core tests.
3. Preserve the central constraint: models produce validated scene data; do not introduce arbitrary generated Python/JavaScript execution or a Manim pipeline.
4. Keep `renderSVG(scene, timeMs)` deterministic. Browser and export use that same renderer. Do not add wall-clock animation state to the renderer.
5. Keep estimated timing and injected preparation delays visibly labeled. Never report fixture throughput as LLM/TTS performance.
6. A passing local experiment establishes feasibility of OUR implementation, not how Lamina works. Only primary disclosures establish facts about that company.
7. Do not invent API credentials or change a provider failure into a successful fixture response. Provider failures must remain visible.
8. Keep keys in `.env`, media and job data in `.data/`, exports in `output/`; all are ignored by Git. Do not commit the user's uploaded competitor video.
9. Update `docs/HANDOFF.md` with exact tests, limitations, and the next bounded task after material changes. Do not recreate `docs/RESULTS.md` — measurements belong in `HANDOFF.md`.
10. The user authorized creating a new GitHub repository at the end. Prefer a private repository unless they request public visibility. Do not overwrite an existing repository with the same name. Record the actual URL only after successful creation and publication.
11. The user welcomes future-agent continuation; this file is a handoff, not a request to spawn agents automatically.
12. Use the code graph for orientation before reading files: `graphify` MCP tools (wired in `opencode.json`) or `graphify query "<question>"`. Regenerate it after any wave that touches `src/` with `graphify update . --force`, and record the node/edge delta in `docs/HANDOFF.md`. The graph proves *structure* (extracted from syntax), not semantics — confirm behavioural claims by reading the file.

13. The `semantic` (V2) pipeline is the default and the only one receiving new work. `explainer` (V1) is **FROZEN LEGACY**: security and critical-regression fixes only, no new capability work, and it is not deleted until the migration gates in `PLAN_TO_IMPLEMENT.md` pass. Do not spread effort across both pipelines.

Keep this a focused local research application. Authentication, billing, a cloud deployment and an infinite canvas editor are outside v0.1 scope.

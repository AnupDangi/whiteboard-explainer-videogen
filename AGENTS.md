# Instructions for the next agent

This is Anup Dangi's independent research prototype, not Lamina Labs source code.

Critical Notes and Guidelines:

Always analyze the tasks complexity if we require subagents to be called to analyze or implement any faeture use it.
Don't try to patch the solutions with agents
After completing tasks audit and update all the docs files which needs to be updated.
Use graphify to search files if graphify is not well updated run it
Review the code and fix bugs if you find don't patch any solution or hardcode to make something work

IF the files to be read are not there just start geenrating by reading the codebase.

1. Read `docs/HANDOFF.md`, then `docs/ARCHITECTURE.md`.
2. Run `npm test` before editing. No provider keys or installed dependencies are required for the core tests.
3. Preserve the central constraint: models produce validated scene data; do not introduce arbitrary generated Python/JavaScript execution or a Manim pipeline.
4. Keep `renderSVG(scene, timeMs)` deterministic. Browser and export use that same renderer. Do not add wall-clock animation state to the renderer.
5. Keep estimated timing and injected preparation delays visibly labeled. Never report fixture throughput as LLM/TTS performance.
6. A passing local experiment establishes feasibility of OUR implementation, not how Lamina works. Only primary disclosures establish facts about that company.
7. Do not invent API credentials or change a provider failure into a successful fixture response. Provider failures must remain visible.
8. Keep keys in `.env`, media and job data in `.data/`, exports in `output/`; all are ignored by Git. Do not commit the user's uploaded competitor video.
9. Update `docs/HANDOFF.md` (evidence log entries) with exact tests, limitations, and the next bounded task after material changes.
10. The user authorized creating a new GitHub repository at the end. Prefer a private repository unless they request public visibility. Do not overwrite an existing repository with the same name. Record the actual URL only after successful creation and publication.
11. The user welcomes future-agent continuation; this file is a handoff, not a request to spawn agents automatically.

Keep this a focused local research application. Authentication, billing, a cloud deployment and an infinite canvas editor are outside v0.1 scope.

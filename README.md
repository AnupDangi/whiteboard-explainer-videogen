# Explain Canvas Lab

An independent research prototype by Anup Dangi for **validated scene data → deterministic whiteboard animation → progressive playback → narrated MP4**. Built to test the canvas hypothesis while studying Lamina Labs / Simi.

This is not Lamina's code. It uses no Lamina API, private code, logo or uploaded demo. Passing our own experiments establishes feasibility of *our* implementation only — it does not establish how Lamina works.

## Start here

Node.js 22+. The web demo and core tests need **no dependencies and no API key**.

```bash
npm start          # http://127.0.0.1:3000
npm test           # builds, then runs the whole node:test suite (fixture-based)
npm run build      # tsc
```

Select an offline fixture and generate; press Play after the first scene arrives. Offline fixtures are silent and show narration as timed text. Estimated timing and injected preparation delays are always labelled as such and are never presented as model/TTS performance.

## Two pipelines

Selected by `VISUAL_PIPELINE` (`src/semantic/pipeline.ts:4`):

- **`semantic` (default)** — the V2 teaching pipeline → `planning/generate.ts`. All current work targets this.
- `explainer` — the original node/edge planner → `explainer/planner.ts`. **FROZEN LEGACY**: kept as the comparison baseline and documented fallback until the executable migration gates in `eval/live/gates.ts` pass, but it receives no new capability work. Select it with `VISUAL_PIPELINE=explainer`.

V2 runs four model calls per scene (knowledge → teaching → architect → director) and compiles everything else deterministically. Models emit validated semantic data only; geometry is built by trusted code and rendered by a pure `renderSVG(scene, timeMs)` shared by browser and export.

## AI generation

Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`. Per-task routes are pinned by `OPENROUTER_OUTLINE_MODEL`, `OPENROUTER_CONTENT_MODEL`, `OPENROUTER_DIRECTOR_MODEL` (all default to the shortlist head in `src/shared/model-router.ts:15`). `OPENROUTER_MODEL` only sets the base and is overridden by the per-task vars.

Narration is **local-only** via the separate `voice-engine/` project (Supertonic 3 default, Piper fallback) over an async JSON boundary. No speech key is used. Local engines return duration, not word timings, so timing is marked `LOCAL TTS · ESTIMATED WORD TIMING`, never as provider alignment.

Provider failures stay visible (`402 quota`, `403 budget`, `429 rate limit`). They never silently become a fixture or a successful silent job.

## Export MP4

Requires FFmpeg plus the optional `sharp` dependency.

```bash
npm run export -- --fixture attention --fps 12 --width 1280 --out output/attention.mp4
node dist/scripts/export-semantic-job.js --job <uuid> --data-root .data/video-jobs --out output/lesson.mp4
```

A V2 job is only publishable when `finalGate === 'PASS'`; otherwise the MP4 is withheld (`src/semantic/jobs.ts:143`). A downloaded JSON alone does not contain narration bytes — the adjacent WAV files are required.

## Documentation

| File | Purpose |
|---|---|
| [Architecture_plan.md](Architecture_plan.md) | Target-state architecture — the authority. Not yet implemented. |
| [PLAN_TO_IMPLEMENT.md](PLAN_TO_IMPLEMENT.md) | Complete overview of the target end to end. Where it disagrees with `Architecture_plan.md`, the latter wins. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | What the codebase actually is, with `path:line` evidence. |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Current state, measured bottlenecks, open decisions, next bounded tasks. |
| [docs/ICON_SYSTEM_PLAN.md](docs/ICON_SYSTEM_PLAN.md) | Dynamic representation subsystem: P0–P3b landed, P4+ pending. |
| [AGENTS.md](AGENTS.md) | Repository rules and research guardrails. |

## Code graph (graphify)

The repo carries a queryable AST knowledge graph that opencode exposes as MCP tools (see `opencode.json`).

```bash
graphify update . --force      # regenerate after changes to src/
graphify query "how does the visual-director stage reach the renderer"
graphify god-nodes
```

`graphify-out/` is gitignored because it is regenerated on demand, but `opencode.json` points the MCP server at `graphify-out/graph.json`. **Run the update command once before relying on the graph tools.** The `command` path in `opencode.json` is machine-specific (a `uv` tool venv); adjust it if the graphify install lives elsewhere.

The graph is extracted from syntax (98% EXTRACTED). It proves *structure* — who calls whom, what is orphaned — not behaviour. Confirm semantic claims by reading the file.

## Limits

Loopback-only single-process prototype, not a deployed product. Delivery is JSON snapshot polling, not HLS. Default timing is estimated; layout uses heuristic text widths. Real-model output quality, multi-scene continuity rendering, latency and production cost are **not** yet verified end to end. There is no billing, cloud storage, infinite canvas editor, or model-repair loop.

## Publish to GitHub

The remote `origin` already exists (`github.com/AnupDangi/lamina-labs-clone`); do not create or overwrite it. `scripts/publish-github.ts` is a standalone script excluded from `tsconfig.json` and has no `package.json` entry — invoke it directly if publication is ever needed, and never overwrite an existing repository.

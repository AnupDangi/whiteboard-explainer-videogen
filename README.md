# Explain Canvas Lab

A working research prototype for **structured scene data → timed whiteboard animation → progressive playback → MP4**. Built for Anup Dangi to test the canvas hypothesis discussed while studying Lamina Labs/Simi.

This is an independent implementation. It does not use Lamina's API, private code, logo, or uploaded demo. Passing our experiments does not establish how Lamina's product works.

Source layout is documented in [src/README.md](src/README.md): `explainer/` (default node/edge pipeline), `semantic/` (V4 teaching pipeline) and `shared/`. The local narration engine lives in [voice-engine/](voice-engine/).

## Start here

Requires Node.js 22 or newer. The web demo and core tests have **no package dependencies or API-key requirements**.

```bash
npm start
```

Open `http://127.0.0.1:3000`. Select an offline fixture and generate. Press Play after the first scene arrives. Increase the simulated preparation delay to inspect the growing available timeline and buffering. Offline fixtures are silent; their narration appears as timed text.

```bash
npm test
npm run benchmark
```

## What works

- Two hand-authored explanations: attention and photosynthesis.
- Validated scene plans with three constrained layouts: flow, branch and comparison.
- Deterministic SVG whiteboard renderer, progressive strokes and stable object placement.
- Play/pause, seeking, playback speed, transcript, available duration and preparation log.
- Background scene preparation with configurable delay injection, local snapshots and cancellation.
- Optional OpenRouter plan generation (Anthropic legacy still supported) and local voice-engine narration (Supertonic 3 / Piper).
- Offline MP4 rendering with the same SVG renderer used by the browser.

The main rendering surface is SVG, not HTML Canvas 2D. The research question is data-driven drawing, independent of that implementation detail. No model-generated executable code is run. TypeScript build required (`npm run build`).

## Enable actual AI generation

Copy `.env.example` to `.env`. Set `OPENROUTER_API_KEY` (default model `google/gemini-3.8-flash`, set via `OPENROUTER_MODEL` to override). Restart `npm start`, choose **AI planner → OpenRouter**, and enter a prompt or paste source text / URL / PDF.

Narration is **local-only**: the free CPU voice-engine at `voice-engine` (Supertonic 3 default, Piper fallback; Nepali always Piper), called over an async JSON boundary. No speech key is used. The repository contains no keys.

Provider adapters were verified with mocked responses and now also with live OpenRouter runs plus real local voice-engine synthesis for 1-minute chapters. Missing keys or provider failures produce visible errors (including `402 quota` / `429 rate limit`); they never silently substitute a fixture. Budget reservation is per-call progressive — already prepared chapters remain playable on budget/quota exhaustion.

## Export MP4

Install FFmpeg on your system and the optional Sharp dependency:

```bash
npm install
npm run export -- --fixture attention --fps 12 --width 1280 --out output/attention.mp4
```

For a generated job, copy its ID from the JSON download, then export the original local snapshot:

```bash
npm run export -- --input .data/JOB_ID/job.json --out output/explanation.mp4
```

Narrated jobs require their adjacent scene MP3 files. A downloaded JSON alone does not contain those bytes. Silent exports have no audio track. The initial tested example is 78.75 seconds at 1280×720 and 12 fps. The engine computes a 78.74-second timeline; the 10 ms difference is frame quantization.

## Research and continuation

| File | Purpose |
|---|---|
| [PLAN.md](PLAN.md) | Implementation milestones and current status. |
| [docs/HYPOTHESES.md](docs/HYPOTHESES.md) | All 23 assumptions, confidence and corresponding experiments. |
| [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) | Inputs, commands, thresholds and failure criteria. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, contracts, design decisions and limits. |
| [docs/RESULTS.md](docs/RESULTS.md) | Measurements and unverified claims. |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Exact next tasks for another agent. |
| [AGENTS.md](AGENTS.md) | Repository instructions and research guardrails. |

## Publish to GitHub

Repository creation was not available through the connected tool surface during this build, and the local GitHub CLI was unavailable. **No remote repository is claimed to exist.** Source is ready for publication once an authenticated creation route is available.

With [GitHub CLI](https://cli.github.com/) installed and authenticated:

```bash
gh auth login
npm run publish:github -- explain-canvas-lab --publish
```

The script creates a **private** repository and pushes the source. Pass `--public` only if you want public visibility. It fails if repository creation fails; it does not overwrite an existing repository. If Git lacks author identity, set your normal `git config user.name` and `git config user.email` first.

## Limits

This is a loopback-only, single-process prototype, not a deployed multi-user product. Delivery is JSON snapshot polling, not HLS video streaming. Default timing is estimated. Layout uses heuristic text widths; multilingual shaping and exact browser font metrics need further work. AI content quality, real narration synchronization, browser audio edge cases and production cost/latency remain unverified. There is no training pipeline, billing, cloud storage or automatic model-repair loop.

### Narration voices

**Local voice-engine** (default, `--tts voice-engine`) is free, CPU-only and needs
no API key. It is a **separate project** at `voice-engine`
(async JSON stdin/stdout boundary). Supertonic 3 is the default for its 31
supported languages; Piper is the fallback for everything else, and Nepali is
always Piper. Set `VOICE_ENGINE_DIR` to override the path, `VOICE_ENGINE_LANGUAGE`
for the language, `VOICE_ENGINE_PROVIDER=auto|supertonic|piper` to force one.
Local engines return audio duration, not word timings, so the boundary marks
timing explicitly as estimated (`local TTS · estimated word timing`), never as
provider alignment.

Provider failures are visible errors; they never become successful silent jobs.
Reopen a saved job using `/?job=JOB_UUID` on the local server.

`npm run test:live -- --minutes 1 --voice --tts voice-engine --budget 0.1` uses
configured OpenRouter credentials plus the local engine for a quick end-to-end
check without a full MP4 export.

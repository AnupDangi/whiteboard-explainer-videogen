---
name: video-generation
description: End-to-end whiteboard lesson video generation with the flat src/ pipeline (S1 intake through S12 gates). Single-prompt one-shot runs, lesson CLI, preview, and judge.
---

# Video generation skill (orchestrator)

Pipeline lives in flat `src/`: `intake plan narration audio planner assets render layout timeline export validate harness run llm shared`. Models emit validated scene data only; `renderSVG(scene, timeMs)` is deterministic and shared by browser preview and MP4 export. Never commit `.env`, `.data/`, or `output/`.

## Prerequisites

`.env` with `OPENROUTER_API_KEY`, `OPENROUTER_CONTENT_MODEL`, `OPENROUTER_SCENE_MODEL` (+ optional `OPENROUTER_VISION_MODEL` for the judge). FFmpeg installed. `pnpm install` done. Voice needs no key: `pnpm run voice-engine:setup` once.

## One-shot video (primary path)

```bash
pnpm run build
pnpm run video:one-shot -- --prompt="Explain X simply" --source=bench/sources/half-life.md --duration=60 --id=my-run
# --source=<file> | --url=<https-url> (exactly one) · --duration=60-3600s (whole seconds; canonical 60|300|600|1800)
# output: output/<id>-<timestamp>/video.mp4 + .vtt + contact-sheet.png + provenance.json
```

Requires a clean git tree (provenance guard). With uncommitted changes, call the lesson CLI directly instead:

```bash
node dist/src/run/lessonCli.js --source=bench/sources/half-life.md --prompt="..." --duration=60 --id=my-run --out=.data/my-run --allow-partial-video
```

## Preview and judge

```bash
pnpm run preview:hypothesis -- <run-directory> [port]   # loopback browser player, same frame composer as export
pnpm run judge:hypothesis -- --runs=<run-dir>            # VLM judge on a complete run (needs vision model + $0.25 cap)
```

## Verify before delivering

1. `pnpm run typecheck:hypothesis && pnpm run test:hypothesis` — green, no keys needed.
2. Run status is `draft` unless S5 alignment calibration is measured and human muted-board review passed — never present a draft as publishable.
3. Check: scene count matches duration budget, hard findings = 0 for a clean run, contact sheet inspected frame by frame, MP4 1920x1080 H.264 + AAC + captions.
4. Append exact commands, costs, wall time, limitations, and next task to `docs/HANDOFF.md`.

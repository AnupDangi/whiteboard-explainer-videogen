---
name: video-generation
description: End-to-end whiteboard video generation — plan chapters, synthesize narration, compile canvas scenes, verify, export MP4. Supports 1/5/10-minute targets.
---

# Video generation skill (orchestrator)

Generate narrated whiteboard videos with the prompt-builder → planner →
director → compiler → speech → renderer pipeline. Default model stack:
planner + director on `OPENROUTER_MODEL` (default
`google/gemini-3.8-flash` — confirmed current best fast/structured-JSON
model in the OpenRouter catalog; tested alternative: `google/gemini-3.7-flash`),
optional critic on `openai/gpt-5.6-luna`, speech on Kokoro local neural
voice (`--tts kokoro`, the default; ElevenLabs available via `--tts elevenlabs`).
There is no robot/local-espeak voice anymore — Kokoro replaced it entirely
(better quality, still free, still no key). Deterministic engine only — no
generated drawing code, no Manim.

## Prerequisites

`.env` with `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`).
FFmpeg + `npm install` (sharp) required for MP4 export. Kokoro narration
needs no speech key. Never commit `.env`, `.data/`, or `output/`.

## Kokoro voice setup (free, local, no key)

Apple Silicon + `espeak-ng` on PATH (`brew install espeak-ng`):

```bash
npm run kokoro:setup
```

This creates a **persistent** venv at `.kokoro-venv/` inside the repo (not
`/tmp` — that was the actual reliability problem: it gets wiped, forcing a
manual rebuild every session). After this one-time setup, `generateKokoroSpeech`
(`src/kokoro-speech.ts`) self-heals: it checks the persistent server's
`/health`, and if it's not running, spawns it from `.kokoro-venv/bin/python`
automatically and waits for it to come up — no manual `npm run kokoro-server`
step needed in normal use. `KOKORO_SERVER_URL` defaults to
`http://127.0.0.1:8765`; `KOKORO_PYTHON` only needs setting to override the
persistent venv path.

Pinned: kokoro-mlx 0.1.2, misaki 0.9.4, mlx 0.32.2 (see `scripts/setup-kokoro.sh`)
— `scripts/kokoro_tts.py` (run inside the persistent `scripts/kokoro_server.py`)
mirrors `phonemize_long` chunking and the `forward()` duration ops, so
repin/review on any upgrade. Voices: `af_heart` (default), `af_bella`,
`am_michael`, `am_adam`, `bf_emma`. Word timings are native (`pred_dur`,
English). Warm synth ≈ 14× realtime; the persistent server pays model-load
cost once, not per scene.

## Quick evaluations (JSON + thumbnail, no MP4)

```bash
npm run build
npm run test:live -- --minutes 1 --voice --tts kokoro --budget 0.5 \
  --prompt "Your rich topic prompt here"
# --minutes 1|5|10|30 · --tts kokoro|elevenlabs · --budget USD cap
# --prompt TEXT | --url URL | --pdf FILE
```

Each chapter = 2 scenes ≈ 1 minute. Budget ≈ $0.50/minute of planning.
Output: `.data/JOB/job.json` + `output/evaluations/JOB.json|.png`.

## Full MP4 videos from any source (demo default: Kokoro voice)

```bash
npm run build
npm run kokoro:setup   # once — persistent venv, then the server auto-starts itself
npm run generate-video -- --url https://arxiv.org/pdf/1512.03385 --minutes 1
npm run generate-video -- --pdf ./paper.pdf --minutes 1 --model google/gemini-3.7-flash
npm run generate-video -- --prompt "Explain how a refrigerator works" --minutes 1
# --minutes accepts 1,5,10,30 (comma list allowed: 1,5,10)
# --model overrides OPENROUTER_MODEL per run · --tts kokoro is the default (no
#   flag needed) · --tts elevenlabs for natural voice (needs ELEVENLABS_* keys)
#   --no-enrich to skip the prompt-builder
#   --no-narration for silent preview · --visual-critic for repair pass
```

You supply ONLY the source — the internal prompt-builder (see
`prompt-builder` skill) enriches it into the rich visual brief. The default
when no source is given is Attention Is All You Need.

## Rich prompt recipe (only needed with --no-enrich)

Cover: audience + prerequisites, 3–6 key questions the video must answer,
concrete examples/numbers to ground anchors, misconceptions to correct,
and explicit scope exclusions. Longer targets add sections, never padding:
each chapter gets a distinct objective from the global outline, and the
planner enforces 110–160 narration words per chapter.

## Verify before delivering

1. `npm test` — 65 passing, 0 failing (`TEST_KOKORO_TTS=1` adds the live
   Kokoro contract test; auto-starts the persistent server if needed).
2. Job status `complete`; scene count = 2 × minutes; narration word count
   ≈ 110–160/chapter; shapes mixed (not all-box — check
   `job.json` node `shape` fields); `renderSVG` deterministic.
3. MP4 plays with narration in sync; subtitle bar never covers content;
   `output/videos/*.mp4` listed with sizes.
4. Record: job id, minutes, scenes, planning cost, TTS chars, elapsed ms.

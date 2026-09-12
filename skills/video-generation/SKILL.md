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
optional critic on `openai/gpt-5.6-luna`, speech on the external local
voice-engine (Supertonic 3 default, Piper fallback). The engine is a separate
project — never re-add a hosted speech provider to this repo. Deterministic engine only — no generated drawing code,
no Manim.

## Prerequisites

`.env` with `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`).
FFmpeg + `npm install` (sharp) required for MP4 export. Local narration needs
no speech key. Never commit `.env`, `.data/`, or `output/`.

## Local voice-engine (free, CPU, no key)

The engine is a separate project at `../lamina-labs-video/voice-engine`. One-time
setup there:

```bash
cd ../lamina-labs-video/voice-engine
npm run setup   # uv venv + Supertonic + Piper voices (English, Nepali)
npm run build
```

The main repo calls it over an async JSON stdin/stdout boundary. Supertonic 3 is
the default for its 31 languages; Piper is the fallback for everything else;
Nepali is always Piper. Override with `VOICE_ENGINE_DIR`, `VOICE_ENGINE_LANGUAGE`,
`VOICE_ENGINE_PROVIDER=auto|supertonic|piper`. Local engines return audio
duration only, so timings are explicitly estimated (`engine`), never
provider-aligned. Kokoro was removed from this repo on 2026-09-12.

## Quick evaluations (JSON + thumbnail, no MP4)

```bash
npm run build
npm run test:live -- --minutes 1 --voice --tts voice-engine --budget 0.5 \
  --prompt "Your rich topic prompt here"
# --minutes 1|5|10|30 · --tts voice-engine (only) · --budget USD cap
# --prompt TEXT | --url URL | --pdf FILE
```

Each chapter = 2 scenes ≈ 1 minute. Budget ≈ $0.50/minute of planning.
Output: `.data/JOB/job.json` + `output/evaluations/JOB.json|.png`.

## Full MP4 videos from any source (demo default: local voice-engine)

```bash
npm run build
npm run generate-video -- --url https://arxiv.org/pdf/1512.03385 --minutes 1
npm run generate-video -- --pdf ./paper.pdf --minutes 1 --model google/gemini-3.7-flash
npm run generate-video -- --prompt "Explain how a refrigerator works" --minutes 1
# --minutes accepts 1,5,10,30 (comma list allowed: 1,5,10)
# --model overrides OPENROUTER_MODEL per run · --tts voice-engine is the default
#   (no flag needed; local-only: Supertonic 3 / Piper)
#   --language en|hi|ne|... selects the TTS language
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

1. `npm test` — all passing, 0 failing (the voice-engine boundary is tested with
   an injected runner; no provider process is required).
2. Job status `complete`; scene count = 2 × minutes; narration word count
   ≈ 110–160/chapter; shapes mixed (not all-box — check
   `job.json` node `shape` fields); `renderSVG` deterministic.
3. MP4 plays with narration in sync; subtitle bar never covers content;
   `output/videos/*.mp4` listed with sizes.
4. Record: job id, minutes, scenes, planning cost, TTS chars, elapsed ms.

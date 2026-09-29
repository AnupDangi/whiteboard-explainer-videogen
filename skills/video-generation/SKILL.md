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
optional critic on `openai/gpt-5.6-luna`, speech on the local voice-engine
(`--tts voice-engine`, the default: Supertonic with Piper fallback, 50+
languages; ElevenLabs available via `--tts elevenlabs`). There is no Kokoro or
robot/local-espeak voice anymore. Deterministic engine only — no generated
drawing code, no Manim.

## Prerequisites

`.env` with `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`).
FFmpeg + `npm install` (sharp) required for MP4 export. Local voice-engine
narration needs no speech key (one-time `npm run voice-engine:setup`). Never
commit `.env`, `.data/`, or `output/`.

## Voice-engine setup (free, local, no key, all languages)

```bash
npm run voice-engine:setup        # = cd voice-engine && npm run setup
```

Creates `voice-engine/.venv` with Supertonic + Piper and downloads the default
Piper voices (Supertonic weights download on first synthesis). The engine is a
separate process behind `voice-engine/dist/cli.js`; each scene spawns one
synthesis call. `VOICE_ENGINE_PROVIDER=auto|supertonic|piper`,
`VOICE_ENGINE_LANGUAGE=<code>` (default `en`), `VOICE_ENGINE_DIR`,
`VOICE_ENGINE_OUT` are optional overrides. Piper is always used for Nepali.
Word timings are **estimated** uniformly over the synthesized audio duration
(the engine returns audio, not phoneme timings) and labelled
`timingSource: estimated`.

## Quick evaluations (JSON + thumbnail, no MP4)

```bash
npm run build
npm run test:live -- --minutes 1 --voice --tts voice-engine --budget 0.5 \
  --prompt "Your rich topic prompt here"
# --minutes 1|5|10|30 · --tts voice-engine|elevenlabs · --budget USD cap
# --prompt TEXT | --url URL | --pdf FILE
```

Each chapter = 2 scenes ≈ 1 minute. Budget ≈ $0.50/minute of planning.
Output: `.data/JOB/job.json` + `output/evaluations/JOB.json|.png`.

## Full MP4 videos from any source (demo default: voice-engine)

```bash
npm run build
npm run voice-engine:setup   # once — venv + default Piper voices
npm run generate-video -- --url https://arxiv.org/pdf/1512.03385 --minutes 1
npm run generate-video -- --pdf ./paper.pdf --minutes 1 --model google/gemini-3.7-flash
npm run generate-video -- --prompt "Explain how a refrigerator works" --minutes 1
# --minutes accepts 1,5,10,30 (comma list allowed: 1,5,10)
# --model overrides OPENROUTER_MODEL per run · --tts voice-engine is the default
#   (no flag needed) · --tts piper|supertonic pins a provider · --language <code>
#   --tts elevenlabs for natural voice (needs ELEVENLABS_* keys)
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

1. `npm test` — suite green, including the language/voice-engine contract tests
   (no live TTS needed for the core tests).
2. Job status `complete`; scene count = 2 × minutes; narration word count
   ≈ 110–160/chapter; shapes mixed (not all-box — check
   `job.json` node `shape` fields); `renderSVG` deterministic.
3. MP4 plays with narration in sync; subtitle bar never covers content;
   `output/videos/*.mp4` listed with sizes.
4. Record: job id, minutes, scenes, planning cost, TTS chars, elapsed ms.

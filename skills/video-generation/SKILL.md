---
name: video-generation
description: End-to-end whiteboard video generation — plan chapters, synthesize narration, compile canvas scenes, verify, export MP4. Supports 1/5/10-minute targets.
---

# Video generation skill (orchestrator)

Generate narrated whiteboard videos with the prompt-builder → planner →
director → compiler → speech → renderer pipeline. Default model stack:
planner + director on `OPENROUTER_MODEL` (default
`google/gemini-3.8-flash`; tested alternatives: `google/gemini-3.7-flash`),
optional critic on `openai/gpt-5.6-luna`, speech on Kokoro local neural
voice (`--tts kokoro`; robot `--tts local` and ElevenLabs remain available).
Deterministic engine only — no generated drawing code, no Manim.

## Prerequisites

`.env` with `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`).
FFmpeg + `npm install` (sharp) required for MP4 export. Kokoro and robot
narration need no speech key. Never commit `.env`, `.data/`, or `output/`.

## Kokoro voice setup (free, local, no key)

Apple Silicon + `espeak-ng` on PATH (`brew install espeak-ng`):

```bash
uv venv /tmp/kokoro-spike
uv pip install --python /tmp/kokoro-spike/bin/python kokoro-mlx \
  https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl
export KOKORO_PYTHON=/tmp/kokoro-spike/bin/python  # or set in .env
```

Pinned: kokoro-mlx 0.1.2, misaki 0.9.4, mlx 0.32.2 — the bridge
(`scripts/kokoro_tts.py`) mirrors `phonemize_long` chunking and the
`forward()` duration ops, so repin/review on any upgrade. Voices:
`af_heart` (default), `af_bella`, `am_michael`, `am_adam`, `bf_emma`.
Word timings are native (`pred_dur`, English). Warm synth ≈ 14× realtime;
per-spawn scene cost ≈ 4–5s (model load + G2P + synth).

## Quick evaluations (JSON + thumbnail, no MP4)

```bash
npm run build
npm run test:live -- --minutes 1 --voice --tts elevenlabs --budget 0.5 \
  --prompt "Your rich topic prompt here"
# --minutes 1|5|10|30 · --tts elevenlabs|local · --budget USD cap
# --prompt TEXT | --url URL | --pdf FILE
```

Each chapter = 2 scenes ≈ 1 minute. Budget ≈ $0.50/minute of planning.
Output: `.data/JOB/job.json` + `output/evaluations/JOB.json|.png`.

## Full MP4 videos from any source (demo default: Kokoro voice)

```bash
npm run build
export KOKORO_PYTHON=/tmp/kokoro-spike/bin/python
npm run generate-video -- --url https://arxiv.org/pdf/1512.03385 --minutes 1 --tts kokoro
npm run generate-video -- --pdf ./paper.pdf --minutes 1 --model google/gemini-3.7-flash --tts kokoro
npm run generate-video -- --prompt "Explain how a refrigerator works" --minutes 1 --tts kokoro
# --minutes accepts 1,5,10,30 (comma list allowed: 1,5,10)
# --model overrides OPENROUTER_MODEL per run · --tts elevenlabs for natural
#   voice (needs ELEVENLABS_* keys) · --tts local for the robot voice
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

1. `npm test` — 44+ passing, 0 failing (`TEST_KOKORO_TTS=1` adds the live
   Kokoro contract test; needs `KOKORO_PYTHON`).
2. Job status `complete`; scene count = 2 × minutes; narration word count
   ≈ 110–160/chapter; shapes mixed (not all-box — check
   `job.json` node `shape` fields); `renderSVG` deterministic.
3. MP4 plays with narration in sync; subtitle bar never covers content;
   `output/videos/*.mp4` listed with sizes.
4. Record: job id, minutes, scenes, planning cost, TTS chars, elapsed ms.

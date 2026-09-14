---
name: video-generation
description: >
  End-to-end orchestrator. Use to plan, narrate, compile, verify, and export
  a lesson MP4. Owns sequencing and budgets, not stage internals.
---

# Purpose

Run prompt-builder -> teaching-architect -> planner -> director -> speech +
compile -> critic -> export in order, with cost/latency budgets and honest
failure records. Deterministic engine only; no drawing code, no Manim.

# When to use

User requests a video or eval run from prompt/URL/PDF/text with a duration
target and budget.

# When NOT to use

Single-stage work (call that stage skill directly), metric design
(eval-builder), teaching validation (pedagogy-critic).

# Inputs

- Source (prompt text | URL | PDF path | extracted text).
- Duration target minutes (1/5/10/30), USD budget, language, narration
  on/off, critic on/off, enrich on/off.

# Outputs

- `.data/.../job.json` (scenes, audio, costs, telemetry) consumed by
  library (`GET /api/jobs`), resume (`/?job=`), eval-builder.
- `output/<id>.mp4` (H264+AAC) consumed by viewer download/export route.
- Run log (job id, scenes, cost, TTS chars, elapsed) consumed by HANDOFF/
  RESULTS. Provider failures recorded, never masked as fixture success.

# Hard invariants

- Scene count `2 x minutes` is a **planning target**, not a teaching rule.
  Final count follows TeachingContract beats + duration budget; record
  deviation with reason.
- Narration 110-160 words/chapter target; pacing (static interval <=3500ms)
  gates quality, not completion.
- Speech local-only voice-engine (Supertonic 3 default, Piper fallback,
  Nepali always Piper). Never re-add hosted TTS. Timings labeled estimated.
- Keys in `.env`, media in `.data/`, exports in `output/`; never commit.
- Same SVGs for browser and export via `renderSVG`.

# Decision procedure

1. Ingest source (pdf-extraction only if native parse fails; see its skill).
2. Enrich brief (unless --no-enrich) -> architect contract -> plan scenes
   (target count, adjust to beats) -> direct -> parallel speech+compile ->
   critic gate (if on) -> export MP4.
3. On stage failure: persist partial, log taxonomy (plan/asset/provider),
   stop claiming success. Retry bounded only.

# Failure conditions

- 403/auth/provider outage -> visible failure record, $0 misleading success
  forbidden. Missing FFmpeg/sharp -> export fails loudly. Budget exhausted
  -> stop before unmetered calls.

# Repair behavior

Resume from persisted snapshot; re-run failed stage only. Heals are
deterministic (schema/array/enum); pedagogy issues return to architect.

# Success criteria

- Job complete/partial honestly labeled; scene durations match audio + tail;
  `ffprobe` H264+AAC; `npm test` green; HANDOFF/RESULTS updated with exact
  tests, limits, next task.

# Representative evals

- `eval:duration-target`: 1-min run -> scenes near target, deviation logged.
- `eval:export-integrity`: ffprobe codec/duration + frame count match plan.
  See `references/evaluation.md`.

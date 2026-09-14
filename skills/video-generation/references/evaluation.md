# Orchestrator evals

- `eval:duration-target`: target 1 min -> accept scenes within beats-derived
  range; hard 2x enforcement is a failure of this skill.
- `eval:export-integrity`: `ffprobe` shows H264 video + AAC audio, duration
  within one frame of timeline + tails; frame count equals plan.

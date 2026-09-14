# Video-quality metrics (primary)

Objective first:

- `plan/direct/compile/tts/fullJob` success rates per case + overall.
- Repair histogram + `representationFallbackCount` (diagnostics+telemetry).
- Grounding: evidence quotes verbatim, source-required plans have refs.
- Anchors: 100% verbatim resolution; static interval <=3500ms advisory.
- Export: ffprobe H264 + AAC, duration within one frame, frame/scene counts.
- Cost/latency: per task+model ledger, P50/mean, budget adherence.

Judge-gated (validated judges only):

- Critic A/B both orders on known corruptions; report accuracy + order flips.
- Checkpoint-answer and contract-fidelity with TPR/TNR + split noted.

Never primary: BLEU/ROUGE/METEOR/BERTScore/perplexity/cosine/Likert.
If used secondarily, label limits and keep out of gates.

Boundary: generic pipeline hygiene (trace sampling, reviewer UX, dashboard
care) stays in `eval-audit`; per-lesson binary repair stays in
`pedagogy-critic`. This skill owns run-level gates.

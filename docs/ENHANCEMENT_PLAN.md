# Enhancement Plan — problems, target, and phases

Status: planning only. Authority: root `Architecture_plan.md`, root
`PLAN_TO_IMPLEMENT.md` (never edit). This doc tracks the work across both pipelines:
the frozen V1 front end (`opt-v3-harness`) and the target V2 semantic front end
(`v4-optimization`). Measured evidence lives in `docs/HANDOFF.md`; task state in
`tasks.md` on `opt-v3-harness`.

## 1. What we measured (2026-09-19, V1, real PDFs, local voice-engine)

| target | status | scenes | wall | timeline | cost |
|---|---|---|---|---|---|
| 1 min | complete | 2/2 | ~45 s | ~68 s | $0.019 |
| 10 min | complete | 20/20 | 196–233 s | ~657–686 s | $0.11 |
| 30 min | partial | 52–55/60 | 626–759 s | ~29.8 min | $0.30–0.41 |

Determinism: compiler/renderer/export are byte-identical across repeated runs and
fresh processes; **planning is not** — four identical 1-min runs gave four distinct
narrations/layouts/kind-chains (label-set Jaccard ≈ 0.06–0.13). Cause: `temperature 0.3`
(0.2 critic/vision), no `seed` anywhere. Local TTS is not byte-reproducible and its word
timings are estimated from audio duration.

## 2. Problem register

Ordered by impact on "generate a clean, long, high-quality video".

1. **Non-determinism of planning.** No seed; temperature > 0. Two runs of the same
   source never produce the same lesson. Cacheable artifacts and A/B evaluation are
   undermined.
2. **Google outline chapter ceiling.** The outline schema uses `array(item, N, N)`;
   Google's structured-output endpoint rejects N > 18 (18 ok, 19+ → HTTP 400
   `INVALID_ARGUMENT`). Naive 30/60-min is impossible on Google. Current mitigation:
   auto-fallback to a non-Google model for >18 chapters
   (`OPENROUTER_OUTLINE_FALLBACK`). Proper fix: batch/split the outline.
3. **30-minute timeline cap.** A "30-minute" target produces ~29.8 min of narration and
   the job stops at 52–55/60 scenes because the compiled timeline would exceed the hard
   30-min ceiling. Duration control is by chapter count, not by measured narration.
4. **Degraded scene blocks export.** Export requires audio on every scene when any
   scene has audio, so one silent (degraded) scene fails the whole MP4.
5. **First-playable ≈ 35–45 s** vs the `<8 s` target — model calls dominate, serial.
6. **Local TTS has no word alignment.** Timings are uniform estimates; caption/anchor
   precision is bounded by that.
7. **Repair rate.** 10-min runs needed 4–9 repairs; 30-min 17–41. Most are gate
   rejections the model could avoid with a tighter contract (v4 HANDOFF §2).
8. **Thin representation** (V2): concepts with no asset render as bare label pills
   (v4 HANDOFF "What still limits output quality"); the icon subsystem is the fix.
9. **V1/V2 divergence.** Two front ends, one default (`semantic`). Work must follow the
   migration rule (`Architecture_plan.md` §69): implement alongside, migrate only when
   the executable gates pass.

## 3. Target architecture (one paragraph)

Concentrate runtime intelligence into three semantic roles — **Knowledge Compiler**
(one BaseConceptGraph per source, cached by content hash), **Teacher Planner** (one
LessonGraph/LessonBible + SceneContracts; duration controls depth), **Scene Director**
(VisualSceneV2 per scene, parallel) — and keep everything else deterministic code:
retrieval (see `docs/RAG_PLAN.md`), geometry/layout/timing, the pure
`renderSVG(scene, timeMs)`, persistence and validation. Models emit validated semantic
data only; no coordinates, no SVG, no executable code.

## 4. Phased plan (proposed, not started)

- **E0 — Baseline + budgets parity.** Confirm both branches build and test green.
  Port the per-duration budget table (`1m $0.5, 5m $0.7, 10m $1, 30m $1.2, 60m $2`) to
  V2's `model-adapter`/`jobs` so both pipelines share one cost policy. Gate: a job
  exceeding its tier fails visibly, and measured spend stays well below the tier.
- **E1 — Determinism.** Add an explicit `seed` to every model call and a
  `SAMPLING_TEMPERATURE` knob (default low). Gate: N repeated runs of the same source
  at the same seed produce byte-identical scene JSON; different seeds differ.
- **E2 — Outline scaling.** Split/batch the outline beyond 18 chapters (deterministic
  merge + gate) so 30/60-min no longer depends on a model swap. Gate: a 60-chapter
  outline validates, and chapter count equals the target.
- **E3 — Duration control by narration.** Derive chapter/scene counts from the measured
  word budget (V2 already has `wordsForMinutes`/`NARRATION_WPM`) and treat the timeline
  ceiling as a warn/shrink, not a hard stop. Gate: a "30-minute" target lands
  27–30 min without `partial`.
- **E4 — Export robustness.** Allow export with per-scene silent fallback audio
  (pad silence) instead of failing the whole job; keep the failure visible in the
  manifest. Gate: a job with one degraded scene still exports.
- **E5 — First-playable.** Overlap architect/director/TTS across scenes and cap stage
  ceilings by the target (V2 HANDOFF §3 serialisation table). Gate: first-playable
  < 15 s, then < 8 s.
- **E6 — Representation.** Finish the icon/tier subsystem (`docs/ICON_SYSTEM_PLAN.md`):
  resolve P4 (cache wiring) and decide P7 (promotion) + `VISUAL_ICONS` default.
  Gate: unseen concepts resolve to a tier; no bare-label-pill hero.
- **E7 — RAG.** Execute `docs/RAG_PLAN.md` R1–R6.
- **E8 — Evaluation.** VLM-critic calibration (corrupt-vs-original pairwise), a
  multi-domain benchmark (biology, physics, civics, economics — not only CS), and
  latency/cost/repair reporting. Gate: no scalar score is a release gate.

## 5. Tracking

| id | phase | state | evidence |
|---|---|---|---|
| E0 | budgets parity | V1 done 2026-09-19; V2 pending | `src/budgets.ts`, `scripts/generate-video.ts` |
| E1 | determinism (seed) | not started | measured 4-run divergence |
| E2 | outline batching | mitigation only | Google 18-chapter probe |
| E3 | narration-driven duration | not started | 30-min partial |
| E4 | export with silent scene | not started | llms-30 attempt 1 export failed |
| E5 | first-playable | not started | 35–45 s measured |
| E6 | representation/icon P4+P7 | partial | `docs/ICON_SYSTEM_PLAN.md` |
| E7 | RAG R1–R6 | partial | `docs/RAG_PLAN.md` |
| E8 | evaluation/benchmark | partial | `eval/`, `docs/v4/EVALUATION.md` |

## 6. Non-goals (unchanged)

No Manim/unrestricted generated code; no model-emitted coordinates or SVG; no network
inside rendering/export; no single scalar quality gate; no diffusion video for teaching
pixels.

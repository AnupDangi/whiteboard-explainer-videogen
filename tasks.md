# tasks

Status tracking for the V1 (`opt-v3-harness`) prototype. Contracts and plans:
root `PLAN_TO_IMPLEMENT.md`, root `Architecture_plan.md`, `docs/v4/`,
`docs/ICON_SYSTEM_PLAN.md`. Evidence log: `docs/HANDOFF.md`.

## 2026-09-19 — voice-engine migration + budget policy

- [x] **Kokoro removed completely**: `src/kokoro-speech.ts`, `src/tts-pool.ts`,
      `scripts/kokoro_{server,tts}.py`, `scripts/kokoro_pool.sh`,
      `scripts/setup-kokoro.sh`, `scripts/bench-tts.ts`, `test/kokoro-speech.test.js`,
      `test/tts-pool.test.js`, `.kokoro-venv/` (979 MB), package scripts, UI controls,
      env keys, docs. No `kokoro` reference remains in code.
- [x] **Local voice-engine is the sole free TTS**: bundled `voice-engine/`
      (Supertonic default, Piper fallback, 50+ languages; Piper for Nepali).
      `src/voice-engine-client.ts` + full `src/language.ts` (Unicode segmentation).
      `--tts voice-engine|piper|supertonic`, `--language <code>`. Word timings are
      estimated from audio duration (`timingSource: estimated`), labelled.
- [x] **Per-duration hard budgets**: 1m $0.5, 5m $0.7, 10m $1, 30m $1.2, 60m $2
      (`src/budgets.ts::DURATION_BUDGET_USD`; `scripts/generate-video.ts --budget`
      overrides; `src/jobs.ts` cap = table max).
- [x] **60-minute duration** added (`DURATIONS`); outline targets >18 chapters
      auto-fall back off Google (`OPENROUTER_OUTLINE_FALLBACK`, default
      `deepseek/deepseek-v4-flash`) because Google rejects >18-chapter schemas.
- [x] **Docs consolidated**: historical docs removed; target plans
      (`PLAN_TO_IMPLEMENT.md`, `Architecture_plan.md`, `docs/ICON_SYSTEM_PLAN.md`)
      copied from `v4-optimization`.
- [x] **Output curated** to `output/keep/` (1/10/30-minute AI + biology + civics
      samples and their `.scenes/` evidence).
- [x] Suite green: **149 pass / 0 fail** (`npm test`).
- [x] **RAG subsystem imported from `v4-optimization`** (pruned to the required
      closure, 13 source files): `src/semantic/retrieval/{bm25,sets}.ts`,
      `src/semantic/source/{chunker,cache}.ts`, `src/semantic/cache/{keys,store}.ts`,
      `src/semantic/harness/concurrency.ts` (parallel `mapConcurrent`),
      `src/shared/{model-router,language,vocabulary,types}.ts`,
      `src/shared/ingestion/{blocks,source}.ts`; plans `docs/RAG_PLAN.md` +
      `docs/ENHANCEMENT_PLAN.md`; tests `test/{concurrency,semantic-source-retrieval}.test.js`.
      Suite now **159 pass / 0 fail**.
- [ ] 5-minute multi-domain videos (AI + biology + civics) — running 2026-09-19.
- [ ] V1 60-minute end-to-end run (outline fallback + 30-min timeline cap).
- [ ] Adopt the target architecture: Knowledge Compiler → Teacher Planner →
      Scene Director; Coverage/Focus retrieval sets; BaseConceptGraph cache
      (`PLAN_TO_IMPLEMENT.md`).

## Known problems (2026-09-19, measured)

- **End-to-end planning is non-deterministic**: `temperature 0.3`, no `seed`
  anywhere. Four identical 1-min runs (same PDF) produced four distinct
  narrations/layouts/kind-chains; label-set Jaccard ≈ 0.06–0.13. Only the
  frozen-scene → SVG/MP4 half is deterministic (byte-identical).
- **Google structured output rejects >18-chapter outline schemas** (18 accepted,
  19+ → HTTP 400 `INVALID_ARGUMENT`). Blocks naive 30/60-min.
- **30-minute target overshoots the hard 30-min timeline cap**: narration reached
  ~29.8 min at 52–55/60 scenes → `partial`.
- **One degraded (silent) scene blocks export** — export requires audio on every
  scene when any scene has audio.
- **Local TTS is not byte-reproducible** (Supertonic same duration/different bytes;
  Piper duration jitters), and its word timings are estimated, not aligned.
- **First-playable ≈ 35–45 s** vs the `<8 s` target.

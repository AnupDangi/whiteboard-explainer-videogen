# Architecture — current (2026-09-13)

Two pipelines, one repo. `src/explainer/` is the default node/edge pipeline behind
the main UI. `src/semantic/` is the V2 teaching pipeline (plan → direct → compile).
`src/shared/` is used by both. `VISUAL_PIPELINE=explainer|semantic` selects the
landing page only; both APIs are always served.

## Request flows

```
UI prompt ──POST /api/jobs──▶ JobStore (explainer, 2-active cap)
  │  poll /api/jobs/:id (400ms full snapshots, revisioned, idempotent)
  │  GET /media/:id/:scene.wav · GET /api/export?job= → /output/<id>.mp4
  └──▶ GET /api/jobs → library (20 most recent, metadata only)
       /?job=<uuid> reopens any saved job

UI ──POST /api/semantic/jobs──▶ SemanticJobStore (2-active cap, durable snapshots)
  │  SSE /api/semantic/jobs/:id/stream (?from=N resume, end on terminal)
  │  GET /media/semantic/:id/:scene.wav
```

Both stores persist `job.json` + per-scene audio under `.data/` (V1) and
`.data/semantic/` (V2). Completed jobs stay on disk; the library lists them.
Exports land in `output/`. `.env`, `.data/`, `output/` are git-ignored.

## Explainer pipeline (default)

`POST /api/jobs {mode, prompt|source, durationMinutes, narration, language}` →
ingest (`sources.ts`: PDF page-aware, docx/pptx/md/json/text/URL) → document map
(cached, sha256) → outline (bounded repair + heals) → per-chapter content
(`planContent`: validators split hard-correctness vs quality-advisory with
deterministic heals) → director or deterministic auto-director → per-scene
voice-engine TTS (bounded pool, fail-soft to estimated silent timing) + compile →
snapshot commit. Progressive: scenes commit as prepared; browser plays while later
scenes prepare. MP4 export re-renders the same SVGs via Sharp + FFmpeg and muxes
local audio.

## Semantic V2 pipeline

```
planTeaching ─▶ selectVisualModel ─▶ resolveRepresentation ─▶ directVisual
  (LLM)          (deterministic)      (tiered, never throws)    (LLM)
  ─▶ canonicalizeVisualScene (runtime owns IDs) ─▶ finalizeNarration
  ─▶ voice-engine speech ─▶ compileScene ─▶ renderSVG ─▶ artifacts
```

- Models emit validated scene data only: no coordinates, no SVG, no code.
- `src/semantic/identity/`: `SemanticIdentityRegistry` (deterministic
  `concept_<scene>_<key>_<n>` IDs), `canonicalizeVisualScene` (rewrites model IDs,
  preserves beat IDs), `resolveRepresentation` (strict union-archetype search →
  alias-substring asset → labeled-primitive fallback, always warned).
- `src/semantic/compiler/fallback.ts`: flow-cycle return arcs, comparison
  demotion, matrix token/asset injection (gated on matrix assets), hero
  promotion, asset/archetype compatibility strip with anchor repair, label fit,
  direct-line connector safety net. Every repair is a counted
  `representation fallback` diagnostic. Unknown asset IDs still throw.
- `compileScene` validates → fallbacks → places (per-archetype deterministic
  layouts) → resolves anchors → routes → timelines. 17 archetypes compile;
  anything else fails explicitly.
- `renderSVG(scene, timeMs)` is pure and shared by browser, contact sheets, and
  export. Speech timing is word-estimated from audio duration and labeled
  `engine`, never provider alignment.
- Optional critic (`V2_CRITIC=on`): calibrated vision judge, one bounded repair.

## Browser player (`public/app.ts`)

Polls full snapshots; clock follows the `<audio>` element while narrated, else a
local timer clamped to prepared duration. Guards added after a real stuck-video
incident: client errors report messages (not just counts), the rAF loop survives
frame exceptions, and audio stalls (paused-while-playing, frozen clock) trigger
bounded re-sync with `audio-stalled` telemetry. Preparation vs completion stay
distinct states; `/?job=<uuid>` reopens saved work.

## Module map

| Area | Files |
|---|---|
| Planning | `explainer/planner.ts`, `budgets.ts`, `auto-director.ts`, `semantic/planning/{teaching-planner,visual-model,visual-director,prompt-builder,validate,model-adapter,narration,generate}.ts` |
| Identity | `semantic/identity/{types,resolver,canonicalize,representation,registry,references,canonical-schemas}.ts` |
| Compile/render | `semantic/compiler/{compile-scene,fallback,archetypes,zones,routing,text,timeline,collisions,occupancy}.ts`, `semantic/renderer/*.ts`, `explainer/engine.ts` |
| Assets | `semantic/assets/{registry,search,validator,geometry,templates/catalog,illustrations/*,icons/*}.ts` (43 curated) |
| Speech | `shared/voice-engine-client.ts`, `semantic/speech.ts` (Supertonic 3 default, Piper fallback) |
| Jobs/server | `explainer/jobs.ts`, `semantic/jobs.ts`, `src/server.ts`, `shared/{model-router,logger,language}.ts` |
| Eval | `eval/live/{manifest,runner,metrics,compare}.ts`, `eval/semantic/cases/` |

## Evaluation

`eval/live/` (48-case manifest, smoke subset of 6): stage success rates, repair
histogram, failure taxonomy (`plan/asset/provider/…`), cost/latency. Latest live
smoke: 13/18 full success. Metrics count `representationFallbackCount` from
diagnostics + telemetry. Teaching quality and aesthetics are human-judged, not
metered. Fixture throughput is never reported as model/TTS performance.

## Logging and telemetry ledger

One durable append-only JSONL ledger, written by `src/shared/logger.ts`:

- **Path**: `app.log` in the repo root (override with `APP_LOG_PATH`); rotated
  once past 20 MB to `app.<timestamp>.log`. Never delete it — rotate or
  truncate only, it is the cost/prefill/scene-generation record.
- **Per-job mirror**: every line also lands in `.data/<jobId>/log.jsonl` when a
  job context is active.
- **What it records**:
  - `provider.request` / `provider.response` / `provider.failure` — host, path,
    HTTP status, latency, request id (never headers, bodies, or query strings);
  - `v2.planner.call` — model, latency, **prompt (prefill) tokens**, completion
    tokens, cost, attempt;
  - `v2.stage` — per-stage OK/FAIL with owner, attempt, latency, model, cost,
    prompt/completion tokens, skill hash, gate codes;
  - `v2.scene` — per generated scene: archetype, object/relation/beat counts,
    duration, timing kind and provenance, narrated flag, word count, scene-ready
    latency, cost and calls so far, diagnostics;
  - `semantic-job.created` / `first-playable` / `status` / `summary` — lifecycle,
    `firstPlayableMs`, wall time, aggregate cost, calls, prompt/completion
    tokens, model routes, final gate, MP4 status.
- **Redaction**: values matching key/token/secret/password/credential, plus
  prompt, narration, sourceText and base64 payloads, are replaced with
  `[REDACTED]` before writing; the ledger never contains provider secrets.
- Logging is best-effort: a ledger write failure must never break the pipeline.

## Hard constraints

No generated executable code or Manim; no model coordinates or raw SVG; renderer
deterministic; estimated timing visibly labeled; provider failures stay visible
(no silent fixture success); keys in `.env`, data in `.data/`, exports in
`output/`. Current gaps and next tasks: `HANDOFF.md`. Evidence log: `RESULTS.md`.
Spec reference: `docs/v4/`.

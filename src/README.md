# Source layout

Two pipelines share one server. Pick one by intent, not by history.

```
src/
  server.ts        HTTP entry point. Serves both UIs, the job API, media and export.
  shared/          Used by BOTH pipelines. No product logic lives here.
    logger.ts              structured JSON logging + secret redaction
    types.ts               cross-pipeline types (JobSnapshot, Timing, ...)
    vocabulary.ts          node kinds + layout names (explainer vocabulary)
    model-router.ts        per-task model selection (outline/content/director)
    voice-engine-client.ts async boundary to ../voice-engine
  explainer/         DEFAULT pipeline: deterministic node/edge whiteboard scenes.
    sources.ts document-map.ts retrieval.ts embeddings.ts figures.ts   ingest
    planner.ts auto-director.ts prompt-builder.ts                      planning
    engine.ts schema.ts vocabulary-less renderer helpers
    icons.ts illustrations.ts style.ts templates.ts fixtures.ts
    jobs.ts scene-output.ts progression.ts budgets.ts concurrency.ts
  semantic/        EXPERIMENTAL V4 pipeline: semantic teaching scenes with assets.
    types.ts schemas.ts pipeline.ts artifacts.ts evaluation.ts
    calibration.ts vision-judge.ts speech.ts
    planning/      teaching planner, visual model, director, narration, model adapter
    compiler/      hero-first composition, collisions, routing, timeline, archetypes
    assets/        immutable registry, validator, search, curated illustrations/icons
    renderer/      pure renderSVG; browser and export use the same function
```

## Which pipeline am I looking at?

- `explainer` is the release default and powers the main UI (`public/index.html`, `public/app.ts`).
- `semantic` is the V4 research pipeline (`public/semantic.html`, `public/semantic-viewer.ts`).
  It is enabled with `VISUAL_PIPELINE=semantic`; `v2`/`v1` are accepted as legacy aliases.

## Rules

- `shared/` must never import from `explainer/` or `semantic/`.
- `semantic/` may import `shared/` but never `explainer/`.
- `explainer/` may import `shared/` but never `semantic/`.
- The renderer is pure: `renderSVG(scene, timeMs)` returns the same SVG for the same input,
  with no DOM, clock or random state. Browser and MP4 export call the same function.
- Models never emit coordinates or executable code; `compiler/` owns all geometry.

## Related

- `../voice-engine/` — separate local TTS project (Supertonic 3 default, Piper fallback).
- `../examples/semantic/` — manual semantic scene fixtures.
- `../eval/semantic/` — semantic archetype benchmark cases.
- `../docs/` — architecture, handoff, results and the V4 implementation matrix.

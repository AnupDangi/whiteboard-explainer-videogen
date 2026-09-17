# Instructions for the next agent

This is Anup Dangi's independent research prototype, not Lamina Labs source code.

Critical Notes and Guidelines:
-  Always analyze the tasks complexity if we require subagents to be called to analyze or implement any faeture use it.
- Don't try to patch the solutions with agents 
- After completing tasks audit and update all the docs files which needs to be updated.
- Use graphify to search files if graphify is not well updated run it 
- Review the code and fix bugs if you find don't patch any solution or hardcode to make something work


## Architecture authority — read these first

1. `Architecture_plan.md` — **this is THE architecture.** Target-state "Final Production Architecture" (72 sections: three semantic stages, deterministic code owns geometry/layout/timing, caching tiers, model routing, migration rule). Tracked nowhere yet and untracked in Git — do not delete or lose it. Line 1: `NEVER EDIT THIS FILE`.
2. `PLAN_TO_IMPLEMENT.md` — the **complete overview** of the same target end to end (ingestion → chunking → retrieval → knowledge graph → teacher planner → scene contracts → scene workers → TTS → caching → benchmark). Prefer it for breadth. Where it disagrees with `Architecture_plan.md`, **`Architecture_plan.md` wins**. Also `NEVER EDIT THIS FILE`.
3. `docs/ARCHITECTURE.md` — what the code **is** right now, with `path:line` evidence.
4. `docs/HANDOFF.md` — state, measurements, open decisions, next bounded task.
5. `docs/ICON_SYSTEM_PLAN.md` — the dynamic-representation subsystem.

Both plan files describe an **unimplemented target**. Do not report target behaviour as current. The migration rule (`Architecture_plan.md` §69) forbids replacing V2 in one commit: implement alongside, migrate only when the executable gates pass.

## Trust order — executable sources beat prose

`src/` + `package.json` + `tsconfig.json` + `eval/live/gates.ts` are truth. The docs were synced to the code on 2026-09-17; when you find a line that is false, fix it in the same change rather than leaving drift. Durable facts to apply:

- Runtime pipeline default: code is `semantic` (`src/semantic/pipeline.ts:8`); an `.env` `VISUAL_PIPELINE` key overrides it. `explainer` (V1) is opt-in only.
- `VISUAL_ICONS` code default is `balanced` (`src/semantic/planning/representation-external.ts:34-38`); some plan prose still says `off`.
- Never hardcode test counts — run `npm test`.
- The V1→V2 migration gates live in `eval/live/gates.ts:24-34` and `scripts/live-matrix.ts:142-172`, not in the plan files.
- `scripts/publish-github.ts` is excluded from `tsconfig.json` and has no `package.json` script; do not invoke `npm run publish:github`.
- `docs/HANDOFF.md` is chronological: an earlier wave/audit section can be superseded later in the same file. Prefer the §1-7 summary only where it does not contradict a later wave.
- `docs/ICON_SYSTEM_PLAN.md` status table was stale; P0–P3b, P5 and P6 are done, P4 is unwired, P7 is not started.

## Commands

- `npm test` — builds, then runs every `test/*.test.js` with the built-in `node:test` runner. This is the only gate; there is no linter, formatter or CI.
- Single test file: `npm run build && node --test test/<name>.test.js`. Tests import from `dist/`, so skipping the build runs stale code.
- `npm run typecheck` (`tsc --noEmit`), `npm run build` (`tsc`).
- `npm start` — `http://127.0.0.1:3000`, serves both UIs.
- `npm run test:semantic` — V2 tests only.
- `npm run matrix:frontends` — live current-vs-new front-end comparison (`scripts/compare-frontends.ts`); needs `OPENROUTER_API_KEY`.
- Live/bench runs need `OPENROUTER_API_KEY` in `.env`: `test:live`, `test:live:v2`, `matrix:live`, `bench:representation`, `bench:semantic:*`, `calibrate:semantic:critic`. Core tests and offline fixtures need no key and no installed dependencies.
- Node >= 22, ESM (`"type": "module"`), TypeScript strict `NodeNext`.

## Current architecture in brief

- Two pipelines, one server. `semantic` (V2) is the default and the only one receiving new work; `explainer` (V1) is **FROZEN LEGACY** — security and critical-regression fixes only, deleted only when the gates pass. Do not spread effort across both.
- `semantic-v3` is the target front end from `Architecture_plan.md`, built **alongside** V2 behind `VISUAL_PIPELINE=semantic-v3` (migration rule §69); it must not become the default until the gates in `eval/live/gates.ts` pass. W0 landed: single ingestion pathway in `src/shared/ingestion/source.ts`, versioned cache skeleton `src/semantic/cache/`, and `loadV3ModelRouter`/`PLAN_MODEL_DEFAULTS` in `src/shared/model-router.ts`. W1 landed: typed `SourceBlock` parsing (`src/shared/ingestion/blocks.ts`), semantic chunker (`src/semantic/source/chunker.ts`), pure BM25 + Coverage/Focus sets (`src/semantic/retrieval/`), and source-tier cache. W2 landed: `GraphFragment`/`BaseConceptGraph` contracts, parallel graph maps + deterministic reducer + `gateBaseGraph` (`src/semantic/knowledge/`), and a source-owned base-graph cache. W3 landed: one `teacherPlanner` call → `LessonGraph`/`LessonBible`/`SceneContract[]` with duration→depth and `gateLessonPlan` (`src/semantic/teacher/`). W4 landed: one `sceneWorker` call per batch → `VisualSceneV2` (Scene 1 alone then pairs) with `gateSceneIntent`, plus `VoiceProfile`/TTS cache key (`src/semantic/scene/`). W5 landed: `generateV3` (`src/semantic/frontend/generate-v3.ts`) wires the modules into the job path behind `VISUAL_PIPELINE=semantic-v3`; V2 stays default and byte-identical. `model-adapter.ts` sends OpenRouter `session_id` + a `cache_control` prefix for prompt caching. Live A/B (2026-09-17, same 1-min source): v3 = 2 scenes / 14.2s / 4 calls / $0.0214 vs V2 = 2 / 70.0s / 6 / $0.0434. All plan model IDs exist on OpenRouter and support strict structured output; `gpt-5.6-luna` intermittently 404s on endpoint/tier availability, and the plan's `gemini-3.8-flash` fallback serves — visible, never substituted.
- V2 runs four model calls per scene: knowledge → teaching → architect → director. Everything else is deterministic.
- Models emit validated semantic data only. No coordinates, no executable code. `src/semantic/compiler/` owns all geometry; `renderSVG(scene, timeMs)` is pure and shared by browser and export.
- `src/semantic/planning/model-adapter.ts` is the **only** module that does network I/O. Route all model calls through it.
- Layering (`src/README.md:37-39`): `shared/` never imports a pipeline; `semantic/` never imports `explainer/`; `explainer/` never imports `semantic/`. The compiler/renderer purity rule is enforced by `test/purity.test.js`, which scans source text — no `Date`, `Math.random`, `performance.now`, `process.env` or impure imports there.

## Relevant env flags

`VISUAL_PIPELINE` (`semantic`|`explainer`, default `semantic`), `V2_CRITIC` + `V2_CRITIC_BUDGET_USD`, `VISUAL_ICONS` (`off|strict|balanced|broad`; code default `balanced`, docs say `off`), `V2_JOB_BUDGET_MS` / `V2_JOB_BUDGET_FACTOR`, `V2_TTS_CONCURRENCY` (default 1), `V2_REPLAY_DIR`, `OPENROUTER_API_KEY` and the per-task `OPENROUTER_*` model vars.

## Research guardrails — keep these true

- The central constraint: models produce validated scene data; never introduce arbitrary generated Python/JavaScript execution or a Manim pipeline.
- Keep `renderSVG(scene, timeMs)` deterministic. Browser and export use that same renderer. No wall-clock animation state.
- Keep estimated timing and injected preparation delays visibly labeled. Never report fixture throughput as LLM/TTS performance.
- A passing local experiment establishes feasibility of OUR implementation, not how Lamina works. Only primary disclosures establish facts about that company.
- Do not invent API credentials or turn a provider failure into a successful fixture response. Provider failures must stay visible.
- Keep keys in `.env`, media/job data in `.data/`, exports in `output/`; all gitignored. Never commit the user's uploaded competitor video.
- Do not recreate `docs/RESULTS.md` — measurements belong in `docs/HANDOFF.md`.

## Docs sync — mandatory after material changes

Update `docs/HANDOFF.md` with exact tests, limitations and the next bounded task. Keep `AGENTS.md`, `Architecture_plan.md`, `PLAN_TO_IMPLEMENT.md` and the four docs consistent with the code you just changed — if a doc line is now false, fix it in the same change rather than leaving drift. Do not edit the two `NEVER EDIT THIS FILE` plan files.

## Cleanup to unblock implementation

The target architecture cannot land while dead weight stays. When you touch these areas, remove rather than extend:

- `docs/ARCHITECTURE.md` §9-11 already inventories orphaned identity paths, dead exports and unloaded skills. The identity layer is half-wired (`identity/types.ts` superseded by `harness/registry.ts`); consolidate, do not add a third system.
- Only 4 of the 14 `skills/**/SKILL.md` files actually load (only their `# Hard invariants` section, `src/semantic/skills.ts`). The target classification — runtime, deterministic-invariant, development-process, deferred — is recorded in `skills/README.md`; deterministic invariants stay code+tests, never prompts. The render cache is intentionally not implemented (renderSVG is pure and <0.3% of job time).
- Unimplemented-but-declared behaviour (`structural_diagram`, `convergence` layouts; non-animating motions) must be removed from vocabularies or implemented — never left advertised.

## Git

Remote `origin` already exists (`github.com/AnupDangi/lamina-labs-clone`), branch `v4-optimization`. Do not create or overwrite a repository. Commit and push only when explicitly asked. Gitignored: `app.log`, `.data/`, `output/`, `graphify-out/`, `.agents/`, `.claude/`, `dist/`.

## Code graph (graphify)

Use the graph for orientation before reading files: `graphify` MCP tools (wired in `opencode.json`) or `graphify query "<question>"`. Regenerate after any wave that touches `src/` with `graphify update . --force`. `graphify-out/` is gitignored but the MCP server needs it — run the update once before relying on the tools. The graph proves *structure*, not semantics; confirm behavioural claims by reading the file.

## Out of scope

Keep this a focused local research application. Authentication, billing, cloud deployment and an infinite canvas editor are outside v0.1 scope.

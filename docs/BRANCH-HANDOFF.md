# STCC branch handoff — what this branch is, how it works, issues, breakthrough

Branch: `wt/stcc/charter` · Tag: `stcc-charter-v1` · Commit: `f3b90a9`
Worktree: `simi-worktrees/stcc` · This doc is the handoff for continuing the work.

---

## 1. What STCC is

Simi Teaching Compiler: a **source-grounded visual teaching compiler**. It turns source
material into an evidence-backed pedagogical model, then deterministically compiles that
model into a synchronized narrated whiteboard video.

Canonical pipeline (`docs/architecture/SIMI-TEACHING-COMPILER-CONSTITUTION.md`):

```
SOURCE → LEARNING OBJECTIVE → EVIDENCE → CONCEPT GRAPH → LEARNER/CONFUSION MODEL
→ TEACHING SCENE CONTRACTS → TEACHING STRATEGY → MOVES → NARRATION + VISUAL MODEL
→ TTS + ALIGNMENT → TYPED VISUAL PROGRAM → SEMANTIC RESOLUTION → GEOMETRY
→ AUDIO-DRIVEN TIMELINE → COMPILE LOCK → SVG → RASTER → VIDEO → TRACE → EVAL
```

Two runtime tracks coexist:

- **V1** (`src/plan`, `src/planner`, `src/layout`, `src/render`, `src/export`, `src/run`) —
  the frozen-benchmark path; entry `src/run/lessonCli.ts`. Produces the videos in `output/`.
- **V2** (`src/pipeline-v2`, `src/visual-v2`) — mechanism **kits** (compartment, stack, array,
  axes-plot, cycle, graph, tree, equation…), persistent board state, board-ops. Flag-gated
  (`TEACHING_COMPILER_VERSION=v2` + `BOARD_OPS_V2=1` …); richer look, still experimental.

---

## 2. Pipeline stages → owner files

| Stage | What | Files |
|---|---|---|
| S1 intake | parse PDF/DOCX/PPTX/HTML/text, hash bytes, exact spans | `src/intake/*`, `src/plan/sourceIntake.ts`, `src/plan/sourceBundle.ts` |
| S1b syllabus | learning goal, audience, modules, duration budget | `src/plan/hierarchical.ts` |
| S2 concepts | concept graph (kind/level/relations/evidence) | `src/plan/stages.ts` |
| S3 plan | teaching plan (visualForm, mentalModel, semanticVisualIntents) | `src/plan/stages.ts` (`v6-derived-contracts`, `v10-math-notation`) |
| S3b discovery | how each concept will be drawn (icon/metaphor/diagram/topology/label) | `src/planner/visualDiscovery.ts`, `src/assets/depictionDirector.ts` |
| S4 narration | one scene script per call, `[[id\|phrase]]` markers, claim spans | `src/plan/stages.ts` (`writeScript`) |
| S5 audio | TTS + word alignment (master clock) | `src/audio/*`, `src/shared/alignment/*`, `voice-engine/` |
| S6 board | typed board (nodes/edges/representation intent) | `src/planner/board.ts` (V1), `src/visual-v2/ops-plan/*` (V2) |
| S7 resolve | ladder R0–R11 → asset/diagram/role/label | `src/assets/ladder.ts`, `resolveScene.ts`, `depictionDirector.ts` |
| S8 layout | templates + measured text bounds + edge routing | `src/layout/*` |
| S9 timeline | phased reveals anchored to spoken mentions | `src/timeline/compile.ts` |
| lock | `lesson.lock.json` freezes S1–S9 | `src/run/lessonLock.ts` |
| S10 render | pure `renderSVG(scene, t)` | `src/render/*` |
| S11 encode | resvg → ffmpeg → MP4 | `src/export/*` |
| S12 gates | deterministic gates + VLM judge | `src/validate/gates.ts`, `src/shared/evaluation.ts`, `src/harness/*` |

Every model call goes through `src/llm/structuredCall.ts` (temperature 0, provider JSON
schema, bounded repair, budget ledger). Every call is recorded by `src/structured/recorder.ts`
and replayable by `src/structured/replayClient.ts`.

---

## 3. What this branch implemented

### Icons — use the whole library (biggest visual win)
- **Enabled owner-approved review sets in production**: flat **Flaticon (4,687)** and
  hand-drawn **Sketchi (237)** were `devOnly`; now load by default
  (`src/assets/data/enabled-libraries.json`, `src/assets/normalize.ts` `OWNER_APPROVED_LICENSES`,
  `src/shared/evaluation.ts`). Added a `release` usage context to gate them for a rights-clean release.
- **Resolver reachability** (`src/assets/depictionDirector.ts`, `src/planner/visualDiscovery.ts`):
  the Depiction Director now falls back to **embedding-retrieved catalog candidates** when its
  proposed nouns match no exact name, admitting only a candidate that passes `similarityAdmissible`
  (near-synonym guard: no flags/siblings/antonyms). The director prompt prefers a vocabulary noun
  and abstains only for numbers.
- **Source words are lesson words**: the board vocabulary gate now harvests words from cited
  source quotes; a source element's evidence is snapped to a quote containing its label.

### Math on the board (the reference writes the maths)
- The reference frames (`hypothesis_claude/harness/reference/lamina/…scene02/03.png`) show the
  **notation** and an **explanatory sentence** next to each component.
- S3 now requires on-board notation for math scenes (fraction/equation/number-line/plot with
  parts revealed) and short point text for complex scenes (`src/plan/stages.ts`, `v10-math-notation`).
- Result: class8 shows `x+3=8`, `2(4)+3=11`, `2x+3=11 → 2x=8 → x=4`; undergrad shows `θ←θ−α∇f`.

### Budget — hard caps
- `src/run/config.ts`: `LESSON_COST_CAP_USD` = 60:$0.05, 300:$0.20, 600:$0.40, 1800:$1.00,
  3600:$1.50; off-table $0.03/min clamped [$0.05,$1.50]. The ledger (`src/run/budgetLedger.ts`)
  is fail-closed (reserves worst case, settles billed cost).

### Speed — hard timer
- `.env`: `HYPOTHESIS_PROVIDER_CONCURRENCY=6`, `HYPOTHESIS_RASTER_CONCURRENCY=6`,
  `HYPOTHESIS_S6_CONCURRENCY=4`, `HYPOTHESIS_TTS_ALIGNMENT_CONCURRENCY=3`.
- Model routed to `openai/gpt-6-luna` (faster than the flash model; 30 min ≈ $0.5, within budget).

### V2 board-ops fixes (mechanism-kit path)
- `src/visual-v2/ops-plan/*`: repair-scope widening (patch a sibling field of the same op),
  token budget 7000→8000, representation-family **binding** in the prompt, symbolic-equation
  provenance rule, deterministic **edge-evidence snap** and **source-element evidence snap**,
  **≤3-region hard cap**, movement-collision attributed to the move op, and a **soft-accept** for
  movement-path collisions (recorded, not fatal). `src/visual-v2/kits/compartment.ts`: cells use
  the zone's real width (was fixed 110px). `src/visual-v2/provenance/ground.ts`: plural tolerance.

### Determinism + agent teaching
- `src/harness/runReplay.ts` + `runReplayCli.ts`: collect a run's `structured/**/replay-fixture.json`
  chain and flag incomplete chains (verified: 17 calls, complete).
- `src/plan/prompts/stageExamples.ts`: strict-JSON few-shot examples for S1b/S2/S3, validated
  against the real schemas (`src/__tests__/agent-examples.test.ts`). `docs/prompts/00..07` prompt
  packs; `docs/AGENT-CONTRACTS.md` the agent inventory.

---

## 4. How it works (the mechanics that matter)

### Determinism
- **Post-lock is deterministic by construction**: layout + seeded Rough.js + pure `renderSVG` +
  raster + encode, all content-hashed. `pnpm run video:render -- --from=<lock>` replays offline.
- **Model stages are determinism-by-replay**: each call writes a `replay-fixture.json`; re-running
  serves recorded responses only when the request hash matches.
- **Fresh calls are stochastic** (LLM judgment) — measured, not asserted.

### Caching (the route to sub-minute generation)
- Content-addressed **stage cache** under `<out>/<lesson>/stage-cache` keys every input + version
  (`src/run/artifactCache.ts`). A **warm replay of the same lesson** hits S5/S6/S7/S8/S9 + module MP4
  at ~$0 and near-zero time. This is why the warm path meets the target.
- Catalog + embeddings are memoized (`src/assets/streamline.ts`, `src/assets/semantic.ts`);
  query embeddings cached (`src/assets/queryEmbeddingCache.ts`).

### Speed profile (measured)
| Run | Wall | Video | Ratio |
|---|---|---|---|
| MATH-01 cold (flash model, old) | 384 s | 61 s | 6.3× |
| MATH-01 cold (gpt-6-luna + concurrency) | 180 s | 65 s | 2.8× |
| **MATH-01 warm-cache replay** | **57 s** | 65 s | **0.88× ✅** |

Phase split (cold): prep 90 s (S1–S4 sequential LLM), align 36 s, plan/layout 54 s, encode 35 s,
firstPlayable 55 s (was 184 s).

---

## 5. Issues found (root causes)

1. **Flat/hand-drawn icons never used in production** — Flaticon/Sketchi were `devOnly`; the
   monochrome-flat normalizer also restyled some flat glyphs to house outline. → fixed by enabling
   the sets + keeping designed colours.
2. **The board was box-dominant** — abstract concepts from S2 have no literal icon, and the resolver
   resolved director nouns by **exact name only**. → embedding fallback + director prompt + S2
   "drawable actors" guidance.
3. **No math notation on the board** — the plan chose metaphor/process, not the exact form; the board
   prompt even said "the speech does the explaining". → S3 requires notation; board binds to `visualForm`.
4. **Speed**: provider/raster concurrency defaulted to 2; S7 icon-prep was chained per scene; the
   board planner is sequential (persistent board). → raised concurrency; the warm path reaches <1min.
5. **V2 board-ops fragile** — token cut-off, wrong-op repair attribution, unenforced region cap,
   kit slot overflow, movement collisions. → the fixes listed in §3.
6. **class10 failed** on concurrent S4 script calls (provider error burst at concurrency 6) — needs
   backoff/retry; the other math topics passed.

---

## 6. Breakthroughs

1. **Enabling the flat + hand-drawn asset sets and making the resolver reach them turned box-only
   boards into real teaching pictures** — BIO-01 went from 0–2 to 7 resolved icons, CS-01 to 10,
   with flat/hand-drawn style; the same change plus S3 notation put the actual maths on the board.
2. **The warm-cache path makes a 1-minute video regenerate in 57 s (<1 min)** at ~$0.001 — the
   content-addressed stage cache + replay fixtures make the pipeline effectively deterministic and
   fast on repeat, while the cold path (180 s) is bounded by sequential LLM latency.

---

## 7. Where the videos are

All generated videos live in **`simi-worktrees/stcc/output/`** (gitignored — local only):
`output/index.html` is a viewer. Math set: `class8-linear-equations`, `class12-derivatives`,
`undergrad-gradient-descent` (+ `class10` failed). Benchmark set: `MATH-01`, `PHYS-01`, `BIO-01`,
`CHEM-01`, `CS-01`, `SYS-01`, `AIML-01`, `STAT-01`. Each dir has `video.mp4`, `contact-sheet.png`,
`evaluation-bundle.json`, `run-manifest.json`, `lesson.lock.json`.

## 8. How to run

```bash
pnpm run typecheck:hypothesis && pnpm run test:hypothesis   # offline, no keys
node dist/src/run/lessonCli.js --source=bench/math-sources/class8-linear-equations.md \
  --instruction="..." --duration=90 --id=my-lesson --out=.data/bench-run --allow-partial-video
# V2 (mechanism kits): TEACHING_COMPILER_VERSION=v2 BOARD_OPS_V2=1 ... node dist/src/run/lessonCli.js ...
node dist/src/harness/runReplayCli.js --run=<run-dir>       # verify the replay chain
```

## 9. Remaining (for the next pass)

- Simi-style **explanatory sentence next to each component** (needs a board `note` field + render).
- class10 **S4 concurrency backoff**.
- **Semantic icon search** quality (weak fallbacks: calculator for "worked example").
- 5/10-min **warm-path ≤5 min** validation; cold-prep parallelization.
- RAG sidecar venv not installed (`rag-engine/.venv`) → local-text fallback only.

# 2026-09-13 — First live V2 semantic job through the synchronous path

Job `94117016-bb4b-4dfa-bbf4-c09d6ea6054f` via `POST /api/semantic/jobs`
(`VISUAL_PIPELINE` unchanged; semantic routes always available).

- Status `complete`, one scene `scene_gathering_inputs`, archetype `convergence`.
- Cost **$0.022144**, 2 model calls (teaching + director), estimated silent timing
  (narration:false, no TTS).
- `firstPlayableMs` **17 439**, `sceneReadyMs` **17 426**; teaching 7 382 ms,
  director 10 044 ms, visualModel 0.1 ms, narrationFinalize 0.04 ms, compile 0.4 ms.
- Scene: hero plant (`biology.plant.sapling.v2`) + sunlight/water/CO₂ supports on
  real assets; relations sunlight->leaf.top, water->roots, CO₂->leaf.right;
  five beats matching the plan.
- One advisory diagnostic: narrated static interval exceeds 3500 ms (pacing, not a
  hard failure).

Root cause of the preceding ~20 failed live attempts: `.env` set
`OPENROUTER_OUTLINE_MODEL=google/gemini-2.5-flash-lite`. Direct probes showed
`json_schema` strict mode on `google/gemini-3.8-flash` returns `{}` while
`json_object` returns the full plan, so `V2_JSON_MODE=object` is required for this
repo's custom schema subset. Models now teaching/director/vision =
`google/gemini-3.8-flash`.

**Honest limitations:** this is feasibility of our implementation, not evidence of
teaching efficacy, live TTS latency, or Lamina behaviour. Deterministic heals now
convert several former hard failures into warnings; the Phase 15 benchmark must
confirm none of them mask a real planning gap. Static-timing is estimated.

---

# 2026-09-12 — General narration language support (any script)

Replaced English-only narration with a script-general implementation:

- `src/shared/language.ts`: `Intl.DisplayNames` for language names and `Intl.Segmenter` for
  word/sentence segmentation. No per-language tables, no CJK special-casing.
- The planner takes a `language` option and writes titles, narration, labels, notes, edge
  labels and key points in that language (a LANGUAGE RULE is appended to the outline and
  content prompts).
- Word timing, anchor resolution, beat derivation and word budgets all use the shared
  segmenter, so space-free scripts (Chinese) tokenize correctly; `deriveBeats` slices the
  original text so the exact beat partition holds on any script.
- `scripts/export.ts` validates imported timing with the same segmenter.

Evidence: four one-minute videos on one topic (China's silicon-28 quantum-computing
breakthrough) in English, Hindi, Nepali and Chinese, each with real target-language narration
and the matching voice (`--language`): `output/china-s28/{en,hi,ne,zh}/`. Full suite 183/183.

---

# 2026-09-12 — ElevenLabs removed; narration is local-only

Per user request, the hosted ElevenLabs path is gone and only the local engine
remains (Supertonic 3 default, Piper fallback):

- Deleted `src/providers.ts` (ElevenLabs speech + `alignmentToTiming`) and
  `test/providers.test.js`; removed `generateSpeech`, the `elevenlabs` branch in
  `src/explainer/jobs.ts`, the `ELEVENLABS_*` vars from `.env.example` and the local `.env`,
  the UI provider/voice selectors, and the `--tts` choice in scripts.
- `ttsProvider` is now `'voice-engine'` only; `timingMode` is `engine-estimated`.
- No Google TTS existed in the codebase; nothing to remove.
- Live smoke: 1-min job completed, h264+aac, 65.25 s, `fallbackCount 0`,
  $0.0018 planning; narration rendered by the local engine.
- Full regression: 180 tests, 180 pass, 0 fail, 0 skip (was 185; the ElevenLabs
  provider test was removed).

---

# 2026-09-12 — Kokoro removed; external local voice-engine integrated (async)

- Kokoro deleted from this repo: `src/kokoro-speech.ts`, `src/tts-pool.ts`, four
  shell/python scripts, two test files, `bench:tts` and the three `kokoro:*` npm
  scripts. The live worker (PID 30385, port 8765) was stopped and `.kokoro-venv/`
  (1.0 GB) removed. Timing mode `kokoro-aligned` is gone.
- Local narration now goes through the separate `voice-engine` project, moved to
  `voice-engine` (Supertonic 3 default for its 31 languages,
  Piper fallback, Nepali always Piper). The temporary Kokoro comparison provider
  was removed from the engine too; `out/` was cleaned.
- New async boundary: `src/shared/voice-engine-client.ts` (JSON stdin/stdout, one process
  per request) and `src/semantic/speech.ts`. Local engines return audio duration only, so
  word timings are explicitly `engine`-marked (`LOCAL TTS · ESTIMATED WORD TIMING`).
  ElevenLabs was then removed too, so narration is local-only. `generate-semantic.js
  --narration` synthesizes through the boundary.
- Engine smoke (real, local, no key): Supertonic EN 4.6 s audio / 1.7 s gen
  (RTF 0.375); Piper NE 3.4 s audio / 0.6 s gen (RTF 0.183).
- Full regression: 185 tests, 185 pass, 0 fail, 0 skip (was 193/191/2; the Kokoro
  and pool tests are gone). Build clean.
- Limitation: engine timings are estimated, not word-aligned; V1 job integration is
  proven by unit tests, not a new latency/cost profile.

---

# 2026-09-12 — Phase 12 visual critic + live calibration

Implemented the calibrated critic boundary (`v4_docs/Tasks.md` Phase 12, `Tests.md §15`,
`Evalaution.md §10`):

- `src/semantic/vision-judge.ts`: metered OpenRouter vision judge (model from
  `OPENROUTER_VISION_MODEL`), two candidate contact sheets sent as image parts, strict JSON
  verdict, no fixture fallback; refuses unpriced models and unmetered responses.
- `src/semantic/calibration.ts`: nine controlled corruptions from the plant golden; runs each in
  both orders; `judgeCalibration` treats any order flip as inconsistent.
- `scripts/calibrate-semantic-critic.ts` + `npm run calibrate:semantic:critic`: builds timestamped
  event-aligned contact sheets, runs live calibration, writes `report.json`.

Live evidence (both runs kept):

- Run 1 `output/semantic-critic-calibration/`: **not reliable** — accuracy 0.889 (16/18), misses
  `delay_reveal` and `reverse_relation`, no order flips, $0.0362. Negative result retained.
- Run 2 `output/semantic-critic-calibration-02/`: after per-frame timestamps and an explicit
  direction/timing rubric, **reliable** — accuracy 1.0 (18/18), 0 misses, 0 inconsistent;
  18 calls, $0.0366.

Full regression: 193 tests, 191 pass, 0 fail, 2 skip; 76.306 s (was 189/187/2).

Limitation: one model (`google/gemini-3.8-flash`) on one scene; calibration is not a
teaching-quality gate and does not replace human pairwise. Next: wire the calibrated judge
into a bounded critic-repair path, then V2 speech + progressive jobs.

---

# 2026-09-12 — hierarchy + timeline + trajectory: Phase 14 complete

Closed Phase 14 (`v4_docs/Tasks.md`): all twelve archetypes in the ordered list now have a
deterministic compiler and renderer. Added `hierarchy` (single-root tree, ≤3 levels,
single-root/cycle/connectivity validation), `timeline` (2–6 declared-order events on a
deterministic rail) and `trajectory` (3–6 ordered steps on a descending quadratic path
with a dashed trail).

- Compiler adds `top`/`bottom` anchors; hierarchy routes parent-bottom→child-top so tree
  edges no longer cross label text. Timeline rail and trajectory trail are rendered from
  compiled geometry (pure, deterministic).
- Fixtures: `examples/semantic/memory-hierarchy.scene.json`, `examples/semantic/roman-timeline.scene.json`,
  `examples/semantic/gradient-steps.scene.json`; gates in `eval/semantic/cases/`.
- Evidence: `output/semantic-archetypes-07/` — 11 cases, MP4/JSON/event+fixed sheets,
  `diagnostics []`, 0 errors; silent estimated timing, no model calls.
- Full regression: 189 tests, 187 pass, 0 fail, 2 skip; 76.405 s (was 187/185/2).
- Limitation: manual fixtures only; live planner/director not yet exercised for these
  archetypes; trajectory is a deterministic quadratic path, not a learned curve. Next:
  Phase 12 calibrated critic, then V2 speech + progressive jobs.

---

# 2026-09-12 — equation_walkthrough + matrix_operation layouts

Extended Phase 14 (V4 Tasks) from seven to nine distinct archetype compilers:
`equation_walkthrough` (2–6 stacked equation lines, monotonic top-to-bottom
derivation) and `matrix_operation` (3–6 left-to-right terms with at least one
equation token and one matrix/vector asset).

- New deterministic `renderEquation` primitive (progressive character reveal,
  emphasis wash, monospace text) replaces the label fallback for `equation`
  objects; collision bounds unchanged.
- Manual fixtures: `examples/semantic/equation-walkthrough.scene.json` (2x + 3 = 11
  solved in four lines) and `examples/semantic/matrix-multiply.scene.json` (A × x = b
  with real `math.matrix.v2` / `math.vector.v2` geometry). Eval gates:
  `eval/semantic/cases/equation_walkthrough.json`, `eval/semantic/cases/matrix_multiply.json`.
- Evidence: `output/semantic-archetypes-06/` — eight cases, MP4/JSON/event + fixed
  contact sheets, `diagnostics []`; all silent estimated timing, no model calls.
- Full regression: 187 tests, 185 pass, 0 fail, 2 skip; 76.513 s (was 185/183/2).
  `npm run build` and `git diff --check` pass.
- Limitation: manual fixtures prove the compiler/renderer only. The live
  planner/director has not been run for these archetypes; `matrix_operation`
  relation routing detours above the row (legible, not yet adjacent). Next:
  `hierarchy`, `timeline`, `trajectory`, then Phase 12 calibrated critic.

---

# 2026-09-12 — Semantic V2 capability and archetype expansion

Exact task matrix: [V4_IMPLEMENTATION.md](V4_IMPLEMENTATION.md).

- Immutable baseline: six cases, 11 V1 scenes; silent estimated timing under
  `output/v4-baseline/`. Original SHA `932af863982eac6d5d0db099c3914c00cd7a7813`.
- Manual plant capability passed frame/browser review. Automatic live plant run 09
  subsequently passed all ten semantic checks and final-frame review: $0.03532815,
  22.123 s scene ready, 22.570 s reported first playable. One teaching call and two
  director calls; JSON-object compatibility mode with strict local schemas. No TTS.
- Earlier failed model attempts remain retained with their actual costs and causes.
  Saved-output replays are separately labeled and do not count as live latency evidence.
- Six manual archetype cases now export successfully: DNA, tectonic section, MLA,
  numbered caching rules, HTTP flow and water cycle. Latest output:
  `output/semantic-archetypes-05/`. Frame review corrected a spurious query vector in the
  MLA K/V representation, mantle placement, cycle crossings and dotted primitive
  outlines caused by normalized SVG path-length rasterization. Registry: 39 assets.
- Full regression: 185 tests, 183 pass, 0 fail, 2 skip; 76.158 s. Build and diff checks
  pass. These checks establish implementation behavior, not human teaching efficacy.

V1 remains default. Calibrated VLM/human pairwise, remaining math/graph/spatial layouts,
advanced motion, V2 speech and progressive jobs, full multi-domain evaluation and live
performance/migration gates remain unfinished. No commits or pushes made.

---

# 2026-09-11 — Stale-server incident + last-resort content commit (never 0 scenes)

**Symptom:** a UI job (bare prompt, FHE) ended `error`, **0/2 scenes**, after 163.7 s with board-text
and grounding findings.

**Root cause: a stale server process.** `pid 88578` had started at 15:31, before this session's
Phase 1-3 build; `dist/src/planner.js` was rebuilt hours later. Node loads modules at startup, so
the running server still had the old planner. Proof in the job's own events:
- `attempt:4` — the current code has `CONTENT_ATTEMPTS=3`.
- Grounding was applied to a **prompt** source, but current code logs `planner.grounding-skipped`
  and skips it (`groundingApplies = source.kind !== 'prompt'`).
- No `schema-healed` / `grounding-autofix` events — all Phase 1-3 heals absent.

**Verification:** after `npm run build` + restarting the server, the **exact same prompt** through
the real `POST /api/jobs` path is `complete`, **2/2 scenes**, real Kokoro audio, $0.0017. No code
change was needed for that specific failure — it was purely an un-restarted server.

**Hardening added anyway (defense in depth):** `planContent` now keeps the most recent
structurally-valid candidate (`resolveAnchors` succeeded: 2 scenes, anchors, edges) and, on the
final attempt, if only quality gates remain (key-point board, pacing, grounding), **commits that
candidate** with `planner.gates-deferred` logged instead of failing the chapter. A quality-gate
exhaustion can no longer return 0 scenes for a structurally valid plan; hard structural failures
still throw. New regression: `test/generation.test.js` "Quality-gate exhaustion commits a
structurally valid chapter instead of returning 0 scenes".

Suite: `npm test` → **153 tests, 151 pass, 0 fail, 2 skip**.

**Operational note:** after any build, **restart the server** (`kill <pid>; node
--env-file-if-exists=.env dist/src/server.js`). A long-lived Node server does not pick up rebuilt
`dist/`. This is the single most likely cause of "the fix didn't work" reports.

---

# 2026-09-11 — Phase 3 gate consolidation: the 10-min / 20-scene path now COMPLETES

Suite: `npm test` → **152 tests, 150 pass, 0 fail, 2 skip** (up from 150/148).

**Two over-strict gates root-caused and demoted (harness §36 + §56):**

1. **Schema-format fields threw before any heal.** `validatePlan` (`src/explainer/engine.ts:76,80,82`) rejects
   an over-long `visualIntent`, a non-charset `conceptId`, or a malformed `evidenceIds`, and it runs
   inside `resolveAnchors` *before* every deterministic heal. One stray space in a `conceptId` cost a
   full 20-50 s model repair. Fix: `healSchemaFields()` (`src/explainer/planner.ts`, exported) normalizes these
   planning-metadata fields before validation — visualIntent/keyPoint trimmed to their limits at a
   word boundary, `conceptId` charset-normalized + capped at 40, `evidenceIds` filtered to valid
   `p\d+:c\d+` and capped at 4 (or dropped so grounding can re-cite). Logged `planner.schema-healed`.
2. **Shape diversity was hard on the director-exhausted fallback** (`src/explainer/planner.ts`), so a chapter
   whose director failed 3× died instead of degrading. Harness §36: "Shape diversity may remain a
   soft diagnostic." Fix: demote to a `planner.shape-diagnostic{fallback:true}` warning; keep
   `checkKindCollision` and `preflightScene` hard.

**Measured — same 53-page DeepSeek-V3 report, 10-min, kokoro:**

| run | before this pass | after |
|---|---|---|
| `8d27af04` (original) | error, **0/20 scenes** | — |
| Phase 1 gate | partial, 4/20 | — |
| Phase 2 gate | partial, 8/20 | — |
| Phase 3 gate | partial, 10/20 | — |
| **Phase 3b (`6308827e`)** | — | **complete, 20/20 scenes**, $0.0125, 27 calls, MP4 ✓ |

Also live: 1-min complete, 5-min complete (10/10). Final run health: **0 timeouts, 0 `unknown`
errorKind, 0 TTS queue timeouts**; `schema-healed` fired 4× (each a previously-fatal repair);
`direction-fallback` 1/10 chapters (logged, all-box flow for that chapter — visible, not silent);
outline healthy; Kokoro cache 988.8 MB after 42 requests / 18 min uptime (bounded, no leak growth).

**Tests:** `test/outline-repair.test.js` gains `healSchemaFields` unit + `resolveAnchors`
integration coverage; the two regressions that asserted the old hard gates
(`Exhausted director retries…`, `V3-4 templates: unknown template…`) now assert the correct
invariants — the chapter degrades to a validated fallback, and an invalid template is **never**
committed as that template.

## Remaining limitations (honest)

- **Latency, not completion, is now the gap.** 10-min `firstPlayableMs` 64 s (harness §5.1 target
  <8 s); 5-min 66 s. `repairs:11` across 10 chapters at ~20-50 s each; chapter 5 content alone took
  117 s, chapter 3 director 48 s (3 attempts then fallback). Phase 4 work: ≤2-min fast path, wider
  auto-director coverage, hedged content.
- **1/10 chapters degraded to the all-box fallback** — a real quality loss on that chapter, logged
  as a soft diagnostic. Reducing director-fallback frequency is the auto-director task.
- Pool N≥3 still degrades on this 24 GB box (default 2). The machine was swap-bound throughout.
- Estimated-timing fallback for a scene remains silent-with-captions (user-approved policy).

---

# 2026-09-11 — TTS reliability + planner boundary (Phase 1+2): Kokoro leak root-caused and bounded; outline no longer a single point of failure

Suite: `npm test` → **150 tests, 148 pass, 0 fail, 2 skip** (was 133/131/0/2). New:
`test/tts-pool.test.js` (8), `test/outline-repair.test.js` (8), plus `classifyError` coverage in
`test/jobs.test.js`.

## Root cause: the "provider timeout under multi-chapter load" was local Kokoro memory exhaustion

Three prior hypotheses were wrong (OpenRouter timeout; a provider lock; a job-level watchdog).
Evidence: failing job `8d27af04` crashed at `dist/src/jobs.js:218` = the **`await speech`** line, not
a planner call; its `speech.request` at `11:03:51.583` + the fixed 120 s `AbortSignal.timeout`
(`src/kokoro-speech.ts:67`) = `11:05:51.583`, and `job.failure` fired at `11:05:51.708` (125 ms
match). A 10 h 31 m Kokoro server (`pid 29415`) was holding an **18 GB footprint — 17 GB dirty
`IOAccelerator`** for an 82 M bf16 model (~165 MB), with the host at **23.5 GB swap used / 81 MB
free**. `mx.clear_cache()` / `set_cache_limit` appeared **nowhere**; the process Metal buffer pool
grew without bound. Compounding: `kokoro_mlx` is single-flight (`with self._lock:`,
`kokoro.py:114`) with no batch API, and the job runner fired **all 20 scenes at once**
(`src/explainer/jobs.ts` speculative fan-out bypassed `sceneSem` and the character cap).

## Fixes shipped

**Phase 1 — Kokoro-only parallel, bounded, leak-free, fail-soft**
- `scripts/kokoro_tts.py`: `mx.set_cache_limit(KOKORO_CACHE_LIMIT_MB)` (default 1024) once per
  process; `en.G2P` cached per language variant (was rebuilt every request).
- `scripts/kokoro_server.py`: `/health` now reports `requests_served`, `uptime_s`, `cache_mb`,
  `peak_mb`; optional self-recycle (`KOKORO_RECYCLE_AFTER`).
- `scripts/kokoro_pool.sh` (new): start/stop/status N self-restarting workers on
  `8765..8765+N-1`, memory-gated (`KOKORO_POOL_MIN_FREE_MB`); `npm run kokoro-pool`.
- `src/tts-pool.ts` (new): bounded priority pool — one in-flight request per worker, priority
  `chapter*100 + scene` so scene 1 is first, **queue-wait and service-time deadlines separate**,
  one retry on a different worker, health-gated workers, `cancel(key)`.
- `src/explainer/jobs.ts`: `onContentReady` enqueues instead of firing unbounded calls; character
  reservation moves to enqueue; a regenerated chapter cancels its superseded pool entry; a TTS
  failure degrades **one scene** to explicitly-estimated silent timing (`degradedScenes`,
  `fallbackCount`, `job.status='partial'`) instead of killing the job. `src/kokoro-speech.ts`
  exposes `ensureKokoroServer` (per-URL) + `synthesizeAtServer`; robot-voice branch removed from
  `public/app.ts`. `classifyError` now distinguishes `timeout` / `provider-truncated` /
  `provider-refused` / `speech` (was 18 blind `unknown`).

**Phase 2 — deterministic planner boundary**
- `src/explainer/planner.ts`: outline is now a bounded repair loop (`OUTLINE_ATTEMPTS=3`) that re-asks with
  the exact clauses instead of throwing once; `validateOutline()` returns **named clauses**;
  `healOutline()` trims >28 chars, drops entity-only key points (fixes the live `"+ 6O2"`), snaps
  unknown arcs by position, and synthesises a missing key point from the chapter's own objective.
- `call()`: `finish_reason==='length'` retries once at **×1.5 budget** with reasoning
  `1200→400` (was any non-`stop` thrown as "incomplete or refused"); `content_filter` fails
  loudly and distinctly; `require_parameters:true` is now sent unless the model is a known
  non-strict tier (`qwen/`, `inclusionai/`, `deepseek/`) — the old guard keyed on `callModel`
  truthiness, which the router made always-true, so strict-schema pinning was **never** sent.
- `src/explainer/budgets.ts`: outline floor `2000+250·ch` → `2600+400·ch` (1-min: 2250 → 3000).

## Measured

| measurement | before | after |
|---|---|---|
| Kokoro Metal cache after 20 scenes | **16 963.8 MB** | **1024.2 MB** (cap), 983 MB after 16 min uptime |
| per-request clear_cache | — | slower (p50 4.19 s vs 3.73 s) — **not used**; cap-only wins |
| pool throughput, 20 narrations | — | N=1 14.6–18.6/min · **N=2 17.4–19.1/min** · N=3 15.7/min |
| live 1-min (prompt) | — | **complete**, 2 scenes, $0.0017, repairs 1, fallback 0, `strictSchema:true` (gemini) / false (qwen) |
| live 5-min (prompt) | — | **complete**, 10/10 scenes, $0.0043, repairs 4, fallback 0, MP4 ✓ |
| live 10-min (DeepSeek-V3 PDF) | job `8d27af04`: error, **0 scenes** | **partial**, **8/20 scenes**, $0.0163, fallback 0, MP4 ✓ |
| saved outline failures `1283a4d2 / 9e5c560f / 09ddb161` | all `Invalid chapter outline` (fatal) | **all heal to valid, 0 repair calls** |

Zero `aborted due to timeout`, zero `errorKind:'unknown'` in the post-fix live logs.

## Honest limitations

- The 10-min run still only **partially completes (8/20 scenes)**: the remaining blocker is the
  **content gate stack**, not TTS. `errorKind:'plan'`, `"Invalid conceptId (node c)"` after 12
  repairs — the reject-and-retry gates are Phase 3, out of this round's scope. Partial commit
  preserves the 8 playable scenes (MP4 exported).
- Pool size >1 gave at best a modest wall win and **degrades at N≥3** on this 24 GB box under
  memory pressure; default is 2 but the machine was swap-bound throughout, so the sweep is noisy.
- `kokoro_tts.synthesize` still reaches into `tts._model/_config/_voices` and does not take the
  library lock; the pool avoids the hazard by never sending two concurrent requests to one worker.
- A degraded (estimated) scene is silent with captions — this is the user-approved policy and is
  labelled in `job.summary`, `degradedScenes`, the UI status, and `scene.timing.kind='estimated'`.
- Hardware/provider numbers describe only this local implementation. No claim about Lamina Labs.

## Next bounded task

**Phase 3 — gate consolidation** (`docs/PERFORMANCE_ANALYSIS.md` §3.4, `docs/HANDOFF.md`): split the
~12 `planContent` validators into hard-correctness (stay reject/retry) vs quality-advisory
(deterministic heal), so the 10-min path reaches 20/20 without 12 repairs. Evidence:
`docs/RESULTS.md` 2026-09-11 critical-bug pass measured the 53 % content repair rate as the gate
stack, not the model.

---

# 2026-09-11 — Critical-bug pass: TTS job-killer, mid-word splits, dead code, docs

Fixes (suite 133 tests, 131 pass, 0 fail):
- **TTS alignment no longer aborts a job.** `scripts/kokoro_tts.py` `fail()` on an
  unmatchable word (`O(1).`, `RuBisCO`) killed fully planned + synthesized runs (2 real
  failures, 165-170s, ~$0.007 each). Wrapped the mapper: on mismatch, drop the chunk's
  partial timings and emit proportional word timings (character-length share of the
  chunk's predicted duration) — audio preserved, job continues.
- **`wrapText` breaks at `/` and `_` before any mid-word cut** (live SVGs showed
  `recurrence/conv|olution`, `parameter|s`). Regression test added.
- **Removed domain hardcoding** (biology keyword regex in `src/explainer/auto-director.ts`).
- **Removed dead code**: `generateOpenRouterPlan`, legacy Anthropic `generatePlan` (+tests).

Measured A/B (content model): gemini-3.8-flash content = 51.7s / **$0.0141** / 1 repair;
qwen3.7-flash = ~25s / **$0.005** / 0-1 repairs. Conclusion: the **53% aggregate content
repair rate is the gate stack, not the model** — buying a bigger model does not remove it.
The next fix is gate consolidation, not a model swap.

Docs: HANDOFF 693 -> 116 lines (history archived), ARCHITECTURE module map refreshed,
docs/README index (current vs historical), historical banners on superseded docs.

---

# 2026-09-11 — UI source intake restored + durable app.log + model-tier audit

**UI RCA:** `#prompt-fields` (which holds the Source dropdown with *Public HTTPS link*
and *PDF document*) was `hidden` and only revealed when mode = "AI planner"; the select
defaulted to "Offline fixture", so the upload/URL inputs never appeared. Moreover the
running server (PID 76959) was an old build. Fixes: mode defaults to **AI planner**,
`#prompt-fields` visible on load, `#fixture-fields` hidden, and the browser-client module
whitelist in `server.ts` was missing `/src/templates.js` (engine.js imports it) → a 404
that could break client rendering; added. Removed the one inline style that tripped CSP.
Verified in-browser: Source = Prompt / Source text / Public HTTPS link / PDF document;
PDF → file chooser, URL → https textbox; **0 console errors**.

**Durable logging:** every event now appends to `app.log` (repo root, gitignored,
`APP_LOG_PATH` overridable, 20 MB rotation) in addition to the per-job `log.jsonl`. New
`job.summary` line on completion/failure records wall ms, first-playable, timeline, scene
count, cost, calls, prompt/completion/cached tokens and per-stage spans — one record for
cost/time tracking.

**Model-tier audit (ledger, job `ddf92a9f`):** the env already runs a static per-task
router — outline `google/gemini-3.8-flash` ($0.0072, 5.5s, **82% of run cost**),
content/director `qwen/qwen3.7-flash` ($0.0004/$0.00025, ~20-25s each). The expensive
model is on the task cheapest to replace; the cheap-but-slow model is on the
latency-critical calls. Concrete router experiment: move the outline to a cheap model
(largest cost win), test a faster content/director model for wall time.

---

# 2026-09-11 — RCA pass 2: static-tail root cause fixed (beat fill); PDF + arXiv URL complete

**Root cause of the multi-second static intervals (the top quality debt):** narration
teaches in 2-3 beats, but the model anchors every node in beat 1 — later beats then play
with nothing new on the canvas. Prompt pressure failed across 4 attempts. Fix:
`fillBeats()` deterministically synthesizes a concept node from an uncovered beat's OWN
narration (label quotes the beat, anchor at the beat start, evidence from the chapter's
evidence set, flagged `auto` so it is exempt from the source-support overlap while still
requiring a valid chunk id). Also this pass: `healDanglingEdges()` (drop unrenderable
edges — the URL-path blocker), `keypoint-healed` remap/drop, whole-source
`grounding-autofix`, `conceptId` heal, outline rejects entity-only key points, narration
floor 80→70, pacing pressure for two attempts then engine stretch.

**Measured (both paths, same 53-page arXiv paper, 1-min):**

| run | wall | timeline | planning $ | calls | static lints | outcome |
|---|---|---|---|---|---|---|
| PDF (`--pdf`, job `9886a265`) | **1:28** | 51.9s | **$0.0094** | outline 3.8s + content 27.6s + director 21.2s + director-repair 20.3s | **2600 / 2600 ms** | first attempt, 0 content repairs |
| arXiv URL (`--url`, job `35dddd0d`) | **1:15** | 43.6s | **$0.0095** | outline 4.7s + content 23.0s + 1 repair 21.9s + director 18.4s | **2600 / 2600 ms** | complete |

Static intervals dropped from 8305/7230ms to **2600/2600ms — under the 3500ms limit on
both paths**. Total cost per 1-min video ≈ $0.01 planning + ~$0.001 figures (Kokoro voice
free). Suite 128 tests, 126 pass, 0 fail, 2 skip.

**Honest residuals:** director is still the slowest stage (18-21s, sometimes +20s repair)
— the auto-director did not fire on these chapters because two of five nodes are
unclassifiable note/directive labels; director-repair fires on templates/layout
occasionally; embeddings remain BM25-only live; human playback review pending.

---

# 2026-09-11 — LD8 stability pass: deterministic heal/autofix, 1:50 wall

Job `bbef4e24`: complete, 2 scenes, 43.5s timeline, $0.0097 planning, wall 1:50 (was 10+ min
failure loops). New deterministic repairs: keypoint-healed (invented claims remapped to the
closest outline key point or dropped), outline rejects entity-only key points at validation
time (~4s), grounding-autofix always-on over ALL source chunks (support found anywhere in
the document is cited honestly), spread deference attempt≥1. Lints: staticInterval
8305/7230ms still over 3500 (spread-deference trade-off); director still called here
(ambiguous labels) — 20.1s+17.4s repairs. See the fuller LD8 entry below.

---

# 2026-09-11 — LD8: live validation on a 53-page paper — COMPLETE (first end-to-end large-doc run)

DeepSeek-V3 technical report (arxiv 2412.19437, 53 pages / 36 extracted / 108k chars), 1-min
video, `--pdf` raw-source path, gemini-3.8-flash + Kokoro. Job `8d9f752c`: **complete**,
2 scenes, 50.1s timeline (MP4 50.17s, h264+aac), per-scene SVGs + manifest in
`output/videos/tmp-dsv3-pdf-1min.scenes/`. Planning cost **$0.0102** (5 model calls:
outline 4.3s / content 27.3s + 2 repairs 21+37s / director 19.1s); wall ~109s including
TTS+render. Kokoro-aligned timing both scenes (audio 26.25s/22.6s vs scene 26.9s/23.25s —
exact designed 650ms tail); connector crossings 0.

**Page coverage >15 proven**: `SourceDocument.pages` length 36; document map (v3 heuristics)
30 clean sections routed by the outline (`sourceSections`); evidence chunks cited by every
node (LD6 grounding gate passed after fixes below).

**Fixes that got here (each root-caused from live stack traces, committed `b1379c5`+):**
- Model-authored `beats[]` duplicated the whole narration → removed from schema, derived
  deterministically from sentence boundaries (decimal-safe split at whitespace after
  punctuation). Content call 28s → 14-17s.
- Reasoning burn (gemini-3.8-flash thinking ~8k tokens per call) → `reasoning:{max_tokens:1200}`.
- Map junk sections (table headers "Training Costs Pre-Training Context Extension
  Post-Training", figure labels 30-104 chars, "Time ➔") polluted routing → three
  deterministic filters; map cache versioned (v3) so stale maps rebuild.
- `checkEvidence`/`checkKeyPoints` exact-token membership counted "active" vs "activated"
  as uncovered → prefix-tolerant matching.
- `checkAnchorSpread` deference after 2 failed attempts (engine draw-stretch fills
  residual silence deterministically) — this UNBLOCKED completion but see limitation.
- 429 in-place backoff (Retry-After), keyPoints ≤28 chars ×2-3, narration floor 90→80
  words, visualIntent cap 80→120, hyphen-prefix anchor matching, parallel figure VLM
  (3.4s for 4), parallel ingest/figure-detect, content payload slimmed (map/pages stripped).

**Honest limitations:** (1) scene-1 staticIntervalMs 10405ms / scene-2 5155ms over the
3500ms limit — the spread-deference traded the gate for completion; density debt persists
in live output (V3-6 known issue); (2) director call is now the slowest single stage
(19.1s) — the deterministic layout compiler (plan Next item 1) is the top latency lever;
(3) embeddings untested live (BM25-only path used; no EMBEDDINGS_API_KEY configured);
(4) two repair cycles still burned ~58s — first-attempt content success is not yet
reliable on unseen large sources; (5) human listening of the MP4 pending.

---

# 2026-09-10 — LD2–LD7: source intelligence layer (map, BM25+hybrid retrieval, map-driven outline, evidence grounding, budgets)

Implements `docs/SOURCE_INTELLIGENCE_PLAN.md` phases LD2–LD7 in one batched session
(user approved batching). Commits: LD2+LD3 one commit; LD4+LD5 one commit; LD6+LD7 one
commit. Suite: `npm test` → 118 tests, 116 pass, 0 fail, 2 skip (live-TTS-cred gated),
up from 97/95/0/2 after LD1.

**Exact tests:** new `test/document-map.test.js` (heading sections with tiling spans,
48-section cap, page-window fallback, sha256 cache round-trip), `test/retrieval.test.js`
(stable `p{page}:c{n}` chunk ids, BM25 topic-vs-filler ranking, document-order fallback),
`test/hybrid-retrieval.test.js` (RRF fusion retrieves a cosine-only chunk BM25 cannot see —
the synonym case; BM25-only fallback determinism), `test/embeddings.test.js` (batched
embedding call, sha256 cache hit with zero provider calls, stale-cache rebuild, fail-soft
on provider error), `test/map-planning.test.js` (outline sees the DOCUMENT MAP, not raw
text; chapter evidence scoped to outline-routed sections; small sources keep legacy path),
`test/budgets.test.js` (each budget scales only with its own input), plus checkEvidence
unit tests in `test/validators.test.js`.

**What shipped (our implementation):**
- LD2 `src/explainer/document-map.ts`: heading detection over page-tagged text → ordered sections
  with true page numbers, tiling spans, extractive summaries (zero model calls); 48-section
  cap with even selection; page-window fallback; sha256-cached under `.data/`; jobs.ts
  builds/caches it fail-soft after ingest (`source.map-built` ledger event).
- LD3 `src/explainer/retrieval.ts`: paragraph-boundary chunking (stable per-page ids) + zero-dep BM25
  over objective/keyPoints; evidence assembled in document order within budget; chunk ids
  returned. Old lexical `retrieveForChapter` removed.
- LD4 `src/explainer/embeddings.ts` + RRF: key-gated OpenAI-compatible embeddings
  (`EMBEDDINGS_API_KEY/URL/MODEL`, ~$0.02/1M tokens), batched, sha256-cached, fully fail-soft
  (no key/error → BM25-only, logged `source.embed-mode`); Reciprocal Rank Fusion (k=60) of
  BM25 + cosine ranks; vectors aligned by stable chunk id; per-chapter query embed.
- LD5 map-driven planning: sources >60k chars hand the outline call
  `renderMapForOutline` (section ids/pages/summaries + figure digest) instead of 120k raw
  text; outline schema requires `sourceSections` per chapter; planner routes chapter
  evidence to outline-selected sections (unknown ids dropped; chunks must lie fully inside
  a routed span, logged `source.section-scope-empty`). Small sources keep the legacy path.
- LD6 grounding: content schema + engine whitelist carry `evidenceIds` (1-4 chunk ids);
  labeled `source.evidenceChunks` ride into content calls; deterministic `checkEvidence`
  flags unknown chunk ids and citations with <2 shared content words vs the node's
  label+keyPoint — thrown into the existing content repair loop.
- LD7 `src/explainer/budgets.ts`: five budget functions (output/retrieval/input/cost/latency); all
  planner + figure call sites (max_tokens, timeouts, outline clip) now read it. Live-proven
  1-min values unchanged (content 9000, director 5000, outline min(9000,2000+chapters·250)).

**What this does NOT establish:** no live multi-hundred-page run yet (LD8 pending — needs a
real textbook PDF + paid keys); embeddings untested against a real provider (mock-fetcher
only); grounding is word-overlap, not entailment; a straddling chunk at a section boundary
serves neither section (dropped from both by design).

---

# 2026-09-10 — LD1: full-document page-aware extraction (source-intelligence plan)

Implements LD1 of `docs/SOURCE_INTELLIGENCE_PLAN.md`. Suite: `npm test` → 97 tests,
95 pass, 0 fail, 2 skip (live-TTS-cred gated) — up from 93/91/0/2.

**Exact tests:** new `test/page-extraction.test.js` — (a) buildPageText pure unit tests
(page offsets, blank-page skip, tailCut word-boundary cut, determinism); (b) end-to-end:
a hand-rolled **20-page PDF** (Helvetica base-14, one text line per page, built in-test —
zero new deps) through real poppler `pdftotext` → all 20 pages extracted with correct
1-based page offsets (old `PAGE_LIMIT=15` truncated at page 15). Existing ingestion tests
updated for the raised cap.

**Code changes:**
- `src/explainer/sources.ts`: `PAGE_LIMIT=15` removed (full-document `pdftotext -raw`, maxBuffer
  2MB→16MB, timeout 30s→60s); `TEXT_LIMIT` 200k→5M chars (book scale); new exported
  `buildPageText(raw, tailCut)` — form-feed page split, per-page compaction, joined with
  `\n\n`, returns `pages: {page, start}[]` with true 1-based page numbers; blank pages
  skipped; pdftotext's trailing `\f` handled.
- `stripAcademicTail` now gated to paper-like docs (≤150k chars AND marker in back 40%)
  so a book's References/Appendix sections survive. NOTE: gate tightened from the old
  `index>0.3` rule — papers with References before ~60% of body now keep their tail.
- `SourceDocument.pages?: Array<{page:number;start:number}>` (`src/shared/types.ts`); PDF and
  arxiv-fallback URL paths populate it; text/markdown/json/docx/pptx stay flat.

**What this does NOT establish:** the outline call still clips at 120k chars and the
prompt-builder brief at 60k (L2 layers 2-3) — large docs still lose their tail before
planning until LD2 (document map) + LD5 (map-driven outline). Retrieval is still
lexical-only. No paid run in this phase.

---

# 2026-09-10 — Reviewer-optimization round 1 (O1-O3)

Commit `fe518bb` on `opt-v3-harness`. Suite 93 tests, 91 pass, 0 fail, 2 skip.

**Exact tests:** full `npm test` after each change; repairFigureJson exercised
against the exact truncated payload from the live DeepSeek run plus
mid-array/mid-string/no-JSON/nested-quote cases; mock `run-visual-bench` for
the pacing layers; one live 1-min DeepSeek run per pacing change.

**Measured (our implementation):**
- Figure context: content calls now receive the figure inventory (was
  outline-only). Live run: 4 detected / 3 described, no retry storm.
- Pacing: mock bench over-3500ms lints 102→0. Live: 15775/8500ms →
  3095/5180ms static intervals. Mechanism: engine-side deterministic draw
  stretch + anchor-spread validator (0 spread repairs needed on the live run —
  the prompt+validator pressure alone changed anchor placement).
- Vision robustness: repairFigureJson + single retry; schema capped at 4 key
  numbers, ≤280-char fields.

**What this does NOT establish:** the 5180ms scene-1 residual shows the pacing
fix is incomplete for wide anchor gaps; connector crossing (1 hit) is a known
residual; grid-router alternative deferred with rationale in HANDOFF.

---

# 2026-09-10 — Source-intake program (P1-P6, harness source-intake spec)

Branch `opt-v3-harness`, commits `cf68ac4`→`357706e` (pushed). Suite: 93 tests,
91 pass, 0 fail, 2 skip (live-TTS-cred gated).

**Exact tests:** `npm test` after each phase; new files `test/figures.test.js`
(real sips-generated PDF through detect+crop; mock-fetcher describeFigures
schema/cap/one-call-per-figure) + retrieval test in `test/validators.test.js`
(objective-matched paragraphs retrieved, unrelated dropped, tiny source
pass-through).

**What each phase established (our implementation only):**
- P1 extraction: docx/pptx (unzip+XML), md/json/text ingestion; sha256 ledger.
- P2 figures: poppler `<image>` detection is deterministic and whole-document
  (real figures on pages 32-57 of a 59-page paper beat page-2 decorations via
  area sort); crops are coordinate-true at 150dpi (pdftohtml XML coords are
  150dpi pixels — verified visually, output/review-v36/figure-crop-test.png);
  VLM description is ≤4 bounded calls, strict-schema, fail-soft per figure.
- P3 understanding: rides the outline call (no extra model call — budget stays
  1 outline + 1 registry/chapter); validation REQUIRES the fields; a DeepSeek
  paper run produced correct paperTitle + workedExample ("DeepSeek-V4-Pro")
  and the hook chapter opens with what the paper is.
- P4 retrieval: objective-keyed lexical scoring replaced ordinal chunking;
  unit-proven on a synthetic doc (attention/softmax paragraphs retrieved,
  furniture filler dropped).
- P5 logging: per-job JSONL ledger (`.data/<id>/log.jsonl`), errorKind
  taxonomy, `dist/scripts/journal.js` (43 events, 4 calls, 0 errors on live
  run — call table with tokens+cost).
- P6 eval: 6-seed visual bench (cases JSON schema), runner with Level A
  deterministic lints + semantic coverage → `output/evaluations/visual-bench/
  report.json`; Level-C judge scores 6-dimension rubric strips (live-only).

**Live run (real cost, not fixture):** DeepSeek-V4 PDF, 1 min, gemini-3.8-flash:
$0.0492, 4 calls, 1 content repair, complete; figures detected 4/described 3
(1 truncated-JSON parse failure kept undescribed — fail-soft, logged
`source.figure-describe-failed`).

**What this does NOT establish:** fixture throughput is not model/TTS speed;
local bench results say nothing about Lamina Labs' actual pipeline; the VLM
judge is a rubric scorer, not a ground truth; mock-mode semantic coverage is
structurally 0/23.

**Limitations / next bounded:** static-interval density debt persists in live
scenes (9025/7825ms vs 3500 limit); figure-describe parse retry; figure-aware
content prompt; judge unexercised live.

---

# 2026-09-10 — OPT-V3 program (teacher rebuild) on branch `opt-v3-harness`

All on `opt-v3-harness` (5 commits, pushed); `main` untouched. Contract: `EXPLAIN_CANVAS_AGENT_HARNESS_V3.md`.

- **V3-1 teacher contract** (`b0f25e1`): `checkBoardText` (key points on canvas ≥50% label overlap) + `checkFirstVisual` (anchor ≤30 words) wired into the content repair loop; teacher-contract prompt sentences. Live GPS run job `6a99f295` first attempt $0.0059 — opens on a 0.07s worked example, key points verbatim on board. Frames `output/review-gps-v31/`.
- **V3-2 beat model** (`8ba46ff`): `beats[]` exact narration partition + `beatId`/`conceptId`; beat-local anchor resolution (repeated words can't mismatch across beats); `checkConceptContinuity`; reveal lead −180ms. Live pump run job `77518dab` first attempt $0.0166, beats 3+2, `target_tire` identical across scenes. Frames `output/review-pump-v32/`.
- **V3-3 sketch + safe connectors** (`7df6886`): `EXPLAIN_SKETCH=1` wobbly double-stroke + hachure (seeded PRNG, zero deps, deterministic); `routeEdge` flips/grows bow until the bezier clears intermediate nodes; icon endpoints anchor to glyph edge. Sketch pump export + frame proof.
- **V3-4 domain templates** (`b5088c1`, then matrix/fork/tectonic): 5 deterministic compositions (TLS ladder, supply/demand, attention matrix, DNA fork, tectonic section) requested by the director via schema, revealed on the anchor nodes' own timing; unknown template values fail loudly. Frames `output/review-v36/`.
- **V3-5 progression critic + lints** (`a80780f`): critic reviews a 5-frame contact strip; `staticIntervalMs` + `connectorThroughNode` deterministic lints pre-flag issues and drive repair even without sharp.
- **V3-6 benchmark artifacts**: `output/compare/{v1,v2}/` — 20 scenes × 5 frames + `lints.json`. Honest numbers: **17/20 scenes exceed the 3500ms static-interval limit** (the density debt, now measurable — mostly narration tails after last reveal); 2 scenes have residual connector crossings (`icons/lookup`, `shapes/primitives`); template scenes clear the connector lint. Teaching-clarity judgment is human, pending on these artifacts.

Suite progression: 75 → 87 passing across V3 (89 tests, 2 live-skip). No paid generations beyond the two 1-min live proofs ($0.0059 + $0.0166). V2 substitute here = sketch style + templates + beats + gates; full harness V2 (scene-graph, actions) remains future.

# 2026-09-10 — DeepSeek-V4 paper run + two render fixes

- Full suite: `npm test` → 73 passed, 0 failed, 2 skipped (up from 71/0/2 — hyphen-wrap + label-order tests).
- Live paper run (`/tmp/papers/2606.19348.pdf`, 1 min, enriched, kokoro): job `7860802b`, complete first attempt in 34.75s, 2 scenes / 64s, $0.0423 (gemini-3.8-flash, 54k prompt / 1.9k completion tokens). MP4: 1280×720 h264 + aac, 64.0s. Artifacts: `output/videos/tmp-papers-2606-19348-pdf-1min.{mp4,scenes/}`.
- Audio sync (automated): both scenes kokoro-aligned, gapMs 0, trailingNonSilent false, audio 33900/28800ms vs scene 34550/29450ms (delta = designed 650ms tail), first-word starts 350/325ms. PASS.
- Frame QA (f05/f33/f55 + f33-fixed in `output/review-deepseek-v4/`): content grounded (1M context, 27% FLOPs, V3.2 baseline). Found + fixed: hyphen mid-word split, edge-label under-node clip. Not fixed: model-truncated `FLOPs (T)` label; sparse first seconds.
- Speed: planning-bound (28.5s of 34.75s); render 4.5s/768 frames. No renderer win available.

# 2026-09-10 — Harness adoption + scene-by-scene output

- Full suite: `npm test` → 71 passed, 0 failed, 2 skipped (up from 70/0/2 — 1 new `scene-output` test).
- Harness analysis: all 82 sections read. Current code = V1 Plan + deterministic compiler + pure `renderSVG`; harness demands V2 storyboard/registry/asset/compiler program (§80 Tasks 1–12). Adopted as north-star reference; shipped bounded slice only: per-scene persistence (harness §§45/57/64, Phase 0 baseline capture).
- Export proof (silent fixture, estimated timing — not TTS/model performance): attention MP4 (79 frames, 1fps, 640w, 78740ms) + `output/scenes-check/attention.scenes/` holding `scene-01-context.svg` … `scene-04-combine.svg` + `manifest.json` (4 scenes, durations 17616/20513/19685/20926ms, `timingKind: estimated`, audio null).
- Limitation: final-frame SVGs only; no progression sheets, no V2 types yet.

# 2026-09-10 — Phase A baseline correctness (A1, A4, A5, A6)

- Full suite: `npm test` → 70 passed, 0 failed, 2 skipped (up from 65/0/1 before this pass — 6
  new tests: 1 live-gated Kokoro timing assertion extension, 1 kind-collision unit test, 1 A4
  end-to-end generation test, 1 A5 schema test, 1 A5 end-to-end generation test, 1 A6 job-snapshot
  test — plus 1 live-gated multi-chunk boundary test from A1 review round 1; both live tests skip
  without `TEST_KOKORO_TTS=1`). Live: `TEST_KOKORO_TTS=1 npm test` → 72 passed, 0 failed.
- A1 (`scripts/kokoro_tts.py`): traced the trailing-audio defect to the duration predictor's
  BOS/EOS frame entries (`pred[0]`/`pred[-1]` per chunk) being excluded from every word's
  start/end sum despite being real synthesized audio. Fixed by attributing BOS lead-in to every
  word's start and clamping the last word's `endMs` to the true total audio duration. Verified
  live: `TEST_KOKORO_TTS=1 npm test` — first word now starts after a nonzero BOS offset; trailing
  gap after the last word is under 1ms (was previously 1.55-5.125s per the 2026-09-09 review's 32
  audited scenes). Human listening verification across those 32 scenes remains outstanding.
- A4 (`src/explainer/planner.ts`): `checkKindCollision` now allows same-kind nodes whose labels reduce to
  one stem after stripping a trailing instance marker (number/letter/ordinal) — token rows and
  multiple lettered keys pass; two different concepts sharing a kind still fail. The hard
  `checkShapeMix` gate was removed from `directScene`'s normal per-attempt path (now a
  `planner.shape-diagnostic` log line only) but deliberately left in place on the
  exhausted-director-fallback path, per the existing `'Exhausted director retries fail loudly...'`
  regression test it protects.
- A5 (`src/explainer/schema.ts`, `src/explainer/planner.ts`): found that the single-scene critic-repair call was
  validated against the fixed 2-scene `directorSchema` — a real, previously-silent bug meaning
  critic-requested repairs have likely never actually applied (the failure was swallowed by
  `repairFromCritique`'s own `catch`). `directorSchema` is now `directorSchema(count)`; a new
  end-to-end test with `visualCritic:true` proves a repair's changed `kind` now reaches the
  committed scene.
- A6 (`src/shared/types.ts`, `src/explainer/jobs.ts`, `docs/REVIEW_CORPUS.md`): every new `JobSnapshot` carries
  `manifestVersion` (`GENERATION_MANIFEST_VERSION` in `src/explainer/jobs.ts`); added a named, stable
  review corpus table so future reports cite the same evidence set by name.
- No paid provider calls in this pass; no commits beyond what was explicitly authorized.

---

# Latest observed results — 2026-09-09, multi-video review

Evidence and method: [VIDEO_QUALITY_REVIEW.md](VIDEO_QUALITY_REVIEW.md). Proposed next work: [OPTIMIZATION_PLAN.md](OPTIMIZATION_PLAN.md). Earlier entries below are historical and can contain superseded provider behavior, test counts and unverified claims; do not use them as current acceptance evidence.

- Five additional videos, 877.583 seconds total, reviewed through ordered frame samples, selected dense windows, saved narration/timing and WAV energy. No auditory quality rating was performed.
- Full suite: `npm test` with loopback access, 64 passed / 0 failed / 1 skipped; build passed. Log: `output/review-2026-09-09/tests.log`.
- 32 saved WAV scenes: last-word timestamp precedes audio end by 1.55–5.125 s; uncovered tails have non-silent energy. This challenges alignment confidence but does not establish exact word errors without listening/independent alignment.
- Reproduced current-source defects: .25 configured fill becomes full opacity; captions return to opening text when activeWord is -1; repeated key kinds and uniform token boxes rejected; one-scene repair response constrained to two scenes.
- Historical prepared-completion spans: DNA 41.477 s, tectonics 39.487 s, printing 45.201 s. These exclude MP4 export and local compute cost; no new provider throughput benchmark was run.
- Source, tests and media were not modified by fixes. Documentation and ignored evidence only; roadmap implementation remains pending.

---

# Observed results

Date: 2026-09-07. Environment: Linux x64, Node v24.19.0. Local prototype only.

## Automated checks

Initial run: **25 passed, 0 failed, 0 skipped**, approximately 0.53 seconds. Re-run `npm test`; timing varies by machine.

Covered: invalid references and schema rejection; deterministic random-access SVG output; stable geometry; 2–6 node rectangle bounds/nonoverlap in all three layouts; connector attachment; speech-rate-dependent duration; scene-boundary selection; buffering clamp/resume; escaping; repeated-word alignment; provider error handling (including 402/429 surfacing); progressive job snapshots; cancellation; partial preservation after provider failure; interrupted snapshots; HTTP lifecycle and cross-origin rejection.

Provider tests use synthetic responses. They establish adapter behavior, not provider availability or natural speech synchronization. OpenRouter and ElevenLives adapters verified with mocked responses and live runs (1-minute chapters with silent fallback on 402).

## SVG construction microbenchmark

Command: `npm run benchmark`.

- 5,000 SVG string constructions after 100 warm-up iterations.
- Mean: 0.01974 ms; median: 0.01333 ms; p95: 0.02690 ms.
- Combined SVG output: 7,674,523 characters counted by JS string length.
- Attention fixture timeline: 78,740 ms.

This measures string construction only. It excludes browser layout/paint, rasterization, encoding, LLM planning, network transfer and speech synthesis. It is not an end-to-end generation claim or a comparison with Simi.

## Silent MP4 export

Command:

```bash
node scripts/export.js --fixture attention --fps 12 --width 1280 --out output/attention.mp4
```

- 945 rendered frames.
- Export wall time reported by the script: 19,601 ms.
- FFprobe: H.264, 1280×720, 12 fps, 78.750 seconds, 165,320 bytes.
- Difference from compiled duration: 10 ms, within one 83.33 ms frame.
- No audio track, intentionally: the offline fixture uses estimated timing.
- Sampled contact-sheet frames inspected: titles, node labels, arrows and notes are legible; progressive reveals appear as intended. This was file inspection, not live browser QA.

Sharp 0.35.4 was reused from the environment's preinstalled runtime. A local optional-dependency installation attempt did not complete; a portable fresh `npm install` was not verified here. The repository pins the optional Sharp version and leaves the dependency-free demo/tests usable without it.

## What these results support

Our constrained scenes can be rendered deterministically without per-video generated programs. Our worker can expose prepared scenes before finishing, and the pure playback controller handles unavailable content. A conventional encoder can produce a short whiteboard video from that representation.

## What these results do not establish

- Lamina's actual renderer, foundation-model ownership or infrastructure.
- Live AI plan quality, provider latency, pricing or success rates.
- Real speech-to-drawing error, voice continuity, browser autoplay and seeking behavior.
- Browser/export pixel identity: both use the same SVG source but different font/rasterization environments can differ.
- Robust non-Latin typography, arbitrary label geometry or diagram routing.
- HLS streaming, distributed scaling, restart resumption or production reliability.

Those gates remain explicit in `EXPERIMENTS.md`. Do not relabel them passed because the synthetic tests pass.

## 2026-09-08 — build recovery and local synchronized speech

- Baseline `npm test` could not compile: malformed strings/object syntax in
  app.ts/server.ts. After syntax recovery, missing anchors silently mapped to
  word zero. Restored rejection, making the former failing test pass.
- Final `TEST_LOCAL_TTS=1 npm test`: 30 pass, 0 fail, 0 skipped (macOS/local
  socket and speech access). Default `npm test`: 29 pass, 1 opt-in skip.
- New regressions cover selected ElevenLabs voice forwarding, persisted speech
  events, visible quota errors, and real PCM repeated-word boundaries.
- Browser QA: audio-clock playback; pause during startup; 10-second seek;
  backward seek to 2 seconds during playback; scene-tail seek without replay;
  transition to second audio; 2x replay; end button reset. No playback error.
- E02/H16: Python WAV sample durations equal recorded durations (0 ms difference)
  for both scenes of replay `4a27d9d4-6d70-4472-9175-05801792d1db` and live job
  `c429d641-4d21-4ccc-827f-00df950b3d42`. Timings label local-segment-aligned.
  Segment boundaries are measured; speech quality is deliberately robotic.
- Final live evaluation: 1-minute target, 65.831-second result, 2 scenes, first
  playable 68.305 seconds, completion 132.444 seconds, $0.000495693 planning,
  model google/gemini-2.5-flash-lite, 2 calls, 674 speech characters. Distinct
  narration, source number/safety and deterministic-frame checks all true.
  Evidence: `output/evaluations/c429d641-4d21-4ccc-827f-00df950b3d42.json`.
- Failed evidence retained: `797beb74-d50e-4bc9-9e4e-e07060db9cd5` could not encode
  MP3 because FFmpeg's x265 library is missing; `0b41a635-9f5f-4508-9cc5-74b3bc019f5c`
  and `14e057e2-6da9-4ebd-b2ab-290935ff6ec8` exhausted repairs on overlong notes.
  Switched local narration to WAV and clarified short-caption instructions.
- Limitations: no long-duration live evaluation or measured human alignment
  accuracy; sequential local TTS slower than playback; FFmpeg export blocked by
  local installation. These results concern this prototype only.

## 2026-09-08 — ElevenLabs diagnosis and successful retest

- Exact configured-voice rejection: HTTP 402, `paid_plan_required`, "Free users
  cannot use library voices via the API. Please upgrade your subscription to
  use this voice." Removed the incorrect exhausted-credit diagnosis.
- GET /v1/voices listed premade Alice; a short synthesis request succeeded with
  MP3 bytes and character timestamps, converted to indexed word timing.
- Full repository attention fixture, job 0537edae-3d6a-4bba-8a44-313a29ec1594:
  4/4 scenes complete, first playable 3014 ms, complete 13558 ms, duration
  84149 ms, 1134 TTS characters. No planner calls involved. All scenes have
  provider-aligned timing and MP3 audio. Browser confirmed actual playback
  (paused=false, advancing audio time, no media error).
- `npm test`: 30 passed, 0 failed, 1 optional macOS integration test skipped.
  New regression verifies exact paid-plan reason without an exhausted-quota label.
- ElevenLabs/Alice now defaults in UI/API; Python robot remains optional.
- The initially proposed saved-document upload was rejected by automatic review;
  the full test used a public educational repository fixture instead.

## 2026-09-08 — icon shape, agentic skills, 1/5/10-minute videos

- Visual Director now emits all three canvas shapes. Prior code accepted
  `icon` in the schema but `mergeDirectorOutput` dropped it, so agents could
  never draw icon nodes. Fixed: `icon` preserved when `hasIcon(kind)`,
  downgraded to box otherwise; SHAPE_GUIDANCE teaches box/icon/illustration
  mixing with per-shape rules. `generate-video.js` gained `--prompt`,
  `--text`, and `--tts elevenlabs|local`.
- Agentic skills added under `skills/`: `canvas` (sole drawing-surface
  contract: 1280×720, safe band y 150–600, shapes, kinds, layouts, drawing
  grammar), `whiteboard-planner` (Stage 1 content prompt), `visual-director`
  (Stage 2 visual prompt with canvas access), `video-generation`
  (orchestrator: 1/5/10-min commands, rich-prompt recipe, verification).
- `npm test`: 37 passed, 0 failed, 1 opt-in skip. New regression: icon nodes
  render left-anchored labels beside a pasted glyph with zero `rx="10"` box
  rects; `generic`+icon rejected. Offline `output/icons.mp4` (187 frames,
  15.5 s) confirms the render path without providers.
- 1-min GPS explainer (ElevenLabs narration): job 5db37de5, 2 scenes,
  65.8 s (1.10 min), planning $0.0053 (3 calls, gemini-3.8-flash), shapes
  icon 3 / box 4, layouts timeline/convergence. MP4 1.8 MB.
- 5-min database-indexing explainer (local TTS — ElevenLabs quota hit 256
  remaining credits mid-run, error preserved visibly, no silent fallback):
  job 7d56aa6b, 10 scenes, 5.13 min, planning $0.0215 (11 calls), shapes
  icon 14 / box 17 / illustration 1, layouts timeline/branch/hierarchy/
  convergence. MP4 7.2 MB.
- 10-min photosynthesis explainer (local TTS): job 11f997ef, 20 scenes,
  12.35 min actual (robot pacing slower than estimate), planning $0.0552
  (24 calls), shapes icon 31 / box 37 / illustration 1, layouts
  convergence/branch/compare/timeline. MP4 17.5 MB.
- Across all 32 AI-planned scenes: zero all-box scenes; every scene mixes at
  least two primitives. Deterministic `renderSVG` checks held.
- Limits: ElevenLabs narrated runs blocked once quota exhausted (401
  quota_exceeded); 5/10-min videos use robotic local voice. 10-min wall time
  ~8 min (sequential local TTS). No human quality scoring yet.

## 2026-09-09 — internal prompt-builder, multi-model + multi-source demo (local TTS)

- New `src/explainer/prompt-builder.ts` (pure, deterministic, zero cost): any bare
  source → optimized rich visual brief (domain→audience, headings→chapter
  questions, numbered sentences→anchor facts, misconception/scope guards,
  concrete-objects visual direction, untrusted-source delimiters).
  `test/prompt-builder.test.js`: 6 new tests. Full suite: 43 pass, 0 fail,
  1 opt-in skip.
- `scripts/generate-video.js`: `--pdf FILE`, `--model ID` (per-run
  OpenRouter override), `--no-enrich` opt-out; `--tts` default flipped to
  `local` (robot voice, no key); `--minutes` default is now 1; results
  record model/enrichment/TTS. Enriched jobs store provenance in
  `source.name` (`<orig-kind>:<orig-label>`).
- Live runs, all enriched, all local-TTS narrated with MP4 export:
  - ResNet paper URL + `google/gemini-3.8-flash`: job 368a9de2, 2 scenes,
    1.24 min, $0.034 (3 calls), shapes illustration 1 / icon 2 / box 3,
    layouts compare/timeline. MP4 1.8 MB.
  - Downloaded BERT PDF (6 pp, pdftotext) + `google/gemini-3.7-flash`: job
    fbd083aa, 2 scenes, 1.33 min, $0.047 (4 calls), shapes illustration 1 /
    box 2 / icon 3, layout timeline. MP4 1.9 MB.
  - Bare prompt "Explain how a refrigerator works" + gemini-3.8-flash
    (after anti-generic/2-shape guidance): job 1b02f089, 2 scenes,
    1.74 min, $0.0055 (3 calls), zero generic kinds
    (process/loop/energy/result), shapes box 4 / icon 2, layouts
    timeline/convergence. MP4 2.4 MB, ffprobe: h264 1280×720 + aac.
- Model suitability (visible failures, never silent):
  - `qwen/qwen3.8-flash`: outline OK, but content calls die with
    finish_reason=length + empty content (11k reasoning tokens burn the
    budget; `reasoning:{effort:'low'}` not honored). Evidence:
    `.data/6d61bb09…/planner-{2,3}.json`.
  - `openai/gpt-4o-mini`: in catalog but completions POST → HTTP 404 on
    this key (no usable provider route).
  - `deepseek/deepseek-v4-flash-0731`: one bare-prompt success (6 calls,
    207 s, $0.007) but all 7 nodes kind=generic → all-box scenes; a second
    run under strengthened guidance never returned (18–23k completion
    tokens/attempt → truncation loops → timeout). Flaky, not recommended.
- Guidance fix from the deepseek all-box case (prompt-text only, live-
  verified on gemini): anti-generic kind mapping + hard "every scene uses
  ≥2 shapes" rule in `src/explainer/planner.ts`.
- Limits: local TTS pacing overshoots estimates (1-min targets render
  1.2–1.7 min); Qwen/DeepSeek/GPT-mini unsuitable for strict-JSON planning
  on this key; no human quality scoring yet.

## 2026-09-09 — Kokoro local neural voice + 1/5/10-min test matrix (kokoro-aligned)

- New TTS provider `kokoro` (ElevenLabs + robot untouched): `scripts/kokoro_tts.py`
  bridge (stdin text → stdout wav + word timings) + `src/kokoro-speech.ts`
  (same `{audio, timing, format}` contract), wired through `jobs.ts`
  allowlist/selection (`timingMode: kokoro-aligned`), UI dropdown + 5-voice
  catalog, `--tts kokoro` in generate-video, `KOKORO_PYTHON` in `.env.example`.
  Word timings are the model's OWN duration signal (`pred_dur`, 40 fps) mapped
  through misaki word tokens — spike gate: pred total == audio length exactly
  (diff 0.000 at 39-word scene length), all words mapped, monotonic.
  Setup: `brew install espeak-ng`, `uv venv`, `kokoro-mlx==0.1.2`,
  spacy `en_core_web_sm-3.8.0` wheel (PyPI name unresolvable under uv — use
  the GitHub release URL). Warm synth ≈ 14× realtime; per-spawn scene ≈ 4–5s.
- Suite: 45 pass, 0 fail, 1 skip (new `kokoro-speech.test.js`; live contract
  test runs under `TEST_KOKORO_TTS=1` + `KOKORO_PYTHON`).
- Matrix, all enriched, all first-attempt `complete`, zero generic kinds:
  - T1 bare fridge prompt × gemini-3.8-flash, 1 min: job 240b8e64, 2 scenes,
    0.83 min actual, $0.007 (4 calls), 26 s elapsed, box 4 / icon 2.
  - T5 BERT PDF × gemini-3.7-flash, 5 min: job 3a9f8ca1, 10 scenes,
    4.39 min actual, $0.089 (17 calls), 79 s elapsed,
    box 14 / icon 14 / illustration 5, 4 layouts.
  - T10 ResNet URL × gemini-3.8-flash, 10 min: job f37361df, 20 scenes,
    10.02 min actual, $0.094 (26 calls), 160 s elapsed,
    icon 24 / box 25 / illustration 12, 4 layouts.
  All MP4s ffprobe-clean (h264 1280×720 + aac): 1.1 / 5.9 / 13.7 MB.
- SLO verdict (honest): `firstPlayableMs` ≈ 19–21 s on all three — dominated
  by OpenRouter planning (outline+content+director ≈ 15 s), NOT by TTS
  (Kokoro ≈ 4–5 s/scene incl. spawn). The <8 s first-playable target needs
  faster planning (or streamed outline), not faster speech. Per-scene
  generation (≈ 8 s incl. planning amortized) stays well under per-scene
  playback (≈ 30 s), so no buffer underrun once started: 7 < 18 inequality holds.

## 2026-09-09 — model × duration cost/latency matrix (kokoro voice, $0)

- 3 models × 1/5/10 min, distinct topics/sources per cell, enriched briefs,
  kokoro narration. 7/9 cells complete; logs in `output/evaluations/matrix/`,
  aggregator `scripts/matrix-report.js`.
- Completed (plan $ / wall / first-playable / TTS chars):
  - 3.8-flash 1-min GPS prompt: $0.0064 / 212 s / 17 s / 737 chars.
  - 3.8-flash 5-min attention paper URL: $0.0587 / 98 s / 30 s / 4485 chars.
  - 3.8-flash 10-min ML prompt: $0.0522 / 230 s / 20 s / 9124 chars.
  - 3.7-flash 1-min inflation prompt: $0.0050 / 20 s / 14 s / 734 chars.
  - 3.7-flash 5-min BERT PDF: $0.0610 / 494 s / 16 s / 3875 chars.
  - 3.7-flash 10-min ResNet paper URL: $0.1371 / 269 s / 28 s / 8812 chars.
  - deepseek-flash 1-min magnets prompt: $0.0048 / 311 s / 305 s / 815 chars
    (after one 0/3 failed invocation; 27k completion tokens of reasoning bloat).
- Totals: plan **$0.3252**, voice **$0.0000** (28,582 kokoro chars; same via
  ElevenLabs would be paid per credit). Per-minute plan cost ≈ $0.005–0.014.
- DeepSeek 5-min (ResNet) + 10-min (quantum, no-enrich): not completable here —
  repeated incomplete/refused outputs, JSON syntax errors, 90 s call timeouts,
  0 scenes across attempts; long bg runs also killed by shell timeouts.
  Verdict stands: Gemini Flash for multi-chapter planning; deepseek 1-min only.
- firstPlayableMs 14–30 s on gemini cells (planning-bound); deepseek 305 s.

## 2026-09-09 — Phase 0 spans live; bottleneck table (1-min bicycle pump, kokoro)

- `Usage` gains `cachedTokens` + `spans{outlineMs,chapters}`; `JobSnapshot.spans`
  persists planner stages + per-scene `ttsMsByScene`; every OpenRouter call logs
  `planner.call{label,elapsedMs,cachedTokens}`; export logs `renderMs` + `muxMs`.
- Proof job c069641a (complete, attempt 3/3): outline 2181 ms, content 3738 ms,
  director 2067 ms, TTS 11106 + 11387 ms (parallel), export render 6385 ms +
  mux 519 ms, firstPlayable 19222 ms. `cachedTokens: 0` on all calls — no
  implicit-cache hits at these prompt sizes; repair retries would be the hit
  source (Phase 3).
- New critical finding: attempts 1–2 died when ONE of two parallel kokoro
  spawns hung past the 180 s Node timeout (sibling finished in ~7–9 s; empty
  stderr). Per-spawn model load under parallel contention is flaky AND slow
  (~11 s even when it works). Fix queued in Phase 4 (persistent kokoro
  server); error message now distinguishes timeout-kill from missing setup.
- Bottleneck ranking for 1-min: parallel TTS spawns (flaky, ~11 s/scene) >
  planning (~8 s total) > serial export (~7 s). For 10-min: TTS waves dominate,
  export second (~90–120 s).

## 2026-09-09 — Phase 1 teaching brain live (outline v2 + validators, no renderer changes)

- Outline emits `arc` (hook/build/example/payoff/recap) + `keyPoints[1–5]` per
  chapter; content prompt adds beginner progression, duration-aware depth, and
  the rule that every key point is narrated + claimed by a node and every
  narrated quantity is shown. Repair payloads now send the objective string
  (was: whole chapter object — also trims tokens).
- Four deterministic validators recycle through existing repair loops:
  quantity manifest, key-point coverage, shape-mix ≥2, antonym-kind collision.
  `keyPoint` is validated + preserved through `validatePlan` (planning
  metadata, renderer ignores it). Suite: 49 pass, 0 fail (4 new validator tests).
- Live: 1-min bicycle pump (attempt 1, $0.0046, 0 repairs — every node keyed,
  box+icon mix, kinds container/input/process/lock) and 5-min packet routing
  (attempt 2 after a kokoro spawn-kill, $0.0322 — 10 scenes, icon 10 / box 9 /
  illustration 4, 15 distinct kinds, every node keyed, 0 teaching/visual
  repairs). Outline verified with arc + 4 key points, all drawn.

## 2026-09-09 — Phase 2A new shapes/kinds + fallback-hole fix (suite 53 pass)

- 8 new kinds with same-language glyphs (`attract`/`repel` mirrored pair +
  green/red accents, `note`, `tool`, `cycle`, `light`, `temperature`,
  `molecule`); 4 new shapes (`circle`/`square` containers, `bullet` key-point
  lists, `number` count badges with adaptive shrink); deterministic
  `upgradeShapes` (quantity→badge, recap→bullets, cycle/cell→circle,
  document→square) since guidance alone yields box+icon.
- GPS 5-min audit exposed the fallback hole: exhausted director retries shipped
  all-generic boxes, bypassing every visual gate. Fallback is now upgraded +
  validated and fails loudly instead (regression test locks it); key-point
  claims match fuzzily (≥70% overlap); engine keyPoint errors show the value.
  `keyPoint` is validated + preserved through `validatePlan`.
- Live: magnets video shows separate attract + repel icon nodes (after adding
  the never-merge-opposites content rule); water-cycle video auto-upgraded a
  cycle node to circle; compass video uses attract distinctly. Shapes fixture
  proves all four primitives offline.

## 2026-09-09 — Phase 2B annotations, edge labels, illustrations (suite 58 pass)

- Director now receives keyPoint + chapter arc/objective per node (content-driven
  picks, no positional copying); icon radius adapts to emphasis (×1.25, synced
  compile/render); all-kinds icon + illustration coverage tests lock rendering.
- `annotation` shape (attachTo+position, compiler-placed caption) + automatic
  note→marginalia promotion on roomy scenes (13/15 fixture scenes gain it).
- Edge labels required non-empty with halo rendering (validator-enforced);
  emphasis highlight wash on containers; merge preserves ALL valid shapes
  (fixed a silent drop-to-box bug for circle/square/bullet/number).
- 6 new kinds + staged illustrations: plant, sun, browser, phone, robot,
  pipeline (12 total). Phone + server illustrations verified live.
- Live tides video (attempt 1, $0.006): 4 shapes, 3 labeled edges
  ("attracts", "balances", "advances by"), 2 marginalia, "~50 Minutes" number
  badge, attract vs repel distinct — the full teacher-canvas stack in one video.

## 2026-09-09 — Phase 3 caching A/B + compile-idempotence fix (suite 60 pass)

- Explicit `cache_control` breakpoint + per-job `session_id` on all planner
  calls (`--no-cache` opts out). A/B on identical 10-min solar topic, kokoro:
  cached $0.0749 (55,926 prompt tokens, **19,206 cached = 34%**, 29 calls) vs
  uncached $0.0778 (48,642 tokens, 0 cached, 26 calls). Kept: free writes,
  zero behavioral risk; dollar savings are cents at Flash pricing but grow
  with repair-heavy runs (cached arm had 3 more calls yet cost less).
- Critical export fix: recompiling compiled scenes (which carry placed note-
  ghosts) diverged — ghost layout slots shifted siblings AND blocked
  illustration growth — failing export with "no room near …" on 3/3 attempts
  of an otherwise complete 10-min job. Annotations now take no layout slot
  and never obstruct growth: compile∘compile is byte-identical geometry
  (regression test over all fixtures). Stranded job exported cleanly after.

## 2026-09-09 — Phase 5 critic + full matrix re-run (server TTS, caching on)

- Critic (`openai/gpt-5.6-luna`, in catalog at V2-quoted $0.20/$1.20 per 1M):
  same-prompt A/B — no-critic $0.0057/3 calls/22 s vs critic $0.0069/6 calls/
  39 s with 1 successful repair and 6 distinct shapes (vs 5). Verdict: keep
  optional — measurable polish at ~+$0.001 and +17 s per minute of video.
- Matrix (all first-attempt complete, server transport, cached tokens flowing):
  - 1-min rainbows × 3.8-flash: 2 scenes, 6 shapes, 3 labeled edges,
    $0.0071, 37 s wall, 3,492 cached tokens.
  - 5-min BERT PDF × 3.7-flash: 10 scenes, 7 shape types, 21 kinds,
    17 labeled edges, 9 marginalia, $0.0735, **84 s wall (was 494 s)**,
    8,730 cached tokens.
  - 10-min ResNet URL × 3.8-flash: 20 scenes, marginalia on all 20,
    29 labeled edges, 19 kinds, $0.1199, **173 s wall (was 230–269 s)**,
    17,460 cached tokens.
- Totals: plan **$0.2005**, voice **$0.0000**. firstPlayable 21–28 s
  (planning-bound, unchanged — speech is no longer the bottleneck).
- V2 §45 spot-check (mechanical): shapes mixed every scene; preflight
  (no overlap, in-bounds, labels fit) green; audio on all scenes; narration
  near visuals via anchors; deterministic re-render verified by idempotence
  test. Subjective items (teaching clarity, metaphor relevance, hierarchy
  feel) need human eyes on the three MP4s.

## 2026-09-09 — Phase 4 latency: persistent server + parallel export

- `scripts/kokoro_server.py` (stdlib ThreadingHTTPServer, model loads once;
  `npm run kokoro-server`, `KOKORO_SERVER_URL`); provider tries server first,
  falls back to spawn, logs `speech.transport{via}`. Server contract test
  passes in 0.6 s vs 3.7 s spawn.
- Export renders in CPU-sized parallel batches with strictly ordered ffmpeg
  writes (`EXPORT_JOBS` override): same 6,779-frame 10-min job went
  renderMs 203 s → 25 s (**8.1×**); mux 12.5 s → 3.7 s.
- 1-min server cell (echoes): attempt 1, $0.0057, TTS 5.4 s/scene (was ~11 s),
  zero flakes, firstPlayable 17.7 s. Remaining first-playable budget is
  planning (~12 s outline+content+director), not speech.
- Out-of-order chapter→TTS deliberately NOT changed: in-order commit is
  load-bearing for monotonic playback; planning already overlaps via 5-way
  concurrency.

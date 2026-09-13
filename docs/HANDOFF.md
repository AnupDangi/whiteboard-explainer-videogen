# Current handoff — 2026-09-13, Wave 2 critic-repair wiring

Wave 2 done: `src/semantic/contact-sheet.ts` (event-aligned sheet frames via the
pure renderer) and `src/semantic/critic-repair.ts` (lints-first $0 preflight,
pairwise A/B+ B/A judgment, ONE bounded director repair using `criticRepairPrompt`,
identity/narration protection, re-lint after repair). `generateV2` takes an
optional `judge`; critic activates with `V2_CRITIC=on` + judge supplied, adding
`criticMs`/`criticRepairs` to StageMetrics. Suite: `npm test` 191/191 pass, build
clean, `git diff --check` clean. No live calibration run executed in this change.
Next: Wave 3 — synchronous progressive V2 jobs (`POST /api/semantic/jobs`, SSE
scene push with offset resume, polling fallback, prebuffering client, language →
speech, firstPlayable = first scene ready); then Wave 4 (state variants/morph,
ELK graph layout, general compiler repair, asset growth), Wave 5 (model A/B
within $5: DeepSeek-V4-Flash-Vision vs Gemini on critic calibration), Wave 6
(Phase 15 multi-domain benchmark), Wave 7 (performance + migration gate).

---

# Current handoff — 2026-09-13, Wave 1 prompt builder

Wave 1 done: `src/semantic/planning/prompt-builder.ts` now generates the teaching
and director prompts (behavior-compatible refactor of the inline literals) with
teacher-voice rules (no "Step 1" meta-numbering, natural mechanism prose), math
pedagogy rules for equation/matrix scenes, visual richness rules and a shared
`chalk-ink-v2` style token. `criticRepairPrompt()` is pre-built for Wave 2
critic-repair wiring. `lintTeacherVoice` in `planning/validate.ts` deterministically
rejects slide-bullet narration before TTS. Drift-guard tests pin prompt vocabulary
to `types.ts`. Validation: `npm test` 183/183 pass, `npm run build` clean,
`git diff --check` clean. Next: Wave 2 — wire the calibrated vision judge into the
bounded one-repair path using `criticRepairPrompt` and contact sheets; then Wave 3
(synchronous progressive V2 jobs with SSE scene push), Wave 4 (state variants/morph,
ELK graph layout, general compiler repair, asset growth), Wave 5 (model A/B within
$5: DeepSeek-V4-Flash-Vision vs Gemini on critic calibration), Wave 6 (Phase 15
multi-domain benchmark), Wave 7 (performance + migration gate).

---

# Current handoff — 2026-09-12, V4 document implementation / semantic V2

Implementation continues on `v4-optimization`; V1 remains default. Read
[V4_IMPLEMENTATION.md](V4_IMPLEMENTATION.md) for the task matrix and constraints.
No commits or pushes made. The overall V4 plan is not complete.

Automatic plant run 09 passed all ten semantic checks and final-frame review: one
teaching call, two director calls, $0.03532815, 22.123 s scene ready. This is estimated
silent timing, not TTS latency. Failures 01–08 remain preserved. Replay runs are clearly
labeled as recorded-output replays, never new provider successes.

The registry now contains 39 original assets. All ordered Phase 14 archetypes are supported:
structural, convergence, transformation, comparison, cross-section, spatial-process, numbered
steps, flow, cycle, equation_walkthrough, matrix_operation, hierarchy, timeline and trajectory
(use their exact schema enum names in code). Eleven manual fixtures cover DNA, tectonics, MLA,
caching rules, HTTP request flow, water cycle, an equation walkthrough, matrix multiplication,
the memory hierarchy, a Roman timeline and gradient descent. Latest artifacts:
`output/semantic-archetypes-07/` (MP4s, event/fixed sheets, final PNGs, JSON and hashes).
Frame review corrected K/V semantics, mantle placement/label overlap, cycle port crossings,
and a normalized SVG path-length rasterization issue; added a deterministic equation primitive
renderer, `top`/`bottom` anchors and tree/rail/trail geometry. Manual fixtures do not establish
live multi-domain planning reliability or teaching efficacy.

Phase 12 critic is implemented and calibrated: `src/semantic/vision-judge.ts` + `src/semantic/calibration.ts`
plus `npm run calibrate:semantic:critic`. Live run 2 passed all nine known corruptions in both orders
(accuracy 1.0, 0 order flips, 18 calls / $0.0366, `output/semantic-critic-calibration-02/`); run 1
failed on `delay_reveal` and `reverse_relation` and is retained. The judge is not yet wired as an
automatic repair trigger.

Kokoro was removed from this repo on 2026-09-12 (files, npm scripts, live worker,
`.kokoro-venv`). Local narration now goes through a separate `voice-engine` project
at `voice-engine` (Supertonic 3 default, Piper fallback,
Nepali always Piper) via the async `src/shared/voice-engine-client.ts` / `src/semantic/speech.ts`
boundary. Engine timings are explicitly estimated. ElevenLabs was removed too
(2026-09-12), so narration is local-only: Supertonic 3 or Piper.

Validation: `npm test` passed 180 total / 180 pass / 0 fail / 0 skip, 76.461 s
(Kokoro/pool and ElevenLabs provider tests removed with those features).
This includes all V2 tests and the existing HTTP/provider regressions. Loopback access
is required for HTTP tests. `npm run build` and `git diff --check` also pass.

Next bounded task: wire the calibrated judge into a bounded critic-repair path; then the V2
speech adapter and progressive job lifecycle, followed by the full multi-domain benchmark.
Remaining: actual V2 speech adapter, progressive V2 job lifecycle/UI, full multi-domain
benchmark, measured live performance, blind human preference and migration gate.
Do not silently map unsupported operations to generic boxes or invent provider success.

Preview: `PORT=3014 VISUAL_PIPELINE=semantic npm start`; `/semantic.html` also works under explainer.
The current viewer is manual scene playback; it does not expose automatic generation.

---

# Current handoff — 2026-09-11, TTS reliability + planner boundary + gate consolidation (Phase 1-3)

**Suite:** `npm test` → **153 tests, 151 pass, 0 fail, 2 skip**.

**Run the server on the current build** (a long-lived Node server does NOT pick up rebuilt
`dist/`): after `npm run build`, `kill <pid>; nohup node --env-file-if-exists=.env
dist/src/server.js > .data/server.out 2>&1 & echo $! > .data/server.pid`. A stale server was the
cause of a reported 0/2 failure — the same prompt completes 2/2 on the current build.

**The 10-min / 20-scene path completes** (job `6308827e`, DeepSeek-V3 PDF): complete, 20/20, MP4 ✓.
A quality-gate exhaustion can no longer return 0 scenes: `planContent` commits the most recent
structurally-valid candidate with `planner.gates-deferred` logged (hard structural failures still
throw).

**What fixed completion**
- TTS: stable + bounded Kokoro pool (Phase 1). 17 GB Metal leak → `set_cache_limit(1024 MB)`.
- Outline: bounded repair loop + deterministic heals (Phase 2).
- Gates: `healSchemaFields()` normalizes `visualIntent`/`conceptId`/`evidenceIds` **before**
  `validatePlan` (they used to throw first and cost a 20-50 s repair each — fired 4× in the final
  run); shape diversity demoted to a **soft diagnostic** on the director-exhausted fallback
  (harness §36). `8d27af04`, `1283a4d2`, `9e5c560f`, `09ddb161` are all explained and closed.

**Local operations**
- `npm run kokoro-pool start 2` / `stop` / `status` — bounded, self-restarting workers.
  `KOKORO_SERVER_URLS` tells the job runner which workers to use. `/health` shows
  `cache_mb`/`peak_mb`/`requests_served`. `npm run bench:tts` replays saved narration at $0.

**Remaining (value order)**
1. **First-playable latency** — 10-min firstPlayable 64 s, 5-min 66 s vs harness <8 s target. The
   ≤2-min fast path (merge outline into content) + wider auto-director coverage (1/10 chapters still
   fell back to all-box) is the top lever. This is now the only real gap to Lamina.
2. **Repair rate** — 11 repairs / 10 chapters at ~20-50 s each. Continue gate consolidation:
   key-point, quantity and grounding gates still repair rather than heal.
3. Human playback review of `output/videos/gate-phase3b/arxiv-org-pdf-2412-19437-10min.mp4`.
4. Pool N≥3 degrades on this 24 GB box; default 2.

Full evidence and limitations: `docs/RESULTS.md` (Phase 3 entry, 2026-09-11).

---

# Current handoff — 2026-09-11, TTS reliability + planner boundary (Phase 1+2)

**Suite:** `npm test` → **150 tests, 148 pass, 0 fail, 2 skip** (up from 133/131).

**Run local Kokoro as a bounded pool, not a single leaking server:**
`npm run kokoro-pool start 2` (start/stop/status; memory-gated; workers self-restart).
`KOKORO_SERVER_URLS` (csv, default one URL) tells the job runner which workers to use.
`npm run bench:tts -- --servers http://127.0.0.1:8765,http://127.0.0.1:8766 --label pool-2`
replays saved narrations at zero API cost; `/health` reports `cache_mb`/`peak_mb`/`requests_served`.

**Root cause fixed (was mis-diagnosed three times):** the multi-chapter "provider timeout" was
**local Kokoro memory exhaustion**, not OpenRouter. A long-lived server held 17 GB of dirty Metal
buffers for an 82 M model (`mx.clear_cache` never called), the host went to 23.5 GB swap / 81 MB
free, and a 20-scene fan-out tripped a fixed 120 s deadline. Fixed by `mx.set_cache_limit(1024 MB)`
(cache now bounded at ~1 GB, measured 16 963 → 1 024 MB) + a bounded priority pool + per-scene
fail-soft to explicitly-estimated silent timing. No robot voice anywhere.

**Also fixed:** outline is now a bounded repair loop with deterministic heals (was a single call
that failed the whole job — three real saved failures now heal with 0 extra calls, including the
live `"+ 6O2"` entity-only key point); `finish_reason==='length'` retries at ×1.5 budget with
reasoning cut (was thrown as "incomplete or refused"); `require_parameters` is actually sent now
(the router had made the old guard always-false); outline budget 2250 → 3000.

**Measured today:** 1-min prompt **complete** $0.0017; 5-min prompt **complete** 10/10 scenes
$0.0043; 10-min DeepSeek-V3 PDF **partial 8/20** (was 0 scenes) $0.0163, MP4 exported, fallback 0.
TTS: 0 timeouts, 0 `unknown` errorKind.

**Remaining (value order):**
1. **Phase 3 gate consolidation** — the 10-min path still stops at 8/20 with `Invalid conceptId`
   after 12 repairs. Split the ~12 `planContent` validators into hard-correctness (reject/retry)
   vs quality-advisory (deterministic heal). This is the top blocker to 20/20.
2. **First-playable** — 5-min run firstPlayable 66 s vs harness <8 s target; needs the ≤2-min fast
   path (merge outline into content) + auto-director coverage.
3. **Human playback review** of the exported MP4s (`output/videos/gate-phase2/`) — last
   unautomated quality gate.
4. Multi-chapter outline/allocation cost: outline ~10 s and content sum ~40 s/chapter; hedged
   content (2 concurrent, first valid) would bound the 20-50 s variance.

Full evidence and limitations: `docs/RESULTS.md` (2026-09-11 Phase 1+2 entry).

---

# Current handoff — 2026-09-11, at Lamina-parity: 43-53s, $0.005, director-free

**Server**: rebuild + `node --env-file-if-exists=.env dist/src/server.js` at
`http://127.0.0.1:3000`. UI source intake (Prompt / Source text / **Public HTTPS link** /
**PDF document**) is visible by default; verified in-browser, 0 console errors.

**All events + per-call cost/time land in `app.log`** (gitignored, `APP_LOG_PATH`, 20 MB
rotation) plus per-job `log.jsonl`; `job.summary` has wall/first-playable/timeline/cost/
calls/tokens/spans. `npm run router:report` aggregates the ledger per task+model.

**Measured today (auto-directed, no director call):** URL 1-min 43.1/44.9/53.6s at
$0.0052–0.0054; PDF via API 44.8s at $0.0078 (4 figures + bigger map); PDF via
generate-video 43.4s, export ✓. Static intervals 2600/2600ms on the URL runs (limit 3500).

**Completed this stretch:** auto-director reliability (3/3 runs director-free; broader
kind hints + tolerance; engine-synthesized nodes excluded), per-item bullet reveal,
model router (`src/shared/model-router.ts`, `MODEL_ROUTER` JSON > per-task env > base) +
`npm run router:report`, `app.log` durable logging + `job.summary`, UI source-intake fix
(default AI planner + `/src/templates.js` whitelist + CSP inline-style), export-breaking
shape bug fixed (`deCollideKinds` clears icon shape on demotion; `normalizeShapes` safety
net). Suite 134 tests, 132 pass, 0 fail, 2 skip.

**Remaining (value order):**
1. **Outline cost** — ledger: outline gemini = **87% of run cost**, avg 5.0s; content qwen
   = 37% repair rate, avg 25.3s. Experiment: route outline to a cheap model via
   `MODEL_ROUTER`/`OPENROUTER_OUTLINE_MODEL` and compare cost/quality with `router:report`
   (a shell env override through `npm run` did NOT take effect in one test — set it in
   `.env` or verify the router path).
2. **Hedged content** (2 concurrent attempts, first valid wins) — bounds the 25s+repair
   variance; needs test request-count updates.
3. **Fast path ≤2 min** (merge outline into content) — removes ~5s and most of the cost.
4. Human playback review of the MP4s (last unautomated quality gate).

---

Server runs at `http://127.0.0.1:3000` (rebuild + `node --env-file-if-exists=.env
dist/src/server.js`). UI now defaults to **AI planner** so the Source dropdown (Prompt /
Source text / Public HTTPS link / PDF document) is visible; verified in-browser with 0
console errors (server whitelist was missing `/src/templates.js`).

All events append to **`app.log`** (gitignored, `APP_LOG_PATH`, 20 MB rotation) plus the
per-job `log.jsonl`. `job.summary` records wall/first-playable/timeline/scene-count/cost/
calls/tokens/spans for every completion and failure.

**Measured today (server URL runs, `app.log`):** best **55.7s** wall / $0.0075 / 3 calls
(outline+content+director, content first-try); worst 84s with one content repair. Auto-
director fires intermittently (skips the ~20s director) depending on content labels.
Static intervals 2600–5950ms (under/around the 3500 limit). Model tiers are env-routed:
outline gemini-3.8-flash (**~82% of cost**), content/director qwen3.7-flash (slow, cheap).

**Remaining tasks (value order):**
1. **Auto-director reliability** — make it fire on every composable chapter (biggest
   latency lever; would take wall to ~35s).
2. **Fast path ≤2 min** — merge outline into content; removes ~5s and ~$0.007/cost.
3. **Hedged content** — 2 concurrent attempts, first valid wins (bounds the 20-30s repair
   variance).
4. **Model router** — move outline to a cheap model; per-task cost/success from app.log.
5. Per-item bullet reveal; human playback review.

Full latency/cost/architecture analysis: `docs/PERFORMANCE_ANALYSIS.md`.

---

Top quality debt root-caused and fixed: beats with no visual caused 8.3s/7.2s static
tails; `fillBeats()` now synthesizes a node from each uncovered beat's own narration.
Both live paths on the 53-page DeepSeek-V3 report now complete with **staticInterval
2600/2600ms (under 3500)**: PDF 1:28 wall / $0.0094 / first attempt; arXiv URL 1:15 /
$0.0095. New deterministic heals this pass: `healDanglingEdges`, `fillBeats`,
`keypoint-healed`, whole-source `grounding-autofix`, `conceptId` heal. Suite 128 tests,
126 pass, 0 fail, 2 skip. Full table in RESULTS.md (2026-09-11 RCA pass 2).

**Remaining tasks (value order):**
1. **Eval/router** — cost/success aggregation from the existing planner.call ledger, judge
   live, Gemini-vs-Qwen A/B (50 content + 50 director calls) before any model flip.
2. **Director latency** — 18-21s + occasional 20s repair is now the slowest stage; extend
   auto-director to handle note/directive labels (2 of 5 nodes blocked it this run).
3. **Machine-readable canvas contract** (`canvas-contract.ts`) — prompts/skills derive
   from one spec; tests prevent drift.
4. Optional: 5-min live run (multi-chapter concurrency); adaptive provider concurrency.

---

---

# Critical-bug pass — 2026-09-11 (post-Lamina-parity review)

**Fixed (committed):**
- **TTS no longer kills a planned job.** `scripts/kokoro_tts.py` word-timing alignment
  called `fail()` on unmatchable words (`O(1).`, `RuBisCO`), killing 2 fully-synthesized
  runs (165-170s, ~$0.007 each). The mapper is now wrapped: on mismatch it falls back to
  proportional word timings and keeps the audio.
- **Text no longer splits mid-word.** `wrapText` breaks at `/` and `_` (was
  `recurrence/conv|olution`, `parameter|s`).
- **Removed domain hardcoding**: the biology keyword regex in `src/explainer/auto-director.ts`.
- **Removed dead code**: `generateOpenRouterPlan` (zero callers), legacy Anthropic
  `generatePlan` (+ tests), stale `validatePlan` import.

**Measured finding (important):** the 53% content repair rate is driven by the **gate
stack**, not only the model — content on gemini-3.8-flash cost $0.014 and still needed a
repair, vs qwen $0.005. Do not "fix" reliability by buying a bigger model; reduce/repair
the gates.

**Remaining known issues (next session, in order):**
1. **Gate consolidation** — 12 validators in `planContent` are reject-and-retry loops.
   Keep correctness (anchors, edges, quantities, first-visual); make quality signals
   (pacing, key-point completeness, beat coverage) advisory with deterministic heals.
2. **Kind selection should be the model's job** — `src/explainer/auto-director.ts` guesses kinds
   from ~37 hardcoded keyword regexes. Move `kind`/`shape` into the content schema (the
   model emits them from the kind list already in the prompt); keep the compiler
   deterministic for layout/geometry only. This removes the regex table entirely.
3. **Skills/prompt drift** — `skills/*.md` never mention `evidenceIds`, `beats`,
   `sourceSections`, or the 28-char key-point rule. One machine-readable canvas contract
   should generate both the prompts and the skills.
4. **Multi-chapter pacing** — 10-min runs still show static intervals up to 7.5s and
   timeout under concurrency.


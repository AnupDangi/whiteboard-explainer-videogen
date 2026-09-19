# Current handoff — 2026-09-19, loopback engine: kokoro removed, local voice-engine + budgets

**Suite:** `npm test` → **149 tests, 149 pass, 0 fail**.

**Kokoro is gone.** Deleted `src/kokoro-speech.ts`, `src/tts-pool.ts`,
`scripts/kokoro_{server,tts}.py`, `scripts/kokoro_pool.sh`, `scripts/setup-kokoro.sh`,
`scripts/bench-tts.ts`, `test/kokoro-speech.test.js`, `test/tts-pool.test.js`,
`.kokoro-venv/` (979 MB), the package scripts, the UI voice controls, the env keys and
the docs. No `kokoro` reference remains in code (grep-verified).

**Replacement — the bundled local voice-engine** (`voice-engine/`, ported from
`v4-optimization`): Supertonic by default with Piper fallback, **50+ languages**
(Piper is always used for Nepali). `src/voice-engine-client.ts` bridges it as a separate
process (`voice-engine/dist/cli.js`), one spawn per scene; full `src/language.ts`
(Unicode word/sentence segmentation via `Intl.Segmenter`). CLI: `--tts voice-engine`
(default) or `--tts piper|supertonic`, `--language <code>`. Setup once:
`npm run voice-engine:setup`. Word timings are **estimated** uniformly over the
synthesized audio duration (`kind:'engine'`, `timingSource:'estimated'`) and clamped to
`durationMs` so the export validator's `endMs > durationMs` float check cannot trip.
New tests: `test/language.test.js`, `test/voice-engine.test.js`.

**Budgets are per-duration and hard** (`src/budgets.ts::DURATION_BUDGET_USD`):
1 min $0.5 · 5 min $0.7 · 10 min $1 · 30 min $1.2 · **60 min $2**. `scripts/generate-video.ts`
uses the table (`--budget` overrides); `src/jobs.ts` accepts up to the table max.
Duration `60` added. Because Google rejects outline schemas asking for **>18 chapters**,
targets >18 chapters auto-fall back off Google to
`OPENROUTER_OUTLINE_FALLBACK` (default `deepseek/deepseek-v4-flash`) with
`planner.outline-model-fallback` logged.

**Measured 2026-09-19 (V1, local voice-engine, real audio):** 1-min complete ~45 s
wall / 67.6 s timeline / $0.019 / 2 scenes; 10-min complete 20/20 (~196–233 s wall,
~657–686 s timeline, ~$0.11); 30-min partial 52–55/60 (~626–759 s wall, ~29.8 min
timeline, $0.30–0.41). Languages smoke-tested: ne/zh→Piper; hi/es/fr/ar→Supertonic.

**Output curated** to `output/keep/` (1/10/30-min AI + biology + civics samples and
their `.scenes/`). Docs consolidated: historical docs removed; target plans copied
(`PLAN_TO_IMPLEMENT.md`, `Architecture_plan.md`, `docs/ICON_SYSTEM_PLAN.md`).
Current task tracking: root `tasks.md`.

**Known problems (carry forward):** end-to-end planning is non-deterministic
(temperature 0.3, no seed — four identical 1-min runs gave four distinct outputs);
Google >18-chapter outline limit; 30-min overshoots the hard 30-min timeline cap
(partial); a single silent scene blocks export; local TTS is not byte-reproducible;
first-playable ~35–45 s vs the `<8 s` target. Next bounded task: 60-min V1 run +
multi-domain 5-min set, then adopt the target architecture (`PLAN_TO_IMPLEMENT.md`).

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
model router (`src/model-router.ts`, `MODEL_ROUTER` JSON > per-task env > base) +
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
- **Removed domain hardcoding**: the biology keyword regex in `src/auto-director.ts`.
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
2. **Kind selection should be the model's job** — `src/auto-director.ts` guesses kinds
   from ~37 hardcoded keyword regexes. Move `kind`/`shape` into the content schema (the
   model emits them from the kind list already in the prompt); keep the compiler
   deterministic for layout/geometry only. This removes the regex table entirely.
3. **Skills/prompt drift** — `skills/*.md` never mention `evidenceIds`, `beats`,
   `sourceSections`, or the 28-char key-point rule. One machine-readable canvas contract
   should generate both the prompts and the skills.
4. **Multi-chapter pacing** — 10-min runs still show static intervals up to 7.5s and
   timeout under concurrency.


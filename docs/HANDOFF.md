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


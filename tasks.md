# Whiteboard Teacher Program — phased task tracker

> Source of truth for all phases below. Update discipline: tick `[ ]`→`[x]`
> only when that phase's acceptance criteria are verified by a passing run,
> never on intent. Each phase logs: date, job IDs, cost, wall time, result.
> References: `lamina_video_replication_target_v2.md` = V2.

## Standing decisions (locked 2026-09-09)
- [x] Consistency enforced by **deterministic validators**, not LLM reviewers (V2 §32)
- [x] **DeepSeek dropped** from matrix (Gemini-only multi-chapter; DeepSeek 1-min spot checks)
- [x] No new LLM micro-agents (V2 §6/§30); researcher stays deterministic (V2 §7)
- [x] Voices: ElevenLabs + robot + Kokoro all kept; demo default `local`

## Phase 0 — Time instrumentation (FIRST)
- [x] Per-stage spans in job events: `outlineMs`, per-chapter `contentMs`/`directorMs`, per-scene `ttsMs`, `exportRenderMs`/`exportMuxMs`
- [x] Log OpenRouter `cached_tokens` (cached vs fresh) per call
- [x] Re-run one 1-min job; publish true bottleneck table
- **Acceptance:** timing table names the bottleneck without log archaeology

## Phase 1 — Teaching brain (MOST IMPORTANT, no renderer changes)
- [x] Outline v2: `arc` roles (hook→build→example→payoff→recap) + `keyPoints[3–5]` per chapter (V2 §4, §8)
- [x] Beginner progression prompt: what-it-is → how-it-moves → why-it-matters; chapters never repeat (V2 §2)
- [x] Duration-aware depth: density budget scales with target minutes + recap scene at 5/10-min (V2 §4, §26)
- [x] Semantic storyboard lite: `keyPoint` node field links visual to teaching intent, preserved through validatePlan (V2 §8)
- [x] Deterministic validators in repair loops: quantity manifest, shape-mix ≥2, key-point coverage, antonym-kind collision reject (V2 §32)
- **Acceptance:** 1-min + 5-min videos where key points appear on canvas, counts match narration, zero all-box scenes

## Phase 2A — Vocabulary + new shapes (DONE)
- [x] New kinds + glyphs (same stroke language, V2 §11): `attract`/`repel`, `note`, `tool`, `cycle`, `light`, `temperature`, `molecule` (V2 §10 gaps)
- [x] New shapes: `circle`/`square` containers, `bullet` key-point lists, `number` count badges (+ deterministic upgrades when guidance alone yields box+icon)
- [x] Unit + render tests; `vocabulary.ts`/`schema.ts`/`engine.ts` stay in sync
- [x] Fallback hole closed: exhausted director retries fail loudly instead of shipping all-generic boxes (regression test locks it)
- [x] Fuzzy key-point claim matching (≥70% overlap) so rewording never burns repairs
- **Acceptance:** magnets video shows distinct attract vs repel icons; suite 53 pass

## Phase 2B — Annotations, edge labels, highlight, extra illustrations (DONE)
- [x] Director sees keyPoint + arc + objective per node/scene; content-driven selection guidance (no hardcoded icon defaults, no positional copying)
- [x] Adaptive icon sizing (emphasis ×1.25, compile/render synced); all-kinds icon/illustration coverage tests
- [x] `annotation` shape: relative attachTo/position, compiler-placed caption; scene notes auto-promote to marginalia (roomy scenes only)
- [x] Edge labels (required non-empty, midpoint halo, validator-enforced); emphasis highlight wash on containers
- [x] 6 new kinds + illustrations: plant, sun, browser, phone, robot, pipeline; merge preserves all valid shapes (fixed silent drop to box)
- [x] Unit + render tests for each
- **Acceptance:** tides video — 4 shapes, 3 labeled edges, 2 marginalia, number badge, attract+repel distinct, attempt 1; suite 58 pass

## Phase 3 — Prompt caching + cost (DONE)
- [x] Freeze system prompts; stable-prefix ordering; explicit `cache_control` breakpoint after system+source; `session_id` per job
- [x] A/B one 10-min run cached vs uncached; keep iff savings beat write premium (Gemini implicit 0.25× reads, free writes)
- [x] Compile-idempotence fix (annotation slots excluded from layout count + illustration growth) + regression test — found via 3× export failures
- **Acceptance:** cached arm 19,206/55,926 tokens cached (34%), $0.0749 vs $0.0778 uncached; kept (free, zero risk); suite 60 pass

## Phase 4 — Latency (DONE)
- [x] Persistent Kokoro server (kills per-spawn warmup + flakes); server-first with spawn fallback
- [x] Parallel export frames (ordered writes); out-of-order chapter→TTS analyzed-not-changed (in-order commit is load-bearing for playback monotonicity)
- [x] Re-ran one matrix cell; proved wall-time delta
- **Acceptance:** export 203s→25s (8.1×); server TTS 11s→5.4s/scene, zero flakes; suite green

## Phase 5 — Critic + matrix re-run (DONE)
- [x] Verify critic model (`openai/gpt-5.6-luna`) on key; enable `--visual-critic` on one cell; score delta per V2 §44/§31 (one bounded repair only)
- [x] Re-run 1/5/10-min Gemini matrix; update cost/latency table + `matrix-results.json`
- [x] Human spot-check vs Replication Quality Checklist (V2 §45)
- **Acceptance:** critic +$0.001/1 repair; matrix 32 scenes green ($0.2005/$0); checklist mechanically verified, subjective items flagged for human

## Phase 6 — Teacher persona wiring fix (DONE)
> Source: `docs/OPTIMIZATION_PLAN.md` Phase 6. Triggered by user report: "doesn't feel like a
> real teacher," scene inconsistencies, overlap, visuals not polished. Reprioritized against
> the plan's own impact ranking to match what the user actually called out.
- [x] `teacherTone` was added to the outline schema (uncommitted, prior session) but was a
      bug: validated and stored, never read again. Now wired into the per-chapter
      `contentSystem` prompt (explicit mood/approach instruction) and the JSON payload.
- **Acceptance:** two chapters with different arcs (e.g. hook vs recap) produce narration a
  human reviewer can tell apart in tone without seeing the arc label; suite stays green.
  Verified: prompt wiring in place, suite green. Human tone comparison needs a live model
  run (costs $) — left for the next real generation, not a blocker for this commit.

## Phase 8 — Scene density & overlap prevention (DONE)
- [x] Found and fixed a real bug in the uncommitted `textExpand`: it grew box width from the
      *unwrapped* label length, ignoring that `wrapText` had already wrapped it to fit the
      column — forced boxes wider than their grid slot, defeating the whole mechanism.
- [x] Found and fixed a second bug: growing height could cross the `h<70` font-size
      threshold used later in rendering, so the grown height and the eventually-rendered
      font size disagreed and could still overflow. Fixed with a small convergence loop.
- [x] Found and fixed a third bug: even after height growth, very tight slots (radial
      satellite rows) could still not fit a long label — generalized the number-badge's
      shrink-to-fit fallback (font size down to the 14px floor) to every label-bearing shape.
- [x] Replaced the original iterative pairwise push-apart (converged only asymptotically,
      could cascade — resolving one pair re-broke an adjacent one, leaving sub-pixel
      residual overlap) with a provably-correct one-pass sweep: sort nodes top-to-bottom,
      push each down only as far as an already-placed, X-range-overlapping node requires.
- **Acceptance:** new engine test (`Phase 8: long labels on a crowded 6-node scene...`) and a
  broader ad-hoc stress sweep (all 7 layouts × counts 2–6 × long labels) both show zero
  overlaps and zero out-of-bounds nodes; full suite green (62/62, 2 skipped needing live TTS).

## Phase 7 — Semantic Storyboard v2 (DONE — mechanism verified, live model run still pending)
- [x] Added `visualIntent` (short string, ≤80 chars) alongside `keyPoint` on every
      content-stage node: what the diagram should visually show for this node (e.g. "arrow
      from query to each key, comparison"). Shared semantic-event field per V2 §8 — same
      2-stage pipeline, no new agent call; narration and visual direction now trace to one
      written intent instead of the director re-guessing from the label alone.
- [x] `contentShape`/`contentSchema`/`types.ts` PlanNode: field added (optional on old
      fixtures — verified backward compatible — required in the LLM-facing JSON schema).
- [x] `directorPrompt` (and the critic's `repairFromCritique` payload) now pass `visualIntent`
      per node; `SELECTION_GUIDANCE` rewritten to say it is more authoritative than the label
      when choosing kind/shape/emphasis/layout.
- [x] `validatePlan` in `engine.ts`: validates (1-80 chars, non-empty) + preserves through the
      renderer whitelist (planning metadata, like keyPoint — never drawn directly).
- **Acceptance:** mechanism verified — new test confirms validation, preservation, and old
  no-visualIntent fixtures still pass; suite green (63/63, 2 skipped). **Not yet verified live**:
  whether a real chapter generation actually produces non-obvious shape choices traceable to
  visualIntent — needs one real (paid) generation run; flag for the next agent with API access.

## Phase 9 — Visual polish (DONE — full icon redesign still deferred, see note)
- [x] Whiteboard background texture: a faint dot-grid pattern (`<pattern id="board-grain">`,
      26px spacing, ~0.55 opacity over the base cream fill). First attempt used `<circle>` for
      the dot and broke an existing test asserting background decoration adds no extra
      `<circle>`/`<ellipse>` tags (a real, useful invariant) — switched to a rounded `<rect>`.
- [x] Emphasis highlight sweep: `renderHighlightRect`/`renderHighlightEllipse` draw two
      slightly offset, slightly rotated translucent shapes instead of one flat wash — reads as
      an imperfect hand-marker stroke. Wired into all three emphasis-wash call sites (box,
      circle, square).
- **Deferred, not done this pass:** per-icon redesign across all 32+ kinds in `icons.ts` for
  "more detail, consistent stroke weight" — large surface area, low marginal value vs. the
  overlap/coherence fixes above; a future agent can pick this up as its own bounded pass.
- **Acceptance:** re-rendered the real gradient-descent job's scenes — dot-grid visible but
  unobtrusive, doesn't interfere with any content; suite green (64/64, 2 skipped).

## Phase 10 — Pencil & transitions (DONE — verified)
- [x] Scene-start fade-in and pencil fade-out near a local event's end (`transitionFade`,
      `pencilFade` in `renderSVG`), landed and committed as part of the Phase 6+8 commit.
- [x] Verified pencil "jumping between regions" falls out of the existing first-active-
      node/edge selection (staggered `startMs` per node/edge, one `pencil` picked per frame
      as whichever single element has `0<progress<1`) — confirmed by code inspection, no
      change needed. Also verified the pencil now follows the true curved-connector tangent
      (Phase 11), not just straight lines/box perimeters.
- **Acceptance:** re-rendered real job frames (gradient-descent) show the pencil tracking the
  active stroke correctly; code path confirmed for region-jumping; suite green.

## Phase 11 — Connector routing (DONE — text measurement still deferred, see note)
- [x] **Live-verified bug**, fixed (found running a real gradient-descent generation, see
      `output/videos/How-gradient-descent-optimizes-a-model-s-weights-1min.mp4` and the job at
      `.data/ecb25d5a-d8de-42ce-a9f7-24a44ccfe5df/`): edge labels rendered at the raw midpoint
      of `(x1,y1)`-`(x2,y2)`, so on a short connector between two close nodes the label sat
      overlapping/clipped behind the destination shape. Re-rendered the same real job's scenes
      before/after: "determin[es]" and "reaches" went from clipped-inside-the-shape to clear
      of it (small residual edge-touch on very tight gaps, not a hard overlap — acceptable).
- [x] Curved (quadratic bezier) connector routing instead of straight lines: control point
      bows perpendicular to the straight connector, deterministically toward -y ("up") rather
      than a random wobble. Arc-length sampled for stroke-dasharray/dashoffset reveal (same
      technique already used for box/circle outlines elsewhere in the renderer). Pencil
      position and arrowhead angle both now follow the true bezier tangent, not the old
      straight-line approximation.
- **Deferred, not done this pass:** real glyph-accurate text measurement (opentype.js/canvas
  measureText) — the current heuristic is now used consistently by both layout and the new
  Phase 8 overlap prevention, so it's internally consistent even if not pixel-perfect; V2 marks
  this lower-impact than the items above.
- **Acceptance:** new engine test confirms the path uses a bezier (`Q` command, not `L`) and
  the label renders off the straight connector line; re-rendered real job frames confirm the
  live-verified clipping bug is fixed; suite green (64/64, 2 skipped).

## Phase 12 — Latency (DONE — TTS/director overlap; other sub-items not attempted)
> Re-scoped in: user explicitly asked to be faster in a follow-up message.
- [x] TTS/director overlap: narration is final once the content (Teaching Planner) stage
      validates — the director only adds visual metadata TTS never reads. `generateChapters`
      now fires `onContentReady(chapter, scenes)` right after content validates, before the
      director call starts. `jobs.ts` uses this (kokoro only — never elevenlabs, to avoid
      burning paid API calls on content a later regeneration might discard) to kick off TTS
      in the background while the director call runs, then reuses that promise in the normal
      per-scene TTS step IF its cached narration still matches the final scene's narration
      (regeneration-safe: mismatch/absence just falls back to a fresh call).
- **Not attempted this pass:** streamed outline (chapters already stream progressively via
  the existing async generator — this was already true before this session), faster fallback
  models for simple scenes, cross-topic geometry caching, combining outline+content into one
  call (explicitly against the codebase's own documented 2-stage separation rationale — see
  planner.ts comments — not attempted as it risks the independent-repair-loop benefit that
  separation exists for).
- **Acceptance:** live-verified — TTS (6.5s/scene) finished entirely inside the director
  call's 9.8s window and cost 0ms of additional wait once consumed; suite green (65/65,
  1 skipped when server isn't pre-warmed for that specific test invocation).

## Phase 13 — Kokoro-only TTS, remove robot voice (DONE — user-requested)
- [x] Removed `local` (Python `say`-based robot) TTS entirely: `src/local-speech.ts`,
      `scripts/robot_tts.py`, `test/local-speech.test.js` deleted; every `'local'` reference
      in `types.ts`/`jobs.ts`/`generate-video.ts`/`live-evaluation.ts`/`matrix-report.js`/
      `public/index.html`/`public/app.ts` removed. Kokoro is now the sole free local voice
      and the default `--tts` (ElevenLabs remains available via `--tts elevenlabs`).
- [x] Root-caused and fixed the actual Kokoro reliability problem: the venv lived in `/tmp`
      (wiped on cleanup, forcing a manual rebuild every session — not a model problem).
      `scripts/setup-kokoro.sh` (uv-based, idempotent) now creates a persistent `.kokoro-venv/`
      inside the repo instead.
- [x] `kokoro-speech.ts` now self-heals: checks `/health` on the persistent server
      (`KOKORO_SERVER_URL`, now defaulted to `http://127.0.0.1:8765` instead of requiring
      `.env` setup) and, if down, spawns it detached from the persistent venv and polls until
      ready — no manual `npm run kokoro-server` step needed anywhere. Dropped the old
      per-request process-spawn fallback (was a 4-5s cold-start tax every single scene).
- [x] Checked the live OpenRouter model catalog: `google/gemini-3.8-flash` (current planner
      default) confirmed the best available fast/structured-JSON model — no newer variant
      exists. No model change needed.
- **Acceptance:** live-verified end-to-end — killed the running server, ran a fresh
  generation with zero manual steps, confirmed auto-start + successful kokoro narration.
  Suite: 65/65 (0 skipped when the persistent server is warm — `TEST_KOKORO_TTS=1` now runs
  for real instead of being permanently skipped).

## Phase 11 (re-opened) — Real text measurement (PARTIAL — bounded win shipped, full fix still deferred)
> Re-evaluated this session after being deferred once already.
- [x] Replaced the 5-bucket category heuristic (`narrow`/`wide`/upper/digit/default) with a
      per-glyph width table sourced from the standard published Helvetica AFM advance widths
      (Adobe's font metrics, real documented data — not synthesized). ~90 characters covered
      (a-z, A-Z, 0-9, common punctuation); falls back to the old category heuristic for
      anything not in the table (accented Latin, Devanagari, CJK — non-Latin shaping is still
      a known gap). Stays fully synchronous, no new dependency, identical in browser and Node.
- **Why full glyph-accurate measurement (opentype.js/canvas measureText) is still deferred**:
  needs to be isomorphic — `public/app.ts` imports and calls `compileScene` directly in the
  browser (fixture/offline-demo path), while `jobs.ts` calls it server-side in Node
  (AI-generated jobs) — both must measure identically or preview vs. export geometry
  diverges, violating the codebase's own determinism guarantee (locked in by the
  "H05/H13/H17 frame is deterministic" test). It also needs `measureText`/`wrapText` to stay
  fully SYNCHRONOUS (deep inside the synchronous `compileScene`, called from
  tests/renderer/export scripts) — font loading is normally async in both environments, so a
  correct fix needs care (Node: `readFileSync` + opentype.js's synchronous `parse()`;
  browser: ensure `document.fonts.ready` before first compile). That's a bigger
  architectural change than remaining budget covered this pass — the per-glyph table above
  captures most of the practical accuracy gain without that risk.
- **Acceptance:** suite green (65/65, 1 skipped); re-ran the all-layouts × all-counts ×
  long-labels stress sweep from the Phase 8 work — still zero overlaps, zero out-of-bounds
  with the new (generally different) measured widths.

## Phase 9 remainder + Skills/prompt consistency audit (DONE — merged from two parallel Opus agents)
> Session context: Sep 9 2026. Both worked on non-overlapping files (icons.ts vs. planner.ts
> prompt strings) in isolated worktrees so they could run concurrently without merge
> conflicts. Both worktrees had drifted behind `main` by the time of merge, but neither had
> touched a file the other side had since changed, so each agent's file was copied onto the
> then-current `main` verbatim rather than git-merged (avoids resurrecting stale reverts of
> unrelated Phase 6-13 work already on `main`). Verified: `npm run build` clean, suite 64/64
> (1 skipped — Kokoro server not pre-warmed in this run).
- [x] **Icon rewrite** (`src/icons.ts`): replaced the old icon set with a shared low-level
      stroke primitive (`draw`/`glyph`) so every icon draws with consistent stroke width,
      dash caps and paper-colored knockout circles at joints — plus new multi-part glyphs
      (bust/head figures, gear teeth, radial burst variants) reused across several kinds
      instead of one-off paths per icon.
- [x] **Prompt consistency audit** (`src/planner.ts`): addressed the user's original
      cross-chapter coherence complaint directly in the two-stage prompt rather than in
      skills/*.md. Added a fixed `VOICE_CONTRACT` (byte-identical narrator voice rules across
      all chapters — banned AI-tell phrases, consistent register, contractions) and a
      `CONTINUITY_GUIDANCE` block (chapters are dispatched concurrently and can't read each
      other, so continuity is enforced via a shared canonical-term glossary built from the
      outline's own chapter titles/key points, injected into every chapter's content prompt).
      Outline prompt now also fixes one canonical term per concept up front. `teacherTone`
      guidance reworded so it varies energy/pacing only, never voice/persona — closing the
      Phase 6 risk that tone drift would read as a different narrator per chapter.
      `SELECTION_GUIDANCE` gained explicit same-concept-same-kind/shape consistency rules
      (outranking the earlier variety rules) and `LAYOUT_GUIDANCE` now tells the director
      both scenes of a chapter are one call and should share a layout only when their
      relationship genuinely matches.

## Run log (append per execution)
| Date | Phase | Jobs | Cost | Wall | Result |
|---|---|---|---|---|---|
| 2026-09-09 | matrix | 7 complete | $0.3252 plan / $0 voice | 36.7 min logged | baseline; deepseek dropped |
| 2026-09-09 | phase0 | 1-min bicycle pump (3 attempts, 1 complete) | $0.0053 plan / $0 voice | ~8 min wall incl. 2 failed attempts | spans live; bottleneck = parallel kokoro spawn flakiness + serial export |
| 2026-09-09 | phase1 | 1-min pump + 5-min packet-routing (2 attempts) | $0.0046 + $0.0322 plan / $0 voice | normal | outline v2 live (arc+keyPoints); 12/12 scenes mixed shapes, 0 generics, every node keyed; suite 49 pass |
| 2026-09-09 | phase2a | magnets + compass + water + GPS-5min | ~$0.07 plan / $0 voice | normal | 8 kinds, 4 shapes, deterministic upgrades; fallback hole closed; fuzzy claims; suite 53 pass |
| 2026-09-09 | phase2b | tides 1-min + web-request 1-min ×2 + thermostat 1-min | ~$0.03 plan / $0 voice | normal | 4 shapes/scene, labeled edges, marginalia, number badge, 12 illustrations; suite 58 pass |
| 2026-09-09 | phase3 | 10-min solar A/B (cached vs --no-cache) | $0.0749 vs $0.0778 plan / $0 voice | ~10 + 6 min | 34% tokens cached; idempotence fix unblocks export; suite 60 pass |
| 2026-09-09 | phase4 | export re-run + 1-min server cell | $0.0057 plan / $0 voice | ~1 min | export 8.1×; server TTS 2×, 0 flakes |
| 2026-09-09 | phase5 | critic cell + 1/5/10-min matrix | $0.2074 plan / $0 voice | ~6 min | critic +$0.001/1 repair; matrix 32 scenes, $0.2005, all first-attempt |
| 2026-09-09 | phase6-11 | 1-min gradient descent (local TTS), 1st attempt | $0.0064 plan / $0 voice | ~75s gen + re-export | teacherTone+visualIntent live-verified; 3 real overlap bugs found+fixed; label-clip bug found+fixed via curved connectors; suite 64 pass |
| 2026-09-09 | phase12-13 | bicycle pump 1-min (server auto-start test) + db-indexing 1-min (overlap timing test) | $0.0087 + $0.0051 plan / $0 voice | ~37s + ~45s | kokoro persistent venv + self-healing verified (killed server, zero manual steps to recover); TTS/director overlap verified (TTS hidden entirely inside director wait); suite 65 pass |

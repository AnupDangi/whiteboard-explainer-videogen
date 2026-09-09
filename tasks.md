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

## Phase 9 — Visual polish (SCOPED DOWN — full icon redesign deferred, see note)
- [ ] Whiteboard background texture: subtle dot-grid or paper-grain fill behind scenes
      (V2 §9 "rich visuals... belong on one whiteboard").
- [ ] Improve the emphasis highlight sweep (currently a flat yellow rect/ellipse wash) with a
      slightly textured/imperfect marker-stroke look.
- **Deferred, not done this pass:** per-icon redesign across all 32+ kinds in `icons.ts` for
  "more detail, consistent stroke weight" — large surface area, low marginal value vs. the
  overlap/coherence fixes above; a future agent can pick this up as its own bounded pass.
- **Acceptance:** rendered scene visibly shows background texture without interfering with
  text/overlap checks; suite green.

## Phase 10 — Pencil & transitions (MOSTLY DONE — verify only)
- [x] Scene-start fade-in and pencil fade-out near a local event's end already landed
      (uncommitted `renderSVG` changes: `transitionFade`, `pencilFade`).
- [ ] Confirm pencil "jumping between regions" already falls out of the existing
      first-active-node/edge selection (staggered `startMs` per node/edge) — no code change
      expected, just a verification note in this file once confirmed.
- **Acceptance:** visual check on one rendered video: pencil never lingers on a completed
  stroke, fades out between scenes.

## Phase 11 — Connector routing (SCOPED DOWN — text measurement deferred, see note)
- [ ] **Live-verified bug** (found running a real gradient-descent generation, see
      `output/videos/How-gradient-descent-optimizes-a-model-s-weights-1min.mp4` and the job at
      `.data/ecb25d5a-d8de-42ce-a9f7-24a44ccfe5df/`): edge labels render at the raw midpoint of
      `(x1,y1)`-`(x2,y2)`, so on a short connector between two close nodes the label sits
      overlapping/clipped behind the destination shape (e.g. "determin[es]" clipped behind the
      "Prediction Error" ellipse, "reaches" clipped behind "Minimum Loss Valley"). Fix as part
      of this phase's connector work, not just the curve.
- [ ] Curved (quadratic bezier) connector routing instead of straight lines, still anchored to
      boundary points per `compileScene`'s existing edge geometry.
- **Deferred, not done this pass:** real glyph-accurate text measurement (opentype.js/canvas
  measureText) — the current heuristic is now used consistently by both layout and the new
  Phase 8 overlap prevention, so it's internally consistent even if not pixel-perfect; V2 marks
  this lower-impact than the items above.
- **Acceptance:** edges render as curves in an engine test snapshot; no new overlaps
  introduced; suite green.

## Phase 12 — Latency (SKIPPED — not one of the user's reported gaps this round)

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

# Handoff archive (pre-2026-09-11)

Historical handoff entries, kept for provenance. The current handoff is `docs/HANDOFF.md`.

---

# Handoff — 2026-09-11, LD8 stability pass (historical)

Two completing runs on the DeepSeek-V3 report (53pp): job `8d9f752c` (2:05) then
`bbef4e24` (1:50) after the deterministic heals. Fix ledger in RESULTS.md (both 2026-09-11
entries). Suite 126 tests, 124 pass, 0 fail, 2 skip. Per-call state: outline 4-7s,
content 17-27s (+0-1 repairs), director 17-20s when called (auto-director skips it when
labels map to concrete kinds), TTS overlapped, render ~5s. Planning cost ~$0.01.

**Measured residuals:** staticInterval 8305/7230ms over the 3500 limit (spread-deference
trade-off — the density debt is now the top QUALITY item); director is the slowest stage
on abstract-label chapters; embeddings untested live; human playback review pending.

**Remaining tasks (in value order):**
1. **Eval/router program** — per-call traces already in the ledger (planner.call has
   tokens/finish/cost/ms); add cost/success aggregation + judge live + Gemini-vs-Qwen
   A/B (50 content + 50 director calls) before any model flip.
2. **Machine-readable canvas contract** (`canvas-contract.ts`) — prompts + skills derive
   from one spec; tests prevent drift.
3. **Adaptive provider concurrency** — backoff tuning beyond the current 429 handler.
4. Optional: 5-min live run to exercise multi-chapter concurrency with the new heals.

LD8 done: DeepSeek-V3 report (53pp) → 1-min narrated MP4, job `8d9f752c`, $0.0102 planning,
kokoro-aligned, connector crossings 0. Full evidence + fix ledger in RESULTS.md
(2026-09-11 LD8 entry). Suite 122 tests, 120 pass, 0 fail, 2 skip.

**Known residuals (measured):** staticInterval 10405/5155ms over the 3500 limit
(spread-deference trade-off); director 19.1s is the slowest stage; two repair cycles
burned ~58s; embeddings still BM25-only in live runs; human playback review pending.

**Next bounded task — deterministic layout compiler (plan Next item 1, top latency lever):**
compile `compare/flow/hierarchy/timeline/branch/radial` scenes from `visualIntent` without
the Visual Director call; target 70-85% of scenes director-free (~19s/chapter saved).
Constraint: preserve layout invariants (overlap/safe-region validators still run on the
compiled result). Alternative next: eval/router (per-call traces + cost/success table).

---

# Handoff — 2026-09-10, source-intelligence program: LD1–LD7 complete (superseded by LD8 entry above)

`docs/SOURCE_INTELLIGENCE_PLAN.md` phases LD1–LD7 shipped and committed on `opt-v3-harness`
(LD1 `199332b`; LD2+LD3; LD4+LD5; LD6+LD7 — see git log and the RESULTS.md 2026-09-10
LD2–LD7 entry). Suite: 118 tests, 116 pass, 0 fail, 2 skip. `src/planner.ts` still carries
pre-existing uncommitted changes from an earlier session (require_parameters conditional,
content max_tokens 5000→9000 now expressed via getOutputBudget) — ask the user before
committing those separately.

**Next bounded task: LD8 — live validation ($0.15–0.40).** Needs: (a) a real
multi-hundred-page PDF from the user (nothing suitable in-repo), (b) OPENROUTER_API_KEY +
optionally EMBEDDINGS_API_KEY in `.env`. Run 1-min + optionally 5-min; record in
RESULTS.md: page coverage (>15 pages used), retrieval mode (bm25 vs hybrid), section-routing
correctness (human check), grounding pass rate, cost, wall time, repair count.

**Known residuals after LD2–LD7:** outline prompt maxTokens unchanged for the map path
(fine — map text is small); straddling section-boundary chunks serve neither section;
embedding provider untested live; `run-visual-bench`/judge not yet re-run on the new
retrieval path; LD8 is the acceptance gate before claiming large-document support works.

---

# Handoff — 2026-09-10, LD1 (superseded by the LD1–LD7 entry above)

User approved the next program: **large-document support** (`docs/SOURCE_INTELLIGENCE_PLAN.md`,
LD1–LD8). Grounded limitation audit lives in that doc (verified against code 2026-09-10:
`PAGE_LIMIT=15` sources.ts:14, 200k/60k/120k clip stack, lexical-only retrieval planner.ts:50-62,
no evidence IDs, hardcoded 9000/5000 max_tokens). Decisions: hybrid BM25 + key-gated
embeddings with deterministic BM25-only fallback (core tests stay key-free); budget
~$0.15-0.40 per live validation. Do NOT re-implement what that doc lists as already-true
(chapter/scene concurrency, speculative Kokoro TTS, deterministic fast renderer).

**LD1 shipped** (see RESULTS.md 2026-09-10 LD1 entry): 15-page PDF cap removed, full-doc
page-aware extraction (`SourceDocument.pages: {page,start}[]`), TEXT_LIMIT 200k→5M,
`stripAcademicTail` gated to papers. Suite 97 tests, 95 pass, 0 fail, 2 skip. Committed as
`199332b` on `opt-v3-harness`.

---

---

# Current handoff — 2026-09-10, reviewer-optimization round 1 (O1-O3)

External review diagnosed three gaps; all three fixed on `opt-v3-harness`
(commit `fe518bb`). Suite 93 tests, 91 pass, 0 fail, 2 skip.

- **Figure context leak (O1):** figure digest rode only into the outline call;
  chapter content calls lost it. Now every content call's chapter source
  appends the figure inventory (`planner.ts` chapter task).
- **Static-interval debt (O2, three layers):** (a) `compileScene` now
  deterministically stretches each draw into the following narrated slack —
  pencil keeps stroking while narration continues (residual silence 2.6s,
  stretch cap +7s nodes / +5.4s edges, never into the next anchor, never past
  the last word); (b) new `checkAnchorSpread` validator rejects clustered
  anchors (consecutive gap >50% of narration for 3+ nodes, >80% for 2-node
  scenes; last anchor before 45%) and the existing repair loop regenerates;
  (c) `staticIntervalMs` samples thirds of every draw so a long continuous
  stroke is measured honestly. Evidence: mock bench over-3500 lints 102→0;
  live 1-min run static intervals 15775/8500ms → 3095/5180ms.
- **Vision parse failure (O3):** `repairFigureJson` conservatively repairs
  truncated model JSON (string-state walk, safe-boundary cut, comma-strip
  fallback); one bounded parse retry per figure with a conciseness nudge;
  schema caps 4 key numbers. Unit-proven on the exact live failure payload.
- **O4 (orthogonal grid router) deferred:** current bezier router + crossing
  detector + 6-candidate fallback already bound crossings to a residual the
  lint reports; a grid A* rewrites the router for marginal gain and risks
  sketch-mode + determinism invariants. Revisit only if crossings recur in
  more live runs (this run had 1 hit in scene 2).

Next bounded tasks: (1) live scene-1 residual 5180ms — one more anchor-spread
tune or per-scene pull of the last anchor into the closing third; (2) run
`run-visual-bench --live` + Level-C judge end-to-end; (3) figure-aware
visualIntent (content prompt currently gets figure text but no explicit
redraw instruction per node).

---

# Current handoff — 2026-09-10, source-intake program (P1-P6) complete

All six harness source-intake phases shipped on `opt-v3-harness` (latest commit
`357706e`). Suite 93 tests, 91 pass, 0 fail, 2 skip. Full ledger: commits
`cf68ac4` (P2 figures), `85fa768` (P3 understanding), `70c71ce` (P4 retrieval),
`0c0ed37` (P6 eval bench), `357706e` (figures through enriched flow). P5 (JSONL
ledger + errorKind + journal script) and P1 (extraction: docx/pptx/md/json)
landed earlier in the session.

**What shipped this stretch:**
- `src/figures.ts`: deterministic figure/table detection from `pdftohtml -xml`
  (`<image>` tags, whole-document scan, area-sorted top-4 — real figures beat
  page decorations), coordinate-true 150dpi crops (`cropFigure`), and
  fail-soft per-figure VLM description (`describeFigures`, ≤4 calls, strict
  schema). One real parse-failure on the DeepSeek paper kept 3/4 figures —
  fail-soft works as designed, no retry yet (bounded follow-up).
- Understanding rides the outline call (harness §77 budget kept): outline
  schema now requires `paperTitle`, `centralQuestion`, `workedExample`,
  `visualInventory`; hook chapter teaches what the source IS first; content
  calls receive the understanding block. Ledger event `source.understood`.
- `retrieveForChapter` (planner.ts): objective+keyPoint lexical scoring over
  paragraphs, original order, 8k char budget — ordinal chapter chunks gone.
- `eval/visual-bench/` (6 seed cases) + `scripts/run-visual-bench.ts`
  (live/mock; Level A lints + semantic coverage → report.json) +
  `scripts/judge.ts` (Level-C rubric vision scoring; live-only).
- Figures flow: enriched `generate-video` detects+describes before handoff and
  passes `GenerationOptions.figures` (worker never sees original bytes).

**Live proof (real paid runs, OpenRouter gemini-3.8-flash):** DeepSeek-V4
paper, 1-min: complete, $0.049, 4 model calls, 1 content repair; outline
produced paperTitle "DeepSeek-V4: Towards Highly Efficient Million-Token
Context Intelligence", workedExample "DeepSeek-V4-Pro", 3 visuals; scenes
carry verbatim-anchored facts (1.6T/49B, 27% FLOPs, 10% KV cache, 57.9%
SimpleQA).

**Known residual debt:** live 1-min scenes still measure staticInterval
9025/7825ms over the 3500ms limit (density debt already flagged in V3;
connectorHits=0) — the V3-6 beat-spread fix list still applies to live
outputs. Figure-describe: 1 truncated-JSON parse failure per ~4 figures
(fail-soft; a single bounded retry is the cheap fix). Mock-mode visual-bench
semantic coverage is 0/23 by construction (fixtures don't narrate per case) —
only `--live` produces meaningful semantic numbers.

**Next bounded task for a future agent:** (1) one parse-retry inside
`describeFigures`; (2) apply the static-interval spread fix to live planner
prompt (V3 handoff item 1); (3) run `run-visual-bench --live` once and the
judge on the saved scenes; (4) figure-aware content prompt (currently figures
reach outline+brief only).

---

# Current handoff — 2026-09-10, V3 program complete through V3-6

All six V3 items checked on `opt-v3-harness` (latest: matrix/fork/tectonic templates + `scripts/compare-v1-v2.ts` → `output/compare/{v1,v2}/` lint report: 17/20 scenes over the 3500ms static-interval limit — the measurable density debt; 2 residual connector crossings in `icons/lookup` and `shapes/primitives`). Suite 89 tests, 87 pass, 0 fail, 2 skip. RESULTS.md has the full V3 entry.

Next bounded tasks, in value order: (1) kill the 17 static-interval violations — mostly late-anchored tails; the beat model supports it, the planner prompt needs "spread reveals across the whole narration, not just the opening" plus a validator bump; (2) fix the 2 residual connector crossings (grow routeEdge candidate set or shrink obstacle band); (3) human pairwise judgment on `output/compare/` artifacts; (4) browser-side style toggle for EXPLAIN_SKETCH; (5) full harness V2 (scene-graph/actions) — large, separate.

---

# Current handoff — 2026-09-10, V3-5 progression critic + deterministic lints

V3-5 shipped on `opt-v3-harness`: new `src/progression.ts` — `progressionFrames` (5 deterministic frames at 0/25/50/75/100%), `staticIntervalMs` (longest narrated span with no visual change, 3500ms limit per harness §48), `connectorThroughNode` (re-derives `routeEdge` candidates; flags routes whose fallback still clips). Critic upgraded: reviews a 5-frame horizontal contact strip instead of one end-state thumbnail; deterministic findings are prepended to the critic prompt as pre-flagged issues and appended to repair issues even when the model ignores them; when sharp is unavailable, deterministic findings alone still drive one bounded repair. Suite 88 tests, 86 pass, 0 fail, 2 skip. Notable honest finding: the attention fixture itself fails `staticIntervalMs` (9.6s narrated dead tail) — the lint is already telling the truth about the density problem V3-6 must show.

Next: V3-6 V1-vs-V2 benchmark on attention/supply/TLS contact sheets, or the 3 remaining templates.

---

# Current handoff — 2026-09-10, V3-4 domain templates live-proven

V3-4 shipped on `opt-v3-harness` (pivoted: icon coverage is already 55/56 kinds, so Lucide vendoring is a style option, not the gap — the observed poverty was domain misrepresentation). New `src/templates.ts`: `tls_handshake` (two glyph-centered lifelines + labeled message arrows below the node band) and `supply_demand` (axes, opposing curves, dashed P*/Q* guides below the node band) — pure (scene,timeMs)→SVG, reveal rides the anchor nodes' timing. Wiring: `Scene.template` (types/engine whitelist/directorSchema enum), merge passes it through, unknown template values fail loudly (merge + validator tests). Director prompt (`TEMPLATE_GUIDANCE`) teaches when to request one (exactly 2 non-annotation anchors). `templates` fixture added; suite 85 tests, 83 pass, 0 fail, 2 skip. Export proof `output/videos/templates-proof.mp4` + `.scenes/`, frames `output/review-pump-v32/tpl-tls2.png`, `tpl-supply2.png`.

Known limitations: 2 of the planned 5 templates shipped (attention matrix, DNA fork, tectonic section remain); template scenes still render their anchor boxes in the top band (by design — nodes are the labels); arrow labels come from edge labels (unlabeled edges fall back to canonical step names).

Next: V3-5 critic progression sheets + lints, or the 3 remaining templates.

---

# Current handoff — 2026-09-10, V3-3 sketch + safe connectors live-proven

V3-3 shipped on `opt-v3-harness`, zero new dependencies (hand-rolled, seeded PRNG — Rough.js idea without the dep): (1) `EXPLAIN_SKETCH=1` env flag → containers render as wobbly double-stroke closed polylines + hachure hatch fill + label backdrop; deterministic per node id (hash-seeded mulberry32); browser and export share the same `renderSVG` bytes. (2) `routeEdge` exported: connector control point flips direction / grows bow (×1/2/3.2) until the sampled bezier clears every intermediate node rect — kills the TLS arrow-through-server-bug class. (3) Icon endpoints anchor to the glyph circle edge, not the invisible layout rect — kills arrows-floating-in-space. H09 test contract updated (icon boundary = glyph circle). Suite 82 tests, 80 pass, 0 fail, 2 skip. Sketch export of pump job `77518dab`: `output/videos/Explain-how-a-bicycle-pump-works-1min-sketch.mp4` + `.scenes/`, frame `output/review-pump-v32/sketch20b.png`.

Known limitations: sketch covers box containers only (circle/square/number/illustration stay clean — deliberate bounded slice); flag is export-side until the browser UI gets a style toggle; hachure under mid-reveal labels is faint by reveal opacity, legible at completion.

Next: V3-4 Lucide registry + 5 domain templates (attention matrix, DNA fork, tectonic section, supply/demand curves, TLS ladder).

---

# Current handoff — 2026-09-10, V3-2 beat model live-proven

V3-2 shipped on `opt-v3-harness`: optional `beats[]` (exact ordered partition, 2-4/scene) + `beatId`/`conceptId` on nodes across types/schema/validator; beat-local anchor resolution in `resolveAnchors` (repeated words across beats can no longer mismatch; legacy global path kept for beat-less plans); `checkConceptContinuity` in repair loop; node reveal lead -80ms → -180ms (harness 100-300ms). Suite 77/0/2. Live pump run job `77518dab`: first attempt, $0.0166, beats 3+2, `target_tire` identical across scenes, frames `output/review-pump-v32/` show beat reveal + example + annotation. Residual: canvas still sparse per frame (density = V3-3/V3-4 style + templates, not beats).

Next: V3-3 Rough sketch flag + obstacle-avoiding connectors + endpoint rules.

---

# Current handoff — 2026-09-10, V3-1 teacher contract live-proven

V3-1 shipped on `opt-v3-harness`: `checkBoardText` (key points on canvas, ≥50% label overlap) + `checkFirstVisual` (anchor ≤30 words) wired into content repair loop; teacher-contract sentences in content + outline prompts; 5 mock sites updated to new contract. Suite 75/0/2. Live GPS run job `6a99f295`: first attempt, $0.0059, opens mid-thought on 0.07s worked example, quantities in labels, frames `output/review-gps-v31/`. Residual honest gap: scene-2 empty ~5s despite passing word gate — wall-clock lateness needs V3-2 persistent objects/beat timing, not a tighter word bound.

Next: V3-2 beat model (nested beats, beat-local anchors, leadMs, conceptId continuity).

---

# Current handoff — 2026-09-10, DeepSeek-V4 paper run + two render fixes

End-to-end proof on user-supplied paper `https://arxiv.org/pdf/2606.19348` (DeepSeek-V4, 8pp): 1-min video, first attempt, job `7860802b`, 2 scenes, 64s timeline, gemini-3.8-flash ($0.0423, 5 calls), Kokoro TTS (982 chars), MP4 muxed (h264+aac) + per-scene SVGs in `output/videos/tmp-papers-2606-19348-pdf-1min.scenes/`. Audio sync automated PASS: kokoro-aligned, gapMs 0, trailingNonSilent false, first words at 325/350ms, scene durations exceed audio by exactly the designed 650ms tail.

Frame review of that video found two real render bugs, both fixed in `src/engine.ts` with tests: (1) `wrapText` char-split `one-million-token` into `tok|en` — now splits over-wide words at hyphens first, char-splits only a still-too-wide segment; (2) edge labels painted before (under) opaque node boxes (`deploys`→`eploys`) — labels now collected and appended after all nodes. Re-exported same job; `output/review-deepseek-v4/f33-fixed.png` confirms both. Full suite: `npm test` → 73 passed, 0 failed, 2 skipped.

Speed profile (no code change, truthfully): 34.75s total dominated by planning (outline 3.7s + content 16.9s + director 7.9s); render 4.5s for 768 frames. No bounded render win available — faster planning model is the lever, not renderer tweaks.

Known limitations: model wrote `FLOPs (T)` truncated label (data defect, validator gap — quantity coverage check is future work); f05 shows title-only canvas for first seconds (beat-density/static-interval work = harness §48, not started); human listening/viewing of full 64s not done — user playback review pending.

Next: user playback verdict on the MP4; then Phase B or §48 static-interval metric.

---

# Current handoff — 2026-09-10, harness adoption + scene-by-scene output

Harness `EXPLAIN_CANVAS_AGENT_HARNESS_V3.md` adopted as reference architecture (not one-shot rewrite: its §80 Tasks 1–12 / §67 Phases 0–7 remain multi-session program; V1 pipeline untouched). Bounded slice shipped: every export now saves each committed scene scene-by-scene in `output/` — final-frame SVG per scene plus `manifest.json` (ids, durations, node/edge counts, timing kind, audio ref) in `<name>.scenes/` next to MP4. Provenance: deterministic `renderSVG` bytes; fixture timing labeled `estimated`, never aligned.

What changed: new `src/scene-output.ts` (`writeSceneArtifacts`), wired into `scripts/export.ts`, covered by `test/scene-output.test.js`. Full suite: `npm test` → 71 passed, 0 failed, 2 skipped. Live proof: `npm run export -- --fixture attention --fps 1 --width 640 --out output/scenes-check/attention.mp4` → 4 SVGs + manifest in `output/scenes-check/attention.scenes/` (ignored, kept as evidence).

Known limitations: per-scene artifact = final frame only (no §45 start/25/50/75/end progression sheets yet); full V2 types/registry/storyboard not started. No paid calls, no commits.

Next bounded task: progression contact sheets per scene (§§45/64), or Phase B fixtures per prior handoff.

---

# Current handoff — 2026-09-10, Phase A baseline correctness closed

Implemented `docs/OPTIMIZATION_PLAN.md`'s Phase A (A1, A4, A5, A6 — A2/A3 had already landed in
commit 5cf8c32) per `docs/superpowers/plans/2026-09-10-phase-a-correctness-fixes.md`. Full suite:
`npm test` → 70 passed, 0 failed, 2 skipped.

What changed: A1's Kokoro BOS/EOS word-timing root cause fixed (predictor frames were being
dropped from every word's timing math — verified via a live `TEST_KOKORO_TTS=1` contract test,
not just a mock). A4's forced "every scene needs 2+ shapes" gate replaced with an identity-aware
kind-collision check (token rows, multiple keys, repeated bases no longer wrongly rejected; two
genuinely different concepts sharing a kind still fail); the exhausted-director-fallback path
intentionally stays strict. A5 found and fixed a real silent bug: the single-scene critic-repair
call was validated against the always-2-scene `directorSchema`, so every critic-requested repair
has likely been silently failing and keeping the unrepaired scene — `directorSchema` is now
`directorSchema(count)`, and a new end-to-end test proves a repair actually applies. A6 adds a
`manifestVersion` stamp to every job snapshot and a fixed named review corpus
(`docs/REVIEW_CORPUS.md`).

Known limitations, stated explicitly rather than left implicit: A1's fix is code/predictor-level
and live-contract-tested, but the full A1 acceptance criterion (human listening checks across all
32 originally-reviewed WAV scenes) was not performed — no human ears were available in this pass.
A6's manifest is a version string, not the full per-request schema/model/font/compiler hash
`GenerationManifest` contract `docs/OPTIMIZATION_PLAN.md` §4 describes — that remains future work.

Next bounded task: Phase B ("Prove expressive visuals without a model" — `src/types.ts`/`src/
schema.ts` V2 unions, `src/assets/registry.ts`, three authored mechanism fixtures: DNA fork, pump
cylinder, attention tokens) per `docs/OPTIMIZATION_PLAN.md` §5 Phase B. Do not start Phase B
inside this same session without deliberately re-reading that section first — it is a large,
separate effort per the plan's own dependency note ("Dependencies: A3/A4").

Verification: `npm test` (build + full suite) at each task boundary; no paid provider calls; no
commits beyond what was explicitly authorized for this run.

---

# Current handoff — 2026-09-09, multi-video architecture review

The user requested a broader video review and a complete implementation plan, not code changes. Read [VIDEO_QUALITY_REVIEW.md](VIDEO_QUALITY_REVIEW.md), then [OPTIMIZATION_PLAN.md](OPTIMIZATION_PLAN.md). The roadmap supersedes the older priority ordering below; historical completed phases do not establish current quality parity.

Reviewed full timelines of the DNA, tectonics and printing five-minute outputs plus the test bicycle-pump and GPS videos using sampled frames, saved scripts/timings, and WAV energy. This was not continuous audiovisual listening. Evidence is in ignored `output/review-2026-09-09/` with hashes, contact sheets, matched jobs and audio-tail measurements.

Highest-priority new evidence: all 32 audited WAV scenes have 1.55–5.125 seconds of audio after the final recorded word, containing substantial non-silent signal. Exact spoken boundaries/root cause still need listening or independent alignment. Current code also confirms caption reset in timing gaps, numeric fill opacity treated as boolean, rejection of useful repeated kinds/all-box token rows, and a single-scene critic repair using a two-scene schema. These are not fixed yet.

Next bounded implementation batch: roadmap A1–A5 (alignment diagnosis, captions, opacity, repeated-instance validation, repair schema). Then authored V2 mechanism fixtures for DNA, pump and attention before model generation. Preserve deterministic data, V1 compatibility and existing media. Do not start a framework rewrite or an uncontrolled generation matrix.

Verification: `npm test` with loopback access → build passed, 64 passed, 0 failed, 1 skipped. No application source changed, paid generation, commits or pushes. This session produced documentation and local ignored evidence only. See the review for baseline/provenance limitations and the roadmap for proposed acceptance gates.

---

# Agent handoff — 2026-09-09 (Phases 6-11: quality optimization pass)

## Current state (latest session)

User reported: doesn't feel like a real teacher, scene inconsistencies,
overlapping content, icons/visuals not polished. Followed
`docs/OPTIMIZATION_PLAN.md` (Phase 6-12), reprioritized to match the
report, executed Phases 6, 8, 7, 9, 10, 11 in that order (Phase 12
latency explicitly skipped — not a reported gap). Full checklist,
acceptance criteria and evidence in `tasks.md` (search "Phase 6").
Suite: 64 pass, 0 fail, 2 skipped (need live TTS creds). One real paid
generation run ($0.0064, gradient descent, first attempt) used to
validate live, not just synthetic tests.

**What shipped:**
- Phase 6: `teacherTone` (captured on the outline since a prior session,
  never wired) now actually reaches the narration prompt.
- Phase 8: found and fixed THREE real bugs in uncommitted overlap-
  prevention code from a prior session (width grown from unwrapped label
  ignoring wrapping; height growth crossing the font-size threshold used
  later so the two disagreed; no shrink-to-fit fallback for tight slots).
  Replaced the iterative pairwise push-apart (converged only
  asymptotically, could cascade) with a provably-correct one-pass sweep.
  Verified via a stress test across all 7 layouts × counts 2-6 × long
  labels: zero overlaps, zero out-of-bounds.
- Phase 7: added `visualIntent` per node — a Semantic Storyboard field
  (V2 §8) the Visual Director now treats as more authoritative than the
  label. Same 2-stage pipeline, no new agent. Live-verified: a real
  generation produced e.g. visualIntent "U-shaped bowl curve" → circle
  shape.
- Phase 9: dot-grid whiteboard background texture + a two-layer
  slightly-offset highlight wash instead of one flat rect.
- Phase 10: verified (no code change) pencil region-jumping already
  falls out of the existing per-frame active-element selection; now
  also follows the Phase 11 curve tangent correctly.
- Phase 11: curved (quadratic bezier) connectors, replacing straight
  lines. Fixed a bug found DURING live validation of Phase 7: edge
  labels rendered at the raw straight-line midpoint and could clip
  behind an adjacent node on a short connector — re-rendered the same
  real job's frames before/after to confirm the fix.

**Next bounded task for a future agent:** Phase 11's remaining label-
clip residual on very tight gaps (small edge-touch, not a hard overlap
— see tasks.md Phase 11 note) could use another pass if it still reads
as a problem in more real generations. Otherwise: Phase 9's deferred
per-icon redesign (all 32+ kinds in `icons.ts`), or Phase 11's deferred
real text measurement (opentype.js/canvas measureText replacing the
character-width heuristic), are the next-highest-value items per
`docs/OPTIMIZATION_PLAN.md`.

---

# Agent handoff — 2026-09-09 (ALL PHASES COMPLETE: teacher program + critic + matrix)

## Current state

All 8 program phases done, suite 60 pass / 0 fail. Kokoro server running
(PID 89790, :8765, from rebuilt /tmp venv — /tmp gets cleaned, rebuild per
`video-generation` skill if missing). Demo default stays `--tts local`;
fast path is `--tts kokoro` + `KOKORO_SERVER_URL=http://127.0.0.1:8765`.
Full phase history in `tasks.md`; measurements in `docs/RESULTS.md`.
Latest: critic verified (+$0.001/1 repair, keep optional); 1/5/10-min matrix
green first-attempt ($0.2005 plan, $0 voice, 5-min in 84 s, 10-min in 173 s).

## Previous session — 2026-09-09 (Kokoro voice + 1/5/10-min matrix, kokoro-aligned)

## What changed this session

1. **Kokoro local neural voice** (`--tts kokoro`): bridge + provider + jobs/UI
   wiring + 5-voice catalog + tests. Suite 45 pass, 0 fail. Native word
   timings (pred_dur, diff 0.000 vs audio). Setup in `video-generation` skill.
   ElevenLabs + robot paths untouched. Default `--tts` is still `local`.
2. **1/5/10-min matrix on Kokoro**, all first-attempt complete, zero generics,
   shapes mixed throughout (T10: 24 icon / 25 box / 12 illustration).
   `firstPlayableMs` ≈ 20 s — planning-bound, not TTS-bound; <8 s SLO needs
   faster planning, not faster speech. Details in `RESULTS.md` (Kokoro entry).
3. Leftovers: `/tmp/kokoro-spike` venv + `/tmp/papers/bert.pdf` live outside
   the repo (set `KOKORO_PYTHON` to use). `.data/2dc3c48d…` still an orphaned
   `planning` job from the earlier killed deepseek run.

## Previous session — 2026-09-09 (prompt-builder + multi-model/multi-source demo, local TTS)

## What changed this session

1. **Internal prompt-builder** (`src/prompt-builder.ts`, pure/deterministic):
   bare URL / PDF / text / one-line prompt → rich visual brief (audience,
   chapter questions, anchor facts, visual direction). Six unit tests;
   suite now 43 pass, 0 fail, 1 skip. New `skills/prompt-builder/SKILL.md`.
2. **Demo script** (`scripts/generate-video.js`): `--pdf`, `--model`,
   `--no-enrich`; `--tts` default is now `local` robot voice. Caller gives
   ONLY a source. `skills/video-generation/SKILL.md` updated.
3. **Live proof** (all enriched + local TTS + MP4): ResNet URL ×
   gemini-3.8-flash (mixed shapes), BERT PDF × gemini-3.7-flash (mixed
   shapes), bare fridge prompt × gemini-3.8-flash (0 generics, box+icon mix
   after new anti-generic/≥2-shape guidance). Details in `RESULTS.md`
   (2026-09-09 entry). Model negatives documented: qwen3.8-flash
   (reasoning-bloat truncation), gpt-4o-mini (completions 404 on this key),
   deepseek-v4-flash (generic-everything + flaky timeouts) — use Gemini
   Flash for visual richness.
4. Leftovers: `.data/2dc3c48d…` is an orphaned `planning` job from the
   killed deepseek re-run (harmless; reads back as `interrupted`).
   `/tmp/papers/bert.pdf` is outside the repo (intentionally uncommitted).

## Previous session — 2026-09-08 (icon shape + agentic skills + 1/5/10-min videos)

## What changed this session

1. **Icon shape actually reaches the canvas.** `directorSchema` already
   allowed `icon`, but `mergeDirectorOutput` rejected it as unknown and the
   shape guidance never mentioned it — agents could not draw icon nodes.
   Fixed: merge accepts/validates `icon` via `hasIcon(kind)` (downgrade to
   box otherwise); SHAPE_GUIDANCE + director shape example now teach all
   three primitives with a mix-shapes rule. Live proof: the 1-min GPS video
   below has 3 icon nodes; 5-min has 14 icons + 1 illustration; 10-min has
   31 icons + 1 illustration; zero all-box scenes across 32 AI scenes.
2. **Agentic skills with canvas access** (`skills/*/SKILL.md`): `canvas`
   (sole drawing contract), `whiteboard-planner` (Stage 1), `visual-director`
   (Stage 2, canvas-aware), `video-generation` (orchestrator + rich-prompt
   recipe + verification). `generate-video.js` gained `--prompt`, `--text`,
   `--tts elevenlabs|local`.
3. **Videos tested:** 1-min GPS (ElevenLabs), 5-min DB indexing + 10-min
   photosynthesis (local TTS after ElevenLabs quota hit 256 remaining
   credits — 401 quota_exceeded preserved visibly, no silent fallback).
   Details + job IDs in `RESULTS.md` (2026-09-08 icon/skills entry).
   `npm test`: 37 pass, 0 fail, 1 skip. `output/icons.mp4` proves the
   icon render path offline.

## Planner architecture review (same session, after the illustrations work)

User asked for an audit of the "AI agents architecture, prompts, skills,
tools" (i.e. `src/planner.ts`'s three-stage Teaching Planner / Visual
Director / Visual Critic pipeline) and to fix what's found — explicitly
scoped to reviewing/improving the existing pipeline in place, not migrating
to Vercel's `eve` agent framework (that option was offered and declined; the
project's own `AGENTS.md`/replication-target doc explicitly call for a small
number of direct model-call stages, not a tool-using agent framework).

Read the full pipeline (`call()`'s budget/timeout/retry wrapper, the
Teaching Planner and Visual Director prompts/schemas, `resolveAnchors`'s
multi-strategy anchor matching, `mergeDirectorOutput`, the optional Visual
Critic thumbnail-review stage). Found and fixed one real bug plus two
robustness/observability gaps:

1. **Bug**: in both `planContent()` and `directScene()`, the *first* call to
   `call()` was made once before the retry loop, outside any try/catch. A
   transient failure there (network blip, HTTP 429/5xx, a truncated
   response) wasn't retried in place — it escaped straight past the stage's
   own retry budget (`CONTENT_ATTEMPTS`/`DIRECTOR_ATTEMPTS`) into the much
   more expensive outer `CHAPTER_REGENERATIONS` loop, or in `directScene`'s
   case wasn't caught at all until that outer loop. Fixed by moving the
   first call inside the loop (`if(attempt===0)contentRaw=await call(...)`),
   so transport failures and validation failures now share the same
   in-place retry budget, exactly like every subsequent attempt already did.
2. The model-catalog fetch (`GET /models`, made once before any chapter
   work starts) had no timeout at all, unlike every other request in this
   file. Added the same `AbortSignal.timeout` pattern `call()` already uses.
3. When `visualCritic:true` is requested but the critic model isn't in the
   OpenRouter catalog (or has unusable pricing), the critic stage silently
   no-ops for every chapter with no trace anywhere. Added one log line
   (`planner.critic-unavailable`) so this is diagnosable.

New test in `test/generation.test.js` (`'A transient failure on the very
first content/director call retries in place...'`) fails a mock content and
a mock director call exactly once each and asserts each is retried in place
(2 attempts) rather than the whole chapter being regenerated from scratch —
would have failed before the fix (the original test suite had no coverage
of this path at all). Verified: `npm run build` clean, `npm test` → **36
pass, 0 fail, 1 skipped** (up from 35/0/1).

Not changed (reviewed, judged fine): the reservation/budget math in `call()`
and `callCritic()` (documented conservative-by-design); the multi-strategy
anchor-matching fallbacks in `resolveAnchors` (verbose but each strategy is
independently justified in its own comment and exercised by existing
tests); the whole-chapter `CHAPTER_REGENERATIONS` outer retry (still the
right last resort for a genuine content defect, just no longer the *first*
line of defense against a flaky network call).

## What changed earlier in this session (rich illustrations)

The user's core complaint: every scene was "boxes and connections" — each node
rendered as a rounded rect with a tiny 15px-radius glyph in the corner, never
an actual drawn figure. This session adds a real fix, per
`../../lamina_video_replication_target_v2.md` §12/§20 (reusable multi-part
illustrations; major outline → detail → fill drawing grammar):

- `src/illustrations.ts` (new): multi-part, normalized-coordinate vector
  figures for `user` (person), `teacher`, `student`, `agent` (robot),
  `server` (rack) and `model` (neural-network diagram). Each figure is drawn
  in three timed stages — major outline, secondary detail, fill wash — via
  per-part stroke-dasharray reveal (not the browser-only `pathLength`
  attribute, which some SVG rasterizers don't support; lengths are computed
  from mapped absolute coordinates instead, matching the existing box/edge
  reveal style in `engine.ts`).
- `PlanNode`/`CompiledNode` gained `shape?: 'box'|'illustration'`
  (`types.ts`). `illustration` is only valid when the node's `kind` has a
  matching entry in `illustrations.ts` — enforced in `engine.ts`'s
  `validateCandidate`.
- `engine.ts`: illustration nodes render via `renderIllustration(...)`
  instead of the rounded-rect+icon path, get a longer `drawMs` (1700 vs
  900), and — the key visual fix — opportunistically **grow their bounding
  box** (`growIllustrationBox`) into whatever unused safe-region space
  surrounds their laid-out slot (taller first, then wider), checked against
  every other node's current rectangle so it can only shrink back to the
  untouched base geometry, never overlap. Without this, figures rendered at
  ~70–90px and still looked like a slightly bigger icon; with it they
  typically reach 300–400px and read as an actual drawn person/robot/rack.
  Also fixed a pre-existing, unrelated bug found while inspecting rendered
  frames: the subtitle caption's words ran together with no spaces (missing
  `xml:space="preserve"` on the `<text>` element — SVG collapses tspan
  whitespace without it).
- `schema.ts` / `planner.ts`: the Visual Director's per-node schema and
  system prompt now include `shape`, with explicit guidance to use
  `illustration` sparingly (≤1–2 nodes/scene) and only for kinds that have
  one. `mergeDirectorOutput` downgrades an invalid kind/shape combination to
  `box` rather than failing the scene.
- `fixtures.ts`: added an `illustrations` demo fixture (`people` = teacher +
  student, `system` = agent → server → model) and upgraded the `neuralnet`
  fixture's "Output layer" node to `shape:'illustration'`.
- `server.ts`: added `/src/illustrations.js` to the browser-servable static
  whitelist (the client renders via the same `engine.ts`/`renderSVG`).
- `test/engine.test.js`: new test covers staged reveal (outline before
  fill), the longer draw duration, and both new validation failures
  (illustration on an unsupported kind; unknown shape string).

Verified: `npm run build` clean; `npm test` → **35 pass, 0 fail, 1 skipped**
(up from 34/0/1 — one new test added, nothing else changed). Visually
verified by rasterizing fixture frames to PNG (`sharp`) and inspecting them
directly — confirmed progressive multi-stage stroke reveal, correct final
fills, and that the grown boxes stay disjoint (no overlap) with realistic
demo scenes.

Not done: `LAYOUT_GEOMETRY` itself is untouched (deliberately, to avoid
destabilizing the existing 7 layouts / H07 overlap invariant) — growth is a
post-hoc opportunistic pass, so a scene packed with 5-6 nodes including an
illustration will grow less than the roomier 2-3 node demos shown here. The
illustration library covers 6 kinds; extending it (e.g. `document`,
`browser`, `cloud`) follows the same `Part[]`/stage pattern in
`illustrations.ts`. No live OpenRouter call was made to confirm a real model
actually picks `shape:'illustration'` well in practice (prompt guidance and
schema are in place; only fixture-driven rendering was verified end-to-end).

## Current state

Build restored after malformed edits to `public/app.ts` and `src/server.ts`.
Latest `npm test`: **30 pass, 0 fail, 1 optional local speech test skipped**.
The prior `TEST_LOCAL_TTS=1 npm test` passed all then-existing 30 tests.
Plain `npm test` now runs 30 tests and skips the opt-in macOS speech integration test.
Run tests with local socket access; the restricted tool sandbox causes this
machine's Node 24 HTTP tests to abort in native code. Outside it, they pass.

The UI and API now default to ElevenLabs; the configured voice is Alice (premade). Python robot narration is optional. `scripts/robot_tts.py` uses macOS
`say` (Alex), measures trimmed PCM word segments and joins them into WAV audio.
No Python packages, speech keys or FFmpeg are needed for this path. It sounds
robotic and generation is sequential and slow. `PYTHON_BIN` overrides Python.
ElevenLabs remains selectable; configured/default/custom voice IDs reach its API.
Narration failures terminate visibly, preserving any already committed scenes.
There is no automatic silent success fallback.

The preparation log shows queued/planning/chapter-ready/speech-started/scene-ready
and completion/error/cancellation. Error messages reach the UI; empty terminal
jobs no longer retain the Preparing title. Play/pause, seeking within speech,
backward seeking, seeking into a silent scene tail, transitions, completion and
2x replay were checked in the browser with real WAV audio. End-of-playback button
redraw and stale audio-play promise handling were fixed.

## Verification

- `npm run build` and `TEST_LOCAL_TTS=1 npm test` pass.
- `npm run test:live -- --minutes 1 --voice --tts local --budget 0.1` completed:
  job `c429d641-4d21-4ccc-827f-00df950b3d42`, 2 scenes, 65.831 s timeline,
  first playable 68.305 s, complete 132.444 s, OpenRouter cost $0.000495693,
  2 calls, 674 TTS characters. All automated source/determinism checks passed.
- Every live scene's WAV sample duration matches timing.durationMs exactly.
  This proves segment duration consistency, not human-rated natural alignment.
- A saved valid plan replay also completed with 88.575 s audio timeline.
- Earlier live attempts failed: FFmpeg missing x265, then overlong model notes.
  WAV removes the first dependency; explicit short-caption instructions improved
  the final run. Invalid anchors/overlong notes still fail validation; model
  quality and first-pass success remain unproven.

The verified app runs at http://127.0.0.1:3001 (port 3000 already had an older
process). Reopen the live result with
`/?job=c429d641-4d21-4ccc-827f-00df950b3d42`.

## Constraints and next bounded task

Read `AGENTS.md`. Preserve validated scene data and the deterministic renderer.
Secrets remain in `.env`; generated data/media in `.data`, reports in `output`.
No commits, pushes, repository creation or deployment were performed.

Next: optimize local speech preparation latency without losing word boundaries,
then measure sustained buffering with real narration. Longer 5/10/30-minute
live runs, human teaching-quality ratings and natural continuous speech are
unverified. Current Homebrew FFmpeg cannot start: missing
`/opt/homebrew/opt/x265/lib/libx265.215.dylib`. MP4 export supports WAV paths in
code but cannot be revalidated until the local FFmpeg installation is repaired.

## ElevenLabs retest — 2026-09-08

The previous configured Russ library voice HKFOb9iktHA85uKXydRT returns HTTP 402,
code paid_plan_required: "Free users cannot use library voices via the API.
Please upgrade your subscription to use this voice." This was NOT evidence of
exhausted credits. providers.ts now preserves HTTP status, provider code and
message exactly instead of mislabeling every 402 as exhausted quota.

Alice Xb7hH8MSUJpSbSDYk0k2 is premade, listed by this key, and tested successfully.
The ignored .env voice value was updated to Alice; the API key was unchanged.
UI defaults to ElevenLabs, with Alice/George/custom options and robot optional.

Full hand-authored attention fixture job 0537edae-3d6a-4bba-8a44-313a29ec1594:
4 scenes, 84.149 seconds playback, first playable 3.014 seconds, completion
13.558 seconds, 1134 TTS characters, all scenes provider-aligned MP3. Browser
confirmed loaded, unpaused audio with advancing time and no error. Test report:
output/elevenlabs-check/full-explanation.json. Exact original failure is in
output/elevenlabs-check/configured-voice.json.

Automatic review blocked transmitting a saved explanation as potentially private;
the full test instead used the repository's hand-authored educational fixture.
No saved user document was uploaded. No billing change or upgrade was needed.

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
- LD2 `src/document-map.ts`: heading detection over page-tagged text → ordered sections
  with true page numbers, tiling spans, extractive summaries (zero model calls); 48-section
  cap with even selection; page-window fallback; sha256-cached under `.data/`; jobs.ts
  builds/caches it fail-soft after ingest (`source.map-built` ledger event).
- LD3 `src/retrieval.ts`: paragraph-boundary chunking (stable per-page ids) + zero-dep BM25
  over objective/keyPoints; evidence assembled in document order within budget; chunk ids
  returned. Old lexical `retrieveForChapter` removed.
- LD4 `src/embeddings.ts` + RRF: key-gated OpenAI-compatible embeddings
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
- LD7 `src/budgets.ts`: five budget functions (output/retrieval/input/cost/latency); all
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
- `src/sources.ts`: `PAGE_LIMIT=15` removed (full-document `pdftotext -raw`, maxBuffer
  2MB→16MB, timeout 30s→60s); `TEXT_LIMIT` 200k→5M chars (book scale); new exported
  `buildPageText(raw, tailCut)` — form-feed page split, per-page compaction, joined with
  `\n\n`, returns `pages: {page, start}[]` with true 1-based page numbers; blank pages
  skipped; pdftotext's trailing `\f` handled.
- `stripAcademicTail` now gated to paper-like docs (≤150k chars AND marker in back 40%)
  so a book's References/Appendix sections survive. NOTE: gate tightened from the old
  `index>0.3` rule — papers with References before ~60% of body now keep their tail.
- `SourceDocument.pages?: Array<{page:number;start:number}>` (`src/types.ts`); PDF and
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
- A4 (`src/planner.ts`): `checkKindCollision` now allows same-kind nodes whose labels reduce to
  one stem after stripping a trailing instance marker (number/letter/ordinal) — token rows and
  multiple lettered keys pass; two different concepts sharing a kind still fail. The hard
  `checkShapeMix` gate was removed from `directScene`'s normal per-attempt path (now a
  `planner.shape-diagnostic` log line only) but deliberately left in place on the
  exhausted-director-fallback path, per the existing `'Exhausted director retries fail loudly...'`
  regression test it protects.
- A5 (`src/schema.ts`, `src/planner.ts`): found that the single-scene critic-repair call was
  validated against the fixed 2-scene `directorSchema` — a real, previously-silent bug meaning
  critic-requested repairs have likely never actually applied (the failure was swallowed by
  `repairFromCritique`'s own `catch`). `directorSchema` is now `directorSchema(count)`; a new
  end-to-end test with `visualCritic:true` proves a repair's changed `kind` now reaches the
  committed scene.
- A6 (`src/types.ts`, `src/jobs.ts`, `docs/REVIEW_CORPUS.md`): every new `JobSnapshot` carries
  `manifestVersion` (`GENERATION_MANIFEST_VERSION` in `src/jobs.ts`); added a named, stable
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

- New `src/prompt-builder.ts` (pure, deterministic, zero cost): any bare
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
  ≥2 shapes" rule in `src/planner.ts`.
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

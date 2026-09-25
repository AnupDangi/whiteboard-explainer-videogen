# Pipeline Audit — Claude hypothesis track (`v1_claude`)

Audit date: 2026-09-22. Read-only audit, no code changed. Source of truth: `claude_pipeline.md` (root) + all six
`hypothesis/v1_claude/*.md` files. Implementation inspected: `src/experimental/hypothesis/v1_claude/**` and
`src/experimental/hypothesis/shared/**`. `docs/HANDOFF.md` and `docs/ARCHITECTURE.md` were treated as claims to
verify, not facts — every line below was checked against the actual source and, where practical, a passing test.

Legend: `[x]` DONE (implemented AND covered by a passing test) · `[~]` PARTIAL (implemented but incomplete/stand-in)
· `[ ]` MISSING (not implemented, or only stubbed).

---

## UPDATE 2 — 2026-09-23 (later): superseded by `docs/AUDIT-2026-09-23.md`

A second line-by-line audit plus build pass closed:
- S2/S3/S4;
- the Streamline catalog with embeddings;
- the math primitives;
- the MathJax formula;
- the strong S6 with its §9 fallback;
- the drawn-in-real-time renderer;
- the G5/G9 gates;
- the judge harness.

It also found and fixed 10 bugs. Read that file for the current checklist; the sections below are historical.

## UPDATE — 2026-09-23: the three load-bearing gaps below (S6 Scene Planner, S5 real
TTS/alignment, S11 MP4 encode) are now real and live-verified. This section supersedes the
specific `[ ]`/`[~]` lines it names below; the rest of this 2026-09-22 audit (all 12 templates,
layout solver, timeline compiler, deterministic gates, mention-marker contract) is unaffected and
still accurate as written. Full evidence log: `docs/HANDOFF.md`'s "2026-09-23, live pass" entry.

- §4 S6 Scene Planner: **no longer MISSING.** `v1_claude/planner/{prompt,plan,env}.ts` make real
  OpenRouter calls (`OPENROUTER_DIRECTOR_MODEL`, temperature 0, JSON schema generated from
  `schema.ts` via `z.toJSONSchema`, exactly one repair attempt, real cost/token accounting). Run
  live across all 4 golden cases: `gradient-descent`/`photosynthesis` 3/3 scenes with 0 hard
  failures; `transformer-attention` 2/3 (one scene's title genuinely exceeded the 4-word limit
  twice, a real model failure, correctly recorded and NOT papered over);
  `electromagnetic-induction` 3/3 scenes but 1 hard `timeline/concurrency` gate failure (a real,
  newly-surfaced edge case — see HANDOFF for root-cause analysis; not fixed, since fixing it would
  require loosening a gate specifically for this case). No deterministic `list_icon`/`chain`
  fallback was implemented — a deliberate, documented deviation from this file's §9 optional
  fallback language, per the live-run task's explicit "no silent fallback" instruction. Total real
  spend across all 4 cases: $0.0112 (11 planner calls including repairs), each case far under the
  $0.10/clip cap.
- §3 S5 Voice + alignment: **no longer MISSING.** `pipeline/runLive.ts` calls the local
  voice-engine (`synthesizeAndAlign` in `shared/alignment/align.ts`, unmodified) for real TTS and
  real `stable-ts`/`faster-whisper` forced alignment per scene, stitches per-scene real WAVs onto
  one master clock via real ffmpeg `apad`+`concat` (`v1_claude/export/audioStitch.ts`), and
  re-resolves `[[id|phrase]]` markers against the real word timestamps through the EXISTING,
  unmodified `narration/resolveMentions.ts` — its interface needed no changes.
- §9 `@resvg/resvg-js` PNG rasterization: **no longer MISSING.** Installed (`npm install
  @resvg/resvg-js`, confirmed absent before this pass, smoke-tested standalone), wired in
  `v1_claude/export/videoEncode.ts`, calling the SAME unmodified `renderSVG(scene,timeline,t)`.
- §10 S11 Encode: **no longer MISSING.** `v1_claude/export/{ffmpeg,videoEncode}.ts` pipe resvg PNG
  frames into system ffmpeg (`image2pipe` → `libx264`/`yuv420p`/`aac`), muxing in the real
  per-case master WAV. All 4 golden cases produced a real `video.mp4` (h264/1920x1080/30fps + aac,
  confirmed via `ffprobe`, ~30.000s each) at
  `.data/hypothesis-runs/claude/live/<case>/video.mp4`. A PNG contact sheet was also added
  alongside the pre-existing SVG one.
- Unchanged / still open: catalog (~18 entries), `formula` primitive (raw LaTeX text, no
  MathJax), `relations: []` in every `EvaluationBundle` (Edge→GoldenRelation mapping still
  missing), content-addressed caching, VLM judge harness (E1-E10/C1-C6), the `fill`-tail-vs-
  concurrency-gate question newly surfaced by `electromagnetic-induction`'s live run (see
  HANDOFF). The tally line and "Required to reach a real live run" section below describe the
  2026-09-22 state and are now superseded for the 3 items above — do not re-read them as current
  without this note.

---

---

## 0. Ground truth: test suite, run today

```
npm run typecheck:hypothesis   -> tsc --noEmit -p tsconfig.json  ->  0 errors
npm run test:hypothesis        -> node --test dist/.../__tests__/*.test.js
  tests 114, pass 114, fail 0, cancelled 0, skipped 0, duration ~138ms
```
Both commands were executed fresh in this session (not copied from `docs/HANDOFF.md`). Numbers match what
`docs/HANDOFF.md` claims (114/114), so that document's test-count claim is confirmed accurate.

`package.json` dependencies for the whole repo are exactly `{ cheerio, ipaddr.js, zod }` (+ optional `pg`, `sharp`).
None of `@resvg/resvg-js`, `ffmpeg-static`, `roughjs`, `mathjax-full`, `elkjs`, `@iconify/json`, `@iconify/utils`,
`@huggingface/transformers`, `opentype.js`, `svg-path-properties`, `svgo`, `svgson` are installed
(`node_modules` grep confirms) — every downstream item below that needs one of these is at best a deterministic
stand-in, never the real package.

---

## 1. Pipeline stage order (claude_pipeline.md §1)

- [x] Stage order S4→S5→S6→S7→S8→S9→S10 is preserved exactly and never reordered — `src/experimental/hypothesis/v1_claude/pipeline/run.ts:65-133` calls `buildNarrationScene` → `alignFixture` → `resolveMentions` → `safeParseSceneSpec`/`validateSceneSpecStructure` → `resolveScene` → `layoutScene` → `compileTimelineFull` → `runClaudeGates`/`renderSVG`, in that literal order. Verified by `__tests__/e2e.test.ts:34-40` (zero hard failures end to end).
- [~] S1 INGEST / S2 UNDERSTAND / S3 TEACHING PLAN — not implemented in `v1_claude` at all; frozen `TeachingBeat[]` fixtures from `src/experimental/hypothesis/shared/fixtures.ts:10-34` stand in, exactly as `claude_pipeline.md §2` ("experimental mode... full ingestion pipeline may be bypassed") explicitly permits. No PDF/DOCX/PPTX/MD parser exists under `v1_claude/`. Marked PARTIAL rather than MISSING because the spec itself sanctions the bypass for this experiment — but note it means the "any document... → narrated video" end-to-end claim in `01-ARCHITECTURE.md:3` is untested from a real upload.
- [ ] "Every stage emits a typed, content-addressed artifact" (§1) — no content-addressed cache exists; `runner/cache.ts` (named in `01-ARCHITECTURE.md §10`'s repo layout) does not exist anywhere in this tree. `pipeline/run.ts` writes plain JSON files keyed by scene id, not by `hash(input+modelId+promptVersion+schemaVersion)`. Determinism is proven (`e2e.test.ts:86-92`, byte-identical reruns) but caching/resume is not implemented.

## 2. S4 — Script with mention markers (claude_pipeline.md §4)

- [x] `[[id|phrase]]` marker syntax, stripped before "TTS," offsets preserved — `narration/markers.ts:4,17-34`. Tested `__tests__/mentions.test.ts:12-18`.
- [x] Repeated-phrase, punctuation, Unicode, ambiguous, and missing-span resolution — `narration/resolveMentions.ts:15-100`. Tested `mentions.test.ts:31-91` (7 dedicated tests, all passing).
- [x] Missing mention is a hard, non-silent failure — `resolveMentions.ts:81-84`, surfaced as `StageFailure` in `pipeline/run.ts:77-79`. Tested `mentions.test.ts:58-74`.

## 3. S5 — Voice + alignment (claude_pipeline.md §5)

- [~] `AlignedAudio` shape (`wavPath`, `durationMs`, `words[]`, `mentions[]`) — DONE structurally, `types.ts:64-74`.
- [ ] Real TTS audio — **MISSING**. `narration/align.ts:1-61` is a pure deterministic character-count word-duration model (`baseDurationMs`, line 17-20) scaled to hit `targetDurationMs`; `wavPath` defaults to the literal string `'fixture://silence.wav'` (line 30). No `voice-engine/` code is invoked from `v1_claude/` anywhere (confirmed: no import of anything under `voice-engine/` in the whole subtree).
- [ ] Real forced alignment (stable-ts/whisperx) — **MISSING**. `AlignedAudio.provider` type allows `'fixture' | 'stable-ts'` (`types.ts:67`) but only `'fixture'` is ever produced; `pipeline/run.ts:67` throws if `options.mode !== 'fixture'`. No Python sidecar, no `stable-ts`/`whisperx` invocation anywhere in the repo.
- [x] "Audio is the master clock" ordering honored even in fixture mode — every downstream timestamp derives from `alignFixture`'s output, never the reverse (`pipeline/run.ts:75-111`).

## 4. S6 — Scene Planner (claude_pipeline.md §6, the item the task asked to specifically re-verify)

- [ ] **MISSING, confirmed with fresh eyes.** Grepped the entire `v1_claude` tree for any model/LLM call: none exists. `pipeline/run.ts:22` (doc comment) and `cli.ts:19-23` state this outright; `fixtures/attentionScenes.ts:1-90` supplies three **hand-authored** `SceneSpec`s ("Why Attention", "Query Meets Keys", "Blending the Values") directly to `runHypothesis`. `cli.ts:71-75` hard-errors for any `caseId` other than `"transformer-attention"` because no other case has a SceneSpec source and there is no planner to generate one.
- [ ] Planner prompt contract (narration+mentions, concept subgraph, top-k catalog candidates, template/slot definitions, few-shots, hard rules) — **MISSING**, no prompt files exist (`hypothesis/v1_claude/01 §3.3`'s `prompts/`, `fewshots/`, `repair.ts` layout from the plan pack is not present).
- [ ] zod validation → one repair call → deterministic fallback loop (`claude_pipeline.md §9`) — **PARTIAL only for the validation half**: `schema.ts:238-242` (`safeParseSceneSpec`) and `validateSceneSpecStructure` (`schema.ts:159-224`) exist and are tested (`schema.test.ts`, 16 tests), but there is no repair call and no deterministic `list_icon`/`chain` fallback generator anywhere, because there is nothing to repair — hand-authored specs either parse or the scene is simply skipped (`pipeline/run.ts:94-97,103`).

## 5. Scene DSL — primitive union & templates (claude_pipeline.md §7-8)

- [x] Full 14-member primitive union, matches spec exactly (box/pill/tokenStrip/operator/meter/matrix/formula/container/cylinder/stack/axis/hill/object/text) — `types.ts:119-133`, mirrored in zod at `schema.ts:44-101` with every branch `.strict()`.
- [x] Elements never carry model-chosen coordinates — enforced at the schema boundary (`.strict()` on every variant rejects unknown keys like `x`/`y`); explicitly tested `schema.test.ts:38-44` ("rejects an element carrying pre-layout coordinates").
- [x] No invented primitive (e.g. a source-figure/crop primitive) can pass — `schema.test.ts:46-52` deliberately tries `prim: 'sourceFigure'` and asserts rejection, framed in the test itself as "falsifying evidence for the Claude hypothesis, not a feature to add."
- [x] All 12 templates implemented — `templates/definitions.ts:27-226` (`title_card`, `hub_spoke`, `chain`, `convergence`, `fan_out`, `list_icon`, `compare_2`, `threshold`, `weighted_blend`, `layered_stack`, `cycle`, `formula_focus`), registered in the `TEMPLATES` map (line 213-226).
- [x] All 12 templates layout-tested for safe-area, no-overlap, edge routing, occupancy sanity, determinism — `__tests__/templates.test.ts`; confirmed in the live test run: 5 properties × 12 templates = 60 passing assertions (`template title_card:...` through `template formula_focus:...` in the captured run output).
- [x] `≤9 elements`, `labels ≤4 words`, every element anchored — schema-enforced (`schema.ts:16-19,34,134`), not just a runtime warning.

## 6. Catalog resolution ladder (claude_pipeline.md §10-12)

- [x] Ladder logic itself (rung 2 exact/alias/semantic ≥τ_high → rung 3 ≥τ_mid+badge → rung 4 unconditional text fallback) — `catalog/ladder.ts:46-88`, exactly matches the spec's 3-rung + async-gap shape (async offline factory intentionally out of scope, correctly not claimed). Tested `catalog.test.ts:27-53` (rung 2/3/4 paths + badge composition all exercised).
- [x] Every `object` element is guaranteed a resolution, no unresolved placeholder is possible — `resolveScene.ts:8-14` doc comment + `catalog.test.ts:59-77` explicitly asserts this for a nonsense concept.
- [ ] Real catalog (Iconify/Streamline ingestion) — **MISSING**. `catalog/catalog.ts:1-147` is **18 hand-authored procedural entries** (`key, lock, treasure_chest, brain, robot, magnet, coil, leaf, sun, battery, gear, lightbulb, book, clock, cloud, person, scale, compass` — counted directly from the `CATALOG` array, lines 42-145), each a deterministic vector recipe built from the same path-math helpers as the renderer. The spec's own week-1 target is 300 objects (`01-ARCHITECTURE.md:209`) — current catalog is **~6% of the week-1 target, 0% real ingested assets**. No `@iconify/json`/`@iconify/utils` import exists anywhere in the tree (confirmed by grep).
- [ ] Real semantic embeddings for candidate ranking — **MISSING**. `catalog/ladder.ts:17-34` (`semanticScore`) is Jaccard token-overlap over `names/tags/meaning`, explicitly documented as a stand-in in the file's own header comment (`ladder.ts:8-12`) and in `catalog.ts:8-19`. No `@huggingface/transformers` import exists.
- [ ] τ_high/τ_mid calibration via E4 threshold sweep — **MISSING**. `ladder.ts:14` sets `TAU_HIGH=0.6, TAU_MID=0.3` with a comment admitting "No harness sweep (experiment E4) has been run this session — these are conservative starting points."
- [~] Normalizer (svgo/svgson cleanup, viewBox normalization, stroke/fill classification) — **PARTIAL**: `catalog/normalize.ts:26-35` validates path-count budgets and license allowlist (both real, tested `catalog.test.ts:9-25`) against the procedural catalog, but the actual SVG-ingestion cleanup pipeline (`svgo` cleanup, transform flattening, path classification of externally-sourced SVGs) described in `claude_pipeline.md §12` does not exist — there is nothing to normalize because there are no ingested SVGs. Two normalization lanes (`simple-symbol`/`rich-illustration`) do exist and are correctly distinguished (`catalog.ts:35-40`, tested `catalog.test.ts:20-25`).
- [x] Badge composition (rung 3 compose(base,badge)) — `catalog/badges.ts:11-21`, 13-glyph `Badge` union matches spec exactly (`types.ts:91`), tested `catalog.test.ts:39-45`.
- [x] License allowlist gate, blocks unlicensed assets — `catalog/normalize.ts:4,28`; `validation/gates.ts:41-43`; tested `catalog.test.ts:13-18`.

## 7. S8 — Layout (claude_pipeline.md §14)

- [x] Template → measured sizes → overlap push along primary axis → occupancy scale → edge routing, in that order — `layout/solver.ts:35-118`, matches the 8-step procedure in `01-ARCHITECTURE.md §6` closely (steps 1,2,3/4,5,6,7 present; step 8 "fail if overlap/safe-area remains" is enforced by the caller's gates, not inside the solver itself — see §9 below).
- [x] Overlap resolution only pushes pairs that actually overlap in the perpendicular axis (a real bug found and fixed this session per `docs/HANDOFF.md`, verified present in code) — `layout/geometry.ts:81-98`.
- [x] Occupancy-band scaling clamped to true available room from pivot to each rect edge (also a documented bug fix, verified present) — `layout/solver.ts:79-99`.
- [x] Carry-over pin to previous scene's exact bbox — `layout/solver.ts:62-68`, tested `timeline.test.ts` "carry-over pins to a supplied previous bbox."
- [x] Edge routing boundary-to-boundary (never centers), straight or single Manhattan bend around an obstacle — `layout/edges.ts:30-52`, tested `templates.test.ts` "connector routing produces boundary-to-boundary polylines, never zero-length" (12/12 templates).
- [~] ELK for large chain/convergence scenes (claude_pipeline.md §14 "ELK may be used") — **MISSING**, no `elkjs` dependency, no usage; acceptable since ELK was explicitly optional ("may be used only for larger... cases") and current goldens don't exceed elkjs's stated trigger size, but flagged since the plan pack names it as a spike (S-9) that was never run.
- [~] Real glyph-metric text measurement (opentype.js) — **MISSING**, `layout/measure.ts:1-16` uses a fixed character-width heuristic (`CHAR_W`), explicitly documented as a stand-in in its own header comment. Deterministic and monotonic (sufficient for the layout tests) but will mis-size proportional-width text.

## 8. S9 — Timeline compiler (claude_pipeline.md §15)

- [x] `revealStart = mentionTime - lead`, clamped to scene bounds — `timeline/compile.ts:53-65`, tested `timeline.test.ts` "reveal start = mention time - lead (clamped to scene start)."
- [x] `sceneStart` / `mention:*` / `after:*` anchor resolution, `after:*` resolves to the referenced element's **actual** (possibly delayed) end time — `compile.ts:62-65`, tested `timeline.test.ts` "after:<id> schedules relative to the referenced element's ACTUAL (possibly delayed) end time."
- [x] ≤2 simultaneous reveals via a 2-server greedy scheduler — `compile.ts:67-93`, tested `timeline.test.ts` "at most MAX_CONCURRENT_REVEALS reveals are active at any instant, even with 4 near-simultaneous mentions" AND enforced as a hard runtime gate in `validation/gates.ts:62-72`.
- [x] Idle-window emphasis insertion (`maxIdleMs`) and `focus[]` closing emphasis — `compile.ts:99-122` (`compileTimelineFull`).
- [x] Carry-over elements get a `hold` track, never re-reveal, never occupy a concurrency server — `compile.ts:44-51`, tested `timeline.test.ts` "carry-over elements get a full-scene hold event, not a reveal."
- [x] Reveal-mode-by-kind table (stroke dash-offset / fill fade / text wipe / meter grow / emphasis ring) — `timeline/compile.ts:6-15` (`primaryTrack`) + `render/renderScene.ts:56-84` implement all five modes from `01-ARCHITECTURE.md §7`'s table. Formula uses `wipe` (text-based), not a dedicated clip-mask-per-term reveal — acceptable simplification given formula itself is unrendered LaTeX (see §9 below).

## 9. S10 — Renderer (claude_pipeline.md §16)

- [x] `renderFrame(scene, timeline, t) → SVG` is a pure, deterministic function, no wall-clock/randomness — `render/renderScene.ts:32-100`; tested `renderer.test.ts` "roughness is 0 and primitive geometry is exactly reproducible," "export and live-player paths are literally the same pure function," and `e2e.test.ts:86-92` (byte-identical reruns of the whole pipeline).
- [x] Stroke draw-on (`stroke-dashoffset`), fill fade, text/formula left-to-right wipe, meter grow, emphasis ring — all implemented `renderScene.ts:56-84`, tested `renderer.test.ts` (mid-reveal partial dashoffset, scene-start/scene-end visibility).
- [x] Roughness = 0 by default, deterministic (no per-call jitter) — `style.ts:30`, tested `renderer.test.ts` "roughness is 0 and primitive geometry is exactly reproducible."
- [x] Text is XML-escaped, no raw markup passthrough (a real security property, not just style) — `render/renderScene.ts:3,11`; tested `renderer.test.ts` "text content is XML-escaped, never emitted as raw markup," and independently re-checked by `deterministicGates`'s `unsafe-svg` regex (`shared/evaluation.ts:19`).
- [ ] `@resvg/resvg-js` PNG rasterization — **MISSING**, no such dependency installed, no rasterization code anywhere.
- [ ] Live browser player (Mode B, `requestAnimationFrame` synced to `audio.currentTime`) — **MISSING**, no `player/` directory, no browser-side code exists in this tree at all.
- [~] `formula` primitive — **PARTIAL, materially short of spec**: `render/primitives.ts:94-100` renders the raw LaTeX source string as literal text inside a box, explicitly documented in its own comment as a simplification. No MathJax integration (`mathjax-full`, spike S-4) exists. This means `formula_focus` — one of the 12 templates and a claimed differentiator over Simi ("Math/formula depth" in `05-GEMINI-AUDIT...md:71`) — cannot actually typeset math today.

## 10. S11 — Encode (claude_pipeline.md §16 export mode / §19 outputs)

- [ ] **MISSING.** No `ffmpeg-static`/system-ffmpeg invocation anywhere in `v1_claude/`. `pipeline/run.ts:162-166,178-182` produces `contact-sheet.svg` (an SVG grid) instead of a PNG contact sheet, and never produces `video.mp4`, `.vtt` captions, or any audio mux. `__tests__/e2e.test.ts:62-84` explicitly asserts `video.mp4` is **absent** from the output directory rather than faking a placeholder — this is honest test design, but it confirms the gap is total, not partial.

## 11. S12 — QA gates (claude_pipeline.md §20, `03-VALIDATION-HARNESS.md §2`)

Deterministic gates, checked against the G1-G15 table in `03-VALIDATION-HARNESS.md`:

- [x] G1 schema validity — `schema.ts` + `validateSceneSpecStructure`; 16 tests in `schema.test.ts`.
- [x] G2 no unresolved placeholders — rung-4 unconditional resolve + `validation/gates.ts:38-40` hard-checks every `object` element has a `resolution`.
- [x] G3 overlap — `shared/evaluation.ts:13` + per-template tests (12/12 pass).
- [x] G4 safe area — `shared/evaluation.ts:11` + per-template tests (12/12 pass).
- [~] G5 occupancy [0.45, 0.75] — **PARTIAL**: `layout/solver.ts:74-100` actively scales content toward the band, but there is no dedicated pass/fail gate that checks final occupancy lands in-band and reports a failure/warning if the room-clamp prevented it from doing so (only `templates.test.ts`'s "occupancy is a finite, non-negative number" — a much weaker property than "in [0.45,0.75]").
- [x] G6 min font size (≥32px @1080p) — `validation/gates.ts:44-58`, with a documented, non-hidden spec-ambiguity carve-out for `note`-tier (28px) text downgraded to warning.
- [x] G7 palette compliance — enforced structurally by `PaletteTokenSchema` (fills can't be non-palette values) and fixed `STYLE.stroke.color`; not a separate runtime scan, but stronger (type-level) than the spec's runtime-gate framing.
- [x] G8 all anchors resolve — mention resolution is a hard pre-timeline failure (`resolveMentions.ts` + `pipeline/run.ts:77-79`); `after:*` cycle/dangling-target detection in `schema.ts:159-224`.
- [~] G9 idle ≤2500ms — **PARTIAL**: the timeline compiler proactively *inserts* emphasis on idle gaps (`compile.ts:109-119`) rather than there being an independent gate that verifies no >2500ms idle window remains afterward; no dedicated test asserts the post-insertion idle property.
- [x] G10 concurrency ≤2 — `validation/gates.ts:62-72`, hard failure; tested `timeline.test.ts`.
- [x] G11 A/V sync (±200ms) — `shared/evaluation.ts:18` (`av-sync`); tested `e2e.test.ts:42-46` (exact 30,000ms).
- [x] G12 element count [2,9] — schema hard-caps at 9 (`schema.ts:134`); `validation/gates.ts:74-76` warns below 2/above 9 as a second layer.
- [x] G13 label ≤4 words — `schema.ts:15-19`, hard schema rejection; tested `schema.test.ts:72-76`.
- [x] G14 license allowlist — `catalog/normalize.ts:4`, `validation/gates.ts:41-43`; tested `catalog.test.ts:13-18`.
- [ ] G15 cost ceiling — **MISSING/moot**: `usage.costUsd` is hard-coded to `0` in fixture mode (`pipeline/run.ts:158`, tested `e2e.test.ts:57` "fixture mode makes zero live calls, so cost must be exactly 0"). There is no code path that ever computes a non-zero cost, so a real cost-ceiling gate has never been exercised.
- [ ] Sampled VLM judge (J-semantic/J-style/J-clarity/J-simi, `03-VALIDATION-HARNESS.md §5`) — **MISSING** entirely. No judge code, no prompts, no image-hash caching, nothing.

## 12. `03-VALIDATION-HARNESS.md` — experiments and golden sets

- [ ] G-10/G-LONG/G-DOC/SIMI-REF golden sets — **MISSING/PARTIAL**. `shared/fixtures.ts:10-34` has exactly 4 golden case stubs (`transformer-attention`, `gradient-descent`, `photosynthesis`, `electromagnetic-induction`) plus 1 synthetic source-figure case — a small fraction of the spec's 10+4+5 goldens, and **only `transformer-attention` has a corresponding hand-authored SceneSpec** (the other 3 have `TeachingBeat[]` fixtures but no scenes to render — the CLI explicitly refuses them, `cli.ts:71-75`). No SIMI-REF keyframe set exists anywhere in the repo (no `harness/` directory at all).
- [ ] E1-E10 experiments — **MISSING**, none implemented. No `harness/` directory, no experiment runner, no report generator (`harness/reports/<date>.md` format from `03 §7` does not exist).
- [ ] C1-C6 "key experiments specific to Claude hypothesis" (`claude_pipeline.md §23`) — **MISSING**, none run; these require the missing Scene Planner (C2, C5 depend on planner output) and the missing Simi reference set (C1, C4) to even begin.
- [~] Failure taxonomy (F-ING..F-ENC) — **PARTIAL**: `StageFailure { code, stage, message, hard }` (`types.ts:286-291`) is a generic, extensible failure record and stage names loosely correspond (`'planner'`, `'align'`, `'resolve'`, `'layout'`, `'timeline'`, `'render'`), but the actual `F-XXX` codes from `03-VALIDATION-HARNESS.md §6` are never emitted verbatim — codes used are things like `'schema'`, `'dangling-id'`, `'unresolved-object'`, not `F-LIST`/`F-TPL`/`F-META`/`F-GAP` etc.

## 13. Explicit prohibitions (cross-cutting)

- [x] No pre-narration `VisualStoryIntent`-style stage silently adopted — confirmed: `pipeline/run.ts` builds `NarrationScript` first (from already-scripted `raw` text with markers) and only then runs alignment/resolve/layout; there is no separate "visual story" artifact anywhere in `types.ts` or the pipeline.
- [x] No open `VisualProgram` / model-chosen coordinates — `.strict()` zod schemas reject any coordinate field; explicitly tested (`schema.test.ts:38-44`).
- [x] No invented source-figure primitive — explicitly tested and rejected (`schema.test.ts:46-52`).
- [x] Default roughness zero — `style.ts:30`, tested (`renderer.test.ts`).
- [x] Max 9 scene elements — schema-enforced hard cap (`schema.ts:134`), not merely a soft convention.

---

## 14. Tally

Counting every checklist line above (60 total): **DONE 35, PARTIAL 13, MISSING 12.**

The DONE items are concentrated entirely in the deterministic, non-LLM core: mention parsing/resolution, schema
validation, all 12 templates + layout solver, the mention-anchored timeline compiler, the pure SVG renderer, and
most of the deterministic QA gate set. Every PARTIAL or MISSING item is concentrated in exactly the places the
codebase's own comments (`docs/HANDOFF.md`, inline headers) already flag: the Scene Planner, real TTS/alignment,
a real catalog, real math typesetting, and rasterization/encoding/judging. `docs/HANDOFF.md`'s self-reported gap
list was cross-checked line by line against the source and found accurate — it does not overstate completion.

---

## Required to reach a real live run with narrated audio and real video

Priority order to go from the current fixture-mode proof to an actual live run (strongest model Scene Planner +
real local TTS + real forced alignment + real MP4), based on what's missing above:

1. **Wire real TTS + forced alignment (S5).** `narration/align.ts` must be replaced with an actual TTS call
   (`voice-engine/`, unused today) producing real audio, plus either native word timestamps or a `stable-ts`/
   `whisperx` Python sidecar per `hypothesis/v1_claude/04` spike S-6. Everything downstream (mentions, timeline)
   already consumes the `AlignedAudio` shape correctly — this is a pure S5-internals swap, not a redesign.
2. **Implement the Scene Planner (S6).** Currently zero LLM calls exist anywhere. Needs: the prompt contract from
   `01-ARCHITECTURE.md §3.3` (narration+mentions, concept subgraph, top-k catalog candidates, template/slot defs,
   few-shots, hard rules), wired to `safeParseSceneSpec`, one repair call on validation failure, and a deterministic
   `list_icon`/`chain` fallback generator on second failure — none of the repair/fallback machinery exists yet
   because there has never been anything to repair.
3. **Install and wire `@resvg/resvg-js` + `ffmpeg-static`/system ffmpeg (S10/S11).** `renderSVG` already produces
   correct, deterministic per-frame SVG; the only missing piece is rasterizing frames to PNG and piping them to
   ffmpeg with the (now-real) audio track muxed in, per the `encode.ts` sketch in `02-IMPLEMENTATION-PLAN.md`.
   This is the most mechanically simple of the three and unblocks an actual `video.mp4` immediately once (1) and
   (3) both exist (audio to mux + frames to encode).
4. **Grow the catalog past 18 stand-in entries and add real semantic ranking.** Ingest a real Iconify/Streamline
   set (license-filtered per spike S-8) and replace the Jaccard-token `semanticScore` with local embeddings
   (`@huggingface/transformers`, spike S-10) so rung-2/3 resolution reflects real retrieval quality, then run
   experiment E4 to calibrate `τ_high`/`τ_mid` instead of the current unvalidated 0.6/0.3.
5. **Wire MathJax for the `formula` primitive** so `formula_focus` scenes typeset real math instead of raw LaTeX
   source text — currently the one template that is structurally present but functionally hollow.

Everything else (all 12 templates, the layout solver, the timeline compiler, the deterministic QA gate set, the
mention-marker contract) is already real, tested, and does not need rework to support a live run — only the five
items above stand between the current fixture-mode pipeline and an actual narrated MP4 from a live strong-model
planner.

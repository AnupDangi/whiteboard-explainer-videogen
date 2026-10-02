# RCA, semi-benchmark and long-form plan (2026-10-01)

Scope: answer the review of the fix9 videos against `final_plan/simi_teaching_methods/SIMI_TEACHING_BENCHMARK_CONTEXT.md` (re-read in full for §§1-16 and §28 on 2026-10-01), `final_plan/01-04`, and the single-shot rule (a prompt or a PDF link in, a finished video out, no pipeline change while it runs). Generated run artifacts under `.data/` and `output/` were read, never edited.

## 1. Direct answers

**Did the video come from the prompt alone, or from hard-coded elements?** From the prompt and source alone. Each run is one `lessonCli` call with a fixed instruction string; nothing was changed while a run was in progress. Evidence that no topic content is injected: `__tests__/anti-hardcoding-static.test.ts` scans production `.ts` for the benchmark topic names (passes), and every label, claim and relation in the scene specs traces to an evidence span. Two honest caveats:
- Data files are authored: `catalog/data/metaphors.v1.json` holds 84 reviewed concept-to-role/topology mappings (data, allowed by CLAUDE.md, but it is human curation).
- I tuned code between batches on the same eight sources (fix4 to fix9). That is the normal fix loop but it risks overfitting. Four sources the pipeline had never seen were therefore run afterwards (section 4). Result: 3 of 4 reached a draft video (acid-base failed on `board-role-misplaced`). The frozen 8-case held-out set in `final_plan/04 §11` was not touched.

**Is it generic and deterministic?** Stages S7-S12 are deterministic and content-addressed (same inputs, same bytes). The model stages (S1-S4, S6, director, judge) are not: the same source gave 3, 5, 2, 6, 6, 6 drafts out of 8 across six batches. Determinism of the model stages is not claimed.

**Does narration drive the visuals?** Mostly yes by construction: S4 writes narration with mention markers, S5 aligns audio, S9 schedules every reveal on the aligned mention time, and claim-coverage gates fail a scene whose claim is drawn late. Where it breaks (section 3, causes 5 and 6) the failure is a narration/concept mismatch, not a visual override.

**Are the visuals rich and is the asset library used?** No. Library use is poor (section 3, cause 1).

## 2. Measured state (every attempt reported)

| Measure | Result | Source |
|---|---|---|
| Lesson reached a draft video, same sources, last 3 batches | fix7 6/8, fix8 6/8, fix9 6/8 | `.data/goal-run/fix{7,8,9}-*` |
| Unseen sources (recursion, acid-base, printing press, law of large numbers) | 3/4 draft, 1 failed | `solo1-*`, `unseen1-*` |
| Scenes with a hard finding (lower bound) | 3 of 104 planned scenes; 2 of 24 lessons failed before any scene (S1-S4) | fix7-fix9 bundles |
| Concept nodes drawn as a real picture or diagram (new harness metric) | recursion 37%, acid-base 45%, law of large numbers 50%, printing press 70%; fix9 sources 12% (supply-demand) to 100% (vaccination), 51% overall | `auditCli` |
| Distinct pictures per 60 s video | 2 to 10 (Lamina reference: 5-9 per scene) | resolved scenes |
| Elements carried across scenes | 0 in every scene of every run | `carryOver` |
| Simi rubric (automated subset, out of 14, new stricter harness) | 8 to 11 on the four unseen runs | `auditCli` |
| Wall time, one run alone | 207 s for 62.7 s of media = 3.3x real time | `solo1-recursion` |
| Wall time, 8 runs sharing one laptop | 190 to 440 s (3x to 7x), contention inflated | fix9 manifests |
| LLM cost | $0.012 to $0.023 per produced minute | budget ledgers |

Wrong or weak bindings seen by eye (the judge sees only text): sports bottle for "water potential gradient", cupcake for "one eighth", ramp for "osmosis", presentation board for "production costs", infinity-clock for "recursive case", ladder for "recursive case", bag for "buyer response".

## 3. Root causes

1. **A labelled box never gets a picture attempt.** The planner chooses a form before any library lookup. A node marked `labelled` compiles to a box, and the per-scene icon validation only looked at object elements. Supply-demand: 13 of 17 concept nodes were boxes. Fixed in this round: `planner/pictureUpgrade.ts` offers boxes to the Depiction Director and strict judge and upgrades only approved ones (same id, anchor, evidence, concept links). Unmeasured live beyond the four unseen runs.
2. **Concepts are too abstract and compound for drawing.** S2 yields "Buyer demand response" or "Negative feedback" (definition: a paragraph). Benchmark §6 wants atomic, concrete things. The director now sees them but still picks one noun for a compound idea.
3. **No visual vocabulary for state over time.** Recursion's call stack, a search range shrinking, a distribution converging all need a stack, queue, tree, plot or state-sequence picture (benchmark §§28, 29, 30). The engine has icon+box+arrow, formula, array (new), geometry (new), plot (rarely chosen), molecule/reaction. `visualForm` offers only array, geometry, worked-example. Law of large numbers was drawn as boxes and a coin, not a converging line.
4. **No board continuity across scenes.** `carryOver` is 0 everywhere, so each scene is a fresh board. Benchmark §§4-5 want one board that grows and keeps positions. The old rubric gave stability 2/2 for this because nothing carried. The harness now scores concepts that recur in the next scene but sit elsewhere (0 of 2 on all four unseen runs).
5. **Claim concept mapped to a mention in a later sentence.** Thermostat fix8/fix9: the claim's concept is only marked in sentence 2, so its reveal can never finish by the end of sentence 1. Partly mitigated (S4 adds a marker, targets spoken after the claim are pruned); the S3 contract does not bind each claim concept to a mention inside its sentence.
6. **S6 repair exhaustion.** The model board fails on shape errors code can repair (most are now repaired) or on content the model cannot fix in two repairs; the deterministic fallback is valid but plain.
7. **Judge is text-only.** Wrong icons pass because nothing looks at the rendered picture next to its label.
8. **Layout.** Four of 18 templates carry 90% of scenes (section 6 gap 4); arrows cross on dense scenes; a scene with two nodes leaves most of the canvas empty (law of large numbers scene 2).
9. **Harness was optimistic** (fixed): picture share counted only object elements; stability was vacuous; stage durations were summed over parallel calls with no wall-time view.

## 4. Semi-benchmark

**Can it generate higher-quality videos?** Yes, measurably, but not CME-level. Same-source drafts went from 2/8 to 6/8 and from mostly boxes to about half pictures. The unseen runs show quality is topic dependent: concrete topics (printing press 70%) look good; algorithm and statistics topics (recursion 37%, law of large numbers 50%) do not because of cause 3.

**Does it choose appropriate icons from context?** Partly. The director (context-aware nouns), exact lookup, family lock, per-lesson and per-scene uniqueness and the loosened judge (checked on a 15-pair probe) keep most bindings sensible. About one in six bindings I looked at is wrong or weak, and there is no visual check (cause 7).

**Does it retain context?** In words, yes: the LessonBible fixes terminology, persistent concepts and prerequisites; recap scenes may restate earlier claims; pins keep one concept on one icon. In pictures, no (cause 4).

**Benchmark checklist (final-board reading of the fix9 and unseen sheets):**

| Benchmark section | Status |
|---|---|
| §3 narration works with video hidden | mostly met (S4 forbids narrating the drawing) |
| §4 progressive build, board incomplete at midpoint | met (rubric 2/2; 49% of reveals after midpoint) |
| §5 spatial stability | not met (cause 4) |
| §6 icon is vocabulary, wrong icon worse than none | partly met (cause 7) |
| §7 short text anchors | met (labels mostly 1-3 words) |
| §8 relationships by geometry | partly met (arrows and containers; verbs printed only for supports/excepts) |
| §9 claim changes the board | met in 100% of covered claims, fails where cause 5 applies |
| §11 closure hold | met (1.4 s hold, warned if frozen too long) |
| §12 mute test | partly met (pictures 37-70%) |
| §28 algorithm state over time | not met (cause 3) |
| §§17-22 mathematics, geometry before formalism | partly: stacked formulas and worked steps render; the geometry primitive exists but models rarely choose it |

## 5. Speed and execution-time tracking

Measured, one run alone (62.7 s of audio): S3 teaching plan 61 s, S5 TTS+alignment 49 s, S7 resolve 42 s, S6 planner 37 s (four scenes, concurrency 2), S8+S9 35 s, S11 encode 25 s, S2 20 s, S1 16 s, S4 13 s (parallel across scenes), director 10 s. Stages overlap, so the 207 s wall is less than the sum.

Tracking now exists: `harness/timingReport.ts`, printed by `auditCli` as `timing`: wall time, preparation time, per-stage-family summed work versus wall, bottleneck, real-time factor, cost per produced minute, and a note when runs shared the machine. Tested.

Proposed speed work, in order of expected gain:
1. S7 resolve 42 s: it re-embeds and ranks per scene. Batch all scenes' referents in one call, memoise across scenes, keep the catalog embedding matrix loaded.
2. S3 plan 61 s: the largest single model call. Move to a smaller structured draft (already two-phase) and cap reasoning effort.
3. S6 concurrency 2: raise to 4 and measure provider rate limits; boards do not depend on each other.
4. Start S6 as soon as S4 of that scene finishes, not after the whole script (scene-level pipelining).
5. S5: cache by text hash across runs; run alignment workers in parallel up to the CPU count.
6. S11: encode modules in parallel and concatenate; reuse rasterised static frames between reveals.
Target: real-time factor at or below 1.5 for a single run on this machine, measured with `timing`.

## 6. Long-form (5, 10, 30 minutes): limits and gaps

What exists: the syllabus and module path supports 60, 300, 600, 1800 and 3600 s (`plan/hierarchical.ts`: modules of 300 or 600 s, up to 48 concepts, bible, prerequisites, recall links). The only live long run on record is a 600 s source that produced a 261 s, 15-scene draft; 1800 s has never run live.

Gaps, with the number behind each:
1. **Reliability compounds.** At about 3% hard scenes and about 8% of lessons failing before any scene, a 30-minute lesson (about 100 scenes, 6 modules) succeeds in roughly 3% of attempts by my estimate. Needs: a guaranteed per-scene result (a degraded but valid board card, flagged, never a missing scene) and per-module retry from cache. Gates stay; the scene is recorded as degraded, not hidden.
2. **No board or story continuity** (cause 4). A 30-minute lesson of 100 independent boards cannot build a mental model. Needs: a concept-to-position map held across scenes of a module, carry-over of persistent concepts, and a visible "where we are" anchor.
3. **Context window of the planner.** Each S4 scene prompt carries the whole outline; at 100 scenes that grows without bound. Needs: rolling summary plus the previous and next scene only.
4. **Visual variety.** 18 templates exist, but across 52 laid-out scenes (fix9, unseen, solo) only four carry 90% of them: chain 15, formula_focus 14, compare_2 11, fan_out 8 (list, cycle, convergence, hub 1 each; the tree, timeline and rule recipes 0). 100 scenes would look repetitive; needs template diversity pressure in S3/S6, the new forms of cause 3, and per-lesson icon budgeting.
5. **Source sufficiency.** Thirty minutes needs a long, multi-source input; the sufficiency gate shortens the lesson when the source is thin (correct, but then 30 minutes is not produced). Multi-source retrieval exists (`rag-engine`) and is unmeasured at this size.
6. **Time and memory.** At 3.3x real time, 30 minutes is about 100 minutes of wall on this laptop before the speed work; one-process encode and raster memory are untested at that length.
7. **Cost.** $0.012-0.023 per minute is about $0.40-0.70 for 30 minutes before retries, against a $1.00 cap for 1800 s. Director and judge calls grow with scene count.
8. **Alignment calibration** still unmeasured (needs two human reviewers); drafts only until measured.

## 7. Plan (ordered; each item ships with a test and a live batch reported in full)

**P0 reliability (needed before any long run)**
- P0.1 Scene-level guarantee: a scene that cannot satisfy its gates after repair and fallback renders a degraded card (title, narration anchor labels) marked `degraded` in the lock; lesson status stays `draft`/`failed` honestly.
- P0.2 S6 `board-role-misplaced` and similar role/slot errors repaired in `repairRawBoard` (seen in acid-base).
- P0.3 S3 contract binds every claim concept to a mention in its own sentence; S4 validator checks it; then the reveal-timing failures (thermostat) cannot recur.

**P1 richness**
- P1.1 Measure the picture upgrade on 8+4 sources; report the share against the 51% baseline.
- P1.2 Vision binding check: one cheap vision call per scene on the rendered frame asks, per icon, "does this picture match this label?"; mismatches fall back to label (benchmark §6 hard rule).
- P1.3 New board forms with data-only schemas: stack/queue, tree, state sequence (benchmark §28), distribution or converging plot for statistics (§30); S3 `visualForm` extended and bound the same way as array and geometry.
- P1.4 Cross-scene board continuity: persistent concepts keep their position (carry-over), measured by the stability metric.
- P1.5 Arrow routing with fewer crossings; empty-canvas rebalancing for two-node scenes.

**P2 speed** (section 5, items 1-6; acceptance: real-time factor at or below 1.5 solo, measured by `timing`).

**P3 long-form** (section 6 gaps 1-7): 300 s then 600 s then 1800 s live runs, every attempt reported, starting only after P0 is green.

## 8. Changes made in this round (all tested; 936 Node, 28 alignment, 12 RAG)
- `planner/pictureUpgrade.ts` + `pipeline/runLive.ts`: boxes get a picture attempt.
- `harness/iconAudit.ts`, `harness/simiRubric.ts`: picture share over all concept nodes, distinct pictures, honest spatial-stability metric.
- `harness/timingReport.ts` + `harness/auditCli.ts`: execution-time report.
- New unseen probe sources `bench/probe/{recursion-call-stack,acid-base-neutralization,printing-press-spread,law-of-large-numbers}.md` (inputs only).
- Earlier in the day (fix4-fix9): see `docs/HANDOFF.md`.
Nothing committed.

## 9. Status update (same day, after the Transformer one-shots)

| Item | Status |
|---|---|
| P0.1 scene-level guarantee | best-effort mode (`--allow-partial-video`) now draws coverage-failed scenes as diagnostic previews; failure stays hard. A degraded-card fallback for scenes with no board is not built. |
| P0.2 role/slot repairs | built (fallback process slot, convergence without output becomes flow). |
| P0.3 claim concept bound to its sentence | partly: S4 now adds a marker for each concept a claim sentence names; the S3 contract does not yet bind it. |
| P1.1 picture upgrade | built, live on all runs since; share of pictures is topic dependent (architecture is mostly boxes by design). |
| P1.2 vision binding check | built and live (discovery and per-scene); removed the decorative pictures in the Transformer runs; role glyphs resolved late are not yet checked. |
| P1.3 new forms | built: `repeat` stacks (xN), grounded formula, stack render; tree, queue, state sequence and distribution plot are not. |
| P1.4 cross-scene continuity | not built. |
| P1.5 arrows / empty canvas | sparse-board widening built; arrow routing unchanged. |
| P2 speed | timing report built; icon prep ahead of audio, S6 concurrency 4. Not built: module-parallel S2/S3, one-pass lesson-wide icon prep, parallel encode. |
| P3 long-form | 300 s, 600 s and 1800 s one-shots all produced videos from a PDF link (30 minutes: 68 scenes, 1815.8 s, 1.17x real time, $0.2475, 1 hard finding). Reliability at 30 minutes is now measured by attempts, not estimated: 1 of 3 attempts reached a video, each failure was a generic shape error since fixed. |

Open gaps for "amazing": diagram figures that read as one connected architecture (inputs, encoder stack, decoder stack, output) rather than separate boxes; the attention equation built one transformation per beat (the formula form exists, the stepwise build does not); board continuity across scenes; module-parallel preparation for speed; calibration of alignment with two reviewers.

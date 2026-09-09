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

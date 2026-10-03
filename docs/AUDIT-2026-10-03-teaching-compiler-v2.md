# Teaching Compiler V2 — plan audit and ground truth (2026-10-03)

Audited: `docs/superpowers/plans/2026-10-02-teaching-compiler-v2.md` (P0–P17, gates, benchmarks) and
`docs/superpowers/specs/2026-09-26-board-schema-v2-design.md` (historical v1 board schema; V2 supersedes it, see §4).
Method: every claim below was checked against code, tests or a command run in this worktree, not copied from `HANDOFF.md`.
Status words follow CLAUDE.md: **implemented**, **tested**, **passed**, **failed**, **unmeasured**. Implementation alone is not a pass.

## 1. What is true right now

| Check | Result |
|---|---|
| `pnpm run typecheck:hypothesis` | clean |
| `pnpm run test:hypothesis` | Node tests, 2 retained-audit tests, 28 Python alignment tests, 12 Python RAG tests all pass (live counts in HANDOFF; counts change, do not copy them) |
| `pnpm audit` (root, `voice-engine`, Asset Lab) | no known vulnerabilities (a transitive `@xmldom/xmldom` range was overridden to `>=0.9.12`) |
| package manager | pnpm 10 only: pinned, `pnpm-lock.yaml` only, enforced by `pnpm-hygiene.test.ts`; the Asset Lab repo was converted too |
| paid V2 acceptance | **blocked, not failed**: ElevenLabs credits are spent (key 1: 9,999/10,000 until 2026-10-13; key 2: HTTP 401; key 3: 9,968/10,000 until 2026-11-02). Local-TTS runs are possible and are reported separately |

## 2. Phase-by-phase truth

| Phase | Plan requirement | Status | Evidence / what is missing |
|---|---|---|---|
| P0 | version flag, R10 not counted as drawn, baseline artifacts | implemented, tested | `run/featureFlags.ts`, `feature-flags.test.ts`, `r10-accounting.test.ts`; `baseline:verify` exits 0 (40 v1, 77 v2, 5 relocated records; 40 pruned `.data` items and 4 external references remain unverifiable; sets G-10/G-DOC/G-LONG missing). Same-lock 100% hash equality on a V1 lock: unmeasured |
| P1 | strict provider schemas, raw outputs kept, JSON-pointer repairs ≤2/unit, coercion ledger | implemented, tested | `structured/*`, `llm/structuredCall.ts`; tests `structured-call-strict`, `structured-recorder`, `json-pointer-repair`, `coercion-ledger`. Gate rates (first-try validity S3 ≥95%, S4 ≥98%, S6 ≥95%; 100% schema-constrained; 100% raw retained) are **unmeasured**: they need a cold grid |
| P2 | `TeachingBeatPlan` + exit criteria | implemented, tested | `teaching/beat-plan/*` (`validate.ts` enforces claim→beat, learnerDelta, representationFamily, visualInvariant, mutedMeaning, no dangling IDs); provider-generated reliability unmeasured |
| P3 | beat-addressable narration | implemented, tested | `narration/beat-narration/*`; orphan beats rejected in validation; word-count contract replaced by a measured duration gate |
| P4 | 15 BoardOps with opId/beatId/preconditions/postconditions | implemented, tested | all 15 op schemas exist (`add connect move transform replace remove highlight deemphasize strike updateValue split merge equationStep revealRegion clearRegion`); `board-ops/validate.ts`; serialized-operation conflicts: reducer rejects invalid edge/element mixes, a general conflict scheduler is not built |
| P5 | persistent board state, recursion fixture | implemented, tested | `board-state/*`; recursion push/pop sequence asserted in `board-state.test.ts` and `scene-layout.test.ts` |
| P6 | 12 mechanism kits, no topic renderers | implemented, tested | `visual-v2/kits/*` (12 kits in `KIT_NAMES`); topic-swap/anti-hardcoding tests in the suite |
| P7 | type-first resolver, offline VLM only | implemented, tested | `resolver/typeGate.ts`, `assets/ladder.ts` eligibility; this session widened the pool to ~24k icons with a domain preference and a similarity guard (`similarityAdmissible`). Runtime VLM asset checks are not part of V2 board resolution. "Wrong icon = 0 on golden fixtures" is **unmeasured** (no labelled golden icon suite) |
| P8 | illustrative evidence lane | implemented, tested | `provenance/ground.ts`, `verify.ts`, `illustrative-verify.test.ts` |
| P9 | layout V2: kits own geometry, compound graph layout, ink-aware validation | implemented, tested | deterministic compound graph layout (plan names ELK; a dependency-free deterministic layout was chosen). Added: near-parallel edge clearance, shared-endpoint fan-out, back-to-back pairs, kit-line-through-text, and deterministic quadratic obstacle detours pinned in the V2 lock and rendered along with their labels/arrowheads. General hand-drawn or loop-edge routing and the real-lesson geometry gate over 15 runs remain unmeasured. |
| P10 | semantic timeline with pause policies | implemented, tested | `visual-v2/timeline/compile.ts` (`micro 175`, `think 550`, `scene_close 700` ms), beat-end/scene-end lifecycle events |
| P11 | `lesson.lock.json` v2 with all sections, no model calls after lock | implemented, tested | `pipeline-v2/lockV2.ts`; replay x20 asserted offline on a synthetic lock; **generated-lesson** 20× replay unmeasured |
| P12 | event-driven RenderPlan with state hashing | implemented, tested | hold/transition segments with stateHash in the lock; hold frames rasterized once (`clipsV2.ts` reuses identical svg hashes) |
| P13 | warm renderer workers, worker count benchmarked | implemented; **throughput/RAM/CPU measured on one host; thermal unmeasured** | `export/rasterPool.ts` (bounded worker threads, default `min(8, cores-1)`, changed to the locally measured recommendation). `.data/benchmark-v2/p13-render-bench/2026-10-03-3x.json` measures 120 SVG frames ×3 at 1/2/4/8 workers on a 10-core/24-GB host. Median rates: 46.45/91.20/169.20/230.80 fps; max absolute RSS: 759/1,070/1,042/1,035 MB; recommended 8 workers. This raster-only run tolerated the source lock's Node and pipeline drift after all renderer, font, SVG, and other lock checks passed. Full playback/replay/export still reject that lock; macOS exposed no thermal sensor, so thermal throttling is unmeasured. Cross-host behavior is also unmeasured. |
| P14 | parallel scene preparation | **partly implemented this session** | audio for all scenes still runs before board planning (the fixed-duration gate needs every clock). Board planning is inherently sequential because the persistent board carries state scene to scene, so the plan's literal "parallel scenes" is not possible for boards; the achievable overlap is scene *publication* and *playback* while later scenes plan (see P16) |
| P15 | per-scene clips + ordered concat | implemented, tested | `pipeline-v2/clipsV2.ts` (clip cache keyed by scene frames, local retry, ordered join) |
| P16 | progressive playback | **implemented this session, verified in a real browser** | immutable per-scene locks, `readyPrefixV2`, live preview server, player adopts newer prefixes while playing. First-audible latency on a generated lesson: see §5 |
| P17 | renderer backend bake-off | deferred by design | gated on semantic parity; not started |
| §7 | Stage A/B performance ladder | unmeasured | needs a passing generated 60 s lesson (see §5) |
| §8–§15 | grounding, muted-board, sync, determinism, reliability, cost, Simi-behaviour benchmarks | harness code exists (`harness/*`, `scripts/v2-benchmark.mjs`); measurements unmeasured | fresh 15-trial cold grid, human muted review, rights review, 100-item alignment review, external benchmark adapter and sealed hold-out are all absent. `ABSOLUTE_QUALITY_CERTIFICATION=UNAVAILABLE` |

## 3. Defects found by this audit (not visible in any earlier report)

1. **The browser player has not loaded in a real browser since text measurement moved to resvg.** `client.js` statically imported `export/frame.js`, which pulls `layout/measure.js` and `@resvg/resvg-js` (Node-only). Unit tests never open the page, so every "player" test passed. Fixed: the V1 composer is imported lazily; `browser-player-module-graph.test.ts` fails if any statically reachable player module has a bare specifier. V1 playback in a browser stays unavailable (its text measurement is Node-only); the V2 locked player does not need it.
2. **The preview server pointed at a pre-flatten font path** (`/fonts/Kalam-Bold.ttf` returned 500). Fixed; an HTTP-level test pins the served font to `KALAM_FONT_SHA256`.
3. **`assets:sync` could not run** (pnpm invoked in an npm repo, wrong relative path); replaced by `scripts/assets-sync.mjs` (pnpm on both sides).
4. **Synthesis could not start**: ElevenLabs requires a captured capability snapshot and none existed. `pnpm run elevenlabs:capture` now captures it (read-only GETs; 9 speech models).
5. **13 audit advisories** (all one transitive package) are resolved by an override.
6. **Concurrent processes could overdraw an ElevenLabs key**: reservations were process-local. They are now shared through a lock-guarded file keyed by key *hash*, with dead-process and expiry release.
7. **S3 osmosis plan was cut off twice**: the initial response exhausted 7,710 completion tokens and its full-document repair exhausted 11,565 before either produced complete JSON. S3 now requests low reasoning effort on both calls, and its cache versions were bumped. Generic truncation recovery omits incomplete output rather than echoing it into the retry; an offline regression test proves a 100,000-character whitespace tail is omitted. Provider-level resolution remains unverified.

## 4. The board-schema v2 spec (2026-09-26)

That spec describes the v1-track `claude-board/v2` planner (S6 enums, `board-v1` prompt, sketchy icons). It is **historical**: the V2 compiler replaced the planner with BoardOps and the lock with `lesson.lock/v5-teaching-compiler-v2`. Its still-binding rules are all carried by the V2 code: no topic strings in runtime code, one icon family per scene, missing evidence stays a visible failure, a fallback can never pass. Its measurement section (five held-out sources, human verdict) is superseded by the V2 plan's §4 benchmark groups. Nothing in it is a remaining engineering task.

## 5. What cannot be completed from this checkout (needs credits, people, or custody)

- 5×3 cold grid with 15/15 artifacts and ≥14/15 release-passing; Stage A/B timing; cost per finished minute — needs paid provider runs; ElevenLabs credits are exhausted (local TTS is the only speech path until 2026-10-13).
- Human muted-board review (two reviewers), rights review, 100-item three-source alignment calibration — people.
- External benchmark adapter custody and the sealed hold-out — owner decision; the hold-out must stay unread until a release candidate.
- Absolute quality certification — depends on all of the above.

(Run evidence from this session is appended to `docs/HANDOFF.md`.)

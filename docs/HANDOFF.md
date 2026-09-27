# HANDOFF — Claude hypothesis track

## 2026-09-27 — Simi parity recovery plan adopted
- Plan: docs/superpowers/plans/2026-09-27-simi-parity-recovery.md (not plan-locked).
- User approvals (chat, 2026-09-27): "Whatever you feel is best do it make sure first phase cleanup what is not required before that commit and move ahead.but complete and understand my end goal plan for that." / "Keep human gate, ship draft (Recommended)" / "LLM picks from full catalog (Recommended)".
- Checkpoint commit c47631c holds Codex's uncommitted tree; baseline suite: `npm run typecheck:hypothesis` passed with 0 errors; `npm run test:hypothesis` — Node: 441 pass / 0 fail (441 tests total); Python: 21 tests OK + 12 tests OK (33 tests total, 0 failures). Full suite exit code 0.
- Status: all tasks unmeasured.

## Entry — 2026-09-26, board schema v2 + sketchy icons + model bake-off + parallel scenes: 5/5 Anthropic-topic videos

- Spec: `docs/superpowers/specs/2026-09-26-board-schema-v2-design.md` (approved in chat). Commits: 653bee0 (Phase 0 cleanup: 6,115 unreachable legacy lines removed, parse/RAG/voice engines kept; every model id now from `.env`, no code defaults), e9fdba8 (Assest-Library sketchy family: 462 ink+fill MIT icons, native colours, single registry file, per-library attribution), 1acb037 (S6 `claude-board/v2`: enum-constrained board, code-derived evidence/arrows/title), 35eeaf7/01a9b96/4e7fdac/2fca41f (OpenAI non-strict schema + stated limits, S3 token budget, evidence dedupe fix, catalog-wide icons, two-line labels, parallel S5/S6, board rule fixes). Assest-Library commits 2135293, 67e8166.
- Model bake-offs (paid, measured): S3 v5 on 5 held-out sources x2 — `openai/gpt-6-luna` 9/10 ($0.026 total), `deepseek/deepseek-v4.1-flash` 2/10, `google/gemini-3.8-flash` 0 runs (per-call max-price 404). S6 on constitutional-ai (6 scenes) — luna 6/6 valid boards, 0 fallbacks, $0.0051; gemini 1/6 (hidden reasoning used ~2.2k of 2.5k tokens and truncated JSON, ~$0.012/call). `.env`: `OPENROUTER_CONTENT_MODEL=openai/gpt-6-luna`, `OPENROUTER_SCENE_MODEL=openai/gpt-6-luna`.
- 5-topic run, all parallel, cold cache (`.data/hypothesis-runs/claude/timing-20260926-v2/`): constitutional-ai, rlhf, interpretability-features, next-token-prediction, red-teaming — 5/5 real MP4s, 26/29 scenes planned, 0 S6 fallbacks, $0.0093-$0.0135 per video, 188-256 s wall each (256 s for all five together). Status stays `failed`: every run carries the standing S5 gate (`alignment-calibration-unmeasured`, stable-ts zero-length words, captions derived from them); 3 scenes lost to `mention-missing-span`/`scene-context-invalid` (S5 mention alignment).
- Single lesson alone, cold (`timing-20260926-single`, red-teaming): 100 s for a 60 s video, $0.0079. Stage wall: S2 12.4 s, S3 19.1 s, S4 18.5 s, S5 16.3 s, S6 20.2 s (5 scenes in parallel; per scene 4-20 s), S11 12.9 s. Before this work the same kind of run took 221-282 s.
- Earlier diagnoses fixed in this entry: label-only boards (retrieval threshold + literal-only rule; board now picks any catalog icon incl. standard metaphors), Gemini HTTP 400 on a 462-value enum (icon is a plain string above 60 values, membership checked in code), cached S3 failure replayed after a request change (S3 stage version bumped), 11/32 S6 fallbacks from rule clashes (canonical label now code-owned, shared mentions allowed, function words allowed, S2 rejects self-relations).
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` 368 Node + 17 Python passed.
- Known visual defects: a concept can appear on two nodes of one board; consecutive scenes can repeat the same 2-3 concepts (S3 section overlap); no caption line yet.
- Next bounded work (latency, target <=60 s per 60 s video): (1) run S6 concurrently with S5 (board planning does not need word times; only the planning-context check does); (2) keep one aligner sidecar per run instead of a Python process per scene; (3) S11: reuse PNGs for identical consecutive frames; (4) stream each scene to the preview player as soon as its S4->S5->S6->render chain finishes; (5) reject duplicate concepts on one board.

## Entry — 2026-09-26, 5-domain single-attempt video test (real, no cache, no extra retries)

- User-requested test: 5 different-domain 60s lessons, **one real attempt each** (not the
  harnesses' usual 3 repeats), no `--stage-cache` (all prior caches invalidated by this session's
  version bumps anyway). The pipeline's own built-in single-repair-per-stage still applied
  normally — that's shipped behavior, not an extra retry. Real spend: $0.0247 total across 5 runs.
- **Result: 1/5 produced a real video.mp4. 4/5 failed at S3 (teaching-plan), repair included.**
  | domain | total time | result | stopped at |
  |---|---|---|---|
  | ocean-tides | 81s | failed | S3 (`plan-repair-failed`) |
  | bicycle-balance | 125s | failed | S3 (`plan-repair-failed`) |
  | composting | 96s | failed | S3 (`plan-repair-failed`) |
  | rainbow-formation | 186s | failed | S3 (`plan-repair-failed`) |
  | mirror-images | 350s | **video produced** | S5/S6 hard-failed by design; S1–S12 still completed |
- This is consistent with the measured harness numbers, not a new surprise: v5's conditional S3
  pass rate is 0.600 (Task-14-era reliability re-run), so ~2/5 single independent attempts
  passing S3 is within normal variance for that rate; landing at 1/5 is slightly below the
  measured rate on n=5, not evidence of a further regression.
- **The one video** (`.data/hypothesis-runs/claude/demo-5video-20260926/mirror-images/mirror-images-md/video.mp4`,
  1,127,715 bytes): verified with `ffprobe` — real h264 video + real aac audio, both exactly
  60.000s. Sent to the user directly (no hosting infrastructure in this session). Status is
  correctly `failed`, not `passed` — S5 hit `alignment-calibration-unmeasured` (the standing
  human-review gate) and 2 of its S6 scenes hit `planner-call-failed` (OpenRouter routing
  rejection for `anthropic/claude-sonnet-5`, the same live provider instability documented
  repeatedly this session) and fell back to deterministic layout; S1–S12 still ran to completion
  and produced a real, muxed MP4 rather than crashing.
- **Timing breakdown for the one completed run** (scenes vs audio, as requested): content
  generation S2+S3+S4 (concepts→plan→narration) 286s; audio S5 (TTS+alignment) 20s; scene
  planning S6 (2/2 attempted scenes fell back) 31s; render+encode S7–S12 13s.
- Nothing was mutated into a pass; every `failed` status is real and stage-attributed. No source,
  fixture, or gate was modified to make this test look better.
- **Next bounded work** (unchanged from the prior entry): the composting-shaped repair-relation-
  stranding pattern, OpenRouter routing availability for `anthropic/claude-sonnet-5` (external,
  still unresolved), and the user's S5 human review (still the only path to any `passed` status).

## Entry — 2026-09-26, S3 root-cause fix: v5-fully-worked-example adopted as default

- **Root cause** (systematic-debugging, Phase 1-4): the 2026-09-25 `reliability:run` measured
  S3's conditional pass rate at 0.231 (down from a prior 40% baseline), top failure
  `plan-repair-failed`. Traced to raw model output from a real failed attempt
  (`bicycle-balance-md`, saved at `.data/hypothesis-runs/claude/diagnostic-s6/bicycle-balance-zero/`):
  the model returned `lessonBible.terminology: []` and every section's
  `contract.requiredRelations: []`, on **both** the initial attempt and the repair, despite a
  real 6-entry `persistentConceptIds` list and 6 real graph relations. `v4-explicit-concepts`'s
  worked example never demonstrates `terminology` filled anywhere, and only shows the trivial
  2-concept/1-relation case for `requiredRelations` — real failing sections have 3-4 concepts
  and 2+ relations, a shape the model was never shown.
- **Fix**: new prompt variant `v5-fully-worked-example` in `plan/stages.ts` — byte-identical to
  v4's rules paragraph; only the worked example changed, to a full `lessonBible` (terminology
  filled) plus a 3-concept/2-relation section. Guarded by a new regression test,
  `__tests__/plan-prompt-v5.test.ts` (asserts the worked example text itself, not model behavior
  — the real measurement is the calibration harness).
- **Measured** (`plan:calibrate --variants=v4-explicit-concepts,v5-fully-worked-example --repeats=3`,
  same 5 held-out sources as the original v3→v4 calibration, real spend $0.0669 total): v4 7/15
  (47%), v5 8/15 (53%), v5 also cheaper ($0.0316 vs $0.0353) and fewer total failures (7 vs 8).
  Full data: `harness/reports/2026-09-25-plan-calibration.{json,md}`. This is a modest, noisy
  result on a small sample (one attempt's difference) — not a dramatic jump like v3→v4's
  0%→40%.
  **Per-source breakdown (do not read the aggregate alone — an earlier draft of this entry did,
  and it hid a real regression):**
  | source | v4 | v5 | note |
  |---|---|---|---|
  | ocean-tides | 1/3 | 1/3 | unchanged |
  | bicycle-balance | 1/3 | 1/3 | unchanged |
  | composting | **3/3** | **1/3** | **regressed** |
  | rainbow-formation | 1/3 | 3/3 | improved |
  | mirror-images | 1/3 | 2/3 | improved |
  The net +6pp is entirely driven by rainbow-formation and mirror-images improving while masking
  that composting — perfect under the outgoing v4 default — now fails 2 of 3 times under v5. If
  composting-shaped sources matter to you, v5 is currently worse for them, not better. This needs
  its own targeted look; it's logged here, not fixed.
  **Repair path, not just first-attempt rate**: the cited bicycle-balance root-cause sample
  already had `persistentConceptIds` populated, so `structuredCall`'s `validate` callback would
  have raised `PERSISTENT_CONCEPT_MISSING_TERMINOLOGY` on attempt 1 and fed that exact message
  into the repair prompt (`buildRepairPrompt`) for attempt 2 — and attempt 2 *still* returned
  `terminology: []`. So "root cause fixed" overstates it: v5 fixes the *cold first-attempt* rate
  by giving a better worked example, but on at least this sample, targeted per-field repair
  feedback was already given and the model didn't act on it. bicycle-balance stayed 1/3 in both
  variants — v5 did not fix the hard cases, only added more easy ones.
  Every failing attempt in both variants carried `repairs: 1` and real per-attempt spend, which
  rules out transport/network failure as the dominant cause of the harness's generic
  `S3_CALL_FAILED` code (a real diagnostic gap in `planCalibration.ts`: it doesn't surface which
  specific `ContractFinding` code was violated on an exhausted-repair failure, only on a
  first-attempt failure that still produced parseable JSON — worth tightening later).
  **Separate, pre-existing gap surfaced by this work**: `teachingContractFindings` only forces
  `persistentConceptIds`/`terminology` nonempty when a concept recurs across 2+ sections
  (`RECURRING_CONCEPT_NOT_DECLARED_PERSISTENT`); a plan with one concept per section and both
  arrays empty passes every `lessonBible` check silently (`LessonBibleSchema` has no `.min(1)`
  either). The exact failure mode this diff targets can recur completely undetected — no contract
  finding, no repair feedback — on any lesson where concepts don't repeat across sections. Not
  fixed here; flagged for a future targeted task.
- **Adopted**: `DEFAULT_PLAN_PROMPT_VARIANT = 'v5-fully-worked-example'`. Cache identity bumped
  (`S3-teaching-plan-v4-keyword-guard` → `...-v5-fully-worked-example`,
  `S3-teaching-plan-prompt-v4` → `...-prompt-v5`) so no warm cache can replay a stale v4 result.
  These two literals are hardcoded in `pipeline/lesson.ts` with no compile-time link to
  `PlanPromptVariant`/`DEFAULT_PLAN_PROMPT_VARIANT` in `plan/stages.ts` — a future variant swap
  that forgets to bump them would silently replay stale cached output. Not fixed in this pass;
  worth deriving automatically from the variant name later.
- Verification: `npm run typecheck:hypothesis` clean; `npm run test:hypothesis` passed 351 Node
  (350 prior + 1 new) + 17 Python.
- **Confirming `reliability:run` re-measurement** (same command/cap as Task 14 Step 1, real spend
  $0.0274): S2 0.333, **S3 (conditional) 0.600** (up from 0.231 pre-fix — the fix's target metric
  moved, confirmed), S4 (conditional) 0.667, end-to-end **0.133** (down from 0.200). The S3 fix
  worked on its own metric; end-to-end got worse this round because S2 hit heavy, unrelated
  transport-exhausted failures (`concepts-call-failed: 10` — OpenRouter routing/rate-limit
  rejections for qwen, zero completions produced, nothing to repair) — the same live provider
  instability documented throughout this project's history, not a regression from this change.
  Full data: `harness/reports/2026-09-25-reliability.{json,md}` (overwritten in place; the
  pre-fix numbers are preserved above in the Task 14 Step 1 entry below).
- **`/code-review` audit of this diff** (8-angle high-effort pass, all converged/verified): found
  the composting regression and the dropped repair-path nuance above (both fixed in this entry),
  plus a real efficiency issue (`buildV5FullyWorkedExamplePrompt` was building and discarding
  v4's entire `user` string, including a second full `JSON.stringify(graph)`, just to read
  `.system` — fixed below by extracting a shared `buildV4SystemPrompt` helper) and the
  cache-version hardcoding noted above. Minor findings (worked-example scaffold now duplicated
  3× across v3/v4/v5, a test mock duplicating an existing `okBody` helper, a regex-based
  relation-count check in the new test, this docstring duplicating this HANDOFF narrative) were
  logged but not fixed — deferred cleanup, not correctness issues.
- **Composting regression, root-caused** (fresh diagnostic run, `.data/hypothesis-runs/claude/debug-composting-v5/`,
  real spend, single attempt, v5 default): a **distinct, second failure pattern**, not the
  terminology bug. Attempt 1 had `learningDelta` mismatched against the section goal on all 4
  sections, plus 2 concepts (`microbe_requirements`, `thermophilic_stage`) recurring across
  sections without being declared in `persistentConceptIds`. The repair fixed all 4
  `learningDelta` mismatches — but in whatever reorganization it did to fix them, it **stranded 5
  relations** that were not flagged as problems in attempt 1 (`sec_1..4 omits source relation ...`,
  `lesson omits source relation ... from every SceneContract`), and still didn't declare either
  concept persistent. The model corrected one violation class while introducing a different one,
  rather than holding the full constraint set through the edit — consistent with "if you move a
  concept out of a section, move its relations with it" (already stated in the prompt) not being
  followed during a repair driven by a different error. Not fixed here — this is real evidence
  for a possible v6 candidate (a repair-specific reminder about relation-stranding when
  reorganizing sections), not something to prompt-engineer blind; would need its own
  `plan:calibrate` measurement.
- **Single-section contract-validation "gap" re-examined, not a bug**: on reflection, empty
  `terminology`/`persistentConceptIds` is the semantically correct state for a lesson where no
  concept recurs across scenes — the schema's own design ties `persistentConceptIds` to
  recurrence. `RECURRING_CONCEPT_NOT_DECLARED_PERSISTENT` already catches the case that matters
  (a concept recurs but isn't declared persistent). No fix applied; the earlier framing of this
  as a coverage gap overstated it.
- **Next bounded work**: measure a repair-specific relation-stranding reminder as a v6 candidate
  if composting-shaped sources keep failing; the provider-routing instability (external,
  unresolved all session); your S5 human review (still the hard blocker on any `passed` status).

## Entry — 2026-09-25, Task 14 Step 3: S6 prompt-arm calibration (paid, user-approved) — 0 valid scenes, real spend $0.00

- Ran `npm run scene:calibrate -- --runs=<ocean-tides,bicycle-balance,composting phase0-live dirs> --arms=zero,mechanism,diverse --repeats=2 --budget=1.00`. 14 scene items loaded from the three cached run directories (this harness reads `lesson-prep.json`/`narration.json`/`aligned-audio.json` directly, not through the version-gated stage-cache, so it did not hit the same cache-invalidation issue as Step 2). 84 total attempts (14 scenes × 2 repeats × 3 arms).
- **Result class `diagnostic-calibration`, all three arms: 0/28 valid, $0.0000 real spend each.** Full report: `harness/reports/2026-09-25-scene-calibration.{json,md}`. This is not a harness bug — the budget ledger recorded `spentUsd: 0`, `calls: 0`, `preflightFailures: 198`, `blocked: false`.
- **Root cause, confirmed from the raw failure codes (identical across all three arms — this is provider/data flakiness, not prompt-arm variance):**
  - **22/28 attempts per arm** (11 of 14 scenes × 2 repeats): `planner-call-failed` after `planner-transport-retry` exhausted its 2 retries. Every underlying rejection was `OpenRouter HTTP 404 — No endpoints found that satisfy the max price` for `anthropic/claude-sonnet-5`, region `KTM`. This is the exact, previously-documented, still-unresolved OpenRouter direct-routing availability issue from earlier sessions' HANDOFF entries (last seen: "7/8 semantic-rescue attempts failed the same way"). **It is still live today, and this plan's Task 1 fix (transport retries, no-charge classification) worked exactly as designed** — every one of these 198 preflight failures left the ledger unblocked and charged nothing — but it cannot fix OpenRouter's own upstream routing availability, which was never in this plan's scope.
  - **6/28 attempts per arm** (3 of 14 scenes × 2 repeats, all from `composting-60s-mixed3`: scenes `sec_2`, `sec_3`, `sec_5`): `scene-context-invalid` — `buildInput` threw before any provider call, meaning that source's cached S3/S5 artifacts don't cleanly satisfy `compileScenePlanningContext`'s contract for those three scenes. Not investigated further here (out of scope for Step 3); worth a look if `composting` is reused for calibration again.
- **No arm can be, and none was, compared or promoted** — there is no usable data to compare (0 valid scenes on every arm). Zero-shot remains the production default, unchanged, per Global Constraints and the plan's out-of-scope list.
- Nothing was mutated into a pass. Status vocabulary used: `unmeasured` for the calibration comparison itself (it could not run to a real comparison), `passed` only for "the harness executed and wrote its report without crashing."
- **Next bounded work, if S6 prompt-arm calibration is still wanted**: re-measure `anthropic/claude-sonnet-5` OpenRouter direct-routing availability independently before re-running this harness (a session-note action item that has recurred at least three times in this project's history and has not yet been fixed, since it's an upstream provider issue); separately, three of `composting`'s cached scenes have a `scene-context-invalid` data issue worth diagnosing if that source stays in the calibration set.

## Entry — 2026-09-25, Task 14 Step 2: diagnostic S6 attempts (paid, user-approved) — none reached S6

- Ran the three `run:lesson --plan-despite-alignment-failure --prompt-arm=zero --stage-cache=<phase0-live dir>` commands from the frozen HANDOFF instructions, for `ocean-tides`, `bicycle-balance`, `composting`. Total real spend: **$0.0161** ($0.0068 + $0.0042 + $0.0051), all well under the $0.30/lesson cap.
- **The `--stage-cache` reuse these commands assumed no longer applies**: every `stageRun.cacheHit` was `false`. This is expected, correct behavior, not a bug — Tasks 1–13 bumped S2/S3's cache-identity strings (`S2-concept-graph-v1` → `...v3-keyword-guard`, `S3-teaching-plan-v3-explicit-concepts` → `...v4-keyword-guard`, etc.) specifically so a warm cache from before those fixes can never silently replay a stale result (Global Constraint: "every cache-relevant behavior change bumps its version"). The old `phase0-live` caches predate all of Tasks 1–13 and are now correctly treated as stale.
- Each run therefore executed S1–S4 fresh instead of resuming from S5/S6 as the original Step 2 text assumed, and **all three hard-failed before ever reaching S5 or S6**:
  - `ocean-tides`: `script-repair-failed` at S4 (scene `sec_4`: 14→15 spoken words after repair, needs 16-36 for its 10s duration).
  - `bicycle-balance`: `plan-repair-failed` at S3 (persistent concepts missing terminology entries; several source relations never surfaced in any `SceneContract`).
  - `composting`: `plan-repair-failed` at S3 (two source relations never surfaced in any `SceneContract`; one S2 transport retry on a `429` absorbed cleanly with no ledger block, per Task 1).
- This lines up exactly with Task 14 Step 1's reliability measurement: none of these three sources reached `done` in that harness's 3 repeats either. **No diagnostic S6 SceneSpec exists yet for any of the three named sources** — Task 14 Step 2's original goal (a real, non-fallback S6 scene to inspect) is `unmeasured`, not `failed`-as-planned; the failure point moved earlier (S3/S4) than the plan anticipated (S5-alignment gate).
- Nothing was mutated into a pass; every run's `status` is `failed`, as required regardless of failure stage. No topic-specific branch, fixture, or threshold was touched to force progress.
- **Next bounded work, if S6 diagnosis is still wanted**: either (a) find or generate a fresh source that clears S1–S4 under the current, stricter code (the reliability run's `rainbow-formation` and `mirror-images` did reach `done` — those would be candidates), or (b) treat fixing the `plan-repair-failed`/`script-repair-failed` root causes (already the reliability harness's identified next task) as the prerequisite to ever seeing a real S6 scene for these three specific sources.

## Entry — 2026-09-25, Task 14 Step 1: S1–S4 reliability measurement (paid, user-approved)

- Ran `npm run reliability:run -- --durations=60 --repeats=3 --budget=1.00`, capped and approved in chat. Real spend: **$0.0663** of the $1.00 cap. Model `qwen/qwen3.8-flash`, cold (no cache), 5 sources × 3 repeats × 60s = 15 attempts.
- **Measured, not asserted**: S2 pass rate 0.867, S3 pass rate (conditional on reaching S3) 0.231, S4 pass rate (conditional on reaching S4) 1.000, end-to-end pass rate **0.200** (3/15 attempts reached `done`: one each for `rainbow-formation`, `mirror-images`; a third `mirror-images` attempt also passed). Full data in `harness/reports/2026-09-25-reliability.{json,md}`.
- Failure codes: `plan-repair-failed` × 10 (the dominant failure — S3 fails its one repair attempt), `concepts-repair-failed` × 2 (S2 fails its one repair attempt). No transport/provider-routing failures blocked the ledger (Task 1's fix holding up under live use — several attempts did hit and recover from `429` rate-limits via transport retry, at `preflightFailures` cost only, never spend).
- Baseline context: an earlier, narrower `plan:calibrate` harness (S3 only, replaying a cached S2 graph, `v4-explicit-concepts` prompt) measured 6/15 (40%) on a different held-out source set. This `reliability:run` result (0.231 conditional S3 pass rate within a full cold S1–S4 run) is not directly comparable — different methodology, different sources, and S2 failures here remove 2 of 15 attempts before S3 is ever reached — but both point at S3 (teaching-plan generation) as the weakest stage.
- Per the plan's own Task 14 Step 1 rule ("If the end-to-end rate is below 0.8, the top failure code becomes the next bounded task"): **next bounded task is `plan-repair-failed`** — S3's one-repair-attempt teaching-plan generation is not reliable enough end-to-end. This is a measurement only; no prompt or contract change was made in this step.

## Entry — 2026-09-25, Task 11: ingest and enable the user's AssetLab icon library

- **Source and mechanism:** the user's icon library is the "Asset Lab" curation repo (a separate GitHub project, 296 approved assets, MIT/ISC/Apache-2.0 licensed, with its own `ATTRIBUTION.md`). Its own `bridge-pipeline` export command produces output in exactly the `icon-library-manifest/v1` shape Task 9's ingest pipeline expects — it was purpose-built to hand off to this plan. The repo was cloned, `bridge-pipeline` was run, and the three license buckets were staged (copies only, never the user's original directory) at `.data/icon-libraries/assetlab-mit/`, `assetlab-isc/`, `assetlab-apache20/`, each with its own `manifest.json` (schema `icon-library-manifest/v1`, `license` field, `attribution` field reading `"Explain Canvas Asset Lab catalogue; upstream <SPDX> assets, see ATTRIBUTION.md"`) and an `svg/` directory. Verified before use: `assetlab-mit/manifest.json` license `MIT` / 214 svgs, `assetlab-isc/manifest.json` license `ISC` / 13 svgs, `assetlab-apache20/manifest.json` license `Apache-2.0` / 20 svgs. The `ATTRIBUTION.md` file itself that the manifests point to was not copied into the staged `.data/icon-libraries/*/` directories (only `manifest.json` + `svg/` are present); the attribution *text* is self-contained in the manifest and was carried through into each ingested catalog JSON's `attribution` field regardless, so no pipeline behavior depends on the missing file, but the file should be added to the staged directories (or their absence documented) before this is treated as fully closed.
- **Ingest results** (`npm run icons:ingest -- .data/icon-libraries/<id>`, reports at `catalog/data/<id>.ingest-report.json`):
  - `assetlab-mit`: **195 accepted, 19 rejected** — 3 `unknown-color` (non-dark stroke colors, e.g. `#FF6B5B`, `#FFFFFF`), 15 `no-ink` (no dark outline stroke to draw), 1 `bad-geometry` (stroke path with no measurable length). 19/214 = 8.9% rejected, well under the plan's 30% pre-flatten-amendment threshold — no `svgo`/`convertTransform` amendment needed or added.
  - `assetlab-isc`: **13 accepted, 0 rejected.**
  - `assetlab-apache20`: **0 accepted, 20 rejected**, all `no-ink` (every icon in this bucket has no dark outline stroke under the current parser, which only reads presentation attributes, not `style=`). This bucket contributes zero icons and was **not** registered anywhere.
  - Note: an earlier HANDOFF entry ("Task 14 documentation and continuation audit", Task 11 re-audit line, same date) recorded different counts for a prior state of these same staged directories (assetlab-mit 162/214 accepted with 36 unknown-color) and said the library was unconfirmed and disabled. That note is now stale/superseded: this entry reflects the manifests, SVGs, and ingest reports actually present on disk at the time of this entry (195/214 mit, 13/13 isc, 0/20 apache20), verified by reading `manifest.json`'s `license` field and each `.ingest-report.json` directly rather than trusted secondhand. The cause of the count difference between the two audits was not investigated (out of scope for this task); if it matters later, diff the two `manifest.json`/SVG snapshots.
- **Embed and enable (Step 4):** added to `ENABLED_LIBRARIES` in `src/experimental/hypothesis/v1_claude/catalog/registry.ts`, after Streamline:
  ```ts
  { libraryId: 'assetlab-mit', file: 'assetlab-mit.json', embeddings: 'assetlab-mit.emb.bin', house: false },
  { libraryId: 'assetlab-isc', file: 'assetlab-isc.json', embeddings: 'assetlab-isc.emb.bin', house: false },
  ```
  Mirrored the same two entries into the JS-literal library list in `scripts/embed-catalog.mjs` (which duplicates the registry ahead of `tsc`, per Task 10's existing pattern for the Streamline entry). `assetlab-apache20` was deliberately **not** added to either list — it has zero accepted entries, so there is nothing to register.
  `house: false` for both — the user has not confirmed either bucket should share Streamline's house style, and the plan's Task 11 Step 4 language defaults to `false` when unconfirmed. Revisit if the user confirms a shared house style later.
  Ran `npm run catalog:build`: `embedded 195 entries -> .../assetlab-mit.emb.bin (299520 bytes)` and `embedded 13 entries -> .../assetlab-isc.emb.bin (19968 bytes)` — row counts (195, 13) match the accepted-entry counts exactly (384-dim float32 rows: 195×384×4 = 299,520; 13×384×4 = 19,968). The same command deterministically re-wrote `streamline.json`/`streamline.emb.bin` with byte-identical output (no diff), confirming the rebuild is a no-op for the existing library.
- **Regression tests:** extended `src/experimental/hypothesis/v1_claude/__tests__/catalog-registry.test.ts`. Generalized the brief's single-library sample test to iterate over every non-Streamline library (`assetlab-mit`, `assetlab-isc`), asserting each is registered, `loadCatalogLibraries().entries` contains at least one entry whose `source` starts with `${libraryId}:`, and every one of those entries' `license` is in the allowlist (`MIT`, `ISC`, `Apache-2.0`, `CC0-1.0`, `CC-BY-4.0`). Two pre-existing tests in the same file hardcoded the old "Streamline is the only enabled library" assumption and needed updating as a direct, foreseeable consequence of adding two more entries to `ENABLED_LIBRARIES` (not a new defect): the house/registry-shape assertion now expects all three entries with their correct `house` flags, and the "multi-library load equals legacy Streamline load" test was rescoped to compare `loadCatalogLibraries()` filtered to just `streamline` against `loadStreamlineCatalog()` (the unfiltered comparison is no longer meaningful once other libraries are enabled by default). The version-stability test's temp-dir fixture now copies every enabled library's `file`/`embeddings` pair instead of hardcoding `streamline.*`, since `catalogVersion` hashes every entry in whatever library list it's given.
  Also fixed one unrelated pre-existing test that broke for a genuine, non-obvious reason: `catalog.test.ts`'s "a weak embedding candidate falls through to the text box" test used the concept `'chloroplast'` as a stand-in for "no catalog match exists" — but `assetlab-mit` happens to contain a real icon literally named `chloroplast`, so after enabling it that concept now gets an exact-name rung-2 match instead of falling through to rung 4. This is the ingest working as intended (a real icon now exists for a real word), not a bug; the test's probe concept was changed to a nonsense token (`'qzxjklp'`) that has no exact-name match in Streamline, the seed catalog, or either newly enabled library, preserving the test's original intent (weak embedding score alone should never win over a text fallback) without weakening any assertion.
- **Full offline gate:** `npm run typecheck:hypothesis` passed clean. `npm run test:hypothesis` passed **350/350** Node tests (0 failures) and 17/17 Python tests.
- **E3/E4 status: `unmeasured`.** 208 real icons (195 MIT + 13 ISC) are now loadable, licensed, embedded, and pass every structural/regression check — that is `implemented`, `tested`, and `passed`. Their visual normalization coherence (E3) and resolution-ladder threshold behavior (E4) against this specific new content have not been judged by any human or calibration harness; per the plan's own Task 11 Step 7 language, "the icons are available, but their visual quality has not been judged." Do not treat this ingest as evidence for E3/E4 until that measurement happens.
- **Not done / left open:** (1) the missing `ATTRIBUTION.md` file under each staged `.data/icon-libraries/assetlab-*/` directory (attribution text itself is safely embedded in each manifest and catalog JSON, so nothing currently depends on the file, but it should be copied over for completeness); (2) the count discrepancy against the prior "Task 11 re-audit" note, not investigated; (3) no house-style decision from the user — revisit `house: false` if asked to match Streamline's look; (4) `assetlab-apache20`'s 100% no-ink rejection rate suggests its source SVGs use `style=` attributes or a stroke color outside the parser's allowlist rather than being genuinely inkless — worth a follow-up look at the parser or the source SVGs if that bucket's 20 icons are wanted later, but out of scope for this task since the brief only requires enabling libraries with accepted entries.

## Entry — 2026-09-25, Task 14 documentation and continuation audit

- **Current checkpoint:** Tasks 0–13 are implemented and committed through `6ac1f67` (`Add S1-S4 reliability harness`). Task 14's evidence-ledger and architecture update is committed as `e0f39ea` (`Document hypothesis tasks and measurement gates`). The frozen plan remains locked. Final verification passed: `npm run typecheck:hypothesis && npm run test:hypothesis` — 349 Node tests and 17 Python tests, 0 failures.
- **Task 11 re-audit:** `.data/icon-libraries/` now contains manifests and SVGs for AssetLab MIT, ISC, and Apache-2.0 sets. Existing generated report/catalog files show assetlab-mit 162/214 accepted (36 unknown-color, 15 no-ink, 1 bad-geometry), assetlab-isc 13/13 accepted, and assetlab-apache20 0/20 accepted (all no-ink). Unknown-color affects 16.8% of the MIT input set, below the plan's 30% pre-flatten amendment threshold. These are workspace artifacts only: no source path, license, attribution, or house-style decision has been supplied by the user in chat for this run; each manifest points to an `ATTRIBUTION.md` that is absent. Therefore Task 11 stays `unmeasured`, these libraries remain disabled, and their untracked generated catalogs are not treated as validated/approved assets.
- **Task 14 paid work:** no Task 14 paid command has run and no spend was incurred (`$0.00`). Prepared sources and matching stage caches are present. Each command below requires explicit user approval under the frozen plan:

```bash
npm run reliability:run -- --durations=60 --repeats=3 --budget=1.00
npm run run:lesson -- --source=.data/sources/ocean-tides.md --duration=60 --plan-despite-alignment-failure --prompt-arm=zero --stage-cache=.data/hypothesis-runs/claude/phase0-live/ocean-tides-60s-mixed/stage-cache --out=.data/hypothesis-runs/claude/diagnostic-s6/ocean-tides-zero
npm run run:lesson -- --source=.data/sources/bicycle-balance.md --duration=60 --plan-despite-alignment-failure --prompt-arm=zero --stage-cache=.data/hypothesis-runs/claude/phase0-live/bicycle-balance-60s-mixed/stage-cache --out=.data/hypothesis-runs/claude/diagnostic-s6/bicycle-balance-zero
npm run run:lesson -- --source=.data/sources/composting.md --duration=60 --plan-despite-alignment-failure --prompt-arm=zero --stage-cache=.data/hypothesis-runs/claude/phase0-live/composting-60s-mixed3/stage-cache --out=.data/hypothesis-runs/claude/diagnostic-s6/composting-zero
npm run scene:calibrate -- --runs=.data/hypothesis-runs/claude/phase0-live/ocean-tides-60s-mixed,.data/hypothesis-runs/claude/phase0-live/bicycle-balance-60s-mixed,.data/hypothesis-runs/claude/phase0-live/composting-60s-mixed3 --arms=zero,mechanism,diverse --repeats=2 --budget=1.00
```

Caps: reliability $1.00, each diagnostic lesson $0.30, scene calibration $1.00. The diagnostic runs must retain failed S5 gates and must not be visually scored; calibration remains diagnostic and cannot promote an arm.
- **Documentation updated:** Task 6–14 implementation and measurement states are recorded in `hypothesis/v1_claude/02-IMPLEMENTATION-PLAN.md` and `03-VALIDATION-HARNESS.md`; `docs/ARCHITECTURE.md` now lists the Task 6–13 modules, cache behavior, and CLI commands. No Task 14 measurement is claimed.
- **Known gates:** S5 alignment calibration still requires two independent human reviewers. C6/E1/E5 remain `unmeasured`. Long-form 5/10-minute generation remains unimplemented; `maxConcepts` is capped at 14.
- **Next bounded work:** ask which, if any, of the listed paid invocations the user approves, and request the missing AssetLab source path, license evidence, attribution text, and house-style decision. After approval, run only the selected commands, record the measured results and actual spend, and commit the resulting reports and handoff update. No local Task 14 offline work remains.

## Historical initial continuation audit

## Entry — 2026-09-25, continuation audit and resume point

- The objective file confirms the requested continuation: finish the frozen 15-task plan, keep this handoff and the SDD progress ledger current after each task, and commit completed work so another coding agent can resume.
- The worktree is `hypothesis_claude` on branch `hypothesis_claude`. At the start of this continuation, Tasks 0–5 were present but uncommitted. The Task 6 module and test were absent.
- Task 5's approved `/v3/` → `/v4/` assertion change is already applied. The approval was recorded in `docs/superpowers/plans/2026-09-25-visual-richness-and-deterministic-generation.amendments.md`; this corrects the earlier Task 5 note below.
- Audit verification before Task 6: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed with 324 Node tests and 17 Python tests. The frozen plan SHA-256 still matches `plan-lock.json` and its file mode remains read-only.
- **Next bounded work:** Task 6 — deterministic scene-richness metrics. Tasks 7–14 remain after it. The two-reviewer S5 calibration gate remains required for publish claims; Task 11 depends on the user's icon library metadata; Task 14's paid invocations require individual approval.

## Entry — 2026-09-25, Task 6: deterministic scene-richness metrics

- **Why:** Prompt-arm comparisons need a deterministic structural diagnostic for visual richness. These counts describe scene structure only; they do not measure teaching clarity, visual quality, or Simi parity, and they are not E1/E5 evidence.
- **Implementation:** Added `harness/sceneRichness.ts` with `sceneRichness` and `summarizeRichness`. Per-scene metrics include element and primitive counts, object share, edge and factual-edge counts, list-scene classification, and resolved object counts by ladder rung. The summary reports scene means, list-scene rate, template/primitive diversity, and the fraction of resolved objects that use text fallback. Empty inputs return zeros.
- **Tests:** Added `__tests__/scene-richness.test.ts` for structure/rung counts, explicit and inferred list scenes, deterministic aggregates, and empty-input behavior. The first build failed as expected because the implementation module was absent; after implementation all four focused tests passed.
- **Verification:** `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-richness.test.js` passed (4/4); `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (**328 Node tests and 17 Python tests**, 0 failures).
- **Limitations:** These metrics are a diagnostic only. They do not establish generated lesson quality or permit E1/E5 scoring. No paid provider calls were made.
- **Next bounded work:** Task 7 — allow diagnostic S6 planning while the S5 alignment gate remains visibly failed.

## Entry — 2026-09-25, Task 7: diagnostic S6 opt-in with S5 failure preserved

- **Why:** S5 alignment remains uncalibrated and hard-fails, which normally skips paid S6 and leaves only a deterministic fallback. An explicit diagnostic opt-in now allows S6 to produce diagnostic SceneSpecs while preserving the original S5 failures and failed run status.
- **Implementation:** Exported `shouldSkipPaidPlanning` and wired it through `LiveRunContext`, `runLive.ts`, and `lessonCli.ts`. `--plan-despite-alignment-failure` is recorded in the CLI summary, S6 cache input, run ID, config hash, and run manifest prompt-experiment record. Opted-in runs with hard S5 failures record soft `planner-ran-on-uncalibrated-alignment`; the S5 hard failures remain untouched and continue to block publish.
- **Tests:** Added `__tests__/diagnostic-planning.test.ts`: default behavior skips S6 on hard alignment failure; explicit opt-in allows it; clean alignment and hand-authored SceneSpecs do not skip.
- **Verification:** Test-first build failed as expected because `shouldSkipPaidPlanning` was not exported. After implementation, `npm run build && node --test dist/src/experimental/hypothesis/v1_claude/__tests__/diagnostic-planning.test.js` passed (3/3); `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (**331 Node tests and 17 Python tests**, 0 failures). Existing `publish-status.test.ts` passed unchanged. No paid provider calls were made.
- **Checkpoint:** Tasks 0–6 and the corrected Task 5 handoff were committed as `56ccc20` (`Implement hypothesis track tasks 0-6`).
- **Next bounded work:** Task 8 — S6 calibration harness over cached S1–S5 artifacts. Paid calibration invocations remain separately gated by the plan's per-run approval requirement.

## Entry — 2026-09-25, Task 8: S6 prompt-arm diagnostic calibration harness

- **Why:** S6 prompt changes need measured planner validity, gate failures, richness, and cost across arms, using cached S1–S5 inputs. The report is explicitly diagnostic calibration and cannot count as E5 evidence while S5 alignment is uncalibrated and no timed video is reviewed.
- **Implementation:** Extracted `buildPlannerSceneInput` and made `runLive` use it, preserving the existing planner input (verified by existing source-scene planner and E2E tests). Added `sceneCalibration.ts` to build items from run-directory preparation, narration, and aligned-audio artifacts, run prompt arms/repeats with `fallback: false`, and report validity, failure codes, repairs, cost, scene richness, and per-arm totals. Added `sceneCalibrationCli.ts` with run/arm/repeat/model/budget parsing, a persistent ledger capped at $1.00, and JSON/Markdown output whose first line labels the report `diagnostic-calibration`. Added `npm run scene:calibrate`.
- **Tests:** Added `__tests__/scene-calibration.test.ts`. A stubbed provider verifies valid-rate/richness/cost aggregation; an invalid first reply plus failed repair is recorded invalid with no fallback and `planner-repair-failed`.
- **Verification:** The initial build failed as expected because `sceneCalibration.ts` was missing. Focused tests passed (2/2); `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (**333 Node tests and 17 Python tests**, 0 failures), including existing source-scene planner and E2E tests unchanged. No paid provider request or calibration measurement was run.
- **Checkpoints:** Initial Tasks 0–6 checkpoint: `56ccc20`. Task 7 checkpoint: `f711aaf`.
- **Next bounded work:** Task 9 — pure, deterministic SVG icon-library ingest. The paid scene-calibration command remains unmeasured until its Task 14 invocation is approved.

## Entry — 2026-09-25, Task 9: deterministic SVG icon-library ingest

- **Why:** A user-provided library can be ingested through a stable manifest contract, normalized into the renderer's raw icon format, and reported one file at a time when an SVG is outside the supported subset.
- **Implementation:** Added `catalog/libraryIngest.ts` with the Task 9 manifest/catalog interfaces and `MAX_ICON_PATHS = 40`. Supported shape geometry is normalized to paths; strokes receive measured lengths, fills map to `main`/`white`/`ink`, entries are sorted, and each entry receives a content hash. The whole library fails on an unallowlisted license; individual unsupported files carry a rejection reason. Added `scripts/ingest-icon-library.mjs` and `npm run icons:ingest`. The CLI resolves symlinks and rejects manifest paths that escape the library root. Its ingest report states that inline SVG `style` attributes are not parsed.
- **Manifest contract for Task 11:** `manifest.json` uses `schemaVersion: "icon-library-manifest/v1"` and provides `libraryId`, `version`, SPDX `license`, attribution text, and `icons` with relative SVG `file`, one or more `names`, and optional tags/meaning/category. License must be one of `MIT`, `ISC`, `Apache-2.0`, `CC0-1.0`, `CC-BY-4.0`, or `manual`. SVGs need a numeric `viewBox`, supported presentation attributes, an ink stroke, and no transforms, references, gradients, patterns, or more than 40 normalized paths. Inline `style` attributes are unsupported.
- **Tests:** Added `__tests__/library-ingest.test.ts` (6 tests) for stroke conversion, duotone roles, isolated rejections, manifest-order-independent bytes, license rejection, and the 40-path limit.
- **Verification:** Initial build failed as expected because the module was absent. Then all six focused tests passed; `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (**339 Node tests and 17 Python tests**, 0 failures); `node --check scripts/ingest-icon-library.mjs` passed. No user library was available, so only synthetic SVGs were ingested. No paid calls were made.
- **Checkpoints:** Task 7 `f711aaf`; Task 8 `b6bc761`.
- **Next bounded work:** Task 10 — multi-library registry and catalog-version hashing. Task 11 remains `unmeasured` until the user supplies a directory, license, and attribution.

## Entry — 2026-09-25, Task 10: multi-library catalog registry and content version

- **Why:** Retrieval, house-style preference, and artifact cache keys need to track every enabled catalog and embedding matrix.
- **Implementation:** Added `catalog/registry.ts` with a Streamline-only house-style registry and `catalogVersion()` hashing each enabled JSON catalog and embedding file. `streamline.ts` now loads v1/v2 library catalogs in registry order, returns per-library attributions, memoizes by library list, and keeps `loadStreamlineCatalog()` behavior. `semantic.ts` combines enabled libraries and their Float32 matrices in the same order; `ladder.ts` now uses registry house prefixes. The embedding script loops over its registry mirror. `runLive.ts` and `sceneCalibration.ts` use the dynamic catalog version. Run IDs, config hashes, S6/S7 cache metadata, and scene context include the version, so an asset or embedding change invalidates the associated work.
- **Tests:** Added `__tests__/catalog-registry.test.ts` for the default registry and legacy parity, house source classification, stable version hashes, and an embedding-byte change invalidating the version.
- **Verification:** Initial build failed as expected because `catalog/registry.ts` was absent. All 3 focused tests passed; `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (**342 Node tests and 17 Python tests**, 0 failures), including catalog, Streamline, and semantic-loader tests unchanged. `node --check scripts/embed-catalog.mjs` passed. Embeddings were not regenerated; Streamline remains the only enabled library, so its existing matrix is reused.
- **Next bounded work:** Task 11 — ingest a user-supplied icon library if its path, license, and attribution are available; otherwise record it as `unmeasured` and continue to Task 12. The old fixed `streamline-catalog-v1` cache version is retired.

## Entry — 2026-09-25, Task 11: user icon library input absent

- **Status:** `unmeasured`, per the frozen plan's missing-input rule.
- **Required input:** a directory path, SPDX license, and attribution text supplied by the user. None is present in the continuation request or objective file, so no external directory was inspected and no library was copied, ingested, embedded, or enabled.
- **When supplied:** copy assets and any generated manifest only under `.data/icon-libraries/<libraryId>/`; retain the original library untouched. The manifest contract and accepted license list are recorded in the Task 9 entry above. Rejection counts/reasons and whether the library should share house style must be recorded before enabling it. E3/E4 and visual quality remain unmeasured.
- **Next bounded work:** Task 12 — deterministic icon selection using cached query embeddings and lesson-level pins. It does not depend on a user library and can proceed with the Streamline catalog.

## Entry — 2026-09-25, Task 12: deterministic query vectors and lesson icon pins

- **Why:** Repeated query embedding inference could drift across runs, and paraphrased concept labels could resolve to different assets in one lesson. A persisted query cache and concept-identity pins address both.
- **Implementation:** Added `QueryEmbeddingCache`, keyed by embedding model and normalized text, with sorted JSON serialization and atomic flush. `rankConcepts` embeds only missing vectors and accepts the cache; `EMBEDDING_MODEL` is exported. `iconPins.ts` keys by sorted concept IDs (or normalized concept text), collects first rung 2/3 resolutions without mutation or overwrite, and ignores rung 4 text fallbacks. `resolveObject` honors valid pins and chooses exact matches by asset ID order. `resolveScene` accepts pins. `runLive` shares one query cache under the stage-cache root (or output directory), flushes after S6/S7 processing, carries pins through scenes, and includes sorted pin entries in the S7 cache input. Resolve stage version is now `resvg-text-metrics-bundled-kalam-5-icon-pins`.
- **Tests:** Added `__tests__/icon-determinism.test.ts` (5 tests) for pin keys, cross-scene consistency, no overwrite/no rung-4 pins, catalog-order independence, and cache round-trip/model separation.
- **Verification:** Focused tests passed (5/5); `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (**347 Node tests and 17 Python tests**, 0 failures). Existing E2E suite passed twice (8/8 each), including byte-identical replay assertions. Search found no test pinning the old resolve-version literal. No paid calls were made.
- **Next bounded work:** Task 13 — S1–S4 cold reliability harness. Task 11 remains `unmeasured` until the user provides the library directory, license, and attribution. S5 calibration and E1/E5 visual acceptance remain separate unmeasured gates.

## Entry — 2026-09-25, Task 13: cold S1–S4 reliability harness

- **Why:** Reliability needs stage-conditional pass rates and failure-code counts over repeated, cold source-preparation runs. This harness measures existing behavior without changing pass contracts.
- **Implementation:** Added `harness/reliability.ts` with cold `prepareLesson` attempts, conditional S2/S3/S4 rates, end-to-end rate, failure codes, transport retries, evidence-anchor markers, cost, and duration. Added `harness/reliabilityCli.ts`, which parses sources/durations/repeats/model/budget (maximum $1.00), creates a dated persistent ledger, and writes JSON plus a Markdown stage table and failure codes by count. Durations above 60 seconds are allowed and labeled as unimplemented long-form diagnostics. Added `npm run reliability:run`.
- **Tests:** Added `__tests__/reliability-harness.test.ts` for conditional stage rates, code counts, total cost, and empty reports.
- **Verification:** Initial build failed as expected because the reliability module was absent. Focused tests passed (2/2); `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (**349 Node tests and 17 Python tests**, 0 failures). No provider calls or paid measurements were run.
- **Next bounded work:** Task 14 — update architecture and evidence ledgers, record paid measurements only after per-command approval, leave unapproved runs `unmeasured`, then run the final offline gate. Task 11 remains `unmeasured`; C6/E1/E5 and S5 calibration remain unmeasured.

## Entry — 2026-09-25, Task 5: few-shot exemplar bank v2 (template-complete, icon-rich)

- **Why:** Bank v1 had 5 exemplars, all boxes-only; the planner had never seen an `object` icon, `plot`, `formula`, `meter`, `tokenStrip`, `operator`, cycle, hub, fan-out, list, stack, or title demonstration in a few-shot example. Bank v2 keeps v1 unchanged and adds 10 structural demonstrations so the combined bank covers all 13 `TemplateId`s.
- **`fewshots/exampleBank.v2.ts` (new):** implemented byte-for-byte as given in the task-5 brief — `BANK_V2_ADDITIONS` (10 hand-authored `SceneExemplar`s: `title-library-01`, `hub-rocket-01`, `chain-delivery-02`, `converge-kitchen-01`, `fanout-newsletter-01`, `list-homesafety-01`, `stack-storage-01`, `cycle-battery-01`, `formula-speed-01`, `plot-cooling-01`) plus `SCENE_EXEMPLARS = [...BANK_V1, ...BANK_V2_ADDITIONS]` (15 entries total). One data fix was required (see below); no other entry needed changes.
- **Concept-name fix:** `list-homesafety-01`'s `locked` element originally used `concept: 'key'` (a literal, catalog-exact Streamline name — it resolves at rung 2 and is not a validator rejection). It was rejected instead by the bank's own disjointness test, because the word "key" collides with the G-10/calibration topic-word list (`TOPIC_WORDS` matches `\bkeys?\b`, presumably reserved for an attention/query-key golden topic). Swapped to `concept: 'padlock square'` — also an exact Streamline catalog name (confirmed via `node -e "...streamline.json...entries.map(e=>e.name)..."`), still literally depicts a padlock for the "LOCK UP" habit, and does not match any topic word. No validator, template, or teaching mechanism was touched.
- **`planner/exemplars.ts`:** both `import`/`export` lines now point at `../fewshots/exampleBank.v2.js`; `EXAMPLE_BANK_VERSION` bumped `'mechanism-bank/v3'` → `'mechanism-bank/v4'`.
- **Tests (`__tests__/exemplar-bank-v2.test.ts`, new, 5 tests, written exactly as given in the brief):** bank v4 covers every template; bank v4 contains `object`/`plot`/`formula`/`meter`/`tokenStrip`/`operator` primitives; every `object` exemplar's `concept` is an exact Streamline catalog name and resolves at `resolveObject(...).resolution.rung === 2` (i.e., rung 2, no embedding fallback); bank v4 text is disjoint from golden/calibration topic words; no bank v4 entry is promoted (`reviewStatus === 'experimental'`, every `review[*]` is `'pending'` or `undefined`).
- **Status of all 15 entries (5 v1 + 10 v2):** every entry — `reviewStatus: 'experimental'`, all five `review` fields `'pending'`, `qualityScore: 0`. None is promoted/approved. Retrieval (`selectExemplars`) is unaffected in kind — `arm: 'zero'` (the default evaluation arm) still returns zero exemplars; only `'text' | 'mechanism' | 'diverse'` arms retrieve from the bank, and they now have 10 additional templates/primitives to draw from. **Zero-shot remains the default arm for all measured runs.**
- **Approved plan amendment:** the Task 5 change from `mechanism-bank/v3` to `mechanism-bank/v4` required the existing test assertion to move from `/v3/` to `/v4/`. The user approved this in chat on 2026-09-25 (“Yes, update it (recommended)”); the scoped test change is applied and recorded in the amendment file. No other existing assertion was changed.
- **Verification:** `npm run build` succeeded; all 5 new exemplar-bank tests passed; `npm run typecheck:hypothesis` passed. The continuation audit then ran `npm run test:hypothesis`: **324 Node tests and 17 Python tests passed, 0 failures**.
- **Next bounded work:** Task 6 of the 15-task plan. The S5 human word-boundary review remains the separate blocker to a measured `calibration.v2.json`.

## Entry — 2026-09-25, Task 4: S6 prompt v13 with visual recipe cards

- **Why:** The S6 prompt lists slot names but never says what each template teaches, which primitive suits which slot, or how icons carry a mechanism. Recipe cards give topic-neutral composition guidance per template; they contain no topic words.
- **`planner/recipes.ts` (new):** `RECIPE_VERSION = 'visual-recipes/v1'`, `RECIPE_CARDS: Record<TemplateId, { useWhen; build; avoid }>` with exactly one card per template (all 13, matching `TEMPLATE_SLOTS`/`TemplateId`), and `recipeSectionBody()` which renders each card as one bullet line plus a trailing icon-preference sentence. Implemented byte-for-byte as given in the task brief.
- **`planner/prompt.ts` wiring:** imported `recipeSectionBody`; inserted `{ id: 'recipes', title: 'Visual recipes', body: recipeSectionBody() }` directly after the `templates` section in `buildSystemPromptSections`. In `buildUserPrompt`, kept the existing top-5 candidate list per mention and added one line under the mention list — `Icon rule: use an object icon only when its name literally depicts the mention; otherwise use a box, pill, or text.` — only when at least one mention in the scene has a nonempty candidate list.
- **`planner/context.ts`:** bumped `SCENE_PROMPT_VERSION` from `'scene-planner-prompt-v12'` to `'scene-planner-prompt-v13'`; imported `RECIPE_VERSION` and added `recipes: RECIPE_VERSION` to the `versions` object type and its constructed value. `grep`-confirmed no other file hardcodes the literal `scene-planner-prompt-v12` string, so no plan-amendment report was needed.
- **Tests (`__tests__/scene-recipes.test.ts`, new, 4 tests):** every template has a recipe card; recipe cards are topic-neutral against a word list drawn from G-10 golden topics and the five calibration sources; the v13 system prompt contains `## Visual recipes` and `recipeSectionBody()` verbatim, and the version constants read v13/v1 as expected; and (the brief's prose-described 4th test) `compileScenePlanningContext` on a copied synthetic fixture (same heat/pressure contract, bible, and scene input as `__tests__/scene-context.test.ts` — its fixture builders are not exported, so the literal values were copied rather than imported) reports `versions.prompt === 'scene-planner-prompt-v13'` and `versions.recipes === 'visual-recipes/v1'`, and its `contextHash` differs from a hash recomputed with `versions.prompt` swapped back to v12, replaying `compileScenePlanningContext`'s exact `payload`/`sha256(stableJson(...))` shape (including `examples.map(exemplarContextRecord)`, read from `planner/context.ts` to match precisely).
- **The one permitted cross-task test edit** (pre-authorized by the task-4 brief, not improvised): in `__tests__/prompt-builder.test.ts`, replaced only the test named `'S6 v12 zero-shot system prompt is byte-identical after the builder refactor'` with `'v13 differs from the recorded v12 prompt only by the added recipe section'`, which strips `\n\n## Visual recipes\n${recipeSectionBody()}` back out of the v13 prompt and compares the SHA-256 of the remainder against the same recorded `V12_ZERO_SHOT_SYSTEM_SHA256` constant (unchanged, still `fde58f61f17098ba19ef000a68022fd5201fe08a6b4041f05f7d6dd91ac84dfa`). No other test in that file, and no test in any other file, was touched.
- **Verification:** `npm run build` succeeded. `node --test dist/.../scene-recipes.test.js dist/.../prompt-builder.test.js` — 10/10 passed (4 new + 6 pre-existing in `prompt-builder.test.ts`, one edited as above). `npm run typecheck:hypothesis` passed with no errors. `npm run test:hypothesis` passed — **319 Node tests** (315 prior + 4 new) and **17 Python tests**, 0 failures. No frozen plan, golden, or fixture file was touched; no lesson-topic branch was added — `RECIPE_CARDS` keys are `TemplateId`s only.
- **Next bounded work:** unchanged — the S5 human word-boundary review remains the structurally non-automatable blocker to a measured `calibration.v2.json`. This task (S6 prompt content, Task 4 of 15) does not touch that path; Task 5 continues the 15-task plan.

## Entry — 2026-09-25, Task 3: prompt builder and schema-keyword guard

- **Why:** S6 assembled its system prompt as one template string, so sections could not be hashed, reordered, or measured independently. The `mirror-images` failure (prior session) showed a model emitting `type`, `required`, and `relations` as concept IDs — the JSON-Schema field names of our own structured-output contract had leaked into the data the model was asked to produce.
- **`prompt/builder.ts` (new):** `PromptSection { id, title?, body }`, `BuiltPrompt { text, sha256, sections }`, and `buildPrompt(sections, preamble?)`, which renders each section as `"## title\nbody"` (or bare `body` with no title), joins everything with `preamble` on one blank line, and hashes the whole text and each rendered section with `sha256` from `shared/artifacts.ts` (confirmed its signature — `sha256(value: string|Uint8Array): string` — matches exactly; `shared/` was not touched). Throws on a duplicate section id or an empty/whitespace-only body. Also exports `SCHEMA_KEYWORDS` (the JSON-Schema vocabulary plus this pipeline's own container field names: `concepts`, `relations`, `prerequisites`, `sections`, `schema`) and `schemaKeywordLeaks(ids)`, which flags any id (case/whitespace-insensitive) that collides with one of those keywords.
- **`planner/prompt.ts` refactor:** Split the existing `buildSystemPrompt` template literal into a preamble plus 8 named sections (`skill`, `style`, `contract`, `rules`, `templates`, `primitives`, `examples` — matching the brief's list) with the exact same text as before, exported as `buildSystemPromptSections(planningContext?)`. `buildSystemPrompt` is now `return buildPrompt(sections, preamble).text;`. The byte-identity test (SHA-256 of the unmodified v12 prompt, captured live via `npm run build && node -e "...buildSystemPrompt()..."` **before** any code changed: `fde58f61f17098ba19ef000a68022fd5201fe08a6b4041f05f7d6dd91ac84dfa`) passed on the first attempt — no iterative text-shuffling was needed because the section boundaries were copied verbatim, character for character, from the original string.
- **S2/S3 keyword guard (`plan/stages.ts`):** `buildConceptGraph`'s `validate` now rejects any concept id that is a schema keyword (`concept ids "type" ... are JSON field names, not source concepts; give each concept a snake_case id derived from its own label`), right after the existing uniqueness check. `buildTeachingPlan`'s `validate` now runs the same check over every section's `conceptIds` and `contract.requiredConceptIds` combined, just before `return problems`, with a parallel message (`section concept ids ... are JSON field names; use only ids from VALID CONCEPT IDS`). Both consume the stage's one existing repair attempt — no change to the repair mechanism itself.
- **Cache version bump (`pipeline/lesson.ts`):** S2 `'S2-concept-graph-v2-anchored-evidence'` → `'S2-concept-graph-v3-keyword-guard'`; S3 `'S3-teaching-plan-v3-explicit-concepts'` → `'S3-teaching-plan-v4-keyword-guard'`. `'S3-teaching-plan-prompt-v4'` left unchanged (the S3 prompt text itself did not change, only the validator).
- **Tests** (`__tests__/prompt-builder.test.ts`, 6 new): `buildPrompt` joins sections deterministically with titles/hashes; rejects duplicate ids and empty bodies; `schemaKeywordLeaks` finds keywords case/whitespace-insensitively and ignores compound ids like `heat_type`; the v12 byte-identity test against the recorded hash; an S2 test driving `buildConceptGraph` through a stub fetcher whose first response uses concept id `type` and whose repair response is valid, asserting `usage.repairs === 1` and that the second request's `messages[1].content` contains "are JSON field names"; and an analogous S3 test driving `buildTeachingPlan` the same way over `section.conceptIds`/`contract.requiredConceptIds`. Both provider-facing tests build their `SourceDoc` with `sourceDocFromText` and resolve the concept evidence quote through `resolveSourceEvidence` so the quote is verbatim source text, not a hand-typed literal.
- **Verification:** `npm run build` succeeded; `node --test dist/.../prompt-builder.test.js` — 6/6 passed; `npm run typecheck:hypothesis` passed with no errors; `npm run test:hypothesis` passed — **315 Node tests** (309 prior + 6 new) and **17 Python tests**, 0 failures. No frozen plan, golden, or fixture file was touched; no topic-specific runtime branch was introduced — `SCHEMA_KEYWORDS` is a fixed structural vocabulary (JSON-Schema keywords plus this pipeline's own field names), not a lesson- or topic-keyed list.
- **Next bounded work:** unchanged from the prior entries — the S5 human word-boundary review (`.data/alignment-review-pack-20260925/`) is still the structurally non-automatable blocker to a measured `calibration.v2.json` and, downstream, any lesson passing C6/E1. This task (S6 prompt-builder plumbing) is independent of that blocker and does not affect it.

## Entry — 2026-09-25, deterministic evidence-quote anchoring for S2

- **Why:** The live S2 stage was failing on "evidence quote is absent from source span" when models changed typography (curly quotes → straight quotes, em dashes → hyphens, non-breaking spaces → regular spaces, ellipsis → three dots), whitespace runs, or leading/trailing punctuation, or when a quote was cited under the wrong span ID. The new anchoring maps such a quote back to the **exact** source substring. Paraphrase is never accepted. The stored quote is always verbatim source text.
- **Rule:** Anchoring follows four deterministic paths: (1) exact match—the quote appears verbatim in the cited span; (2) normalized match—the quote matches under character/whitespace normalization and is unique within the span; (3) relocated match—the quote is not found in the cited span but occurs verbatim in exactly one other span (requires ≥12 characters after trimming punctuation to prevent short-phrase false relocations); (4) rejected—zero matches, ambiguous matches (same quote in multiple spans), or paraphrase.
- **Implementation:** Added `src/experimental/hypothesis/v1_claude/plan/evidenceAnchor.ts` with `normalizeForAnchor(text)` (applies character/whitespace mappings, returns normalized text plus a position map for original offsets), and `anchorQuote(doc, spanId, quote)` (tries exact, then normalized within span, then relocated to another span). Wired `anchorQuote` into `buildConceptGraph` validation in `plan/stages.ts`: replaced the `checkEvidence` call to `resolveSourceEvidence` with a call to `anchorQuote`, and replaced the `enrich` function to track anchor match counts (exact/normalized/relocated) and record them as a soft, non-blocking note in failures when any normalized or relocated matches occur.
- **Cache version bump:** Changed the S2 stage-version argument in `pipeline/lesson.ts` from `'S2-concept-graph-v1'` to `'S2-concept-graph-v2-anchored-evidence'` to invalidate cached artifacts built without anchoring.
- **Tests:** Seven new tests in `src/experimental/hypothesis/v1_claude/__tests__/evidence-anchor.test.ts`: exact quote anchors unchanged; typographic and whitespace drift anchors to the verbatim source substring; a unique verbatim quote cited under the wrong span is relocated; ambiguous relocation is rejected; short quotes are never relocated; paraphrase is never anchored; normalization map points back to original offsets.
- **Verification:** `npm run build` succeeded; all 7 evidence-anchor tests passed; `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed with 309 Node tests (7 new evidence-anchor tests) and 17 Python tests. Existing test `S1-S4 source lesson preparation carries evidence, blocks relation loss, and resumes from cache` passed unmodified. No fixture text was modified; span-splitting remained consistent with the test expectations.

## Entry — 2026-09-25, provider route rejections, transport retries, validator exceptions

- **Root cause:** OpenRouter returns HTTP 404 "No endpoints found that satisfy the max price" when routing fails (no provider endpoint matched the request or max_price filter), and HTTP 429 when rate-limited. These were thrown as plain `Error`, so `PersistentBudgetLedger.call` classified them as uncertain outcomes, blocked the ledger, and prevented all later calls in that output directory. Separately, exceptions thrown inside `validate` callbacks were surfaced only as generic `stage-threw` without distinguishing them from model failures.
- **Fix:**
  - Added `ProviderNotDispatchedError` to `llm/openrouter.ts` with specific error codes (`PROVIDER_NO_ENDPOINT` and `PROVIDER_RATE_LIMITED`) and `cause.code` for ledger classification.
  - Updated `chatStructured` error handler to throw `ProviderNotDispatchedError` for 404 responses matching "no endpoints" and for all 429 responses.
  - Added `PROVIDER_NO_ENDPOINT` and `PROVIDER_RATE_LIMITED` to the `definitelyNotDispatched` list in `pipeline/budgetLedger.ts` so the ledger records them as preflight failures (no charge, no block, allows retry).
  - Fixed `budgetLedger` snapshot success path to preserve existing fields (`...current`) so `preflightFailures` persists across call updates.
  - Added transport-retry loop (`callWithTransportRetry`) in `llm/structuredCall.ts` that retries `ProviderNotDispatchedError` up to `transportRetries` times (default 2) with exponential backoff, recording soft `<stage>-transport-retry` failures instead of semantic repairs.
  - Added `parseSafely` and `validatorThrew` helpers in `structuredCall.ts` to catch exceptions inside `validate` callbacks and record them as hard `<stage>-validator-threw` failures (distinct from `stage-call-failed`, zero repair cost).
- **Tests:** Five new tests in `src/experimental/hypothesis/v1_claude/__tests__/provider-transport.test.ts`:
  - `chatStructured types a 404 no-endpoint rejection as not dispatched`: verifies error type and code.
  - `chatStructured keeps other HTTP errors as plain errors`: 500 remains plain Error.
  - `route rejection is retried as transport, not as the one repair, and the ledger stays unblocked`: confirms 2 transport-retry soft failures, 0 repairs, ledger unblocked after successful retry on attempt 3.
  - `all route rejections end in one hard failure and leave the ledger unblocked`: 3 sequential failures exhaust retries, produce one hard `plan-call-failed`, zero spend, ledger unblocked.
  - `a validator exception is a distinct hard failure and spends no repair`: exception inside validate is caught, recorded as hard `plan-validator-threw`, zero repairs.
- **Verification:** `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed with 302 Node tests (5 new provider-transport tests) and 17 Python tests. All existing tests remain passing; no existing error message text changed.

## Entry — 2026-09-25, plan lock enforcement

- Created a regression test suite `src/experimental/hypothesis/v1_claude/__tests__/plan-lock.test.ts` that guards against accidental changes to frozen implementation plans listed in `docs/superpowers/plans/plan-lock.json`. The suite verifies: (1) the lock file declares at least one plan, (2) all listed plans match their recorded SHA-256 hash, and (3) plan files remain read-only (mode 444) on disk. The test fails the offline gate if bytes or permissions change.
- Added a rule to `CLAUDE.md` documenting that frozen plans must never be edited, reformatted, or regenerated, and that scope changes must be recorded in the plan's `.amendments.md` file with quoted user approval. This prevents accidental mutations of canonical implementation directives.
- The lock file and read-only permission on `docs/superpowers/plans/2026-09-25-visual-richness-and-deterministic-generation.md` were already in place; the test passed without modification.
- Verification: `npm run typecheck:hypothesis` passed with no errors; `npm run test:hypothesis` passed with 297 Node tests (3 new plan-lock tests added) and 17 Python tests; `git diff --check` passed. No plan content was inspected or edited.

## Entry — 2026-09-24, replace character-count width guesses with rendered glyph bounds

- `layout/measure.ts` now measures text ink with resvg at the configured family, weight, and size, with a per-process cache. Intrinsic widths for boxes, pills, token strips, meters, matrices, formula fallback text, object labels, and text primitives use that measurement. Scene-title sizing/reveal clips and the styled text-box fallback use it too. Meter and matrix widths account for their visible labels. Updated S7/S8/S10 stage versions to invalidate old geometry/render artifacts.
- A synthetic renderer regression verifies that the same-length narrow/wide uppercase glyph strings receive different intrinsic widths. This is geometry/code evidence, not a visual-quality check. The font binary is not bundled; ink bounds are not OpenType advance metrics, SVG text is still used, and cross-host/browser font fallback can vary. The visual gates remain unmeasured.
- Verification: `npm run typecheck:hypothesis`; `npm run test:hypothesis` (279 Node tests and 8 Python alignment tests); `git diff --check` — all passed. No old fixture media was opened, rendered, or scored.

## Entry — 2026-09-24, verify generated-run sample diversity and provider reachability

- Re-read the requested implementation note and checked the current generated-run inventory. Four 60-second run directories are all failed retries of one photosynthesis input; each pair has identical SourceDoc SHA-256 `2c9cf40ec58f80f0bfdae1f3ff42e99ebb94c105eb095baa33b09dd75d72ce62` and narration SHA-256 `fa4b9f535f870e0ac76359bbe6d98573558946deb109701ad771a6963d436fa3`. They provide no independent document coverage and no eligible visual-review sample.
- Structured S5 data in the generated run retains 126 words and three exact-zero stable-ts intervals (`To`, `a`, `the`). The existing CTC comparison assigns nonzero intervals and has lower VAD boundary error on this same single lesson, but its report explicitly leaves promotion unmeasured because VAD is not interior-word ground truth. Keep stable-ts as the live default and keep zero intervals hard-failing; do not fabricate repaired timestamps.
- OpenRouter and Anthropic DNS lookups both remain `ENOTFOUND`; no provider request was attempted. No video, frame, contact sheet, or legacy fixture media was opened or scored. The next eligible visual review requires a complete source-generated lesson after provider reachability and measured alignment are available.

## Entry — 2026-09-24, test stable-ts alignment options on the generated lesson

- Ran local forced alignment against the existing generated photosynthesis scene audio with `suppress_silence=False` and `token_step` 50/150. Disabling silence suppression retained the same three zero-duration intervals. `token_step=150` matched the default (3 zeros; VAD boundary median/max 49.05/325.31ms); `token_step=50` increased zeros to 6 and boundary errors to 54.05/395.31ms. All runs retained 42/42 words in each scene.
- No alignment option was changed or promoted. Each option returned 42 word entries for each 42-word scene; the diagnostic did not separately verify word-string equality. These runs reuse one source/narration and use VAD only for utterance boundaries, not interior-word ground truth; they do not qualify S5 calibration or a completed lesson. Updated the existing alignment README and validation ledgers with this result.
- Verification: full typecheck/tests were not rerun because this entry changed documentation only; `git diff --check` passed. The ad-hoc local diagnostic did not alter the generated run artifacts. No video/frame/contact sheet or legacy fixture media was viewed or scored.

## Entry — 2026-09-24, retry transient local embedding-model initialization failures

- Replaced the one-off MiniLM promise memoizer with a retrying lazy loader. Concurrent callers share one initialization attempt; a rejected attempt is cleared, and a later call can retry without restarting the process. A successful initialization remains memoized.
- Added a focused synthetic unit test for in-flight deduplication, rejection recovery, and memoized success. It does not download or run MiniLM. This is catalog reliability evidence only; semantic quality/calibration (E4), source-generated visual acceptance, and provider-backed video generation remain unmeasured.
- Verification: `npm run typecheck:hypothesis`; `npm run test:hypothesis` (278 Node tests and 8 Python alignment tests); `git diff --check` — all passed. No legacy or fixture media was rendered, opened, or scored.

## Entry — 2026-09-24, correct provider-availability diagnosis

- The runtime credential loader successfully reads a configured OpenRouter key from the designated sibling `.env` (the key was not printed or copied). The earlier note that credentials were absent was inaccurate; the project-local `.env` and process environment are empty, but credentials are configured through the loader. Current DNS lookups for `openrouter.ai` and `api.anthropic.com` return `ENOTFOUND`, so no request was attempted and no live lesson could be generated.
- Ollama has a local Qwen 2.5 Coder 7B manifest, but the installed CLI aborts during native MLX/Metal initialization when listing models; direct localhost API access returned `EPERM` under this sandbox. No local model inference was run. Do not count either the configured key or an installed model manifest as provider availability.

## Entry — 2026-09-24, remove topic-only icon associations from the seed catalog

- Runtime audit found procedural seed-catalog descriptors that routed specific subject terms to associated, non-literal icons (`photosynthesis`→leaf, `carbon dioxide`→cloud, and induction/electromagnetism/physics tags on coil/magnet). Removed those terms while retaining literal names and generic visual meaning. The seed catalog header now accurately documents that source-generated semantic ranking uses Streamline embeddings, while procedural entries provide exact-name matches and a limited lexical fallback.
- Added a regression proving topic-only terms no longer score/select the associated seed icon and instead use the labeled text rung. This is a content-routing/code check only; no video, image, fixture, or generated result was visually scored, and E4 remains unmeasured.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (277 Node tests and 8 Python alignment tests); `git diff --check` passed.

## Entry — 2026-09-24, exercise S6 zero-shot planning without a provider

- Added an optional test transport to the S6 call options and a synthetic source-grounded case that compiles `ScenePlanningContext`, verifies its context is present in the real planner prompt, and runs the actual structured response/schema/evidence validator. A second test simulates HTTP 503 and confirms the diagnostic fallback does not erase the hard provider failure or its own hard fallback gate.
- Together with the S2–S4 test seam, this verifies source-grounded stage contracts and warm preparation-cache replay without external provider calls. A separate integration assertion removes a required S3 relation, observes the single repair fail, and proves preparation stops before S4. Synthetic response payloads are code-test data only; they do not produce or qualify a generated lesson.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (276 Node tests and 8 Python alignment tests); `git diff --check` passed. No visual artifacts were opened or assessed.

## Entry — 2026-09-24, exercise source-grounded S2–S4 without provider access

- Added a test-only `fetcher` seam to the content-stage model interface and threaded it through S2 concepts, S3 teaching plan, and S4 narration. Production continues to use global `fetch` unless a caller injects a transport.
- Added a neutral integration test that runs `prepareLesson` through the real validators with an in-memory source and controlled structured responses. It inspects prompt payloads for source text/span IDs, confirms evidence-linked concepts and contracts survive, then proves warm S2–S4 cache replay makes no transport calls. The synthetic responses are test data, not generated lesson evidence.
- Verification: `npm run typecheck:hypothesis` and the focused integration test passed. This does not assess visuals or replace provider-backed C1–C6/E1–E10.

## Entry — 2026-09-24, distinguish the offline fixture CLI from generated lessons

- Removed stale CLI/pipeline/fixture comments claiming the Scene Planner was not implemented. The `cli.ts` error now identifies itself as the retained offline renderer-fixture path and points source-based runs to `lessonCli.ts --source=...`; fixture SceneSpecs are labeled historical plumbing only, while pipeline comments describe the separate generated S5/S6/S11 path.
- No runtime behavior or output artifact changed. This clarification does not claim generated-video quality or a passed visual gate.

## Entry — 2026-09-24, bind PDF/PPTX evidence to extractor-authored locations

- PDF and PPTX intake now returns character ranges paired with actual page/slide numbers. `sourceDocFromText` treats these ranges as authoritative, so untrusted text resembling `## Page 99` or `## Slide 99` cannot rewrite citation provenance. Existing string-returning extraction helpers remain compatibility wrappers; DOCX already used native block ranges.
- Bumped S1 intake stage/prompt versions to invalidate artifacts whose PDF/PPTX locators were inferred from rendered text headings. Added neutral regressions for spoof headings and blank PDF page numbering.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (273 Node tests and 8 Python alignment tests). These exercise extractor/provenance code only; no legacy fixture, hand-authored output, or generated media was viewed or scored.

## Entry — 2026-09-24, invalidate concept artifacts when native source locators move

- Added a cache regression proving that identical extracted text with a changed DOCX body paragraph/table locator invalidates the derived S2 concept artifact. The SourceDoc content's `sourceId` remains based on its normalized source text, while the full SourceDoc in the stage input carries native locations; those provenance changes must therefore affect the cache key.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (273 Node tests and 8 Python alignment tests). The test uses synthetic SourceDocs only; no fixture, hand-authored output, or generated media was opened or scored.

## Entry — 2026-09-24, stream hashes for large CTC artifacts

- The generated-run CTC report previously loaded the entire Wav2Vec2 model file (about 360 MB) into Python memory to hash it, and similarly loaded each scene WAV for its audio digest. Added chunked SHA-256 file hashing for both paths so diagnostics no longer create a second full-size model copy just to record provenance.
- Added a synthetic file-hash regression using deliberately non-aligned chunk sizes. Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (272 Node tests and 8 Python alignment tests); `git diff --check` passed. No lesson media or fixture output was opened or scored; this is memory and provenance plumbing only.

## Entry — 2026-09-24, compare local TTS voice effect on generated narration alignment

- Used the exact S4 narration from the one eligible source-generated photosynthesis run. Stable-ts base returned 3/42, 0/42, and 1/42 zero-duration words on the three existing Supertonic scene clips. Re-synthesizing those same three narration strings with installed Piper `en_US-lessac-medium` returned 2/42, 2/42, and 3/42 zero-duration words, with all words present and monotonic start times. Piper therefore had 7 zero intervals against 4 for Supertonic across this single lesson; no voice or aligner was changed.
- This isolates a voice-dependent variation signal but is not word-level ground truth, naturalness review, or multi-source calibration. No video, frame, contact sheet, fixture, or hand-authored lesson output was used; no visual assessment was made.
- The test audio was generated under the existing voice-engine output cache and the run artifacts were not edited. C6/E1/E5 remain unmeasured.

## Entry — 2026-09-24, carry DOCX XML body locators into evidence

- Extended the structured-source mapper so each DOCX paragraph and table text block carries a locator with its `w:body` child position and 1-based paragraph/table ordinal. SourceDoc v2 maps extracted character ranges to those locators; exact S2 evidence and S6 citations now retain them and planner validation compares them exactly. The existing string-only `docxXmlToMarkdown` API remains as a wrapper over the located extraction.
- Added synthetic XML tests that resolve a factual paragraph quote to body block 2 / paragraph 2 and a table quote to body block 3 / table 1. The locators are structural ordinals, not durable Word object IDs or byte offsets.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (272 Node tests and 7 Python alignment tests). No fixture media or generated lesson was inspected or scored.

## Entry — 2026-09-24, preserve native PDF and slide locations in citations

- SourceDoc v2 attaches PDF page, PPTX slide, and DOCX body paragraph/table locators to extracted spans, resolved S2 evidence references, and the source-grounded context supplied to S6. The scene evidence schema accepts these optional locators, the prompt asks the planner to copy them, and planner validation checks them exactly. The S1 parser/schema/cache version changed to invalidate cached SourceDocs without native locations. DOCX ordinals map to XML body structure but are not durable object IDs.
- Added neutral intake/evidence tests for page 3 and slide 10 citation resolution, plus a planner regression that rejects a citation moved to the wrong PDF page. No lesson-specific facts or outputs were added.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (272 Node tests and 7 Python alignment tests). No fixture media or hand-authored scene output was measured. Provider-generated provenance and all visual gates remain unmeasured.

## Entry — 2026-09-24, propagate cross-stage budget balance into provider caps

- The persistent budget ledger now computes `min(stageRemaining, lessonBudget - actualPriorSpend)` while holding its call lock and passes that allowance to the provider request builder. This closes the path where S6 could calculate a cap from its local budget while ignoring spend already charged to S2–S4. Measured provider usage is still checked after response; a provider that violates a ceiling can still cause an overrun, which remains a hard failure and blocks later calls.
- Added regressions where S2 spends $0.007 from $0.010 and the next stage receives exactly $0.003; the following call is denied. An injected fake HTTP transport confirms the actual structured OpenRouter request uses the $0.003-derived `max_price`, even when the stage-local allowance is $0.009. No live request was made and provider-side cap enforcement remains unmeasured.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (272 Node tests and 7 Python alignment tests); `git diff --check` passed. No historical output was used for quality measurement.

## Entry — 2026-09-24, cache MP4 bytes across generated-run directories

- Fixed an S11 cache integrity defect: the stage cache previously retained only MP4 hash/size metadata, so a warm hit in a new run directory could not materialize the actual video. S11 now stores the encoded file as a content-addressed binary blob and atomically copies it into the requested output directory. Hashing streams the file instead of loading a long video into memory. A missing blob causes warm mode to regenerate; replay mode fails closed. The S11 cache version changed so metadata-only entries cannot be treated as binary hits.
- Added synthetic cache tests for cold binary storage, warm materialization into another run directory, missing-blob regeneration, and replay miss. These test artifact plumbing only.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (270 Node tests and 7 Python alignment tests). No old fixture media or hand-authored output was used for quality measurement; no visual-quality result was produced. C6/E1/E5 remain unmeasured, and the latest source-generated lesson remains failed at S5 alignment.

## Entry — 2026-09-24, compare an independent English CTC aligner on generated audio

- A parameter sweep on the three source-generated photosynthesis scene clips found the same stable-ts zero intervals under default, `fast_mode`, `nonspeech_skip=None`, and alternate `word_dur_factor` values. No stable-ts option was adopted.
- Added `compare_aligners.py`, a repeatable diagnostic that requires a matching generated-lesson manifest/evaluation bundle, source hash, and completed provider-backed S2/S3/S4 stages. It matches CTC emissions to the exact S4 narration, reports per-word intervals, and compares utterance start/end with independent 5 ms RMS energy boundaries. It does not modify the live S5 provider, round/stretch words, drop content, or qualify a run for C6/E1/E5.
- On the one 60-second source-generated photosynthesis run (3 scene clips, 126 words), torchaudio Wav2Vec2 CTC returned 0 zero-duration words; stable-ts base returned 3. Across six onset/offset checks, CTC median absolute error was 39.49 ms (max 152.75 ms), compared with stable-ts 49.05 ms (max 325.31 ms). This is one lesson and utterance-boundary VAD only; interior-word accuracy, broader language/symbol coverage, full calibration, and live cost/time are unmeasured. Keep stable-ts and the hard S5 gate unchanged.
- Model weights are held in ignored `.data/alignment-models/`. No old fixture output, frame, contact sheet, or video was inspected. The comparison report is `.data/hypothesis-runs/claude/generated-20260924-qwen-v9-s5/photosynthesis-60s/alignment-comparison-ctc-v1.json`.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (269 Node tests and 7 Python alignment tests). Next: gather independent source-generated narration clips and validate CTC word boundaries plus symbols before considering an S5 integration.

## Entry — 2026-09-24, skip paid S6 after hard S5 alignment failures

- Added a run-level prerequisite: if S5 records any hard word-clock failure, the generated-lesson path skips every paid S6 planner call. It still writes a deterministic diagnostic SceneSpec, marks the skip and fallback as hard failures, and cannot be promoted to `passed`. The S6 cache identity includes the upstream failure count and uses a distinct no-provider model marker.
- Replayed the same photosynthesis source-generated lesson using cached S1–S5 artifacts from the prior generated run. All three S5 artifacts were cache hits and preserved the three zero-duration intervals. S6 compiled no prompt and made zero provider calls at $0.00 reported spend, produced three local diagnostic fallbacks, and retained failed status (14 hard failures total). No video was produced because MP4 encoding and captions failed under the invalid word clock. No frames, contact sheets, videos, or legacy fixture outputs were inspected or scored.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (269 Node tests plus 1 Python alignment test). This verifies implementation behavior only. C6/E1/E5 remain unmeasured.

## Entry — 2026-09-24, source-generated S5 v2 end-to-end check

- Ran a fresh source-generated lesson at `.data/hypothesis-runs/claude/generated-20260924-qwen-v9-s5/photosynthesis-60s/` after the alignment precision/gate changes. S1–S4 were warm cache hits; all three S5 artifacts were regenerated under `voice-align-2-submillisecond`.
- S5 recorded three zero-duration intervals (two in `sec_1`, one in `sec_3`) as hard failures. S6 then failed all three calls at network fetch, with $0 reported spend; diagnostic fallbacks remained hard failures. Total: 13 hard failures and three fallbacks; final run status `failed`.
- S11 nevertheless produced a technically valid ~60s H.264 1920×1080 + AAC MP4; `ffprobe` verified the container only. The failed diagnostic video was not viewed, sampled, or scored. It is not eligible for C6/E1/E5.
- This proves the new S5 cache version invalidates the older alignment and the hard gate reaches the run record. It does not solve zero-duration alignment or demonstrate visual quality. The next alignment investigation needs a multi-document, independently grounded boundary/word-coverage calibration; no model was selected from the single-lesson comparison.

## Entry — 2026-09-24, make S6 repair guidance preserve independent citations

- Rechecked the captured fresh source-generated planner responses against the corrected validator, without inspecting any rendered output. The earlier multi-concept title failure was fixed: attempt 1 for scene 1 then had only an unsupported title number; the repair dropped one of the two concept citations and still failed. Scenes 2–3 had no parseable JSON in the old 3,000-token responses.
- Made numeric rejection errors tell the planner to remove the unsupported number or cite an exact source span, and multi-concept citation errors to retain at least one source reference for every linked concept. Added regressions for both instructions and bumped the S6 prompt/cache version to v9.
- The old responses are diagnostic only. Provider DNS still fails, so no v9 response is available yet. No fixture media or rendered frames were inspected or scored.
- Verification after the repair-message change: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (268 Node tests plus 1 Python alignment test).

## Entry — 2026-09-24, measure submillisecond S5 alignment and compare cached models

- The generated-run caption failure traced to `align.py` rounding stable-ts word boundaries independently to whole milliseconds before caching. The adapter now stores the measured fractional-millisecond boundaries; exact zero-duration intervals still fail the caption gate. Bumped the live S5 alignment artifact stage version so stale rounded alignments cannot be reused.
- Added a Python regression proving two distinct submillisecond boundaries remain distinct. `npm run test:hypothesis` now runs the Python alignment check as well as the Node suite.
- Re-aligned the first scene from fresh source-generated narration/audio with the updated sidecar (not a fixture): 42 words included 3 exact zero-length intervals. The zero lengths therefore come from stable-ts output, not only millisecond rounding. No video inspection or quality score was made. Added a generic S5 word-clock gate before mention resolution: empty text, non-finite/out-of-range timing, non-positive intervals, and out-of-order starts now record hard alignment failures at S5. Exact zero intervals remain unchanged for diagnosis; no duration is fabricated. A local stable-ts `fast_mode=True` retry on the same source audio also retained the same three zeros; dropping instant words would lose spoken tokens, so it was rejected.
- Compared cached `base`, `small`, `medium`, and `base.en` stable-ts models with the same `fast_mode=True`, source-generated text, and three scene audio files (126 words each): zero-duration intervals were 4, 2, 4, and 5 respectively; no out-of-order starts. This single lesson is diagnostic only; no model change or calibration update is justified. The exact alignment spans remain a hard S5 failure.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (268 Node tests plus 1 Python alignment test). OpenRouter DNS still returns `ENOTFOUND`, so no new planner request was attempted. C6/E1/E5 remain unmeasured.

## Entry — 2026-09-24, fix multi-span evidence validation and record fresh-run retry

- Fixed a generic S6 validator error: titles/elements linked to multiple source concepts may cite separate exact spans, so validation now requires at least one cited span for each linked concept while still requiring every citation to resolve to the target source. Added a regression using two unrelated neutral concepts and spans.
- Raised the default S6 structured-output allowance from 3,000 to 6,000 tokens after all three Qwen outputs in the prior fresh run exhausted 3,000 tokens. Bumped the prompt/cache version to v8. The price ceiling and persistent budget ledger remain active.
- A capped retry on the same source reused cached S1–S5, but all three S6 requests failed at network fetch before provider responses; run status is `failed`, returned spend was $0, and no MP4 was produced. The preceding source-generated Qwen run did create a technically valid diagnostic MP4, but it remained failed with hard planner and caption/alignment gates; it was not visually inspected or scored.
- The retained measured word clock contains zero-duration words (for example, a word with identical start/end milliseconds). Caption export rejects these as invalid alignment. This is preserved as a hard failure; timestamps are not stretched to manufacture a pass.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (266/266). No legacy fixture media was inspected or used for quality measurement. C6/E1/E5 remain unmeasured.

## Entry — 2026-09-24, source-generated live attempt exposed S3 and budget failures

- Used a fresh, short photosynthesis source summary, not retained outputs or hand-authored scenes. The first live attempt replayed source/concept stages but failed S3 after its single repair because both responses left section `conceptIds` empty. Tightened the generic S3 contract prompt with an exact graph-ID checklist, explicit section-to-contract ID copying, and a pre-return consistency checklist; bumped the prompt/cache version from v2 to v3. Empty section IDs remain a hard failure. An offline regression covers the empty-array rejection.
- The retry reused cached S1/S2, then completed S3 and S4; three TTS scene files and aligned audio were produced, and S6 scene planning began. Total measured provider spend reached $0.119435816 across 9 calls against the configured $0.10 clip ceiling. One dispatched request can exceed the then-remaining budget; the attempt was stopped when the overrun became visible. The run has no completed video/final report and is failed/ineligible for visual acceptance. No generated frames or video were inspected or scored.
- Fixed the persistent ledger to mark a measured overrun as blocked and reject subsequent provider calls; added an offline test. A subsequent implementation step adds per-token provider price ceilings before dispatch; the smoke remains historical evidence for the failure that prompted this work.
- Artifacts: `.data/hypothesis-runs/claude/generated-20260924/photosynthesis-60s/` (first failed S3 attempt) and `.data/hypothesis-runs/claude/generated-20260924-retry1/photosynthesis-60s/` (incomplete retry). Neither is a passed/generated-quality result.
- Current C6, E1, and E5 remain unmeasured. This smoke demonstrates only that source-grounded S2/S3/S4 and TTS can execute; it does not validate teaching visuals or Simi parity.

## Entry — 2026-09-24, constrain provider price and preserve atomic video output

- The fresh S6 planner response was truncated at its 3000-token limit; the repair omitted the required `prim` discriminator. Clarified the generic DSL contract: every element must explicitly set `prim`, and `prim:"object"` is distinct from the nested `object` payload. Bumped the S6 prompt/cache version to v7. This changes schema guidance only; it adds no topic-specific visual content.
- Added a per-request OpenRouter `provider.max_price` computed from remaining stage budget, UTF-8 request size plus chat framing margin, and max completion tokens, with 10% budget headroom. The persistent ledger still records returned cost and blocks subsequent calls after a reported overrun. Offline tests verify the price ceiling bound and that the provider request carries it. OpenRouter documents `max_price` as an input/output price cap per million tokens; live behavior under these ceilings remains unmeasured.
- The interrupted smoke left a 510 KB `video.mp4` path that failed `ffprobe` (`moov atom not found`). S11 now encodes to a unique partial path and renames only after ffmpeg returns successfully. A synthetic interruption test verifies that a failed encode cannot leave a final-path MP4. This validates file-integrity behavior only; it does not render or score lesson visuals.
- Verification: `npm run typecheck:hypothesis`, `npm run test:hypothesis` (264/264), and `git diff --check` passed. C6/E1/E5 remain unmeasured; no additional provider request was made in this entry.

## Entry — 2026-09-24, preserve original PDF page numbers through blank pages

- PDF intake previously filtered empty extracted pages before numbering the remaining pages. A blank page could shift every later page marker and therefore the reported source location. The extractor now preserves empty page slots and removes only `pdftotext`'s final form-feed sentinel. It also rejects inputs with fewer than 20 actual extracted text characters so page headings cannot make an image-only PDF look like readable source.
- Added a synthetic extraction test with a blank middle page and trailing form feed; page 3 remains page 3 and maps to a later `SourceDoc` span. No PDF media or lesson outputs were inspected.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, source intake/doc tests (7/7), and `npm run test:hypothesis` (261/261) passed; `git diff --check` passed.
- OCR remains unsupported. This fixes page provenance for text PDFs and does not establish E9 or visual quality.

## Entry — 2026-09-24, preserve mixed prose and equations in DOCX intake

- Fixed DOCX paragraph extraction so Office Math no longer causes all text in the paragraph to be wrapped as one display equation. Inline `m:oMath` is retained in order with surrounding prose; `m:oMathPara` is isolated as display math, allowing `SourceDoc` to create a separate equation span with offsets.
- Added synthetic XML coverage for inline and display math. No real or retained lesson input/output, generated video, reference media, provider, or visual judge was used.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, source intake/doc tests (6/6), and `npm run test:hypothesis` (260/260) passed; `git diff --check` passed.
- This improves source structure available to S2/S3, but does not establish PDF/OCR/equation fidelity on real documents or complete E9. Visual-quality gates remain unmeasured.

## Entry — 2026-09-24, test few-shot leakage across a changed topic and relation

- Added a synthetic S6 contract test that holds the template and selected exemplar fixed while the target uses a different concept vocabulary, values, and source relation. A target scene with independently supported Heat/Pressure concepts and the source `causes` relation passes; copying exemplar labels/values or replacing the target relation with the exemplar's `feeds` relation fails.
- This is an isolated anti-copy/source-contract test. It did not render or inspect any lesson output, retained fixture media, or reference frame, and did not call a provider or visual judge.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, `node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-context.test.js` (16/16), and `npm run test:hypothesis` (259/259) passed. Full suite uses synthetic code-contract inputs; it is not visual-quality evidence.
- Initial recheck found no process-level OpenRouter/Anthropic keys and no project-local `.env`; it did not inspect the runtime's designated sibling `.env` (corrected by the newer provider-availability entry above). DNS lookup for `openrouter.ai` returned `ENOTFOUND`; no provider request was attempted.
- Visual acceptance remains unmeasured. Next visual work requires a complete source-generated lesson; until provider access is available, continue source-grounded implementation/tests without using retained fixture outputs as proxies.

## Entry — 2026-09-24, align S6 context hash with selected-example prompt

- One S6 context hash omitted exemplar intent, design rationale, and provenance even though those fields were passed to the planner. Added a shared serializer for prompt content and hash payload, retained the retrieval score in the hash as selection metadata, and bumped the S6 prompt version to v6 so prior planner artifacts are not reused.
- Added a synthetic contract regression that changes only rationale and confirms both the compiled prompt and exemplar-context hash input change. No retained fixture scene/media, generated video, reference frame, provider, or visual judge was used. Also removed an unrelated test assertion that mentioned old fixture labels. Current focused suite is 16/16 after the follow-up cross-topic anti-copy test.
- Verification at this entry: `npm run typecheck:hypothesis`, `npm run build`, and `node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-context.test.js` passed (15/15 at that point).
- This fixes reproducibility/audit identity only. C6/E1/E5 visual quality, provider runs, and generated lessons remain unmeasured; old fixture outputs are excluded from visual evaluation.

## Entry — 2026-09-24, remove retained hand-authored lesson scenes from current tests

- The planner, renderer, browser-player, and end-to-end test paths no longer import retained Attention or math SceneSpecs. Replaced those lesson-specific scenes with neutral synthetic IDs/labels for isolated schema, timing, layout, cache, MP4 plumbing, and browser-route contracts. Removed checks that asserted old Attention assets or hard-gate/occupancy outcomes. Retained fixture files were not edited, rendered, or scored; I read limited fixture source excerpts only to identify the stale test references and replace them, without drawing quality conclusions. That source inspection was for test cleanup, not architecture evaluation.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, focused planner/math/drawing/e2e/browser tests (37/37), then full `npm run typecheck:hypothesis` and `npm run test:hypothesis` (257/257), and `git diff --check` passed. Test discovery confirmed no imports of retained Attention/math SceneSpecs. Tests used neutral synthetic contracts and a synthetic MP4 plumbing case; no retained media, reference frame, source-generated video, provider, or judge was used.
- Current visual-quality status is unchanged: C6/E1/E5 remain unmeasured without eligible complete source-generated lessons. The broad offline suite is now safe to run for code behavior; it still does not establish architecture or visual quality. A no-billable DNS check still returns `ENOTFOUND` for `openrouter.ai`; no provider request was made. The local Ollama inventory command aborts in its native Metal backend, so it did not supply an alternate local model. Next: restore provider/network availability and obtain a versioned held-out source set, then validate only complete generated lessons for C6/E1/E5.

## Entry — 2026-09-24, bind E5 vote scoring to its held-out pack provenance

- The E5 vote scorer now requires the sealed key and organizer record. Pack creation hashes the exact serialized answer key into organizer provenance and records each blinded item ID beside its held-out source-generated runs, treatment metadata, successful-video costs, and source/manifest/bundle/video hashes. Before scoring, the CLI validates the organizer schema, key hash, package ID, pair IDs, run/treatment/cost mappings, and held-out set identity. A mismatch forces an `unmeasured` report; the report includes organizer and held-out-set hashes.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, `node --test dist/src/experimental/hypothesis/v1_claude/__tests__/e5-human-review.test.js` (6/6), and `git diff --check` passed. Tests use synthetic keys, treatment records, and hashes only; no retained fixture media, hand-authored output, generated video, reference frame, provider, or judge was read or used.
- This closes a report-integrity gap in the tool, not an E5 quality gate. No frozen held-out set, source-generated pair, reviewer pack, human vote, or visual-quality result exists; E5 remains unmeasured.

## Entry — 2026-09-24, add fail-closed E4 threshold calibrator

- Added `catalog:e4:calibrate`, a pure labeled-pair evaluator. It validates unique source/case/concept/asset records tied to a catalog hash and embedding model; requires at least 200 pairs plus 50 human-adjudicated labels; uses the human label where present; reports the full cosine cutoff curve and VLM/human agreement; and selects a threshold only when both ≥0.90 icon precision and ≥0.85 overall semantic match are met. It does not change the live τ constants. Updated `ladder.ts` comments to state clearly that current values are uncalibrated.
- Tightened the fail-closed behavior after review: when pair or human-check minimums are not met, the report remains `unmeasured` and has no selected threshold even if a partial curve happens to satisfy the numeric ratios. `npm run typecheck:hypothesis`, `npm run build`, and E4 tests passed again (4/4).
- The baseline inventory confirms there is no existing E4 input set or holdout corpus to run: its 77 entries are reference media/frames and retained run artifacts, while G-10 remains partial and G-DOC/G-LONG remain missing. I did not manufacture 200 “real” pairs from fixtures or examples.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, and focused `e4-calibration`, `e5-comparison`, and `e5-human-review` tests passed (12/12); `git diff --check` passed. E4 tests use synthetic label records only; no media, catalog visuals, VLM, or provider was inspected/called.
- The evaluator is implemented/tested, but E4 calibration is still unmeasured and runtime thresholds remain starting guesses until the real labeled set and 50 human checks exist.

## Entry — 2026-09-24, require frozen source membership for E5 holdout reviews

- E5 pack creation now requires `--dataset=<versioned-heldout-set.json>` and checks each run's case ID plus exact `run-manifest.json` `stages.sourceDoc` SHA-256 against that set. A title match or generated-run label alone cannot qualify a source for held-out review. The dataset file hash and set ID/version are recorded in organizer provenance before any videos are copied.
- The only available source inventory is not an E5 held-out set: `baseline-inventory/v2` has 77 entries (4 reference videos, 33 reference frames, 40 retained run artifacts); its own ledger says G-10 is partial and G-DOC/G-LONG are missing. No held-out source manifest was fabricated. The E5 review CLI therefore cannot be used until the frozen source set is supplied.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, focused `e5-comparison`, `e5-human-review`, and `judge-eligibility` tests passed (10/10); `git diff --check` passed. Tests used synthetic hashes/manifests only; no video file was read, copied, rendered, or scored.
- This enforces held-out source identity but supplies no holdout data and no quality evidence. E5 and C6 visual results remain unmeasured.

## Entry — 2026-09-24, implement blinded E5 timed-video reviews

- Added `judge:e5:human:pack:hypothesis` to create full-video A/B reviewer folders and `judge:e5:human:hypothesis` to validate and score the two independent vote files. Pack creation calls the existing generated-run eligibility and matched-pair gates before copying any video; participant folders contain only opaque names/IDs, full timed MP4s, a synchronized play/seek UI, and the vote form. A/B order is counterbalanced across the two judges. The sealed key and organizer record retain run/treatment mapping, source/video hashes, and successful-video API costs outside reviewer folders.
- The cost calculation reconstructs original spend for warm provider artifacts from `artifactApiCostUsd`; it fails closed if a cached provider stage has no original cost. Reports keep individual judge results and report preference, clarity, mechanism explanation, factual-concern rate, and API cost by arm/model/order. They are descriptive and do not choose an architecture.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, and focused `e5-human-review`, `e5-comparison`, and `judge-eligibility` tests passed (9/9). Synthetic test data covered blind orientation, controlled prompt/model contrasts, incomplete votes, report aggregation, warm-cache costs, and fixture rejection. No video pack was created and no media was read, copied, rendered, or evaluated.
- E5 human review tooling is implemented and contract-tested; no real source-generated pair, human vote, held-out comparison, or visual quality result exists. Next: run it only after matched held-out generated lessons pass the gates and real review is authorized/available.

## Entry — 2026-09-24, fail closed on evaluation-golden exemplar leakage

- S6 exemplar retrieval now excludes any example with an evaluation `goldenId`, examples explicitly assigned to development/test splits, the target source/lesson ID, and lexical intent near-duplicates. It no longer relies on substring ID matching. Added required `evaluationSplit` provenance to each bank entry and bumped bank to v3 and ranking policy to v2; the versioned near-duplicate cutoff is 0.72 Jaccard. This only catches lexical similarity, not semantic paraphrases.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, and focused `scene-context`, `prompt-experiment-eligibility`, and `e5-comparison` tests passed (18/18); `git diff --check` passed. Tests use synthetic contracts/manifests and do not render media.
- No fixture media, hand-authored output, generated video, reference frame, provider, or judge was used. This closes a retrieval-leakage control only; E5 treatment quality, exemplar quality, C6, and generated-video visual quality remain unmeasured.

## Entry — 2026-09-24, fixture-media evaluation boundary

- The user clarified that old generated hardcoded fixture output must not be used as architecture or visual-quality evidence. This is now explicit in `CLAUDE.md` and the implementation ledger: do not render, inspect, compare, or score retained fixture media or hand-authored scene output for C6/E1/E5; only complete source-generated lessons may enter those reviews. Synthetic fixture values remain permitted only for isolated code-contract tests.
- Existing historical fixture runs and preview notes are retained as provenance records, not renewed or treated as quality measurements. No fixture media was opened or rendered during this turn.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, and focused synthetic contract suites for `e5-comparison`, `prompt-experiment-eligibility`, and `scene-context` passed (18/18); `git diff --check` passed. These checks do not render media or evaluate visual quality.
- Current quality status remains unmeasured: no complete source-generated video has passed C6, no E1 human pack/votes exist, and no E5 timed-video comparison exists. Continue implementation work that does not need a visual-quality claim; do not substitute fixture output if live generation is unavailable.

## Entry — 2026-09-24, establish matched E5 run identity and upstream reuse

- Run manifests now record S6 prompt arm, example order, planner model, bank/rank/catalog/prompt versions, and SHA-256 of the exact muxed narration audio. Added `harness/e5Comparison.ts`: it admits only individually judge-eligible generated lessons and requires matching case/input/source/narration/alignment/audio hashes plus voice/render/content-model settings; it also enforces whether the declared contrast changes prompt treatment or planner model. Added `lessonCli --stage-cache=<dir>` so separate treatment output directories can reuse content-addressed S1–S5 artifacts while S6 remains treatment-keyed.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, and focused `e5-comparison.test.js` passed (2/2); `git diff --check` passed. Synthetic records cover matching prompt-arm and planner-model pairs, and reject fixtures, changed input/narration/audio/voice, and uncontrolled contrasts.
- No video, old fixture, reference frame, TTS, or provider run was used. E5 pair integrity and cache configuration are implemented/tested; no human timed-video pack or quality comparison exists yet.

## Entry — 2026-09-24, fail closed on ineligible E5 prompt treatments

- E5 retrieval arms now require explicit `generated-lesson` provenance, the exact `SourceDoc`, a LessonBible and SceneContract for every scene, and no hand-authored SceneSpec. Invalid arm/order settings and fixture/script inputs fail before output-directory creation, TTS, or provider work, preventing a run from being mislabeled as a retrieval comparison when no few-shot treatment can be applied.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, and focused prompt-experiment eligibility plus scene-context tests passed (16/16); `git diff --check` passed. Synthetic cases cover eligible source-generated shape, fixture provenance, hand-authored scene, missing source/contract, and zero-shot/order mismatch.
- No video, fixture, reference frame, TTS, or provider call was used. E5 runtime eligibility is tested; model and visual comparisons remain unmeasured.

## Entry — 2026-09-24, add reproducible E5 example-order arm

- The lesson runner accepts `--example-order=ranked|reverse` for text/mechanism/diverse prompt arms; zero-shot plus reverse is rejected. The selected order changes `ScenePlanningContext` v2 and its hash, compiled prompt, S6 cache input, run ID, and config hash. Run summaries report the selected order. The default stays zero-shot/ranked.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, focused `scene-context.test.js` (14/14), and `git diff --check` passed. Synthetic tests assert the same selected examples are ordered in reverse, context hashes differ, and the system prompt reflects each order.
- No old fixture output or media was rendered/scored and no provider was called. E5 order-sensitivity plumbing is tested; model behavior and timed-video quality comparison remain unmeasured.

## Entry — 2026-09-24, add fail-closed exemplar promotion governance

- Exemplar bank v2 now records provenance and separate factuality, visual, license, leakage, and human review states per example. `exemplarPromotionProblems` rejects `approved` status unless all five reviews pass and an identified reviewer plus valid timestamp are recorded. Existing examples remain experimental with all review states pending; no example was promoted. Bank version bump invalidates old cached contexts.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, and focused `scene-context.test.js` passed (13/13); `git diff --check` passed. Synthetic promotion cases cover pending reviews, missing reviewer/time, a complete review record, and missing provenance.
- No old fixture, generated video, or reference frame was rendered or scored. This validates review metadata and approval gating only; it does not approve the current examples, certify their visual/factual quality, or establish that few-shot planning improves outputs. Continue with source-generated lessons and held-out E5 only after provider access is available.

## Entry — 2026-09-24, close S6 container-label anti-copy gap

- The few-shot copy guard now inspects `container.children`, which are rendered labels. Before this change, an unsupported phrase copied from a selected exemplar could be placed in a container and escape the exact-phrase guard. Added a synthetic planner regression that retains the template and example while attempting to copy “sensor readings” into a target lesson about heat and pressure.
- Verification: `npm run typecheck:hypothesis`, `npm run build`, `node --test dist/src/experimental/hypothesis/v1_claude/__tests__/scene-context.test.js` (12/12), and `git diff --check` passed.
- No fixture, hand-authored scene, generated video, or reference frame was rendered or scored. This is a deterministic source-code guard check only; it does not establish visual quality. The guard is still lexical and does not prove semantic non-copying for paraphrases; held-out human review remains required.

## Entry — 2026-09-24, enforce canonical terms in S6 scenes

- S6 now checks its generated SceneSpec against the S3 LessonBible: every persistent concept linked into a scene must have its canonical term visibly present on at least one linked element. A synonym alone no longer passes; explanatory copy may accompany the canonical term. The system prompt states the rule, and `scene-planner-prompt-v5` invalidates older S6 cache entries.
- Verification: `npm run typecheck:hypothesis` and `npm run build` passed; 16 focused S3/S6 and cache tests passed, then all 11 scene-context tests passed again after the final deterministic normalization adjustment; `git diff --check` passed. Synthetic scene input verifies the synonym-only label fails and the canonical label passes. No fixture/generated/reference video was rendered or scored.
- Limitation: the code now enforces canonical naming, but a provider-generated lesson is still needed to see whether the resulting terminology improves finished teaching visuals.

## Entry — 2026-09-24, enforce persistent-concept terminology in S3

- Closed an S3 contract gap: concepts used in multiple scene sections must be declared persistent, each declared persistent concept must have a canonical vocabulary entry matching its source concept label, and duplicate terminology entries/IDs are rejected before narration. The S3 prompt is now v2, so cached plans from the prior instructions cannot bypass or repeatedly fail the new rule. This gives S6 one stable data term for recurring concepts.
- Verification: `npm run typecheck:hypothesis` and `npm run build` passed; 15 focused S3/S6 contract and content-cache tests passed; `git diff --check` passed. Synthetic plan tests cover missing persistent terms, undeclared recurring concepts and duplicate entries/IDs; the cache test proves a prompt-version change causes a miss after a warm v1 hit. No generated or fixture video was rendered or scored.
- Limitation: the prompt and validated plan now supply consistent terms, but there is still no provider-generated lesson proving that the planner uses them consistently in finished visuals.

## Entry — 2026-09-24, validate external E1 vote data at runtime

- Fixed the E1 review crash found during review: answer keys and human vote files now pass Zod runtime schemas before scoring. Invalid shapes and malformed JSON produce an `unmeasured` report with the input preserved in `rawVotes` and validation reasons; they no longer throw on fields such as `participantId.trim()` or `votes.map()`.
- Verification: `npm run typecheck:hypothesis` and `npm run build` passed; 12 focused human-review, judge-eligibility, and judge-cache tests passed; a temporary-file CLI check exited 0 and wrote an `unmeasured` report preserving a JSON parse error; `git diff --check` passed. Synthetic cases cover null/missing key/vote fields, invalid vote arrays, malformed JSON markers, and valid threshold pass/fail cases.
- No human pack was generated and no fixture or reference media was rendered or scored. Human E1 and visual quality remain unmeasured.

## Entry — 2026-09-24, content-addressed VLM judge cache

- Added a disk cache for valid vision-judge results, keyed by judge model, prompt version, output-schema version, exact prompt, and ordered hashes of image bytes. Malformed cache files and schema-invalid cached values are ignored; provider/model failures are not cached. The judge report records cache hits/misses and keeps API spend separate from cache reuse.
- The cache defaults under `.data/hypothesis-runs/judge-cache`; `--cache-dir` can select another local cache directory. Atomic temp-file writes avoid partially written cache records.
- Verification: `npm run typecheck:hypothesis` and `npm run build` passed; nine focused cache, E1 synthetic-vote, and judge-eligibility tests passed; `git diff --check` passed. Synthetic cache tests verify key sensitivity and reject malformed/schema-invalid entries. No fixture video/image or visual judge was used; no VLM request was made.

## Entry — 2026-09-24, portable blind E1 participant packs

- Fixed the human-review handoff: each participant folder now contains copies of its own opaque images, a self-contained `review.html`, an offline vote form for anonymous A/B grouping and style ratings, and a download button that exports the exact `e1-human-vote/v1` JSON shape. Participant instructions tell the organizer to distribute the two folders separately. The key/provenance remain outside both folders.
- Verification: `npm run typecheck:hypothesis` and `npm run build` passed; eleven focused cache, synthetic vote, review-page, image-copy, and eligibility tests passed; `git diff --check` passed. Tests verify the participant folder contains the referenced image beside the offline page. No real review pack or video frames were created and no old fixture output was rendered or scored.
- Limitation: a real generated-lesson pack and human review remain pending; E1 and visual quality are still unmeasured.

## Entry — 2026-09-24, E1 human review tooling (no fixture measurements)

- Added an E1 pack builder that accepts only an eligible, complete `generated-lesson` run and an explicit topic match, then samples 10 generated frames and 10 reference frames tagged for that topic. It writes two independently ordered, opaque participant manifests and blank vote templates; the source answer key and organizer provenance are separate from the participant pack. The private organizer record hashes the run/source/video, topic map, reference index/videos, and sampled frames, and records each source timestamp.
- Added the two-judge vote aggregator. It preserves both raw vote sets and individual source-identification/style scores; malformed or incomplete votes remain `unmeasured`, and only two valid judges can satisfy the configured thresholds. Source group A/B orientation is treated as anonymous by evaluating the better of the two label mappings.
- Tightened the style gate so each judge must rate the generated frames at least 4/5 independently; high Simi/reference ratings cannot offset low generated-video ratings. A synthetic regression case reproduces and blocks that false-pass scenario.
- Verification: `npm run typecheck:hypothesis` and `npm run build` passed; seven focused tests passed (synthetic vote records, blind-manifest data, and judge-eligibility policy); `git diff --check` passed. No blind pack was generated, no human votes were collected, and no historical or hand-authored fixture video/frame was rendered, scored, or used as evidence.
- Limitation: no eligible fully generated lesson is available, so E1 visual/style acceptance remains unmeasured. These tools prepare an auditable evaluation; they do not establish visual quality or a winning architecture.

## Entry — 2026-09-24, judge eligibility and topic-safe Simi comparisons

- Corrected the report path that previously judged every run directory and cycled through unrelated Simi frames. Reports now admit only complete `generated-lesson` runs with the live v2 ledger, exact narration/scene coverage, a source document, no hard failures or planner fallbacks, completed S1–S12 stage records, present local video/source artifacts, consistent run identity, and passing per-scene gates. Draft runs can be judged because they are awaiting that external judgment; fixture, hand-authored, failed, and diagnostic-fallback outputs are excluded. The eligibility check is enforced in both the CLI and exported judge API.
- Simi matching now requires an explicit `--topic=attention|photosynthesis` that also matches the run's case ID or source title. The versioned topic map tags the Attention and photosynthesis source videos; other indexed reference videos remain unclassified and cannot be used as matched references. Without `--topic`, the report is clearly style-only. The topic-map version and SHA-256 are saved in each report.
- The judge samples each eligible scene at three chronological reveal points and attaches the active aligned word to a timed-sequence score. It still records the finished-frame clarity and style scores; no timed-video judge API call has been made. Prompt version is now `judge/v3` after adding this temporal criterion.
- Updated E1 and E2/E3/E6/E7/E8 sampling rules: completed source-generated scenes/videos only. Renderer fixtures remain useful for code-path checks, never for visual or architecture-quality scores.
- Verification: `npm run build` passed; focused synthetic judge-policy tests passed (2/2), including direct API rejection of a fixture before video/model access, incomplete stages/scenes, fallback, failed gate, run identity/topic mismatch, path traversal, and three chronological aligned-word sample points; `git diff --check` passed. No historical video or Simi comparison was run.

## Entry — 2026-09-24, live stage and gate ledger

- Implemented `evaluation-bundle/v2` for the live runner. The run artifact now includes S1 source intake and S2–S12 stage records with duration, current-invocation API spend, cached artifact spend when known, cache status, fallback count, usage, and failures. It also records per-scene Claude/shared gates and the final publish decision.
- The lesson CLI summary now includes these execution records, including preparation failures. Renderer-fixture and hand-authored-script runs remain excluded from visual-quality measurements and successful generated-video cost claims. No old fixture video was rendered or scored for this implementation.
- Verification: `npm run typecheck:hypothesis` passed; `git diff --check` passed. No fixture test suite, video render, provider call, or visual comparison was run.
- Limit: a fresh provider-generated lesson is still unavailable, so generated visuals, per-stage live costs, cache-hit timing, and gate outcomes remain unmeasured. This ledger makes future live results auditable; it does not establish quality by itself.

## Entry — 2026-09-24, generated-planner implementation continuation

- S3 SceneContracts now require a per-scene duration equal to the section budget. The LessonBible may carry a broad optional domain tag for low-weight exemplar retrieval; it does not select lesson content or renderer branches.
- S6's hashed planning context now includes the exact available templates and slots, source-grounded evidence, measured mention times, the contract/bible, and the selected experimental examples. The typed cached stage payload and planner log retain the exact compiled system/user prompt, prompt/context hashes, ordered exemplar IDs and scores, and versions. A focused cache test confirms warm replay preserves this audit payload. The old fixed Attention/math examples are not used as runtime evidence or E5 arms.
- S6 now rejects distinctive text and numeric facts copied from selected few-shot examples unless the target source independently supports them. The running agent does not edit or promote the exemplar bank.
- Generated factual numeric labels and data fields now need a matching number in the evidence cited on that visual item; incompatible physical units fail. Percent evidence may map to a normalized meter fraction. Explicit illustrative-example values remain classified separately.
- S6 now filters per-mention catalog candidates below the renderer's current `TAU_MID_EMB` feasibility threshold before prompt compilation. The named threshold-policy version affects the context, S6 cache key, run ID, and config hash. This only prevents weak candidates from being presented as feasible; E4's 200-pair precision calibration remains unmeasured.
- `npm run typecheck:hypothesis` passed. The full offline suite previously reported 224 passing tests, including legacy fixture renderer checks; those are not visual-quality evidence and will not be used for evaluation. The focused cache, S3/S6, numeric-provenance, candidate-filter, and few-shot anti-copy tests pass (14/14).
- No fresh provider-generated lesson could be run: there is no local or inherited provider key, and DNS could not resolve `openrouter.ai`. A generated lesson and its visual quality therefore remain unmeasured.
- `npm run baseline:verify` failed because frozen v1/v2 manifests reference historical run artifacts that are absent from this checkout. Manifests were left untouched; missing files were not recreated or replaced with new outputs.
- C1–C6/E1–E10, including visual acceptance and exemplar-arm quality, remain unmeasured. Do not use old fixture renders to fill those results.

## Entry — 2026-09-24, reference correction and source-grounded scene context

- **Correction v2:** `harness/reference/lamina/index.json` identifies `simi-scene01.png` as a photosynthesis frame from `simi.mp4`. The topic-matched Attention opening is `lamina-video-ec6c5e81-291c-4917-93f5-7820f50b4213-1-scene01.png`. The earlier token-strip/blue-rectangle comparison used a misattributed reference and is withdrawn. No renderer treatment is selected from it. Frozen v1 files were preserved; `harness/baselines/manifest.v2.json` inventories and hashes 77 retained videos, frames, and run artifacts and records missing G-10/G-DOC/G-LONG sets.
- S3 now asks its existing teaching-model call for a LessonBible and per-scene evidence-linked SceneContracts. Deterministic validation checks concept IDs, every internal graph relation, and exact source span IDs. S4 narration and S5 measured mentions join that contract in a typed S6 planning context without a prompt-writing model call.
- S6 now defaults to zero-shot for new generated runs. Following the user's correction, the five old Attention/math demonstrations have been removed from the runtime prompt and E5 arms; historical fixtures remain only as archived baseline evidence. A versioned, cross-domain structural example bank and deterministic `text`, `mechanism`, and `diverse` selection arms are available behind `--prompt-arm`; all bank entries remain **experimental**, with no human visual approval or held-out E5 result. Prompt/context hashes, selected IDs, ordering, and bank/catalog versions are logged and affect cache identity.
- A planner/provider failure remains hard when a deterministic fallback is rendered for diagnosis. `lessonCli` also stops before live rendering if preparation retained any hard failure.
- This implementation changes planning and audit behavior, not the visual acceptance result. C6/E1–E10, complete generated lessons, RAG coverage, and long-form cost/quality remain unmeasured or failed as previously recorded. Do not promote the bank or the experimental track until held-out timed-video gates pass.

## Entry — 2026-09-24, resumed goal check and C6 ledger correction

### Evidence and changes

- Inspected the existing C6/Simi comparison. The older `.data/.../fixtures-attention` run is stale for current source: its evaluation bundle reports 0.40 occupancy and its manifest predates current output identity. Preserved it; did not overwrite it.
- Checked the saved Codex goal: it is `active`, not paused. No goal-state transition was required. Reconciled this handoff and the validation ledger with the latest C6 fixture, which supersedes the earlier `fixtures-attention-c6-g6-v2` result.
- Ran a fresh no-provider renderer fixture to `.data/hypothesis-runs/claude/fixtures/fixtures-attention-c6-final`. It uses the three hand-authored C6 Attention SceneSpecs, not generated planner output. Result: 3 scenes, 0 hard failures, 0 warnings, mean occupancy 0.4904, status `draft` (fixture provenance and no judge attestation). The run writes SVG/contact-sheet artifacts, not MP4. The matched human C6 gate remains unmeasured.
- The opening token strip looked like a row of product UI cards. Generic `tokenStrip` rendering now places bare, variable-width words and uses one filled marker behind highlighted words. A generic timeline emphasis event now interrupts long final holds by re-emphasizing an already revealed element; no new lesson content is added. Resolver, layout, timeline, and render stages have explicit versions included in artifact keys and run/config identity.
- Resolved the G6 spec conflict in favor of its explicit hard gate: note-tier font token is 32px; all visible text below 32px now fails hard. A regression test shrinks the C6 token-strip element and verifies all six resulting labels block the run. This is stricter than the former behavior that downgraded note-tier text to warnings.
- Latest run identity: `26f092b9725224aae36a873ec97268cacf4d83e0bdef7d2454d5bf1d9cdfe4a4`. Its manifest records versioned S7/S8/S9/S10 artifact keys. Warm reuse and changed-source live invalidation remain unmeasured.

### Verification

```
npm run typecheck:hypothesis -> passed
npm run test:hypothesis -> 217 passed, 0 failed
npm run run:hypothesis -- --case transformer-attention --out .data/hypothesis-runs/claude/fixtures/fixtures-attention-c6-final
  -> 3 scenes, 0 hard failures, 0 warnings, mean occupancy 0.4904, draft
```

### C6 disposition / next work

- **Superseded by correction v2 above:** the frame previously called a matched Simi Attention opening is a photosynthesis frame. Its token-strip conclusion and proposed renderer A/B are invalid.
- The fixture has no MP4, so progressive timing is not compared. C6 remains `unmeasured` for human quality/style acceptance; no two-human scores or order-reversed VLM scores exist. Compare the correctly attributed Attention reference and full timed videos before selecting any renderer treatment.
- Next visual acceptance step: evaluate generic mechanism scenes across unrelated topics using correctly attributed references, then obtain the C6/E1 human and reversed-order VLM judgments. Prompt-context infrastructure may be implemented independently, but RAG/long-form adoption waits for visual acceptance.

## Historical entry — 2026-09-24, initial few-shot boundary and E5 research plan (superseded)

### Implemented in this entry

- This was the initial implementation and is no longer the active runtime path. The Attention/math demonstration fixtures have been removed from the Scene Planner prompt and from E5. Do not use their prior generated outputs as evidence of generated-planner quality.
- The current planner defaults to zero-shot. A separate versioned cross-domain bank contains experimental structural examples; retrieval arms are `text`, `mechanism`, and `diverse`. Those examples have not passed promotion review and are not quality evidence.
- The historical offline checks exercised prompt boundaries and escaping; they did not establish visual quality. E5 remains unmeasured and must use fresh generated lessons, with no fixture outputs counted.
- “Agent learning” is scoped as reviewed, versioned exemplar-bank promotion plus a new offline evaluation. No online self-modification or automatic promotion is implemented.

### Research-informed choices

- Anthropic’s prompting guidance recommends relevant, diverse examples with clear structure; retrieval research finds that surface similarity can select redundant examples and that task/skill-aware or coverage-based selection may help. Those results motivate E5 arms, but do not prove better explainer videos. Prompt order can also change outcomes, so E5 records and checks order.
- Consulted: [Anthropic prompt engineering best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [coverage-based example selection (EMNLP Findings 2023)](https://aclanthology.org/2023.findings-emnlp.930/), [skill-based few-shot selection (EMNLP 2023)](https://aclanthology.org/2023.emnlp-main.831/), [sequential example selection (ACL Findings 2024)](https://aclanthology.org/2024.findings-acl.312/), [prompt order sensitivity (2021)](https://arxiv.org/abs/2104.08786), and [MIPRO prompt/demonstration optimization (2024)](https://arxiv.org/abs/2406.11695). These works concern task metrics, not our visual quality gate; validate locally.
- The local skill inventory has no installed `ai-engineer` skill. A community listing surfaced but is marked critical risk, so it was not installed or executed; the plan uses primary documentation and papers instead.

### Verification

`npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (214 passed, 0 failed). Dynamic retrieval and its visual effect remain unmeasured.

## Entry — 2026-09-24, provider-backed stage resume and budget accounting

### Implemented and tested

- Added the persistent per-lesson/case spend ledger at `budget-ledger.json`. S2–S4 and S6 calls in one run share it. It serializes provider calls across processes, writes actual returned spend atomically, refuses calls at the ceiling, and marks the ledger blocked when a request fails with unknown billing or when a prior lock is abandoned. Known DNS/connection failures before dispatch are recorded as zero-spend preflight failures and do not block a later retry.
- Added provider-backed content-addressed caching for S2 concept extraction, S3 teaching plans, S4 narration scripts, and S6 scene planning. Cache keys include input dependencies plus declared schema, stage, prompt, model, and (S6) catalog versions. Cache hits preserve original responses/failures for audit but contribute zero current-run calls/tokens/cost.
- `lessonCli` and `liveCli` accept `--cache=cold|warm|replay` and default to warm reuse under each output directory's `stage-cache`. Their summaries report cache hits and ledger spend/call counts.
- A call that returns actual spend above its supplied remaining allowance or above the persistent ceiling is recorded and creates a hard failure; it is not presented as a passing artifact.
- Added offline coverage for serialized budget enforcement, actual spend persistence, known preflight failure handling, uncertain provider failure blocking, abandoned-lock fail-closed behavior, and cache reuse/invalidation.

### Verification

```
npm run typecheck:hypothesis -> passed
npm run test:hypothesis -> 213 passed, 0 failed
```

### Limits and next work

- No paid provider run was made to measure cold/warm reuse or reconcile the returned OpenRouter cost against account billing. A warm run can reuse cached failures too; use `--cache=cold` for an explicit fresh attempt, while preserving the old artifacts.
- S1–S12 processing stages now have typed artifacts: source intake, S2–S4, S5 audio bytes/timings, S6, S7–S10, S11 MP4 output-hash verification, and S12 captions. The final evaluation/publish status and output manifests are recomputed each run. A paid live warm-run and complete changed-source dependency-invalidation test remain unmeasured.
- Persistent accounting is per output directory. After an uncertain provider error or abandoned `.lock`, the ledger deliberately requires manual investigation; do not delete that lock just to rerun because billing may have occurred.
- C6/E1–E10 remain unmeasured; Simi parity, generated lesson quality, real audio sync, RAG, and long-form runs remain out of scope until the visual gates pass.

### Live smoke attempt

- Ran a capped 30-second generated lesson from `docs/ARCHITECTURE.md` through `lessonCli`, using the configured content/planner model IDs. S2 stopped with `fetch failed`; there is no graph, plan, script, TTS, alignment, or MP4 from this attempt.
- The `/tmp` run summary reports prepare failed and $0 returned usage. Its per-run ledger has `calls: 0`, `spentUsd: 0`, and `blocked: true` with `uncertainty: "fetch failed"`; this ledger predates cause-code classification and remains untouched. A separate unauthenticated models endpoint probe failed DNS with `ENOTFOUND`, so no further model request was attempted.

## Entry — 2026-09-24, deterministic browser player

### Implemented and tested

- Split master-clock frame selection and erase transitions into browser-safe `export/frame.ts`. MP4 encoding and the browser player now use the same pure `frameSvgAt`; the renderer no longer imports Node-only MathJax just to generate formula part IDs (`render/mathIds.ts`).
- Added an experimental, loopback preview command: `npm run preview:hypothesis -- <run-directory> [port]`. It reads the run manifest, evaluation status, aligned word clock, laid-out scenes, and timelines; optional `audio.wav` and `captions.vtt` are served from that run directory.
- The client supports play/pause, seek, playback speed, optional audio-clock sync, and aligned-word display. It visibly retains `draft`/`failed`/`passed` status and does not execute model output or accept arbitrary SVG/code. Static module serving is limited to the hypothesis renderer and shared hypothesis module directories; production files are excluded.
- Local in-app browser check on the C6 fixture rendered the timed query reveal, advanced playback to 660 ms, then sought to 15 s and updated both the displayed playhead and active narration word. Browser reported no console warnings/errors. The fixture has no audio, so audio-clock synchronization was not exercised.
- Added route tests for the preview page/data/module responses, status preservation, and rejection of POST and production-file paths.

### Verification

```
npm run typecheck:hypothesis -> passed
npm run test:hypothesis -> 209 passed, 0 failed
npm run baseline:verify -> 40 frozen files verified; G-10/G-DOC/G-LONG test sets missing
(cd src/experimental/hypothesis/shared && sha256sum -c MANIFEST.sha256) -> passed
git diff --check -> passed
```

### Limits and next work

- Player behavior has been exercised on a hand-authored renderer fixture only. Verify real generated output, audio sync, VTT caption rendering, browser seeking across scene transitions, and responsive presentation before calling S10 complete.
- The route suite is in-process because the default test sandbox denies loopback binds; a separate localhost browser run verified playback. Continue with the live runner's persistent budget accounting and stage resume after this renderer/player path.
- This does not close C6/E1, nor justify RAG or long-form work. Preserve the draft status and remaining idle warning from the C6 preview.

## Entry — 2026-09-24, C6 occupancy follow-up

### Implemented and tested

- Updated the generic `weighted_blend` template's input-row spacing. The three hand-authored Attention fixture scenes now occupy `[0.45, 0.75]` without changing topic-specific renderer behavior; an E2E assertion protects this fixture's occupancy result.
- Kept the opener magnifying-glass metaphor and query/key catalog examples in the versioned C6 fixture only, marked `illustrative-example`; no frozen fixture or baseline was changed.
- Fresh renderer-fixture run: 3 scenes, 0 hard failures, 1 warning (`idle`, 4,159 ms) in the query-to-scores scene. Status remains `draft`; no external judge is recorded.
- Latest contact sheet is available at `/tmp/hyp-claude-c6-review/contact-sheet.png`. It is a static fixture preview, not a timed video or Simi comparison.
- Replaced the tautological renderer equality assertion with a real comparison between `frameSvgAt` (used by MP4 encoding) and the canonical `renderSVG` result at the same timestamp. This validates sampler parity for one scene; it does not create or validate a browser player.

### Verification

```
npm run typecheck:hypothesis -> passed
npm run test:hypothesis -> 208 passed, 0 failed
npm run baseline:verify -> 40 frozen files verified; G-10/G-DOC/G-LONG test sets missing
(cd src/experimental/hypothesis/shared && sha256sum -c MANIFEST.sha256) -> passed
git diff --check -> passed
```

### Limits and next work

- The spacing change addresses occupancy only. Visual clarity and style parity still require the planned matched-frame and timed-video C6/E1 review with two humans and order-reversed VLM judgments.
- One long-idle warning remains; it is not converted to a pass or silently suppressed. No generated lesson, browser-player parity, E1/E4–E10, RAG, or long-form result is established here.
- Continue C6 generically; review actual timed frames and fix reusable renderer/layout issues before prompt tuning. Preserve all frozen references and the worktree state.

## Entry — 2026-09-24, source structure and evidence wiring

### Implemented and tested

- Added `plan/sourceDoc.ts`: stable source identity includes format and exact text; spans retain character and line offsets, structural kinds, and exact quote resolution.
- Wired source evidence into S2 ConceptGraph claims/relations and into S6 SceneSpec elements/titles/edges. Generated factual scene values need references to exact source spans; typed relation edges must match the extracted graph. Missing or forged evidence is rejected before renderer handoff.
- `runLive` records `source-doc.json` and re-resolves references before evaluating a generated lesson. Factual scene evidence is included in the evaluation bundle. Current mapping is section-level; precise sentence/visual-claim attribution still needs work.
- Added `plan/sourceIntake.ts` and connected `lessonCli --source=...`: plain text/Markdown, PDF page extraction through `pdftotext`, DOCX text/headings/tables/equations/figure descriptions, and PPTX slides/tables in numeric order. Extraction caps the input at 50 MB / 5 million text characters, caps PPTX at 500 slides, and uses bounded parallel extraction.
- Added parser tests for Markdown offsets and the office formats. At that point the test suite had 207 passing tests (current count: 208; see latest entry).
- Fixed a readability failure revealed when the Attention fixture switched to actual catalog icons: 3+ convergence inputs used to occupy one vertical column, shrinking their labels below 32 px. The generic convergence template now lays these inputs in a data-sized grid. Added `fixtures/attentionScenes.c6.ts` as a versioned renderer experiment; the original hashed `attentionScenes.ts` stays unchanged.
- The C6 Attention run now clears deterministic layout/readability hard gates and resolves the query/key metaphors through licensed Streamline icons. I rendered a contact sheet for inspection; it is still visually simpler and sparser than the Lamina reference, so C6 style parity/E1 remain unmeasured.

### Verification

```
npm run typecheck:hypothesis -> passed
npm run test:hypothesis -> 207 passed, 0 failed
npm run baseline:verify -> 40 frozen files verified; G-10 partial, G-DOC and G-LONG missing
src/experimental/hypothesis/shared/MANIFEST.sha256 -> verified
```

### Limits and next work

- PDF intake currently requires extractable text and the local `pdftotext` executable; scanned-page OCR is not implemented. DOCX/PPTX intake is structural text extraction, not faithful image/formula extraction. Source locations refer to extracted text spans (PDF page markers are retained), not original byte offsets.
- Evidence correctness is guarded in code/tests, but no full live generated lesson has yet demonstrated complete claim-to-rendered-value provenance. Prompt/model outcomes are not yet measured.
- C6/E1–E10 remain unmeasured. C6 renderer proof still precedes broader prompt optimization. Browser player, live-stage resume, persistent budgets, RAG, and long-form jobs remain open.
- S11 now has a bounded raster worker pool. An offline integration test rasterizes a deterministic frame, writes a valid MP4 through system ffmpeg, and decodes it again. This does not establish full-job speed or visual parity.
- The separate hypothesis browser player is still absent. Existing production app playback is a different renderer/runtime and does not satisfy that item.
- Keep the earlier entry below as historical context; its 194-test count and evidence/intake gap notes predate this entry.

### S6 relation-transfer follow-up

- Scene elements can now carry S2 `conceptIds`; the generated-scene planner requires every extracted relation to have a typed edge between elements linked to the correct endpoint concepts. Both edge and relation citations must match the exact relation evidence. Tests cover omitted relations, wrong visual endpoints, unrelated-but-allowed citations, and valid transfer.
- Fallback output is no longer discarded merely because it cannot represent a source relation. A schema-safe fallback remains renderable as a diagnostic, is counted and labeled as fallback, and carries a hard `planner-fallback-gate` when relation/evidence checks fail. Thus it can be judged, but cannot become a passing artifact.
- Verification after this follow-up: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed 203/203. This remains offline contract evidence; no generated lesson or visual-quality experiment has been run.

### S11 export follow-up

- Added a bounded worker-thread raster pool for MP4 frame conversion. Frames are rasterized concurrently but written to ffmpeg in order; encoder failures abort ffmpeg and worker cleanup is bounded.
- Added tests for byte-identical output against synchronous resvg and for a real ffmpeg MP4 encode/decode smoke test using a generated silent WAV. The fixture `runHypothesis` remains an SVG-only path and does not claim to emit MP4.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed 205/205.
- Browser playback, full-duration encode throughput, audio/video sync tolerance on real voice jobs, and S12 visual publish judgment remain unmeasured.

### Offline fixture cache follow-up

- Added a typed local content-addressed artifact store. Keys include upstream hashes and stage, schema, prompt, model, and catalog versions; writes are atomic and payload hashes are verified on replay.
- Wired warm reuse into offline fixture S4, S5, and S7–S10. The CLI accepts `--cache cold|warm|replay` and `--artifact-cache-dir <path>`; the run manifest records each stage key and output hash.
- E2E verification proves 14 warm hits for an unchanged three-scene run and changed narration invalidates its S4/S5 artifacts. Provider-backed stages, interruption recovery, and the global budget ledger are not integrated.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed 207/207; `npm run baseline:verify` verified 40 extant frozen files (G-10 partial, G-DOC/G-LONG absent); `(cd src/experimental/hypothesis/shared && sha256sum -c MANIFEST.sha256)` passed all entries.

## Entry — 2026-09-24, immutable baseline and publish-status integrity

### Implemented

- `CLAUDE.md` is the canonical instruction set. `AGENTS.md` now points to it and names the real hypothesis commands.
- Added a first-write-only hash inventory at `harness/baselines/manifest.v1.json`; `npm run baseline:verify` checks the frozen fixture/reference files. It explicitly reports G-10 partial, G-DOC missing, and G-LONG missing.
- Live CLIs load the versioned stable-ts/Supertonic calibration record instead of embedding `36.5` in code. That record states its 18-boundary, 8-clip sample and limitations (including a 505 ms maximum error).
- Unknown lesson IDs no longer get a fabricated empty golden, which previously let arbitrary-duration lessons take the golden scoring path. Generic runs are marked `unscored-generic-input`.
- Evaluation bundles now distinguish `renderer-fixture`, `hand-authored-script`, and `generated-lesson`; hard-failure runs are `failed`, while clean runs stay `draft` until an external judge is recorded as passing.
- Even a judge pass cannot produce `passed` unless the caller attests both factual evidence and alignment completeness; these checks default to incomplete.
- Live exports now emit a sentence- and word-clock-derived WebVTT sidecar. Caption generation failure is a hard failure; captions are recorded among native artifacts.
- Added a generic-template perturbation test that changes the topic, labels, and values and verifies the rendered scene follows the changed data without leaking the previous values.
- Live run bundles record run class, publish status, artifact names, and measured alignment, scene-planning/layout, encoding, caption, and total pipeline milliseconds. Lesson summaries preserve failed/draft status.
- Run IDs now include the actual input content hash and live planner model; known goldens are described as duration-gated rather than fully golden-scored.
- Recorded current implementation/validation status in the existing `hypothesis/v1_claude/02-IMPLEMENTATION-PLAN.md` and `03-VALIDATION-HARNESS.md`.

### Verification

```
npm run typecheck:hypothesis  -> passed
npm run test:hypothesis      -> 194 passed, 0 failed
npm run baseline:verify     -> 40 frozen files verified; G-10 partial, G-DOC and G-LONG missing
```

### Limitations and next work

- No changes were made to frozen fixture/reference inputs. The manifest protects existing files; it does not conjure the absent corpus.
- No E1–E10 or C1–C6 result is claimed. A visual inspection of the retained Attention MP4 shows a legible but sparse frame in progress and a cleaner final weighted-blend frame; this is not a blinded judge result. C6/E1 remain unmeasured.
- Factual source offsets/evidence references are not yet carried through `SourceDoc` → ConceptGraph → SceneSpec → rendered visual. Relation coverage is deliberately not inferred from unlabeled arrows and remains incomplete.
- Browser player, render worker pool, content-addressed resumable stages, persistent budget ledger, document formats beyond text/Markdown, RAG, and 5/10/30/60-minute completion remain unimplemented/unmeasured. WebVTT exists as a sidecar; it is not muxed into MP4.
- Next bounded implementation: add a typed source/evidence model and require it through concept extraction and visual planning, then strengthen generic C6 layout and its rendered-video timing checks before launching judge comparisons.

Evidence-log style, per AGENTS.md #9. Scope: `src/experimental/hypothesis/v1_claude/`
(new code) plus `docs/`, `package.json` scripts, and `package.json`
dependencies (`zod`, `@resvg/resvg-js` added). Nothing under production
`src/server.ts`, `src/runtime/*`, `src/types/*`, or the existing renderer
was touched. Nothing under `src/experimental/hypothesis/shared/` was
touched (hashes re-verified against `MANIFEST.sha256` after this pass —
still unchanged, all 11 files `OK`).

## Entry — 2026-09-23 (later), audit + build: drawn-in-real-time renderer, Streamline catalog, math, S2–S4, strong S6

The full audit (every hypothesis doc, the spec, and every source line) is in `docs/AUDIT-2026-09-23.md`. This entry
records what changed and what was verified. Architecture and commands: `docs/ARCHITECTURE.md`.

### Built this pass

1. **Lamina reference pack (SIMI-REF)**
   - `scripts/lamina-reference.mjs` → `harness/reference/lamina/`: 33 per-scene progression composites plus
     `index.json` and `OBSERVATIONS.md`.
   - Scene cuts come from ink-mass drops. ffmpeg's `scene` filter finds almost none, because whiteboard frames are
     mostly white.
   - Key numbers: median scene length about 18 s; icons are drawn outline-first, then filled; each arrow is drawn
     before its target appears.
2. **Renderer drawn in real time** (`timeline/compile.ts`, `render/renderScene.ts`)
   - One primary reveal per element, with phases in order: pen-order stroke, then fill, then text wipe. The fill no
     longer has its own event outside the scheduler. This fixes the live EMI `concurrency` failure (regression test
     in `__tests__/drawing.test.ts`).
   - `edge` track with arrowheads. Arrows are drawn after their source and lead into their target. Previously every
     edge was drawn at t=0 with no head.
   - Scene title at 96 px with a wipe; 300 ms erase between scenes; labels under catalog icons (previously dropped
     at rungs 2 and 3).
   - Element growth/shrink fit, so layouts use the frame. Weighted-blend layout redone to match the reference.
     Edge routing: straight, then either bend order, then a side detour. `list_icon` becomes a grid when a column
     does not fit. Elliptical `hub_spoke` ring.
   - G5 occupancy and G9 idle are now real (warning) gates. A `formula-error` hard gate was added.
3. **Streamline catalog**
   - 1,992 icons (plump-color, flex-color, color; CC BY 4.0) ingested offline from the local `@iconify/json` by
     `scripts/build-catalog.mjs`.
   - Normalized at render time: black ink at 5.5 px plus one palette fill.
   - Local MiniLM embeddings (`scripts/embed-catalog.mjs`, spike S-10); retrieval runs before planning.
   - The ladder prefers the house style. `CC-BY-4.0` was added to both licence allowlists (the shared file was
     edited and `MANIFEST.sha256` regenerated). `attribution.txt` is written next to every video.
4. **Math**
   - `plot`: closed function families, code-sampled; `tangent`, `trajectory` and `riseRun` groups, each with its
     own anchor.
   - `numberLine`.
   - `shape`: right triangle, triangle, square, rectangle, circle.
   - Formula `parts` revealed term by term through MathJax `\cssId` groups.
   - `plot_focus` template; `formula_focus` with up to 4 lines. Math text keeps its case.
   - Hand-authored proofs in `fixtures/mathScenes.ts`: Pythagoras, slope, and gradient descent × 2.
5. **S2/S3/S4** (`plan/*`, `pipeline/lesson.ts`, `lessonCli.ts`)
   - ConceptGraph → TeachingPlan → deterministic plan analyser (F-PED: order, cycles, budget, steps per
     multi-step concept, recap). The analyser's blocking checks run inside S3 validation, so they get the repair.
   - Marked narration is written one scene per call, in parallel, with a word budget of 2.6 words/s × scene
     seconds. Spoken text only: symbols are written as words.
   - Math golden set M1–M5 in `fixtures/mathLessons.ts`.
6. **S6 upgrade**
   - Strong model: `anthropic/claude-sonnet-5` via `OPENROUTER_SCENE_MODEL`, effort `medium`.
   - The prompt now includes the concept subgraph, top-5 icon candidates per mention, the previous board (for
     carry-over), math few-shots, and a wrong-metaphor rule.
   - Validation rejects invented mention ids, including sub-anchors.
   - The §9 deterministic `list_icon` fallback is back. It is always visible: `usage.fallbacks` plus a
     `planner-fallback` record.
   - `llm/structuredCall.ts` + `llm/openrouter.ts` form an experimental client. The production gateway is
     unchanged. Details:
     - `temperature` is omitted for Anthropic models (their endpoints reject it);
     - the schema is sanitized for Anthropic;
     - JSON is requested by the prompt when the SceneSpec union exceeds Anthropic's grammar limit;
     - empty completions go to the repair;
     - raw control characters are parsed leniently;
     - the timeout is 180 s.
7. **Harness**
   - `harness/judge.ts` + `judgeCli.ts`: J-clarity, J-style, and J-simi in both orders against Lamina frames,
     with a $0.25 cap and a markdown and JSON report.
   - `pipeline/runLive.ts` accepts hand-authored specs, so offline proofs render with real audio.

### Commands and results

```
npm run typecheck:hypothesis      -> clean
npm run test:hypothesis           -> tests 185, pass 185, fail 0
node dist/.../liveCli.js --case=fixtures-math       -> 4/4 scenes, 0 hard failures, 64.0 s narrated MP4, $0
node dist/.../liveCli.js --case=fixtures-attention  -> 3/3 scenes, 0 hard failures, 30.0 s MP4, $0
node dist/.../lessonCli.js --lesson=m2-pythagoras   -> 5/5 scenes, 1 planner fallback, $0.082, 419 s wall (Sonnet 5 S6)
node dist/.../lessonCli.js --lesson=m4-gradient-descent -> 4/4 scenes, 1 fallback (budget), $0.103 (over the $0.10 cap by $0.003, recorded)
S2-S4 only, all five lessons       -> 5/5 plans + scripts valid (after the per-scene S4 change), about $0.004 each
```

Real failures surfaced by live runs, and fixed properly rather than patched:
- anthropic `oneOf` and optional-parameter limits;
- the `temperature` rejection;
- the 4-word *label* limit wrongly applied to titles. This caused the old `why_attention` hard failure. Reference
  titles run to 6 words; titles are now limited to 7 words.
- flash models unable to hit word and marker counts across a whole script;
- symbols inside spoken markers;
- wrong-metaphor icons (a flag for a triangle, a star for 5);
- the hub/spoke ring escaping the safe area;
- the huge emphasis ring around plots.

### Blocked, not done

- **The OpenRouter key hit its total limit** ($15.03 of $15, HTTP 403 "Key limit exceeded"). Blocked until the
  limit is raised:
  - live lessons M1, M3 and M5 (and a rerun of M4 with the latest fixes);
  - the VLM judge report;
  - E5 (flash vs Sonnet 5 on S6);
  - E4 τ calibration.
- `qwen/qwen3.8-flash` was rate-limited upstream during this pass. Lessons ran with `--content=deepseek/deepseek-v4.1-flash`,
  the fallback listed in the user's `.env`, chosen explicitly and recorded in each run.

### Next bounded task

After the key limit is raised:
1. `node dist/src/experimental/hypothesis/v1_claude/lessonCli.js --lesson=all`
2. `npm run judge:hypothesis -- --runs=.data/hypothesis-runs/claude/lessons`
3. Read `harness/reports/<date>-judge.md` and fix the top-ranked failure code.

## Entry — 2026-09-23, consolidation: Claude track adopted, ChatGPT track retired

The two tracks were compared on their live MP4 output against the reference
Lamina Labs videos (`../lamina-labs-video/`). The Claude track was adopted: its
scene-per-beat structure, scene titles, template layouts and mention-anchored
progressive reveal are much closer to the reference than the ChatGPT track's
single static concept graph (squeezed into one corner, labels overflowing
boxes and crossing edges, no scene titles, no icons).

The ChatGPT worktree was removed (`git worktree remove`). A full archive of its
source, docs, and live outputs (without `node_modules`, `.venv`, `dist`) is at
`../archive/hypothesis_chatgpt-2026-09-23.tar.gz`. The `hypothesis_chatgpt`
branch still exists and has no commits beyond `a99719e`.

### Ported from the ChatGPT track

- **MathJax formula typesetting**: `render/math.ts` (sync adapter, `fontCache:'none'`,
  per-latex cache). The `formula` primitive now renders real glyph paths through a
  new `PrimitiveVisual.embeds` field instead of raw LaTeX text. It is revealed with
  the existing left-to-right wipe. Invalid TeX falls back to the visible literal
  source. `layout/measure.ts` sizes formulas from the typeset aspect ratio. This
  closes the "formula renders raw LaTeX" gap below.
- **Hand-drawn geometry library, not yet wired into `render/`**:
  `draw/rough-geometry.ts` (fixed-seed Rough.js, seed = FNV-1a(scene+element)),
  `draw/freehand.ts` (deterministic perfect-freehand gestures: underline, circle,
  checkmark, cross, scribble, arrow), `draw/marker-motion.ts` (point and tangent
  along a path). Their tests are in `__tests__/draw-*.test.ts`. Roughness stays 0 by
  default per the spec. These modules exist for the roughness experiment and for
  freehand emphasis marks.
- New dependencies, pinned to the ChatGPT track's versions: `mathjax-full@3.2.1`,
  `roughjs@4.6.6`, `perfect-freehand@1.2.3`, `svg-path-properties@2.1.0`.

Not ported, but noted for later (source is in the archive): `extraction.ts`
(model-driven claim extraction; its pattern fits generating `[[id|phrase]]`
markers, which the Claude track's live mode still hand-authors in
`fixtures/liveNarrationScripts.ts`), `layout/elk.ts` (ELK layered layout), the
`openrouter-client.ts` reasoning-token cap (`reasoning:{max_tokens}`), and the
word-boundary fix in `text-match.ts`.

### Commands and results

```
npm run typecheck:hypothesis   -> clean
npm run test:hypothesis        -> tests 141, pass 141, fail 0  (114 before + 2 formula + 25 draw)
```

### Gaps visible against the Lamina reference (next priorities)

1. Catalog objects render without their text label. Lamina labels every icon
   ("SUNLIGHT", "WATER"). Many catalog icons are also not recognizable.
2. Edges are drawn at t=0, before their endpoints are revealed. They have no
   arrowheads. Lamina draws each arrow after its source node appears.
3. Scene titles are small (`title * 0.55`). Lamina titles are large and bold.
4. Content occupies a small part of the canvas and leaves large empty areas.
5. Live-mode `[[id|phrase]]` narration scripts are hand-authored, not generated.

## Entry — 2026-09-23, live pass: Scene Planner + real TTS/alignment + real MP4 export

### What changed since the previous entry

A 2026-09-22 read-only audit (superseded by the 2026-09-23 audit below, and later
removed as stale — its still-relevant facts are folded into this entry) found
three load-bearing gaps: no Scene Planner at all, fake TTS/alignment
(`fixture://silence.wav`), and no MP4 export. This pass closes all three with
REAL calls end to end — no
fixtures, no fake data, no golden-case special-casing — and produces real
narrated `video.mp4` files for all 4 golden cases.

1. **Scene Planner (S6) implemented** — `planner/prompt.ts` (system+user
   prompt builder: full primitive union, all 12 templates' slot tables,
   catalog concept list, hard rules, few-shot block built from the 3
   hand-authored Attention scenes) + `planner/plan.ts` (real OpenRouter call
   via the production `OpenRouterProvider`, `temperature:0`, JSON schema
   generated directly from `schema.ts`'s `SceneSpecSchema` via zod v4's
   `z.toJSONSchema()`, exactly one schema-repair attempt feeding the
   validator's exact error back once, real per-call cost/token accounting
   into `RunUsage`, per-clip cost cap enforced against
   `EXPERIMENT.maxClipCostUsd`). Model used: `OPENROUTER_DIRECTOR_MODEL`
   (`qwen/qwen3.8-flash` at the time of this run) — read from the sibling
   `explain-canvas-lab/.env` at runtime only (`planner/env.ts`; never copied
   into this worktree, never committed).
   - **Deliberate deviation from claude_pipeline.md §9's optional
     deterministic `list_icon`/`chain` fallback**: the live-run task
     explicitly asked for "no fake scenes... a real, recorded failure — not
     a silent fallback" on a second validation failure. This implementation
     records a hard `planner-repair-failed` `StageFailure` and skips that
     scene (case may still partially succeed) rather than synthesizing a
     fallback scene. This is intentional and documented, not an oversight.
   - **Few-shot leakage guard**: `buildSystemPrompt(excludeSceneId)` removes
     a scene's own hand-authored answer from its own few-shot block. This
     matters only for `transformer-attention` (the only case whose few-shots
     and target scenes overlap) — an earlier internal run before this fix
     was discarded because `query_meets_keys`/`blending_the_values` had
     their exact ground-truth answer sitting in their own prompt.
   - **Real JSON-extraction bug found and fixed**: the live model frequently
     emits a complete, valid JSON object, then keeps talking ("Wait — I need
     to re-read the rules...") and emits a second, self-corrected JSON
     object, despite an explicit "respond with ONLY JSON" instruction. A
     naive whole-string `JSON.parse` failed on this ~40% of the time in an
     early internal run. Fixed with `extractJsonCandidates` (brace-depth
     scan, string-literal aware) trying every top-level `{...}` region,
     last-first, each validated through the IDENTICAL
     `safeParseSceneSpec`/`validateSceneSpecStructure` path as a clean
     response — no content is invented or edited, this only locates what the
     model actually emitted. This is a parser robustness fix, not a
     validation loosening: a candidate still hard-fails if it doesn't
     validate.
2. **Real TTS + real forced alignment (S5) wired** — `pipeline/runLive.ts`
   calls `voice-engine`'s `synthesize()` (via
   `shared/alignment/align.ts`'s `synthesizeAndAlign`) per scene, then the
   real `stable-ts`/`faster-whisper` sidecar for word-level forced alignment
   against the exact spoken text, then re-resolves `[[id|phrase]]` markers
   against the REAL returned word timestamps via the EXISTING, unmodified
   `narration/resolveMentions.ts` (its interface matched the real aligner's
   output shape with no changes needed — confirmed by re-reading
   `AlignedWord{w,startMs,endMs}` vs the sidecar's `{word,startMs,endMs}`).
   Per-scene real WAVs are stitched onto one master clock with real ffmpeg
   `apad`+`concat` filters (`export/audioStitch.ts`): a real
   `SCENE_GAP_MS=200` silence gap between scenes (matching the fixture
   pipeline's own convention) and — since real narration for these short
   golden-case beats runs well under the golden's nominal 30s target — a
   trailing silence pad on the LAST scene so the final video holds that
   scene's last frame rather than cutting off early. No word timing is
   invented or stretched; only real silence is added between/after real
   speech.
   - Setup performed this pass: `voice-engine/` had no `.venv` yet — ran
     `sh voice-engine/setup.sh` (installs `supertonic==1.3.1`+`piper-tts` via
     `uv`, downloads Piper en/ne voices). `shared/alignment/.venv` already
     existed from the prior sidecar-build session (confirmed, not rebuilt).
     `npm run build` inside `voice-engine/` (no `dist/` existed yet).
     Confirmed working end to end before wiring: one `synthesize()` call
     (supertonic, `rtf≈3.86` on this CPU) piped straight into `align.py`
     produced real word timestamps.
3. **Real MP4 export (S10 export mode / S11) wired** —
   `export/videoEncode.ts`: `renderSVG(scene,timeline,t)` (unmodified, still
   pure) rasterized per-frame via `@resvg/resvg-js` (newly installed —
   confirmed absent beforehand; `npm install
   @resvg/resvg-js` added it, smoke-tested standalone before wiring) at
   1920×1080/30fps, piped as PNG frames into a system `ffmpeg` (`v9.0.1`,
   confirmed present) subprocess (`image2pipe` → `libx264`/`yuv420p`,
   `-crf 20`, real audio muxed in via `-i <masterWav> -c:a aac -shortest`).
   Frame count is `round(finalDurationMs/1000*30)`, not hardcoded to exactly
   900 — `finalDurationMs = max(realNarratedMs, EXPERIMENT.targetDurationMs)`,
   so a case landed at 900 frames/30.000s here because real narration was
   shorter than target (the common case for these short golden beats), but
   the code does not force-truncate real speech if it ever ran long (records
   an `av-sync-over-budget` soft failure instead — did not trigger this
   pass). Also added: a PNG contact sheet (`rasterizePng`, resvg on the
   existing SVG contact sheet) alongside the pre-existing SVG one.

### Files added (all under `v1_claude/`; zero edits to the 6 protected shared files — verified, see hash check above)

```
planner/prompt.ts        system+user prompt builder, template/slot table, few-shot block
planner/plan.ts          OpenRouter call + repair loop + JSON extraction + cost accounting
planner/env.ts           runtime-only loader for explain-canvas-lab/.env (never copied/committed)
export/ffmpeg.ts         runFfmpeg / spawnFrameEncoder subprocess helpers
export/audioStitch.ts    real per-scene WAV -> one master-clock WAV (apad+concat)
export/videoEncode.ts    resvg rasterize -> ffmpeg encode -> video.mp4; PNG contact sheet
fixtures/liveNarrationScripts.ts   hand-authored [[id|phrase]] S4 scripts for the 3 non-Attention
                                    golden cases, each raw string verified byte-identical to the
                                    frozen TeachingBeat.spokenText.text once markers are stripped
pipeline/runLive.ts       live-mode orchestrator (S4->S11), parallel to the untouched pipeline/run.ts
liveCli.ts                CLI: `node liveCli.js [--case=<id>] [--out=<dir>]`
```

`pipeline/run.ts` (fixture mode) and `cli.ts` (fixture CLI) were **not
modified** — fixture mode, its 114 tests, and `docs/HANDOFF.md`'s prior
entry all remain accurate as-is. Live mode is fully additive.

### Exact commands run and results (this pass)

```
npm run typecheck:hypothesis     -> clean, 0 errors (whole repo, including new files)
npm run test:hypothesis          -> tests 114, pass 114, fail 0   (unchanged — fixture mode untouched)
cd voice-engine && npm install && npm run build   -> tsc, clean
sh voice-engine/setup.sh         -> venv created, supertonic+piper-tts installed, Piper voices downloaded
npm install @resvg/resvg-js --save   -> added, smoke-tested standalone (rasterized a 100x100 SVG -> 309-byte PNG)
node dist/.../liveCli.js --out=.data/hypothesis-runs/claude/live   (2 full passes; see below)
```

### Live run results (real TTS + real forced alignment + real Scene Planner + real MP4, all 4 golden cases)

First full pass (before the few-shot-leakage and JSON-extraction fixes)
surfaced three real, honest problems and was discarded/fixed rather than
reported as final:
- `transformer-attention`'s `query_meets_keys`/`blending_the_values` scenes
  came back byte-identical to their own few-shot answer — a real leakage
  bug in the prompt, fixed (see "Few-shot leakage guard" above).
- The model's rambling-then-self-correcting behavior broke naive
  `JSON.parse` on ~40% of calls across the 4 cases — fixed (see "Real
  JSON-extraction bug" above).
- One OpenRouter call hung ~20 minutes before failing (`fetch failed`) with
  no prior timeout — added a 60s per-call `AbortSignal.timeout`, combined
  via `AbortSignal.any` with any caller-supplied signal.

**Final pass (current, reproducible) results:**

| case | scenes ok | hard failures | real cost | video |
|---|---|---|---|---|
| transformer-attention | 2/3 | 1 | $0.0011 | `video.mp4`, 30.000s |
| gradient-descent | 3/3 | 0 | $0.0036 | `video.mp4`, 29.999s |
| photosynthesis | 3/3 | 0 | $0.0035 | `video.mp4`, 29.999s |
| electromagnetic-induction | 3/3 | 1 | $0.0030 | `video.mp4`, 29.999s |

Total real spend: **$0.0112** across all 4 cases (11 planner calls total,
including repairs) — each case individually far under the
`EXPERIMENT.maxClipCostUsd = $0.10` per-clip cap. All 4 videos confirmed via
`ffprobe`: h264/1920x1080/30fps video stream + aac audio stream, ~30.000s
each. Output root: `.data/hypothesis-runs/claude/live/<case>/` — each
directory has `video.mp4`, `audio.wav` (real master-clock WAV), `narration.json`,
`aligned-audio.json` (real `provider:"stable-ts"`, real word timestamps),
`scene-spec.<id>.json` (real planner output per surviving scene),
`resolved-scene.*`, `layout.*`, `timeline.*`, `planner-log.<id>.json` (every
raw model response + usage + failures, for audit), `evaluation-bundle.json`,
`final-scene.svg`, `contact-sheet.svg`/`.png`, `run-manifest.json`.

**Two remaining honest failures, neither papered over:**
1. `transformer-attention/why_attention` — the planner's title exceeded the
   4-word label limit on BOTH the initial attempt and the repair attempt
   (repair prompt fed back the exact "label exceeds 4 words" error and the
   model still produced a >4-word title). Recorded as a hard
   `planner-repair-failed` `StageFailure`; that one scene is skipped, so
   this case's video has 2 of 3 scenes. This is genuine model unreliability
   on a simple, explicitly-stated constraint, not a bug in this codebase.
2. `electromagnetic-induction` — a `timeline/concurrency` hard failure (3
   simultaneous reveals at ~6.7s, cap is 2). Root cause identified by
   inspection, not guessed: the 2-server greedy scheduler in
   `timeline/compile.ts` DOES correctly cap concurrent PRIMARY reveal starts
   at 2 (confirmed still passing `timeline.test.ts`'s dedicated 4-mention
   stress test), but `validation/gates.ts::runClaudeGates`'s concurrency
   gate also counts an element's brief trailing `fill` event (an existing,
   pre-this-pass design — see the prior entry's spec ambiguity #4) as an
   active "reveal." With real ASR-derived mention timing (denser/less evenly
   spaced than the fixture model's uniform timing), a `fill` tail from one
   element can now genuinely overlap two freshly-started strokes on other
   elements, reading as "3 concurrent" under the gate's literal definition.
   This is real signal the live run surfaced that fixture-mode's synthetic
   timing never exercised — **not fixed**, because loosening the
   concurrency gate specifically to make this case pass would be exactly
   the "special-casing a golden case to force a pass" the task forbids.
   Flagged here as a genuine open question for whoever tunes the
   spec next: should a `fill` tail count toward the ≤2 concurrent-reveals
   cap, or only primary stroke/wipe/grow starts?

### Design decisions worth flagging (this pass)

- **Live mode is a parallel pipeline (`pipeline/runLive.ts`), not a
  modification of `pipeline/run.ts`.** Kept fixture mode's 114 tests and
  byte-for-byte behavior completely untouched; live mode reuses every
  deterministic stage (`resolveScene`, `layoutScene`, `compileTimelineFull`,
  `renderSVG`, `runClaudeGates`, the shared `deterministicGates`) unmodified.
- **All 4 golden cases were run through the live planner, including
  `transformer-attention`**, for an apples-to-apples comparison against its
  own hand-authored ground truth (chosen over leaving it fixture-only,
  since it is the one case where a direct planner-vs-hand-authored
  comparison is possible — see the few-shot leakage note above for why this
  needed a specific guard to stay a fair test).
- **`GoldenCase.requiredClaims`/`requiredRelations`/`learnerInference`/
  `misconception` were never read by any planner code path** (`planner/`,
  `fixtures/liveNarrationScripts.ts`, `pipeline/runLive.ts` — grep-verified).
  Only `spokenText`/`displayText`/`visualIntent`/`sourceContext.equations`
  (legitimate frozen teaching-plan content) and mention ids/phrases (S4
  output) ever reach the prompt. This keeps the live run an honest test of
  the hypothesis, not an oracle-assisted demo.
- **No deterministic planner fallback was implemented** (see the Scene
  Planner section above) — a deliberate, documented deviation from
  claude_pipeline.md §9's optional fallback-generator language, per this
  task's explicit "no silent fallback" instruction.

### Known gaps still open after this pass

- **Catalog remains ~18 hand-authored entries** (unchanged this pass, out of
  scope per the task's explicit "acceptable to leave as-is for now").
- **`formula` primitive still renders raw LaTeX source as text**, not
  typeset math (unchanged, `mathjax-full` not wired).
- **`relations: []` in every `EvaluationBundle`** (unchanged — SceneSpec
  edges are still not mapped to the `GoldenRelation` taxonomy).
- **The `fill`-tail-vs-concurrency-gate question above** is a real, now
  concretely-observed open design question, not just a theoretical
  ambiguity.
- **OpenRouter transient failures (429, hung connections) are real and
  happen** on this model/provider combination; the 60s timeout added this
  pass turns a stall into a fast, honestly-recorded failure, but does not
  retry past it (by design — `LLMGateway`'s retry/backoff machinery was
  deliberately NOT used for planner calls, to keep "exactly one schema
  repair attempt" unambiguous and auditable; a transient network failure is
  a `planner-call-failed` StageFailure, not silently retried into a
  success).

### Next bounded task

Pick ONE, in priority order:
1. Decide and implement the `fill`-tail-vs-concurrency-gate question above,
   then re-run `electromagnetic-induction` to confirm it clears cleanly.
2. Grow the catalog past 18 entries + real semantic ranking (still the
   largest completeness gap, explicitly out of scope for this pass).
3. Wire MathJax for the `formula` primitive.
4. Map `Edge` -> `GoldenRelation` so `mechanismCoverage` becomes meaningful,
   then run the shared harness's VLM judge experiments (E1/E5/C1-C6) against
   eligible, complete source-generated videos only. **The earlier suggestion
   to compare against fixture-mode hand-authored scenes is withdrawn** under
   the current visual-evaluation policy in `CLAUDE.md`.

## Entry — 2026-09-22, first implementation pass

> Historical snapshot from 2026-09-22. The implementation and gap statements
> below describe that earlier state and are superseded by the dated entries
> above plus the current ledgers in `hypothesis/v1_claude/02-IMPLEMENTATION-PLAN.md`
> and `03-VALIDATION-HARNESS.md`. In particular, hand-authored/fixture media
> is not eligible for visual-quality evaluation.

### What was built

1. **Core types/schemas** (`types.ts`, `schema.ts`): full `SceneSpec` /
   `Element` primitive union (all 14 primitives from claude_pipeline.md §7),
   marked-narration types, zod validation with `.strict()` element shapes so
   a model can never smuggle raw coordinates, raw SVG/HTML, or an invented
   primitive (e.g. a source-figure/crop primitive) past the schema boundary.
2. **Mention-marker parsing/resolution** (`narration/markers.ts`,
   `narration/align.ts`, `narration/resolveMentions.ts`): `[[id|phrase]]`
   parsing with preserved plain-text offsets; a deterministic fixture-mode
   word aligner; phrase-to-word-span resolution handling repeated phrases
   (cursor-advancing search), punctuation, Unicode (NFKC, diacritics kept
   significant), missing spans (hard failure, never dropped), and ambiguous
   spans (flagged, resolved deterministically).
3. **Three hand-authored Attention scenes** (`fixtures/attentionScenes.ts`):
   "Why Attention" (`title_card`), "Query Meets Keys" (`convergence`),
   "Blending the Values" (`weighted_blend`) — render end to end through the
   full S4→S10 chain with **zero hard gate failures**. The Scene Planner is
   NOT implemented; these are supplied directly, per claude_pipeline.md §17's
   "prove the renderer before the planner" requirement.
4. **Validation gates**: schema-level rejection (raw markup, pre-layout
   coordinates, invented primitives) + structural checks (dangling ids,
   `after:*` cycle detection via DFS, invalid anchor targets, duplicate ids)
   + track-specific runtime gates (`validation/gates.ts`: min-readable-text,
   concurrency cap, license, unresolved-object) + the shared
   `deterministicGates` (schema/overlap/safe-area/timeline-bounds/av-sync/
   unsafe-svg/license), called **once per scene** rather than once globally
   — see "Design decision" below for why.
5. **All 12 templates** (`templates/definitions.ts`): slot-based deterministic
   placement (row/column/circle layouts + generic slot-bucket assignment),
   no model-chosen coordinates anywhere.
6. **Catalog resolution ladder** (`catalog/*`): rung 2 (exact/alias/semantic
   ≥ τ_high) → rung 3 (≥ τ_mid + badge compose) → rung 4 (styled text,
   unconditional). ~18-entry hand-authored procedural catalog (see gap below).
7. **Layout solver** (`layout/*`): template placement → perpendicular-aware
   axis overlap push → container hugging (union of children's boxes) →
   carry-over pin → occupancy-band scaling clamped to the true available room
   from the scaling pivot to each rect edge → boundary-to-boundary edge
   routing (straight, or single Manhattan bend around an obstacle).
8. **Timeline compiler** (`timeline/compile.ts`): `sceneStart`/`mention:*`/
   `after:*` anchor resolution; a 2-server greedy scheduler enforcing
   ≤2 simultaneous reveals (delays anchor-desired starts, never silently
   drops them); carry-over → `hold` track (never re-reveals); `focus[]` →
   closing emphasis; idle-gap → emphasis on the most recently revealed
   element.
9. **Renderer** (`render/*`): `renderSVG(scene, timeline, timeMs)` is a pure
   function (verified deterministic in tests — same input always produces
   byte-identical SVG); stroke draw-on via `stroke-dashoffset`, fill fade,
   text/formula left-to-right clip wipe, meter bottom-anchored clip grow,
   emphasis ring. All primitive geometry is analytic (no `svg-path-properties`
   dependency — see gap below).
10. **`runHypothesis(input, options)` + CLI** (`pipeline/run.ts`, `cli.ts`):
    wires the whole chain, writes per-scene JSON artifacts + `final-scene.svg`
    + `contact-sheet.svg` + `evaluation-bundle.json`, builds the shared
    `EvaluationBundle` shape (neutral elements/timeline/usage/cost/failures).
11. **Test suite**: 114 `node:test` tests across 7 files covering mention
    resolution, schema rejection, all-12-templates layout properties,
    timeline semantics, renderer determinism/sanitization, catalog ladder,
    and end-to-end fixture runs.
12. **npm scripts**: `typecheck:hypothesis`, `test:hypothesis`,
    `fixture:hypothesis` (alias), `run:hypothesis`.

### Exact commands run and results

```
npm install zod@^4 --save          # 51 packages, 0 vulnerabilities
npm run typecheck:hypothesis       # tsc --noEmit -p tsconfig.json — clean, 0 errors
npm run test:hypothesis            # tests 114, pass 114, fail 0
node dist/src/experimental/hypothesis/v1_claude/cli.js \
  --case transformer-attention --out .data/hypothesis/claude/transformer-attention
  # runId=26a2a67040e36d6ec4cd9d1beaa83b5cc5b9b654d16618a86d6bd4d7f63b33cb
  # scenes=3 hardFailures=0 warnings=6
```

At that historical 114-test checkpoint, six `min-readable-text` warnings
were recorded at the then-configured 28px note size. The behavior and the
spec value were superseded by the C6/G6 follow-up entry near the top of this
file: note is now 32px and every below-floor text run hard-blocks.

Determinism verified explicitly: `runHypothesis` called twice on identical
input produces `deepEqual` evaluation bundles and byte-identical
`finalFrameSvg` strings (test: `e2e.test.ts` "fully deterministic
byte-for-byte"). `npx tsc --noEmit` on the WHOLE repo (not just the
hypothesis subtree) is clean — the experimental code does not break
production typechecking.

### Real bugs found and fixed during this pass (not worked around)

- **Axis-overlap push was global, not overlap-aware.** The original
  `resolveAxisOverlap` sorted ALL elements by one axis coordinate and
  enforced a minimum gap between every consecutive pair, regardless of
  whether they actually overlapped. For `title_card` (title/subtitle/strip
  stacked in different vertical bands, never overlapping) this dragged
  elements hundreds of pixels off-canvas (observed: title pushed to x=2107,
  off a 1920px canvas) because it was accumulating "gaps" between elements
  that shared no y-range. Fixed by only pushing pairs that actually overlap
  in the perpendicular axis (`layout/geometry.ts`).
- **Occupancy scale-up could push content past a rect edge even when
  `rect.h / content.h` "looked safe".** The naive ratio assumes content is
  centered in `rect`; when it isn't (e.g. `weighted_blend`'s bottom-heavy
  layout), scaling around content's own center can push whichever side is
  already closest to a rect edge straight through it. Fixed by clamping
  scale-up to the actual room from the pivot to each of the four rect edges
  (`layout/solver.ts`).
- **The shared `deterministicGates` overlap/safe-area check was being called
  once globally across all scenes pooled together**, which produced false
  "overlap" failures between elements from DIFFERENT scenes that are never
  simultaneously visible (they share the same 1920×1080 coordinate space at
  different points in the clip). Fixed by calling it once per scene
  (`pipeline/run.ts`) — see "Design decision" below.

### Design decisions worth flagging

- **`deterministicGates` (shared, read-only) is called once per scene, not
  once globally.** It was written assuming every passed element is
  simultaneously visible, which is only true within a single scene. Calling
  it per scene (with the same golden/total-duration each time) keeps
  overlap/safe-area/dangling-event checks correctly scoped while still
  exercising av-sync/license/unsafe-svg on every call. This is a caller-side
  adaptation, not an edit to the shared file (verified unchanged against
  `MANIFEST.sha256`).
- **Historical G6 exception, closed 2026-09-24:** note-tier text was 28px and
  below-floor labels were warning-only. Follow-up raised note to 32px in the
  implementation and architecture spec, and made every visible text run a
  hard G6 failure when rendered below 32px. The current behavior is covered
  by a regression test; see the latest C6/G6 handoff entry.
- **Container elements are excluded from the overlap/leaf accounting** sent
  to gates (`validation/gates.ts::toNeutralElements` filters them out) per
  claude_pipeline.md §20's "excluding declared containers/badges" — a
  container's own bbox is the union of its children's bboxes by design, so
  it is expected to "overlap" everything inside it.

### Spec ambiguities found (claude_pipeline.md / hypothesis/v1_claude/*)

1. **Resolved 2026-09-24 — `note` font size vs G6 readability gate.** Both
   implementation and architecture spec now use 32px, with G6 hard-blocking
   every visible text run below that rendered size.
2. **Carry-over element identity is unspecified.** claude_pipeline.md §7 says
   `carryOver?: string[]` holds "element ids persisting from previous scene"
   but does not say whether a carried element must ALSO be listed in the
   carrying scene's own `elements[]` (so it can be given a fresh anchor,
   slot, etc. even though it won't re-reveal) or whether it is implicitly
   inherited without being re-declared. This implementation requires
   re-declaration (the carrying scene must list the element; the solver then
   overrides its bbox to the previous scene's position and the timeline
   compiler gives it a `hold` track instead of a reveal). See
   `schema.test.ts` "after:<carried-id> is legal..." for the exact boundary
   this creates.
3. **Badge composition rung ownership.** claude_pipeline.md §10 places badge
   composition under "rung 3 ... + badge composition", but the `Element`
   type's `badge?: Badge` field is independent of rung. This implementation
   attaches a badge whenever `element.badge` is present, regardless of
   whether the base match resolved at rung 2 or rung 3 (e.g. an exact "lock"
   match composed with a "⚠" badge is still a rung-2 resolution with a
   badge, not forced down to rung 3). Documented here since a stricter
   reading is plausible.
4. **Reveal granularity per element** — the spec's timeline event type is
   `Array<{elementId, track, t0, t1, params}>`, one axis per array entry, but
   doesn't say whether one element may have multiple concurrent tracks (e.g.
   stroke + independent text wipe at the same time) or exactly one primary
   track plus an optional trailing fill. This implementation gives every
   element exactly one primary reveal track (stroke/wipe/grow, chosen by
   primitive kind) plus an optional trailing `fill` event immediately after
   a stroke completes — a simplification, not a full "each layer type
   reveals independently" model.

### Known gaps (explicit, not papered over)

- **Scene Planner (S6) is not implemented.** No LLM call exists anywhere in
  this tree. `runHypothesis` takes hand-authored `SceneSpec`s directly. This
  is intentional per claude_pipeline.md §17/§26 (prove the renderer first),
  but it means only `caseId: "transformer-attention"` has a SceneSpec source
  right now (the CLI errors clearly for any other case). Planner repair-loop
  tests, bounded-retry tests, and deterministic-fallback tests do not exist
  because there is no planner to test.
- **No real external asset ingestion.** The catalog (`catalog/catalog.ts`)
  is ~18 hand-authored procedural entries (deterministic vector recipes
  built from the same path-math helpers as everything else), not real
  Iconify/Streamline SVGs. `catalog/normalize.ts` validates against the same
  numeric budgets (≤40 paths, license allowlist, per-lane path caps) so
  swapping in real assets later doesn't silently bypass the gate, but the
  svgo/svgson cleanup pipeline described in claude_pipeline.md §12 does not
  exist.
- **No real semantic embeddings.** `catalog/ladder.ts::semanticScore` is a
  Jaccard token-overlap score over names/tags/meaning, not a real embedding
  (no `@huggingface/transformers` install this session — fixture-mode-only,
  zero live calls, minimal dependency footprint by design). τ_high=0.6 /
  τ_mid=0.3 are unclaibrated starting points, not the output of experiment
  E4's threshold sweep.
- **No MathJax.** `formula` primitive renders the raw LaTeX source as literal
  text, not typeset math (`render/primitives.ts` `case 'formula'`). Honest
  (it never claims to be rendered math), but not the real thing.
  `hypothesis/v1_claude/04` spike S-4 (`mathjax-full`) is not run.
- **No `@resvg/resvg-js` / ffmpeg.** No PNG rasterization, no MP4 encoding.
  `pipeline/run.ts` produces `contact-sheet.svg` (an SVG grid) instead of a
  PNG contact sheet, and never produces `video.mp4`. The e2e test asserts
  `video.mp4` is explicitly ABSENT rather than faking an empty/placeholder
  file.
- **No real forced alignment.** `narration/align.ts` is a deterministic
  character-count-based word-duration model for fixture mode only. Live mode
  (`stable-ts` per `HypothesisRunOptions.alignment.provider`) is not
  implemented; `runHypothesis` throws if `options.mode !== 'fixture'`.
- **No PDF/DOCX/PPTX ingestion (S1/S2/S3).** Per the master plan's
  "experimental mode," this is out of scope — frozen `TeachingBeat[]` from
  `shared/fixtures.ts` stand in for S1–S3.
- **`relations: []` in every `EvaluationBundle`.** SceneSpec edges are not
  yet mapped to the `GoldenRelation {from,to,type}` taxonomy (edges carry an
  optional free-text `label`, not a typed relation). `mechanismCoverage`'s
  relation-coverage metric will always read 0 until this mapping exists —
  flagged in `pipeline/run.ts` inline comment, not hidden.
- **Layout text measurement is heuristic** (`layout/measure.ts`:
  character-count × fixed width), not real glyph metrics (`opentype.js` not
  wired up). Sufficient for the deterministic layout tests (which only need
  monotonic, deterministic sizing) but will mis-estimate box widths for
  proportional-width rendering.

### Next bounded task

Pick ONE of, in priority order matching claude_pipeline.md §26:
1. Wire `opentype.js` for real text metrics (unblocks accurate box sizing
   and the note/body font-size ambiguity above).
2. Implement the Scene Planner (S6) with the prompt contract in
   hypothesis/v1_claude/01 §3.3 — zod-validate, one repair call, deterministic
   `list_icon`/`chain` fallback on second failure — and the planner tests
   (valid output, bounded repair, repair failure, fallback accounting) that
   depend on it.
3. Map `Edge` → `GoldenRelation` so `mechanismCoverage` metrics are
   meaningful, then extend the golden-case coverage beyond
   `transformer-attention` (gradient-descent, photosynthesis,
   electromagnetic-induction all have frozen `TeachingBeat[]` already in
   `shared/fixtures.ts` — they just need hand-authored or planner-produced
   SceneSpecs).

Do not start MP4/resvg wiring or a real embeddings model until (1) and (2)
above land — per claude_pipeline.md §26, prove the visual/planning
hypothesis before layering on production-latency infrastructure.

## Entry — 2026-09-24, bundled font for deterministic text metrics

- Bundled the Kalam Bold display font under `src/experimental/hypothesis/v1_claude/assets/fonts/` with its SIL Open Font License 1.1 notice. The binary is identified by SHA-256 `2f6576601db015d4f6c08678120277fc8510b98c06e932ce7a6a9cbff4cbdded`; upstream Kalam metadata lists Indian Type Foundry as designer and OFL as license.
- Resvg text measurement and MP4 raster workers now load this exact file with host system fonts disabled. The browser preview serves the same font file and waits for it before drawing. Resolver, layout, and renderer stage versions were bumped to invalidate prior text geometry and output.
- Verification: `npm run typecheck:hypothesis` passed; focused browser/renderer tests passed (13/13); full `npm run test:hypothesis` passed (280 Node tests and 8 Python tests); `git diff --check` passed. Tests check font hash, nonempty glyph bounds, browser font serving, and shared rendering contracts.
- This is reproducibility plumbing only. Test scenes are neutral synthetic code-contract inputs; no retained old fixture media or reference video was rendered, compared, or scored. C6, E1–E10, generated visual quality, and human readability acceptance remain unmeasured. The active source-generated S5 alignment issue is unchanged.
- Historical C6 fixture entries elsewhere in this handoff are retained only as an audit trail of past work. They are not current evaluation evidence and must not be replayed or used to select renderer changes.

## Entry — 2026-09-24, diagnose S5 lexical match versus zero timestamps

- Extended the generated-run-only CTC comparator with optional `--asr-consistency`. It uses a local cached faster-whisper base model, records exact/missing/extra lexical tokens beside zero-duration stable-ts words, refuses fixture/hand-authored runs, and never changes timestamps or publish status. If the transcription model is not cached, the optional check is marked `unmeasured` without a download attempt.
- Re-ran the diagnostic on source-generated run `9bc22f61a6485cb9a0b41ab8a5569a26b8b7525a90eeaf257b93ce6483633558`, writing the additive report `alignment-comparison-ctc-v2.json` beside the prior report. ASR matched all 126 expected S4 words across three scenes; it recognized `To`, `a`, and `the` despite stable-ts assigning those three zero-duration intervals. CTC had 0/126 zero intervals. Its independent utterance-edge VAD median/max were 39.49/152.75 ms versus stable-ts 49.05/325.31 ms.
- Interpretation is limited: ASR and stable-ts share the faster-whisper model family, lexical recognition does not establish word boundaries, and utterance-edge VAD is not interior-word truth. Stable-ts remains unchanged, CTC is not promoted, and S5 remains a hard failure. This result is not a successful lesson or visual-quality evidence.
- Verification: Python alignment tests passed (9/9); the comparison completed from local model caches. No legacy fixture, reference video, or rendered output was inspected. Provider access remains unavailable in the current environment; no model call was made.

## Entry — 2026-09-24, withdraw stale S5 calibration and prepare human boundary review

- The previously loaded `36.5 ms` calibration came from scratch clips and per-sample data that are unavailable. Its evidence included utterance edges and natural pauses, not independently labeled interior word boundaries. Marked it withdrawn in `calibration.v1.withdrawn.json`; the active v2 record is `unmeasured` with null metrics. Both live CLIs no longer load 36.5 ms. A live run with no calibration can collect diagnostic audio/alignment but receives a hard S5 failure, so it cannot pass publish. The `calibrationMedianErrorMs <80` assertion applies only when a measured value is supplied.
- Added `word_boundary_review.py`: it accepts only matching generated-lesson source runs with completed provider-backed S2/S3/S4 and exact narration/alignment word sequence; rejects duplicate SourceDoc hashes; creates two independently ordered audio-only participant pages; enforces the candidate alignment/provenance key outside the participant tree; and scores complete independent annotations with agreement and stable-ts/optional CTC error summaries. The provisional review agreement limits are median ≤80 ms and P90 ≤200 ms. Even a three-source/100-word result never auto-promotes S5.
- Built a one-source pilot from existing provider-generated photosynthesis audio: `.data/alignment-review-pilot-20260924/participants/` has three clips and 126 words; key at `.data/alignment-review-pilot-20260924/organizer-key.json`. Its status is pilot-only/unmeasured. No votes exist yet. It uses only the S4 transcript and scene audio; the failed diagnostic MP4 and all fixture/reference media were not opened or scored.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (281 Node tests and 15 Python alignment tests); `git diff --check` passed. No provider call was made.

## Entry — 2026-09-24, prevent generated source IDs from selecting frozen goldens

- Audit found `runLive.ts` unconditionally called `goldenById(input.caseId)`. In the source CLI, the case ID can be supplied by `--id` or derived from a source filename, so a generated lesson named `photosynthesis` or `transformer-attention` could inherit benchmark-specific duration/claim gates. Added `goldenForRun`: `generated-lesson` always receives no golden; explicit non-generated benchmark/script paths retain the frozen target. Added a regression for both collisions.
- This changes only which evaluation target applies; it adds no lesson content, labels, values, or visual behavior. No source-generated run, fixture output, media, or Simi reference was rendered, viewed, or scored.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (282 Node tests and 15 Python alignment tests); `git diff --check` passed. No provider call was made.
- Next bounded task: audit the remaining generated-run gates and E1 eligibility for any other use of case ID, source filename, golden ID, or topic keywords that can alter visual content or benchmark scoring; add a collision regression for each concrete path before changing it.

## Entry — 2026-09-24, stop case IDs from choosing matched Simi references

- E1's topic eligibility accepted either `caseId` or SourceDoc title. The source CLI can derive `caseId` from the source filename, so `photosynthesis-notes.txt` could make an unrelated document eligible for the photosynthesis reference comparison. Changed the matched-topic check to require an explicit declared topic matching the extracted SourceDoc title plus the versioned reference map. Missing/untitled or mismatched sources cannot receive topic-matched scores; the judge's style-only mode is unchanged.
- Added regressions proving a filename/case collision cannot override a mismatched title and a matching title still works under an arbitrary ID. This affects reference eligibility only; no lesson content or planner output changes.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (282 Node tests and 15 Python alignment tests); `git diff --check` passed. No run media, fixture output, or Simi video was rendered, opened, or scored.
- The next audit item is to check remaining evaluation metadata paths for title/keyword-driven selection that bypasses the versioned reference-topic map.

## Entry — 2026-09-24, bind judged source titles to the recorded SourceDoc

- E1 judge API/CLI, E1 human-pack creation, and E5 matched-pair eligibility now require the serialized `source-doc.json` to hash to the exact SourceDoc digest recorded in the run manifest. A replaced or edited title cannot steer a topic-matched reference comparison or remain eligible for E5.
- Added regressions for original-versus-edited SourceDoc metadata and wired the integrity check into E5 review-pack loading. This is evaluator integrity work; it adds no topic-specific planner, scene content, or visual rule.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (282 Node tests and 15 Python alignment tests); `git diff --check` passed. No generated/fixture video, image, or Simi reference was opened or scored, and no provider call was made.
- C6/E1/E5 visual quality remains unmeasured. Earlier fixture outputs remain in the repository only as preserved history or isolated code-contract inputs; they are excluded from architecture-quality evidence as instructed.

## Entry — 2026-09-24, finish case-ID dispatch audit

- Audited remaining `caseId` paths in the Claude track. `liveCli.ts` maps its named Attention/math and narration-script cases to explicit hand-authored inputs; inferred run classes remain `renderer-fixture` or `hand-authored-script`. The source CLI takes an actual source file through S1–S5 and produces `generated-lesson`; its case ID no longer selects golden targets. E1/E5 eligibility rejects non-generated classes, so these fixture/script paths cannot qualify as quality evidence.
- Few-shot selection uses case/source IDs only to exclude target-derived examples; domain and mechanism affect deterministic retrieval rank, not lesson facts. No topic-keyed drawing branch was found in the audited planner/pipeline/harness paths.
- This was a code-path audit; no fixture/reference media was opened, rendered, or scored. Full offline suite remains 282 Node tests and 15 Python tests from the preceding verification; `git diff --check` passed after documentation updates.
- Remaining evaluation blocker is still concrete: the last source-generated run failed to complete within the configured budget and no two-human C6/E1/E5 visual review exists. Continue source-grounded planner/runner fixes and measure quality only on a completed generated lesson.

## Entry — 2026-09-24, fail closed on contradictory spend ledgers

- The preserved source-generated attempt `generated-20260924-retry1/photosynthesis-60s/budget-ledger.json` records $0.119435816 spent against $0.10 over nine calls, but says `blocked: false`. This contradicts the ledger's overrun invariant. The artifact was read for cost/status fields only; it was not modified and no media was opened.
- Hardened `PersistentBudgetLedger.snapshot()` to reject recorded over-budget spend that is not marked blocked. `call()` reads the ledger before dispatch, so a contradictory record now prevents another provider request rather than granting an unsafe remaining balance. Added a regression using the observed inconsistency.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (283 Node tests and 15 Python alignment tests); `git diff --check` passed. No provider call was made.
- This protects future calls but does not explain how the preserved ledger reached its contradictory state or recover its budget. A fresh completed under-cap generated lesson is still needed; visual-quality gates remain unmeasured.

## Entry — 2026-09-24, reconcile final run spend with provider stages

- Read the failed generated run's planner cost summaries only: S6 scene 1 recorded $0.0751464, scene 2 recorded $0.0396084 and reported a persistent budget overrun, and scene 3 made zero calls after the local ceiling was exhausted. The final saved ledger instead had `blocked: false`; the existing artifacts do not establish why.
- Added a final-run accounting check that requires durable cumulative budget spend to cover the current run's non-cached provider stage costs. The ledger may include earlier attempts in the same output directory, so equality is not required. A ledger read error or under-recorded spend adds a hard budget failure before publish status is decided; cached `artifactApiCostUsd` is excluded because it describes prior spend, not a call in the current run.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (284 Node tests and 15 Python tests); `git diff --check` passed. No provider call or media inspection was performed.
- The prior generated attempt remains failed/incomplete and its saved files are preserved. A live run is still needed to verify billing and under-cap completion; no visual-quality gate is promoted.

## Entry — 2026-09-24, record actual provider route beside request cost ceilings

- The prior generated attempt's per-attempt cost exceeded the stage's remaining allowance. Its old logs did not include either the requested per-million-token ceiling or selected provider, so they cannot establish whether routing followed the requested ceiling.
- `chatStructured` now opts into OpenRouter route metadata. Structured-call attempt records preserve the calculated prompt/completion price ceiling, generation ID, selected model/provider, routing strategy, and actual per-attempt token/cache/cost usage. Provider metadata is normalized to the selected endpoint only; prompt/completion content is already stored separately as before.
- The official OpenRouter docs describe `provider.max_price` as a per-token provider price filter and the metadata header as the mechanism for exposing selected endpoint details. This is observability plumbing, not proof the run meets a total-dollar cap. References: [provider routing / max_price](https://openrouter.ai/docs/guides/routing/provider-selection) and [chat completion response metadata](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (284 Node tests and 15 Python alignment tests); `git diff --check` passed. No provider call or video/media inspection was made.
- Need a future source-generated run to compare the recorded per-token ceiling, selected route, and actual provider cost. The $0.10 target and all visual acceptance gates remain unmeasured.

## Entry — 2026-09-24, fail closed when provider billing usage is missing

- Review of the structured-call boundary found that absent `usage.cost` was normalized to `$0` (`Number(undefined) || 0`). This could make an unpriced provider response look like zero spend in run and budget records.
- `chatStructured` now requires finite, non-negative prompt tokens, completion tokens, and cost from the provider response. Missing or invalid billing usage throws after dispatch; the persistent budget ledger records uncertainty and blocks further requests instead of treating the call as free. Explicit zero cost remains valid when returned by the provider.
- Added adapter tests for missing and invalid cost and a structured S6 contract test proving a missing-cost response fails the call and blocks the ledger.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (286 Node tests and 15 Python tests). No provider call was made and no fixture/generated video or reference image was opened, rendered, compared, or scored.
- This closes an accounting under-reporting path; it does not prove OpenRouter's live per-token caps enforce the total-dollar target. A fresh source-generated run with working provider connectivity is still required. All visual-quality gates remain unmeasured.

## Entry — 2026-09-24, exclude exemplars that failed review

- The experimental bank's retrieval predicate excluded held-out, target-derived, and near-duplicate examples, but did not exclude an example whose review metadata explicitly recorded a failed factuality, visual, license, leakage, or human check. Such an entry could still enter an E5 prompt while marked experimental.
- Retrieval now rejects any example with a failed review dimension. Pending examples remain available only to the declared experimental retrieval arms; approved entries still require all five review passes, reviewer identity, and timestamp.
- Added a regression for a failed-license exemplar. `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (286 Node tests and 15 Python tests); `git diff --check` passed. No live model call or media evaluation is part of this change.

## Entry — 2026-09-24, bind S6 relation context to the scene contract

- Audited relation transfer against the saved S3/S6 contract. `lessonToLiveInput` correctly filters graph relations to each scene, but `compileScenePlanningContext` trusted the supplied scene relation list without independently checking it against `SceneContract.requiredRelations`.
- The S6 context compiler now rejects relation-context omissions, duplicates, or extras before prompt construction and provider spend. It also requires the scene's concept IDs to match `SceneContract.requiredConceptIds` exactly and each concept/relation citation to occur in the permitted scene evidence set. The synthetic prompt-order test now uses a matching concept context instead of an internally inconsistent contract.
- Bumped the scene-planner prompt/context version to v12 so cached S6 artifacts cannot bypass the stricter contract checks.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (288 Node tests and 15 Python tests); `git diff --check` passed. No old fixture output, reference image, or video was used or evaluated.

## Entry — 2026-09-25, takeover audit after OpenRouter authentication succeeds

- OpenRouter is now reachable through the authorized network path: unauthenticated `curl -sS -I --max-time 10 https://openrouter.ai/api/v1/models` returned HTTP 200, and one authenticated chat request to the configured `qwen/qwen3.8-flash` route returned HTTP 200. Its `max_tokens=4` response had no visible `content`, so this proves connection, key, and model routing only. No structured-output quality claim follows. The default sandbox still fails DNS; old `ENOTFOUND` entries above are historical. No key was printed or copied. Do not resume network debugging unless a real pipeline request fails.
- The most recent cold source run, `.data/hypothesis-runs/claude/continuation-20260924/lessons/photosynthesis-source-fresh-20260924/lesson-prep.json`, was a supplied Markdown lesson input, not an old generated fixture and not a fetched/RAG-verified NASA document. It ran with `qwen/qwen3.8-flash` on Alibaba: S2 completed after one repair, producing 14 concepts, 17 relations, and 11 prerequisites for 60 seconds; S3 failed after one repair on contract terminology, goals, and relations; S4–S12 did not run. Four calls used 20,571 prompt tokens, 11,731 completion tokens, $0.0075701, and about 158 seconds across S2/S3. The raw responses, attempt usage, route metadata, and hard failure are retained in `lesson-prep.json`. This result predates the latest S2/S3 code edit.
- After that run, `plan/stages.ts` received a generic duration-based S2 concept cap and S3 code-side contract normalization. `npm run typecheck:hypothesis` passed. The current `npm run test:hypothesis` built successfully but passed only 287/288 Node tests. `source-lesson-preparation.test.ts` fails because even its otherwise valid plan receives a soft `plan-contract-normalized` failure; the 15 Python alignment tests did not run because the npm command stopped at the Node failure. The previous 288+15 pass is historical, not a current gate.
- Review findings for takeover: (1) S3 normalization can synthesize a missing SceneContract or erase an unsupported model relation before `teachingContractProblems` sees it, risking a false plan pass; preserve the raw planner violation as a hard failure. (2) S2 and S3 prompt/cache versions in `pipeline/lesson.ts` were not bumped after the behavior changed, so warm runs can replay stale successful or failed artifacts. (3) Valid LessonBible terminology for concepts used once is discarded, and the offline integration test now fails. Resolve these without adding lesson/topic-specific branches, modifying frozen outputs, or marking a fallback as passed.
- Current adapter behavior already treats empty visible content as invalid structured output and sends it through the one-repair path; it does not use hidden reasoning as JSON. `llm/structuredCall.ts` currently defaults S2/S3 to 4,000 completion tokens, S4 uses 2,500, and S6 uses 6,000; `llm/openrouter.ts` reserves a bounded hidden-reasoning allowance for Qwen/DeepSeek. Use measured stage completion distributions before changing these caps or model routing. The four-token smoke response is not evidence that normal stage caps are insufficient.
- S5 remains the publish blocker after S2–S4: `calibration.v2.json` is explicitly unmeasured, and stable-ts assigned exact-zero intervals to words in the one retained generated lesson. The live gate hard-fails unmeasured calibration and zero-duration words; S6 paid planning is skipped after a hard S5 alignment failure. An independent English CTC diagnostic yielded no zero intervals on that single source, but no human word-boundary annotations or cross-source calibration exist, so no aligner was promoted.
- Pipeline status for takeover: source intake, evidence-linked graph/plan/script contracts, code-compiled S6 scene context, generic renderer, browser/MP4 path, artifact cache, budget ledger, fallback integrity, and blind-review tools exist. The experimental exemplar bank remains pending, generated lessons default to zero-shot, and historical hand-authored fixtures are excluded from quality evidence. No complete source-generated video has passed hard gates or human C6 acceptance. E1/E4/E5/E9/E10 are unmeasured; G-10 is partial and G-DOC/G-LONG are missing. Deep RAG, complete 5/10/30/60-minute runs, and the $0.10/$1.00 cost targets remain deferred and unproven.
- Next bounded work: repair the three S2/S3 integrity/cache/test findings and rerun `npm run typecheck:hypothesis` plus `npm run test:hypothesis`; then run one genuinely new SourceDoc with `--cache=cold` through S2→S4 using the configured Qwen model and normal stage budgets. Record every attempt's schema/gate result, raw final content, provider/model, latency, tokens, repairs, and `usage.cost`. Keep Qwen until its contracts are measured. Continue S5 calibration on at least three independent generated sources and do not repair zero intervals by fabrication. Once S5 passes, run one fresh ~60-second zero-shot S1–S12 lesson; only a complete clean video enters C6/E1 visual review. RAG and long-form work follow visual acceptance.

## Entry — 2026-09-25, Phase 0: fix the 3 S2/S3 integrity defects from the takeover audit

- Fixed defect 1 (masking): `canonicalize()` in `plan/stages.ts` (`buildTeachingPlan`) no longer unconditionally overwrites/synthesizes `section.contract`, and no longer recomputes `requiredRelations` from the graph, discarding the model's own list. `validate()` now calls `analyzeTeachingPlan`/`teachingContractProblems` directly against the model's raw structured output, before any mutation. A model that omits a `SceneContract` or invents a relation not supported by the graph now produces a real hard failure (`lacks a SceneContract` / `has unsupported relation ...`) that consumes exactly one repair via the existing `structuredCall` mechanism, instead of being silently repaired and reported as a generic soft `plan-contract-normalized` note. The `canonicalize` function and the soft-failure emission were removed entirely — the function no longer exists, so there is nothing left to mutate the plan before validation.
- Fixed defect 3 (terminology loss): since `canonicalize` no longer touches `lessonBible.terminology` at all, the model's own declared terminology (including entries for concepts used in exactly one scene) passes through to validation unmodified. `teachingContractProblems` already only requires persistent (multi-scene) concepts to carry a terminology entry; it does not forbid single-use entries, so no validator change was needed.
- Fixed defect 2 (stale cache): `runCached` in `pipeline/lesson.ts` took a hardcoded `stageVersion: '1'` literal at every call site. It now takes a real per-call `stageVersion` string, following the pattern already used correctly by S5 in `runLive.ts` (`'voice-align-2-submillisecond'`): S2 uses `S2-concept-graph-v1`, S3 uses `S3-teaching-plan-v2-raw-validate` (a new value, so any warm cache from the old normalizer is provably invalidated), S4 uses `S4-script-v1`.
- Retry-ownership audit (Phase 0 item D, read-only): confirmed provider/network failures and semantic/validation failures are correctly separated in `structuredCall.ts` — only semantic failures spend the one repair. Found one real but narrow gap, left open: an exception thrown inside the `validate` callback itself (e.g. a bug in `canonicalize`/`teachingContractProblems`) is not caught locally and surfaces as the same generic `stage-threw` bucket as a provider crash, rather than a distinct code-bug category. This does not violate "never mutate a failure into a pass" (nothing is swallowed or wastefully retried) and is not fixed now — doing so would mean wrapping `validate` in its own try/catch inside `structuredCall.ts`, touching the frozen one-repair mechanism, which is out of scope for this fix.
- Added three regression assertions to `__tests__/source-lesson-preparation.test.ts`: (1) the existing `cold` case now also asserts `leaf`/`sugar` survive in `cold.plan.lessonBible.terminology`; (2) a new test asserts a model plan omitting `section.contract` is rejected with a hard `lacks a SceneContract` failure after exactly one repair; (3) a new test asserts a model plan with an unsupported relation (valid enum type, but not present in the graph) is rejected with a hard `has unsupported relation` failure after exactly one repair.
- Verification: `npm run typecheck:hypothesis` passed. `npm run test:hypothesis` passed the full Node suite — 290 tests (the previous 288 plus the 3 new assertions/cases), 0 failures — and the trailing 15 Python alignment tests ran to completion and passed (the command is no longer short-circuited by a Node failure). No frozen baseline, golden, or fixture was modified; no topic-specific runtime branch was introduced.
- Next bounded work (unchanged from the prior entry, now unblocked): run one genuinely new SourceDoc (not a re-run of the existing photosynthesis source under a new ID) through cold S2→S4 with `qwen/qwen3.8-flash` against this corrected code, and record schema/gate results, raw content, provider/model, latency, tokens, repairs, and `usage.cost` as a diagnostic measurement. In parallel or after, proceed to Phase 1: measure S5 alignment calibration across at least three independent source-generated narrations using the existing blind-review tooling (stable-ts base vs stable-ts small vs the CTC/Wav2Vec2 candidate), and do not synthesize fake durations or discard spoken words to pass. Only after `calibration.v2.json` reaches `status: "measured"` should a full S1–S12 ~60-second zero-shot lesson be attempted for C6/E1 visual review.

## Entry — 2026-09-25, Phase 1/2 live diagnostics: 3 independent narrations, a real CTC bug fix, first full pipeline runs

- Ran the "next bounded work" above with an authenticated OpenRouter key added to `.env` this session. Wrote four brand-new, single-line-paragraph SourceDocs outside the G-10 set (`.data/sources/{ocean-tides,bicycle-balance,composting,rainbow-formation,mirror-images}.md`) — none previously seen by this pipeline. Total live spend across every S2–S4 attempt this session (successes and diagnostic failures): **$0.1145**.
- **S2/S3 reliability finding (qwen/qwen3.8-flash, zero-shot, post-fix)**: across ~10 independent cold attempts, S2 (concept graph) failed intermittently on exact evidence-quote fidelity or an empty completion; S3 (teaching plan) failed intermittently — after the Phase 0 fix removed the old normalizer, the model must satisfy the full strict contract (`teachingContractProblems`) itself, and it does not always manage this within one repair (recurring pattern: "explain section teaches no concept" and over-segmentation past the ~3-section guidance for a 60 s lesson). This is model/prompt reliability, not a regression from the fix — the fix is working exactly as intended, surfacing a real, previously-hidden weakness that the removed normalizer used to paper over. **3 of ~10 cold attempts fully passed S1–S4 zero-shot with qwen alone**: `ocean-tides-60s-mixed`, `bicycle-balance-60s-mixed`, `composting-60s-mixed3` (all under `.data/hypothesis-runs/claude/phase0-live/`).
- **Measured the "semantic rescue" fallback** (`anthropic/claude-sonnet-5` for S3 per MODEL POLICY): an isolated probe (reusing an already-valid qwen-generated ConceptGraph) passed S3 cleanly — 0 repairs, 0 failures, $0.044. However, ~7 further attempts to invoke Sonnet 5 for S3 (both as a full-pipeline content model and as a targeted rescue-after-qwen-failure) hit OpenRouter direct-routing rejections (`HTTP 404 — No endpoints found that satisfy the max price`, region `KTM`) or one empty completion; only the first isolated probe succeeded. Ruled out our own price-ceiling math as the cause (verified `maxPriceForCallBudget` produces ceilings far above any plausible real price in every failing case, including at $2 of headroom). This looks like transient/regional OpenRouter capacity for `anthropic/claude-sonnet-5` direct routing at the time of this session, not a code defect — worth re-measuring later rather than treating as settled.
- **Found and fixed a real, previously-uncovered bug** in the S5 CTC diagnostic tool, `shared/alignment/compare_aligners.py`'s `ctc_target`: it matched transcript characters against the label dictionary by raw membership, so a literal hyphen in an ordinary hyphenated word (e.g. "self-balancing") coincidentally matched the CTC blank label's own string (`"-"`, index 0) and was emitted as a real target ID — which `torchaudio.functional.forced_align` always rejects (`targets Tensor shouldn't contain blank index`). Fixed by restricting target character extraction to `char.isalpha()` (the existing "unsupported alphanumeric" fail-closed check for digits/accents is unchanged). Added two regression tests to `test_align.py` confirming (a) genuinely repeated adjacent letters like "wheel" need no special handling — `torchaudio.functional.forced_align` documents native support for this via its own `L_log_probs >= L_label + N_repeat` allowance — and (b) a hyphenated word never emits the blank label. All 17 Python tests (15 prior + 2 new) pass; `npm run test:hypothesis` confirmed green afterward (290 Node + 17 Python).
- **First successful stable-ts vs CTC comparison on a brand-new independent source**: `bicycle-balance-60s-mixed` — stable-ts: 10 boundary samples, median 39.8 ms error, max 165 ms, **3 zero-duration words**; CTC: 10 samples, median 42.4 ms, max 129 ms, **0 zero-duration words**. `ocean-tides` and `composting` narrations both contain spoken numbers ("24 hours", "55 degrees") and correctly fail closed on the CTC path's intentional unsupported-alphanumeric guard (not a bug — digits are deliberately not guessed at); a numberless fourth source (`mirror-images`) was written to get a second CTC data point but failed S3 4/4 times against the same Sonnet-routing issue above, so only one clean CTC comparison exists as of this entry.
- **Packed the blind human word-boundary review** using the now-fixed tooling: `word_boundary_review.py pack` across all three successful narrations produced `.data/alignment-review-pack-20260925/` — 3 independent sources, 14 items, **436 words** (clears the ≥3-source/≥100-word gate), two blinded participant pages (`participants/judge-1/review.html`, `participants/judge-2/review.html`), and a separate `organizer/organizer-key.json`. **No votes have been collected — this requires two actual independent human reviewers**, which cannot be supplied by an agent; `calibration.v2.json` remains correctly `status: "unmeasured"` until that happens. This is the one remaining piece of Phase 1 that is structurally not automatable.
- **Attempted full S1–S12 runs** on `ocean-tides-60s-mixed`, `bicycle-balance-60s-mixed`, and `composting-60s-mixed3`: each produced a real, playable `video.mp4` (~1.2–1.3 MB) but each correctly reported `status=failed` — hard failures were `alignment-calibration-unmeasured` (expected, calibration not yet measured), several `invalid-word-alignment` zero-duration words (the known stable-ts defect, now reproduced on 3 independent new sources instead of just the one prior photosynthesis run), `planner-skipped-alignment-failure` (S6 paid planning correctly skipped after the S5 hard failure), and `planner-fallback-gate` failures on the resulting deterministic diagnostic scenes. Nothing was mutated into a pass; this is the honest, documented outcome of "attempt one full S1–S12 run" before S5 calibration is measured, per the takeover brief's exit condition.
- **Next bounded work**: (1) recruit two independent human reviewers to complete `.data/alignment-review-pack-20260925/participants/judge-{1,2}/review.html` and run `word_boundary_review.py score` on their completed annotations to produce a measured `calibration.v2.json`; (2) once measured, re-run one of the three already-prepared lessons (or a fresh source) through S1–S12 — S2–S4 artifacts are already cached and reusable; (3) separately re-measure the `anthropic/claude-sonnet-5` direct-routing availability on OpenRouter before relying on it again as a scripted rescue path; (4) if a second CTC-comparable (numberless) narration is wanted, retry `mirror-images` or a similar source once Sonnet/qwen S3 reliability improves.

## Entry — 2026-09-25, S3 prompt calibration harness: measured 0%→40% pass-rate improvement, adopted

- User directive for this round: never hardcode, fix the actual pipeline code/prompt (not test code, not output JSON), build a real harness, calibrate via measured iteration, don't loosen `plan/contracts.ts`/`plan/analyze.ts` (the "truth") to fake progress. A fresh audit (Explore passes over `harness/`, and quantified re-analysis of the prior round's raw `lesson-prep.json` files) corrected the record: the real qwen/qwen3.8-flash sample was only 6 genuine cold attempts (3 pass/3 fail), not ~10 as previously written; 9 more attempts never launched (OpenRouter routing 404s before any model call) and 5 more were misrouted to Sonnet. The one real root cause across every S3 failure: the model empties a section's `conceptIds` post-repair (usually while self-correcting something else), which mechanically fails the conceptIds/contract match and drops that section's relations from every `SceneContract`. Over-segmentation was **not** the discriminator — passing runs over-segmented too. The one real S2 failure was token-budget truncation (10,199 well-formed characters cut off mid-object at the silent 4000-token default), not an empty response.
- **Added a real failure taxonomy** to `plan/contracts.ts`: new `teachingContractFindings()` returns `{code, message}[]` with one stable `CONTRACT_CODES` entry per rule (e.g. `CONCEPTIDS_CONTRACT_MISMATCH`, `UNSUPPORTED_RELATION`, `SECTION_OMITS_SOURCE_RELATION`). The original `teachingContractProblems()` (string[]) is now a thin derived view — kept byte-identical so `__tests__/scene-context.test.ts`'s `.join('|')`-based assertions needed zero changes. `pipeline/lesson.ts` now pushes the real code into `failures` instead of a single generic `'scene-contract'` literal for every violation.
- **Fixed S2's token truncation**: `buildConceptGraph` now passes a `maxTokens` scaled from the same `maxConcepts`/`maxRelations`/`maxPrerequisites` capacity numbers it already computes (capped at 8000), instead of silently defaulting to 4000 — the exact ceiling that truncated the observed failure.
- **Built `harness/planCalibration.ts` + `harness/planCalibrationCli.ts`** (`npm run plan:calibrate`): fans out N independent cold S3 calls per named prompt variant against a small fixed held-out source set (the 5 non-G-10 sources under `.data/sources/`), sharing one cached S2 ConceptGraph per source across variants for a fair A/B, and aggregates pass/fail + the new contract codes + `analyzeTeachingPlan`'s `F-PED` tags into a report (`harness/reports/<date>-plan-calibration.{json,md}`). Hit and fixed a real robustness bug during the second live run: the harness originally threw and aborted the entire run when one source's S2 failed (`composting`, an intermittent evidence-quote-fidelity failure) — it now retries S2 once, and skips only that source (recorded in a `skippedSources` list) if both attempts fail, continuing the rest of the run.
- **Added a prompt-variant registry** to `buildTeachingPlan` (`plan/stages.ts`): `v3-baseline` (today's exact text, unchanged) and `v4-explicit-concepts` (a stronger, explicit "never empty conceptIds even mid-repair; move relations with their concepts, never strand them" rule, plus the existing "REQUIRED MAPPING SHAPE" placeholder extended into one small, fully worked, topic-neutral example with fake ids — never real content).
- **Measured result** (`harness/reports/2026-09-24-plan-calibration.md`, N=3 × 5 sources, qwen/qwen3.8-flash): **v3-baseline 0/15 (0%)**, **v4-explicit-concepts 6/15 (40%)**. Every v3 attempt consumed its one repair and still failed (real completions, nonzero cost each time — not a network artifact); both variants ran against the identical cached graph per source, so the gap is prompt text. **Adopted `v4-explicit-concepts` as the new `DEFAULT_PLAN_PROMPT_VARIANT`**, bumped S3's cache identity to `S3-teaching-plan-v3-explicit-concepts` / `S3-teaching-plan-prompt-v4` in `pipeline/lesson.ts` so no warm cache can replay a v3-baseline result under the new default.
- **Blocker encountered**: `anthropic/claude-sonnet-5` direct routing on OpenRouter was unreliable this session (7/8 "semantic rescue" attempts hit `HTTP 404 — No endpoints found that satisfy the max price`, region `KTM`; ruled out our own price-ceiling math as the cause by testing at $2 of headroom with the same failure). This is a live, real, currently-unresolved provider-side availability issue, not a code defect — re-measure before relying on Sonnet as a scripted S3 rescue again.
- **Re-verified end to end**: `ocean-tides` at 60s with the new default passed S1–S4 cleanly (3 sections, matching the ~3-section guidance — a qualitative improvement over v3's typical 4–6 over-segmented sections seen in the prior round) and produced a real `video.mp4`; S5/S6/S12 still hard-fail exactly as documented (`alignment-calibration-unmeasured`, zero-duration words) — that is the separate, already-known, unresolved Phase 1 blocker, not something this change touched or regressed.
- **Duration-timeline honesty check** (user asked to see 1/5/10-minute attempts): confirmed in code, not just in this doc, that long-form is genuinely unimplemented — `grep` for `section-parallel`/`long-form` across `v1_claude/` returns nothing, `RAG_ENGINE`/`rag-engine` is referenced nowhere in `v1_claude/`, and `plan/stages.ts`'s `maxConcepts = Math.min(14, ...)` caps at 14 concepts **regardless of target duration**, so a 5–10 minute lesson gets the identical concept budget as a 60s one. Live attempts at 5 min (`ocean-tides`) and 10 min (`bicycle-balance`) both failed at S2 (evidence-quote fidelity) before ever reaching the point where that cap would even matter architecturally.
- Verification: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed 294 Node tests (290 prior + 4 new: 3 in `contracts.test.ts`, none of the existing suite modified) and 17 Python tests, both before and after the variant adoption.
- **Next bounded work**: run `plan:calibrate` again with a 3rd candidate variant once one exists (e.g. targeting the remaining `S3_CALL_FAILED` cluster on `bicycle-balance`/`composting`, which stayed at 0% even under v4); re-measure Sonnet-5 routing before scripting it as a rescue path again; the S5 human-review blocker from the prior entry is unchanged and still the critical path to any lesson passing C6/E1.

## Entry — 2026-09-26, Phase 0 run-unique accounting completed

- **Approved scope:** User explicitly approved implementation of the duration-aware 1/5/10/30-minute source-grounded pipeline and specified completing phases one at a time. The dated approval is recorded in `docs/superpowers/plans/2026-09-25-visual-richness-and-deterministic-generation.amendments.md`; the frozen `plan-lock.json` plan was not edited.
- `lessonCli.ts` now writes each attempt under `<out>/<lesson>/runs/<timestamp>-<uuid>/`, preserving shared content-addressed cache under `<out>/<lesson>/stage-cache/` or the explicit `--stage-cache` root. Every run has a separate budget ledger and artifacts. Global summaries use run-unique names and atomic temporary-file rename, preventing parallel lesson runs from overwriting the same summary.
- Stage records now include UTC start/completion times. S4 has per-scene records with current provider spend; warm replay records zero current spend and reports original artifact spend separately. The S4 cache identity was bumped for the changed record schema. Run manifests and CLI summaries distinguish source/preparation, live pipeline, and full execution wall time. Metrics include first-scene-ready latency, aggregate/per-scene API spend, and scene-planner versus shared preparation costs. Parallel stage durations are not summed for wall time.
- No live provider request was needed for this phase. The existing five-run cold baseline remains the last live benchmark (188–256 seconds per video, $0.0093–$0.0135); cold/warm 1/3/5-job measurements on the new run schema remain scheduled for the final validation phase, after the target architecture is in place.
- Verification on the current tree: `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed (368 Node tests, 17 Python alignment tests); `git diff --check` passed. Focused preparation test asserts cold S4 per-scene timing/spend and warm-cache replay accounting.
- **Next bounded task (Phase 1):** audit existing source parsers, `SourceIR`, figure enrichment, and the sibling RAG sidecar; identify the smallest adapter to return ranked, citation-bearing evidence blocks into the active lesson request. Then implement multiple document inputs and public HTTPS HTML/text/PDF URL intake, preserving page/slide/paragraph, block, table/equation, and figure provenance. Do not begin Phase 2 until Phase 1 tests and this handoff update are complete.

## Entry — 2026-09-26, Phase 1 source bundle and multimodal indexing completed

- **Implemented:** `LessonRequest.sources` and CLI repeated `--source` / `--url` inputs accept multiple PDF, DOCX, PPTX, Markdown, text, JSON, and public HTTPS HTML/text/PDF sources. URL requests reject credentials, custom ports, private/reserved DNS, and unsafe redirects; validated DNS answers are pinned for each request. HTML evidence carries URL selectors; PDF pages and Office paragraphs, tables, and slides retain their native locations.
- **Implemented:** PDF, DOCX, and PPTX embedded images are extracted to content-addressed assets with document hashes, source locations, MIME metadata, and derivation status. HTML figure images are fetched through the same public-HTTPS gate. The source bundle prompt includes sanitized figure metadata and ranked evidence, never local asset paths.
- **Implemented:** S1 creates an exact, citation-bearing `SourceBundle` with deterministic lexical/BM25 ranking. Citations resolve to original document source IDs, byte/line offsets, and page/slide/paragraph/URL selectors. Documents with conflicting claims remain separate ranked evidence rather than being merged into a synthesized answer. JSON source input is parsed and pretty-printed before text indexing.
- **Implemented:** Optional `RAG_ENGINE=on` indexes extracted text, tables, equations, and deduplicated embedded image assets through the existing RAG-Anything `rag-engine/service.py` adapter. It indexes parsed blocks once per stable bundle digest and records an estimated indexing cost in the run ledger. The sidecar's answer-only query is deliberately not presented as cited lesson evidence; ranked exact local evidence remains the lesson's evidence contract. If the sidecar runtime is not configured, the run reports `local-text` mode.
- **Runtime constraint:** No RAG virtual environment is installed in this checkout, so the live RAG-Anything integration (provider credentials, deep multimodal index, and its retained index cache) could not be exercised without external setup or paid calls. Its content-list contract, image/table/equation provenance, disabled fallback, budget handling, and manifest reuse path are covered by code and offline tests. No provider calls were made.
- **Verification:** After the final figure-metadata classification change, `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed 374 Node tests and 17 Python alignment tests; `python3 -m py_compile rag-engine/service.py` passed; `git diff --check` passed.
- **Next bounded task (Phase 2):** implement the duration-aware syllabus, stable lesson bible, and bounded module plans for 60/300/600/1800-second requests. Ensure source-supported shortening, distinct scene purposes, prerequisite ordering, and module budget validation. Keep the current per-response scene limits inside each module. Do not begin Phase 3 until Phase 2 implementation, tests, architecture docs, and handoff are complete.

## Entry — 2026-09-26, Phase 2 hierarchical duration-aware plans completed

- **Implemented:** The public source CLI now accepts exactly `--duration=60|300|600|1800` seconds. `plan/hierarchical.ts` defines typed `Syllabus` / `ModulePlan` contracts, exact budgets `[60]`, `[300]`, `[300,300]`, or six 300-second modules, prerequisite checks, unique goals, stable concept IDs and labels, citation coverage, explicit recall links, and shorter-supported-duration acceptance.
- `prepareLesson()` uses a syllabus call for canonical requests, then plans each bounded module with an excerpt containing only the module's evidence spans. Each module independently runs the existing concept graph, teaching plan, and scene-script validators; no single plan/script response exceeds existing schema limits. Concept IDs, labels, evidence, and prerequisites are merged into a global graph and bible. Namespaced scene IDs and module title/goal/budget/scene lists survive into live-run metadata for chapter export work.
- Runs persist `requestedDurationSec`, `plannedDurationSec`, and `coverageReason` in preparation output, CLI summary, and run manifest. Lesson budget caps are $0.10/$0.50/$0.70/$1.00 for 1/5/10/30 minutes; shortened plans use their planned-duration cap. Golden/renderer-fixture runs retain the $0.10 ceiling.
- **Verification:** duration/budget/coverage/prerequisite validation tests cover all four lengths and shortened plans; a mocked end-to-end 1-minute preparation test covers syllabus→module graph→plan→narration, stable bible assembly, and live-input module metadata. The existing short-fixture preparation path remains covered. `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed 379 Node tests and 17 Python alignment tests. The focused hierarchical suite passed 5/5.
- No provider calls were made. The 5/10/30-minute module call counts, output quality, live cost, word-clock synchronization, and final video assembly have not yet been benchmarked; those require the upcoming speech-timing/module-render phases and the final held-out corpus.
- **Next bounded task (Phase 3):** finish the two-human, three-source word-boundary calibration, select the measured aligner, prevent zero-duration words and mentions, retain voice/alignment workers across scene requests, and implement audio-master module-budget adjustment without rewriting or stretching completed speech. Do not begin Phase 4 until Phase 3 tests, architecture documentation, and handoff are complete.

## Entry — 2026-09-26, Phase 3 worker reuse implemented; calibration review pending

- `voice-engine/src/python-bridge.ts` now maintains bounded JSON-line provider workers. Supertonic and Piper load each model once per process (Piper caches by model path; Supertonic caches its TTS engine and voice styles); `VOICE_ENGINE_WORKERS` defaults to 1 to avoid multiplying model memory. Provider `synthMs` is preserved as synthesis time, separate from scene wall time including queueing. `closeVoiceEngineWorkers()` supports orderly shutdown.
- `shared/alignment/align.ts` now dispatches to persistent stable-ts workers; the Python worker caches its model and responds per line, with `HYPOTHESIS_ALIGNMENT_WORKERS` defaulting to 2 and capped at 8. Existing exact word-sequence, positive-interval, and fail-closed publication gates remain in place. Added a fake-sidecar test for model-process reuse and bounded worker count, plus a mocked Python model-cache test.
- **Local measurement:** `voice-engine` typecheck passed. Two local Supertonic synthesis calls through the new worker measured provider times 683 ms and 681 ms, with audio durations 2.717 s and 3.065 s; combined wall time was 1.854 s. These are two short TTS calls, not a scene/video benchmark. Output WAVs were written under `/private/tmp/hypothesis-voice-engine-worker-check/`. No paid API call was used.
- **Review pack ready:** both independent blinded review pages are at `.data/alignment-review/2026-09-26-five-topic/participants/judge-1/review.html` and `.../judge-2/review.html`; the organizer key is `.data/alignment-review/2026-09-26-five-topic/organizer-key.json` and must stay with the organizer. It was assembled from the five dated cold runs (Constitutional AI, RLHF, Interpretability, Next-token prediction, Red teaming): five distinct source hashes, 29 scene clips, 793 word items. The pack clears the three-source/100-word minimum. No votes exist yet. Score with the documented `word_boundary_review.py score --key ... --votes ... --votes ...` command after two independent reviewers export complete vote JSONs.
- **Blocking condition for Phase 3 completion:** calibration remains `unmeasured`; do not change `calibration.v2.json`, permit publish, or promote CTC/stable-ts based on diagnostics. The request explicitly requires two independent human timing reviews, and no human labels may be synthesized from the existing aligners. Also outstanding within Phase 3 is audio-master adjustment of unwritten later-scene budgets; current preparation still writes all module scripts before TTS. Resolve this by introducing a module-at-a-time script/audio boundary, then compare completed module audio with its budget and re-budget only scenes whose narration has not been written.
- **Worker verification:** after these edits, `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed 380 Node tests and 18 Python tests; `npm run typecheck` in `voice-engine/` passed; `python3 -m py_compile src/experimental/hypothesis/shared/alignment/align.py voice-engine/src/python/supertonic_tts.py voice-engine/src/python/piper_tts.py` passed; and `git diff --check` passed. Do not begin Phase 4 until the human calibration requirement and module timing-control contract are complete and documented.

## Entry — 2026-09-26, Phase 3 audio-master module timing implemented; human calibration still pending

- **Implemented:** the live lesson CLI now injects its configured speech aligner into `prepareLesson()`. Canonical lessons finish one module's S4 script, synthesize and align those scenes, validate exact token order and positive in-bounds word intervals, then plan the next module. If a positive audio duration exists but a word-clock check fails, the measured duration can still rebudget later modules while the hard alignment failure is carried into the live result; if synthesis/alignment fails or reports no usable duration, preparation stops. Measured audio duration includes actual scene lengths and inter-scene gaps. Only unwritten modules are rebudgeted; completed narration is not rewritten, truncated, padded, or sped up.
- **Run accounting:** each module records syllabus budget, effective budget, and measured audio duration; each module's preflight S5 wall time/cache status is a stage record. The final run stores target duration, actual duration, signed delta, and per-module audio milliseconds. In a cold run, S5 artifacts created at the module boundary are reused later in that same process, while a new cold-run store ignores artifacts from the prior process. This prevents duplicate synthesis without weakening cold-cache measurements.
- **Output clock:** generated lessons now concatenate only real scene audio and the declared inter-scene gaps; they do not add trailing silence to meet the requested duration. Golden diagnostic clips retain target padding. Any generated-lesson mismatch is recorded as a non-hard duration-budget delta and the video uses measured audio duration. No live run has yet verified quality or duration accuracy with the local aligner.
- **Tests:** `npm run test:hypothesis` passed **383 Node tests and 18 Python alignment tests**. This includes a synthetic 10-minute/two-module integration where the first module measures 310.05 seconds and the unwritten second module changes from 300 to 290 seconds, plus an assertion that its S5 audio artifact is reused without a second aligner call. `npm run typecheck` in `voice-engine/` passed. `python3 -m py_compile src/experimental/hypothesis/shared/alignment/align.py voice-engine/src/python/supertonic_tts.py voice-engine/src/python/piper_tts.py` and `git diff --check` passed. These are code-contract tests, not live timing evidence. No paid provider calls were made.
- **Phase status:** the audio-master control and worker reuse are implemented and tested. Phase 3 is **not complete**: two independent human annotations across the prepared three-plus-source pack are still missing, so aligner accuracy/calibration remains `unmeasured` and generated videos remain publication-blocked. Do not change the calibration record, declare a measured aligner, or begin Phase 4 until those annotations are scored and calibration passes. Review pages remain at `.data/alignment-review/2026-09-26-five-topic/participants/judge-{1,2}/review.html`; keep `.data/alignment-review/2026-09-26-five-topic/organizer-key.json` private. The next bounded action is to obtain both complete independent vote JSON files and run the documented scorer, then resolve any measured alignment failures before proceeding.

## Entry — 2026-09-26, Phase 3 local aligner and worker diagnostics; human gate unchanged

- **Runtime correction:** the local alignment environment was present all along; the earlier note that it was missing was incorrect. Verified stable-ts `2.19.1`, faster-whisper `1.2.1`, and cached faster-whisper `base` / `base.en` models. Diagnostics below ran with `HF_HUB_OFFLINE=1`; no model download or network call occurred.
- **Repeatable worker benchmark:** added `scripts/alignment-worker-benchmark.mjs`. Reproduce after `npm run build` with:
  `HF_HUB_OFFLINE=1 node scripts/alignment-worker-benchmark.mjs --run-dir=.data/hypothesis-runs/claude/timing-20260926-v2/runs/constitutional-ai --run-dir=.data/hypothesis-runs/claude/timing-20260926-v2/runs/rlhf --model=base --workers=1,2 --scenes-per-run=3 --repeats=3 --out=.data/alignment-review/2026-09-26-five-topic/alignment-worker-benchmark.json`
  In three repeats over six real scene clips, pool size 1 measured p50/p95 wall time 1,606/1,613 ms; pool size 2 measured 1,396/1,399 ms. All 18 samples retained exact narration-token order. Five of six scenes had zero-duration intervals on every repeat, for 15 interval failures per worker setting. This sample shows about 1.15x p50 batch speedup at pool size 2, with alignment validity still failed.
- **Candidate diagnostics:** on the same six scenes, stable-ts `base.en` had five zero intervals total; stable-ts `fast_mode=True` also left five zero intervals; `suppress_silence=False` left the same five zero intervals. No timestamp repair or spoken-word deletion was applied. Full per-scene results are in `.data/alignment-review/2026-09-26-five-topic/local-worker-diagnostic.json`.
- **CTC comparison:** the existing `compare_aligners.py` diagnostic ran on all five generated topics (29 scene clips). It reported 18 stable-ts zero-duration words and zero WAV2VEC2 CTC zero-duration words. Aggregate median absolute error against the report's utterance-edge RMS VAD proxy was 35.6 ms for stable-ts and 48.0 ms for CTC. That proxy measures scene onsets/offsets only; it is not human word-boundary truth and cannot promote either aligner. Full results are in `.data/alignment-review/2026-09-26-five-topic/ctc-diagnostic-five-topic.json`.
- **Next action and phase gate:** keep stable-ts live selection and the `calibration.v2.json` unchanged. Two independent reviewers still need to complete the existing five-source/793-word blinded pack. Score their two vote JSONs with the documented `word_boundary_review.py score` command, inspect candidate-vs-human per-word error and reviewer agreement, and only then decide whether an aligner change is warranted. Do not begin Phase 4 until this calibration gate is measured and accepted. No paid provider calls or new lesson generations were made.

## Entry — 2026-09-26, Phase 3 calibration pack made resumable

- **Implemented:** blinded word-boundary review pages now persist each participant's annotations in browser-local storage, restore only entries belonging to that package/reviewer, and save progress on field updates and before page exit. Vote export remains disabled until every word interval is finite, positive, within the clip, and ordered; the scorer still independently validates downloaded votes. Candidate aligner labels/timestamps remain absent from participant pages and the organizer key remains outside the participant directory.
- **Rebuilt the review pages** from the same five provider-generated runs (five independent SourceDoc hashes, 29 scene clips, 793 words). New pages: `.data/alignment-review/2026-09-26-five-topic-resumable/participants/judge-1/review.html` and `.../judge-2/review.html`. Organizer key: `.data/alignment-review/2026-09-26-five-topic-resumable/organizer-key.json`; do not distribute it to reviewers. The old pack remains unchanged.
- **Verification:** `python3 -m unittest src/experimental/hypothesis/shared/alignment/test_word_boundary_review.py -v` passed 6 tests; `python3 -m py_compile src/experimental/hypothesis/shared/alignment/word_boundary_review.py` passed; `git diff --check` passed. Added assertions cover local persistence, page-exit saving, and guarded export. No alignments/calibration were altered and no provider calls were made.
- **Phase status:** still incomplete. This change makes the human step resumable but supplies no human annotations. `calibration.v2.json` remains `unmeasured`, stable-ts still has observed zero-duration words, and no candidate aligner is promoted. Phase 4 remains gated.
- **Next bounded action:** two independent reviewers complete the separate pages and return their downloaded `judge-1-votes.json` and `judge-2-votes.json`. Score only those human-produced files with `word_boundary_review.py score --key .data/alignment-review/2026-09-26-five-topic-resumable/organizer-key.json --votes <judge-1-votes.json> --votes <judge-2-votes.json> --out .data/alignment-review/2026-09-26-five-topic-resumable/report.json`; then inspect agreement and candidate errors before deciding whether the live aligner/timing gate can pass. Do not start Phase 4 before that result is reviewed.

## Entry — 2026-09-26, Phase 3 Unicode mention matching defect fixed

- **Root cause:** generated scripts use curly possessives (`assistant’s`, `constitution’s`, `text’s`). `tokenizeWords()` recognized only straight apostrophes, splitting these marker phrases into different tokens from the single curly-apostrophe word returned by speech alignment. Existing five-topic manifests consequently recorded three `mention-missing-span` failures even though the aligned transcript contained the phrase.
- **Fix:** the shared narration tokenizer now treats common Unicode apostrophe forms as internal word characters. Mention normalization maps curly/modified apostrophes to straight apostrophes before comparison. It does not alter audio boundaries or soften the missing-span gate.
- **Generated-run replay:** using the saved narration and aligned-audio artifacts from the five cold source-generated lessons, the current resolver mapped all **116/116** mentions: Constitutional AI 29/29, RLHF 21/21, Interpretability 21/21, Next-token prediction 28/28, Red teaming 17/17. No TTS or provider calls were made. This verifies the three old apostrophe-related missing-span failures are resolved against actual generated artifacts; each run still correctly has alignment-calibration/zero-interval failures.
- **Verification:** added straight/curly apostrophe cross-match coverage. `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed **384 Node tests and 18 Python tests**; saved-run mention replay had zero failures; `git diff --check` passed.
- **Phase status:** mention matching now passes on the retained samples, but Phase 3 remains incomplete because the two-human review is still outstanding and zero-duration stable-ts intervals remain. Keep `calibration.v2.json` unchanged and do not start Phase 4.
- **Next bounded action:** obtain and score the two independent votes in `.data/alignment-review/2026-09-26-five-topic-resumable/` as described above. The output must be reviewed against the pre-registered agreement and candidate-error criteria before any aligner or live timing gate change.
## Entry — 2026-09-26, review fixes applied; Phase 3 gate remains open

- **Review remediation:** closed the persistent-worker shutdown hang by moving worker cleanup out of `process.on('exit')` and into CLI `finally` blocks; added a shared speech-worker close path for lesson/live CLIs. Alignment abort now removes queued requests or terminates/replaces an active worker. Syllabus recall links must point backward and teach the repeated concept. RAG sidecar queries now return structured retrieved chunks; only verbatim spans that resolve to original source offsets can become deep-indexed lesson evidence, while generated image captions are excluded as factual evidence. Local retrieval remains available when the sidecar cannot be queried.
- **Phase order correction at that time:** a prior continuation briefly added bounded S6 planning and scene-ready events before Phase 3 had met its human calibration requirement. Those Phase 4-only code/doc additions were removed to follow the then-current “complete one by one” direction. The later 2026-09-26 approval below supersedes that sequencing decision: engineering phases may proceed while the human calibration gate is pending, but Phase 3 and publication remain gated.
- **Latest verification before deferring Phase 4:** `npm run typecheck:hypothesis` passed; full `npm run test:hypothesis` passed **388 Node tests and 18 Python tests**; `voice-engine` `npm run build` passed; `git diff --check` passed. The deleted Phase 4 concurrency test is not part of the current tree; rerun the suite after any further Phase 3 edits.
- **Review-fix runtime status:** RAG's structured query mapping is covered offline, including exact-source-span resolution and caption rejection. Live RAG-Anything query execution is still unverified in this checkout because its configured sidecar environment is absent. No provider or live video calls were made during this continuation.
- **Release gate unchanged:** the resumable five-source word-boundary pack still has no two independent human vote files; `calibration.v2.json` remains unmeasured, and retained runs contain zero-duration stable-ts words. Never mark a generated lesson passed or alter calibration based on code tests or aligner-derived labels. Per the user's continuation instruction, Phase 4 development can proceed while this independent publication gate remains open.
- **Human calibration action:** obtain two independently completed vote JSONs for `.data/alignment-review/2026-09-26-five-topic-resumable/participants/judge-{1,2}/review.html`, score them with the organizer key and documented `word_boundary_review.py score` command, inspect agreement and candidate error, and update calibration only from valid human evidence. No vote files or calibration report are present in the review directory. If the measured aligner does not satisfy criteria, continue aligner correction and review; this remains a Phase 3/publication blocker while later engineering proceeds.

## Entry — 2026-09-26, sequencing decision superseded; Phase 4/5 engineering authorized

- **User direction:** “PLEASE IMPLEMENT THIS PLAN” (the approved plan specifies that later engineering may proceed while human calibration is pending and that Phase 3 and publication remain gated).
- **Authoritative sequence:** the earlier deferral entry records the decision that was in force then. This entry supersedes its stop-work instruction. Continue Phase 4 and Phase 5 engineering in parallel after agreeing on their event/visual contracts. Do not mark Phase 3 complete or a generated lesson `passed` without the independent human calibration and all release gates.
- **Phase 4 status:** not complete at start of this entry. Existing `runLive.ts` waits for all S5 scene audio/alignment before S6 and then fans out visual planning without a bounded pool; the browser preview consumes only a completed run manifest. Module clip assembly, progressive ordered scene events, chapter export, and resume behavior are outstanding.
- **Phase 5 status:** existing low-level formula, plot, matrix, and number-line scene primitives are available, but the S6 board contract does not yet express typed teaching forms or validate derivations and cross-scene repetition.
- **Human blocker:** the resumable five-source review pack still has no exported votes or scored report; `calibration.v2.json` remains `unmeasured`. Human annotations must come from two independent reviewers. Keep all live run statuses honest.
- **Agent coordination:** personal Codex implementer/tester/reviewer roles are configured under `~/.codex/agents/`, with three concurrent subagents. The parent owns shared contracts, integration, documentation, and final verification; Phase 4 pipeline, Phase 4 player/export, and Phase 5 visual changes use disjoint ownership.
- **Verification at start:** `npm run typecheck:hypothesis` passed; `npm run test:hypothesis` passed 387 Node tests and 18 Python tests; `git diff --check` passed. These offline checks do not establish alignment calibration or generated lesson quality.
- **Next:** finish and integrate Phase 4 and Phase 5, then run complete Phase 6 validation across cold/warm durations and concurrency. Continue the human review in parallel and update the calibration only from scored human evidence.

## Entry — 2026-09-26, Phase 4/5 engineering integrated; release gates remain open

- **Phase 4 implemented:** `runLive.ts` now overlaps each S4-ready scene's S5 TTS/alignment with timing-independent S6 planning. It joins that scene's exact measured S5 result before mention timing, layout, gates, and event publication. S5 and S6 work remains bounded, and a cross-process host lease limits provider requests, TTS/alignment, and rasterization. Limits are configurable with `HYPOTHESIS_PROVIDER_CONCURRENCY`, `HYPOTHESIS_SCENE_CONCURRENCY`, `HYPOTHESIS_S6_CONCURRENCY`, `HYPOTHESIS_TTS_ALIGNMENT_CONCURRENCY`, and `HYPOTHESIS_RASTER_CONCURRENCY`.
- **Progressive events/player implemented:** ordered `scene.playable` JSONL events are emitted after the descriptor and hashed scene WAV are ready. Event sequence counts only playable scenes, so a failed scene cannot create a sequence gap. The local player polls while generation continues, validates descriptor/audio hashes, retries transient fetch failures, and plays scene audio in order. First-playable latency is measured after event append.
- **Module export implemented:** module-local clocks, WAVs, and VTT captions feed content-addressed resumable clips. Raster frame caching uses exact rendered SVG and complete Resvg options, with an integrity manifest and bounded storage. Assembly probes actual clip durations for chapter boundaries and writes compatible H.264/AAC clips into one MP4 with chapters and `mov_text` captions.
- **Phase 5 implemented:** typed process, comparison, worked-example, formula, plot, matrix, and number-line boards compile through the existing deterministic renderer. Arithmetic steps are checked; examples are marked illustrative; visual labels and factual numeric parameters must resolve to scene source evidence; duplicate concepts and exact consecutive repeats are rejected. Topic/value regression tests include source-backed scientific notation, decimals, and Unicode minus.
- **Verification:** `npm run typecheck:hypothesis` passed. `npm run test:hypothesis` passed **408 Node tests and 18 Python tests**. The suite includes real synthetic ffmpeg module assembly checks for video/audio/subtitle streams, chapter bounds, caption output, and audio/video duration within 100 ms; interruption cleanup and resumable/corrupt-clip repair; frame-cache key/integrity and host concurrency checks; and player event-gap handling. `voice-engine/npm run build` passed. `git diff --check` passed. These offline fixtures verify engineering contracts only.
- **Status distinctions:** Phase 4 and Phase 5 engineering are `implemented` and their offline acceptance checks are `passed`. Live generated-video teaching quality, 1/5/10/30-minute cold/warm results, 1/3/5-job performance, end-to-end billed costs, and live RAG-Anything remain `unmeasured`. Environment check found no `OPENROUTER_API_KEY`, no enabled `RAG_ENGINE`/`RAG_PYTHON`, and no `rag-engine/.venv/bin/python`; no provider lesson was generated. The event and module-export integration has not been exercised on a calibrated source-generated lesson.
- **Phase 3/publication:** `unmeasured`, not complete. The five-source pack remains 5 sources / 29 clips / 793 words and still has no two human vote JSON files or scorer report. `calibration.v2.json` remains `unmeasured`; no human labels or aligner promotion were created. No generated lesson may be marked `passed`.
- **Next bounded human action:** obtain independent annotations for `.data/alignment-review/2026-09-26-five-topic-resumable/participants/judge-{1,2}/review.html`, then score both real exports with `python3 src/experimental/hypothesis/shared/alignment/word_boundary_review.py score --key .data/alignment-review/2026-09-26-five-topic-resumable/organizer-key.json --votes <judge-1-votes.json> --votes <judge-2-votes.json> --out .data/alignment-review/2026-09-26-five-topic-resumable/report.json`. Inspect agreement and word-boundary errors before changing calibration. After that gate is measured, continue live 1/5/10/30-minute cold/warm lessons, 1/3/5-job concurrency benchmarks, and blinded complete-lesson reviews under the existing duration caps.
- **Agent setup:** personal implementer/tester/reviewer roles are configured under `~/.codex/agents/`; `~/.codex/config.toml` sets `max_concurrent_threads_per_session = 3`. The generic user-level delegation workflow is in `~/.codex/AGENTS.md`. A new Codex session may be needed for the concurrency setting to take effect.

## Entry — 2026-09-26, Phase 6 live preflight attempts blocked before provider access

- **Environment check:** project `.env` contains configured OpenRouter credentials/model IDs; voice Python, ffmpeg, and ffprobe are installed. The key's validity and remaining credits are unverified.
- **Attempts:** cold diagnostic runs requested 60, 300, and 600 seconds from `.data/sources/rainbow-formation.md`, under the existing duration caps with `--plan-despite-alignment-failure`. All failed during S1 syllabus fetch in 0.20–0.24 seconds (internal stage wall 26–38 ms), with zero provider calls and $0 cost. S4, S6, TTS, alignment, and MP4 export were not reached. No videos were produced. The 1800-second run and live concurrency 1/3/5 benchmarks remain unattempted.
- **Escalation outcome:** a network-enabled retry was rejected by automatic approval review because it would transmit local source text and prompts to OpenRouter, and the reviewer found the request had not specifically authorized that external destination/payload. No alternate network route was used. See `.data/hypothesis-runs/phase6-2026-09-26/PHASE6-LIVE-ATTEMPTS.md` for elapsed time, run IDs, summary artifacts, and next steps.
- **Status:** Phase 6 live validation remains `unmeasured`; these preflight failures are not performance results. To resume, the user must explicitly authorize sending the selected source documents and prompts to the OpenRouter endpoint configured in `.env`. Existing human timing calibration/publication gates also remain open.

# Visual coverage and fitness plan

**Worktree:** `hypothesis_claude-simi-parity-work-20260928`  
**Branch:** `codex/simi-parity-work-20260928`  
**Base:** `e47ee6d`  
**State:** frozen pre-change baseline is complete. B3 structural claim mapping and the pre-render gate are implemented and covered by offline tests, but the post-change quality comparison did not pass. The first cold five-case pass had hard failures in all five cases, four produced no video, and psychology encoded a partial video despite a missing scene. That gap was fixed. A second cold pass timed out in S2–S4 across all five cases before producing lesson artifacts. Final fixes disambiguate relation targets, require targets to finish revealing by the mapped spoken-claim end, flatten compound aligned words when mapping timing, fail closed on malformed contracts before S11, and serialize few-shot examples using the current board shape. No successful live provider comparison exists for these fixes. Structural checks do not establish semantic claim-to-visual entailment. Full evidence: ignored `.data/benchmark-20260928/b3/attempts.json`.

**Final audit update:** an authenticated OpenRouter `/models` check returned HTTP 200 and listed the frozen model. Automatic approval review rejected the next fixed five-case B3 call before process creation because submitting the source corpus and prompts to OpenRouter lacked specific payload authorization; it prohibited an indirect retry. No new provider spend or post-change evidence resulted. A focused reviewer-found claim-start boundary defect was fixed offline after that rejection. The review also confirmed that S6-selected icons are pinned as rung 2, score 1, so the rung 3 mismatch gate does not assess their metaphor fitness. See `docs/AUDIT-2026-09-28.md` and the latest `docs/HANDOFF.md` entry.

## Goal

For every source-grounded essential teaching claim in a generated scene, preserve a machine-readable link from the claim to a visible depiction, and fail the scene before rendering if any required claim lacks that coverage. Then assess whether the depiction actually conveys the claim, especially when S6 selects a confident but semantically wrong icon. Keep templates generic and require evidence from multiple unrelated topics before adding a reusable diagram recipe.

## Frozen experiment rules

- The fixed corpus is exactly: science/osmosis, engineering/thermostat-feedback, medical/vaccination-immunity, pharmacy/half-life-dosing, and psychology/spaced-repetition.
- Freeze the exact learner prompt, source bytes/hash, requested duration, content model, planner model, and one-shot command for all five cases. Run cold, once, on one fixed implementation before and after each behavioral change.
- Change code or model configuration in a comparison, never both. Keep the model IDs fixed for code comparisons.
- Stop after two failed attempts on the same failure mode and report the evidence before trying a different approach.
- The five required topic inputs and hashes are frozen in `.data/benchmark-20260928/inputs/`. Earlier diagnostics established that ordinary-sandbox DNS fails, while the network-enabled API path works; local voice-engine and alignment setup is now complete and guarded by runner preflight. The approved baseline is recorded in `.data/benchmark-20260928/baseline/results.json`, with pre-run logs preserved under `.data/benchmark-20260928/attempts/pre-approved-extra-batch-snapshot/`. Do not alter inputs or treat older, different-topic results as this corpus baseline.
- Keep provider credentials in the process environment. Do not copy or print them. Keep run media and provenance under ignored `.data/` or `output/`.

## Remaining work

### 0. Corpus lock and baseline — complete

- Prepare one stable, source-grounded input and one fixed learner prompt per named topic.
- Record source SHA-256, prompt SHA-256, duration, model IDs, one-shot command, run ID, cost, cache state, hard failures, scene count, encoded duration, and artifact locations in a non-secret corpus manifest under `.data/benchmark-20260928/`.
- Ran all five cases once against `e47ee6d`, cold, with frozen hashes and model IDs. Costs/hard failures/scene counts/encoded durations: osmosis $0.00797130 / 0 / 3 / 58.956s; thermostat $0.009515775 / 0 / 4 / 62.551s; vaccination $0.00688928 / 4 / 3 / 58.123s; half-life $0.00802929 / 3 / 3 / 58.390s; spaced repetition $0.00863736 / 0 / 4 / 59.123s. Total **$0.04104301**. All videos and provenance exist. The runner exited 2 because the medical and pharmacy quality gates failed; this is recorded baseline evidence, not an infrastructure failure.
- Baseline acceptance is met. Proceed to B3 with the same five cases before/after, preserving exact inputs and models. Do not change code and model together; do not begin B4 until B3 comparison evidence is recorded.

### B3. Visual claim coverage map

**Current implementation surfaces (checked at `e47ee6d`):** `plan/schemas.ts` defines and validates `SceneContract`; `pipeline/lesson.ts` derives contracts and receives the S4 script; `types.ts` defines S4 `NarrationScene`; `narration/markers.ts` derives exact spoken-text spans from marked narration; `planner/context.ts` compiles the S3 contract, S4 narration, source evidence, and candidates into the versioned S6 context; `planner/board.ts` validates model board intent and compiles it into `SceneSpec`; `pipeline/runLive.ts` calls `runVisualChain` and collects hard gate failures; `validation/gates.ts` contains reusable scene adequacy checks. Keep B3 claim attribution flowing through those contracts and make the final coverage check before S10 render. `visualChain.ts` calls `runClaudeGates` after layout/timeline and before the S10 final-frame render, so that is the current pre-render enforcement point; a publish-only check would be too late.

1. **Implemented:** S3 derives stable essential-claim IDs, concept/relation links, and source evidence. Contract validation rejects forged links. S4 requires exactly one exact spoken substring per claim and derives marker-stripped offsets in code.
2. **Implemented, structurally:** S6 passes claims through context, prompts for a visual intent per claim, compiles targets to board elements/edges, and checks source evidence, concept/relation coverage, and complete reveal timing against aligned speech before S10. This cannot prove semantic entailment.
3. **Implemented:** coverage failure skips S10. Missing boards for generated scenes with essential claims also raise `visual-claim-coverage`, so S11 cannot publish an incomplete subset.
4. **Implemented after first batch review:** S3 expands each claim's evidence inventory to include all graph-backed spans from linked concepts and relations, allowing visual targets to cite the evidence they depict.
5. **Tests:** positive and negative coverage cases include multiple targets, source-backed relation edges, ambiguous parallel edges, topic swaps, missing/unknown/duplicate claim IDs, dangling/unsupported targets, incomplete relations, absent/zero/end-only reveals, reveals that finish after spoken claim end, and compound tokens inside an aligned word. Generated live inputs fail closed on malformed or empty essential-claim contracts, including S11 suppression.
6. **Recipes:** none added. The first cold pass showed diverse planner failures (label length, concept duplication/omission, target/evidence mismatch, board density); it did not isolate a reusable state-comparison or ray-path recipe need supported by two unrelated topics.
7. **Benchmark:** first cold pass, same hashes/models: 5/5 failed status (hard failures 12, 13, 6, 16, 10). Four produced no video; psychology encoded a partial 64.190s video despite one missing scene. The no-board bypass was fixed. Second five-case cold pass reached OpenRouter but timed out before completing S2–S4 for all five (recorded spend $0.01133103; no scene outputs). No further provider attempt was made. Later relation identity, timing, schema guards, and current-shape few-shots have offline tests but no live comparison.
8. **Muted review/Simi-60:** not passed. No valid complete post-B3 video set is available for review; the psychology partial artifact is not an acceptance result.

**Minimum B3 negative-test matrix:** reject a missing essential claim in S4; reject an unknown or duplicate claim ID and any span that does not match the flattened narration; reject an intent with an unknown claim ID, a dangling element/edge target, or no target; reject targets whose evidence does not support the referenced claim; and reject a target whose primary reveal is absent, zero-length, after scene end, or finishes after the mapped spoken claim ends. Positive tests cover multiple targets, same-endpoint edges with distinct relation types, compound words, and a generic topic swap. These remain structural checks, not a semantic entailment judge.

### B4. Rung-2 metaphor fitness

**Not started.** B3 has not passed its required same-corpus post-change validation; do not make another behavioral change or run the B4 comparison until a valid B3 result set is available.

1. Use B3 claim-to-visual links as inputs to a semantic fitness check; do not raise a similarity cutoff as a substitute.
2. Make claim, selected depiction, source evidence, and adjudication provenance inspectable. A confident but wrong rung-2 metaphor must fail closed or use a safer labelled primitive/text representation.
3. Calibrate on reviewed, cross-domain examples before claiming the check is reliable. Keep uncalibrated judgments as warnings or draft state; never report a pass based solely on the planner's own strategy label.
4. Run the same five cases before/after the isolated B4 behavior change, with the same model IDs and exact inputs. Stop after two repeated failures.

### Simi-60 acceptance

After B3 and B4, require repeated results on the fixed corpus with 60–90 second encoded duration, 3–5 scenes, zero hard failures, and comprehensible teaching when muted. Keep human alignment calibration and any missing human review explicitly unmeasured; implementation and offline tests alone cannot pass this gate.

## Explicitly deferred

Audio mastering at −21 LUFS and content-aware WPM, already-taught long-form memory, and 5/10/30-minute orchestration remain deferred until Simi-60 passes. No provider/model swap will be combined with B3 or B4.

## Current blockers and evidence

- HEAD remains `e47ee6d` on the continuation branch; tracked source is intentionally uncommitted. The prior checkout and its intentional local untracked files remain untouched. The `.env` was loaded only in process and values were never printed or copied.
- The exact source/prompt corpus is in ignored `.data/benchmark-20260928/inputs/` with SHA-256 values in `corpus.json`. Model IDs remained `openai/gpt-6-luna` for content and planning.
- `.data/benchmark-20260928/run-fixed-baseline.sh` validates input hashes, frozen model IDs, baseline commit, clean tracked tree, ffmpeg, built voice-engine, and alignment Python before running. The one-shot wrapper passes `--cache=cold`. All five final records are present; see the result index and the latest HANDOFF entry.
- The user supplied the existing `.env` path in the prior checkout. It was read in memory only; no values were printed or copied. Model IDs were `openai/gpt-6-luna` for content and planner.
- The prior ignored benchmark artifacts are outside this worktree and do not match the required corpus: their topics were rainbow formation, cash flow, composting, a DeepSeek technology lesson, and memory. They are not valid before-run evidence.
- The ordinary worktree shell cannot resolve OpenRouter, but the authenticated network-enabled path works (the authenticated `/models` request returned HTTP 200). Earlier provider attempts exposed missing voice-engine and alignment setup; both are installed, smoke-tested, and checked by runner preflight. The latest authorized fixed-corpus run produced all five videos and provenance at a total recorded cost of $0.04104301.
- `.data/benchmark-20260928/b3/attempts.json` preserves both post-B3 batches, exact working-diff fingerprints, all case logs/results, and the current source diff hash. First batch cost $0.05181606. Second batch cost $0.01133103 and timed out on each case at S2–S4, with no scene output. Provider retries stopped after that batch.
- Latest offline verification: `npm run typecheck:hypothesis` passed. `npm run test:hypothesis` reports 552/553 Node tests passing; sole failure is `plan-lock.test.js` because actual mode 644 differs from expected 444. The frozen file was not modified or chmod'd. Node excluding that file: 550/550; alignment: 24/24; RAG: 12/12; `git diff --check`: clean. Current tracked source-diff SHA-256 against `e47ee6d`: `2d5aa843a57ddb9d62813f3b9ebbc6b1224ba524822e8ac48ac1e0cc4c0b2515`.
- B3 structural claim mapping, pre-render coverage, no-board S11 blocking, evidence expansion, relation-specific edge identity, aligned speech reveal timing, and direct-input S3 schema validation are implemented. B3 live quality validation remains unsuccessful; semantic entailment is unmeasured. B4 and Simi-60 are incomplete. No reusable diagram recipe was added because the measured failures did not isolate a demonstrated recipe gap.

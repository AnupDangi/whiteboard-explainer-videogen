# Agent contracts — audit of every model call in the STCC pipeline

Read-only audit. Source of truth is the code; this document mirrors it and must be
updated when a stage prompt/schema/version changes. Every call goes through
`src/llm/structuredCall.ts` (temperature 0, provider JSON schema, bounded repair,
budget ledger). Every call is retained by `src/structured/recorder.ts` and replayable
by `src/structured/replayClient.ts`.

| # | Stage | schemaName | Builder | Schema | Repairs | Prompt version (cache key) | Failure codes |
|---|-------|-----------|---------|--------|---------|----------------------------|---------------|
| 1 | S1b Syllabus | `lesson_syllabus` | `syllabusSystemPrompt` `src/plan/hierarchical.ts:139` | `SyllabusOutputSchema` / `SyllabusSchema` `hierarchical.ts:20` | 2 | `S1-syllabus-prompt-v4-source-examples+<examples-hash>` (`lesson.ts:161`) | `source-insufficient-for-goal`, quote unanchorable |
| 2 | S2 Concept graph | `concept_graph` | `buildConceptGraph` `src/plan/stages.ts:71` | `ConceptGraphSchema` / `ScopedConceptGraphSchema` `schemas.ts:62,70` | 1 | `S2-concept-graph-prompt-v4-source-examples+<examples-hash>` (`lesson.ts:216,306`) | relation self/dup/unanchored dropped; evidence quote absent |
| 3 | S3 Teaching plan | `teaching_plan` | `buildV6DerivedContractsPrompt` `stages.ts:309` | `TeachingPlanDraftSchema` (v6) / `TeachingPlanSchema` `schemas.ts:149` | 1 | `S3-teaching-plan-prompt-v6-derived-contracts-v9-richness-examples+<examples-hash>` (`lesson.ts:311`) | `plan-repair-failed`, kind/intent mismatch `contracts.ts:295`, continuity restatement |
| 4 | S4 Narration | `scene_narration` | `writeScript` `stages.ts:598` | `SceneTextSchema` `stages.ts:590` | 1 | `S4-narration-script` cache; one call per scene | `script-repair-failed`, `script-truncated-after-repair`, `scene-over-budget` (soft) |
| 5 | S3.5 Depiction nouns | `depiction_nouns` | `proposeDepictionNouns` `src/assets/depictionDirector.ts:33` | local `SCHEMA` `depictionDirector.ts:27` | 1 | `depiction-director-v1` | unknown referent |
| 6 | S3.5 Depiction judge | `depiction_verdicts` | `judgeDepictions` `depictionDirector.ts:106` | local schema `:119` | 1 | — | unknown index |
| 7 | S3.5 Icon validation | `icon_validation` | `validateIconCandidates` `src/assets/iconValidation.ts:42` | local `SCHEMA` `:36` | 1 | `icon-validation-v1` | unknown referent, pick not a candidate |

> **Status note:** the live depiction path is `selectDepictions` (`depictionDirector.ts`): depiction-noun proposal → exact-name `resolveNouns` → `judgeDepictions`. `validateIconCandidates` (row 7) has **no production caller** in this tree — it is kept and tested, but a prompt change there does not affect generated video. Wire it into `visualDiscovery` or treat it as a test-only module.
| 8 | S6 Board planner | `board` | `buildBoardPrompt` `src/planner/board.ts` | board v5-intent schema | 2 | `board-prompt-v28-generic-notation+board-bank-v4-representation-intent` (`board.ts:34`) | board repair exhaustion |
| 9 | S6 Scene spec (legacy) | `scene_spec` | `src/planner/prompt.ts` | SceneSpec | 1 | `scene-planner-prompt-v16-layout-recipes` (`context.ts:11`) | copy-guard `plan.ts:154` |
| 10 | VLM Judge | — | `src/harness/judge.ts` | — | — | `judge/v3` (`judge.ts:19`) | judge cache key |
| 11 | (V2) Beats | `teaching_beats` | `src/teaching/beat-plan/plan.ts:26` | `BeatPlanDraftSchema` | — | — | — |
| 12 | (V2) Beat narration | `beat_narration` | `src/narration/beat-narration/generate.ts:13` | `SceneNarrationDraftSchema` | — | — | — |
| 13 | (V2) Board ops | `scene_board` | `src/visual-v2/ops-plan/plan.ts:13` | `SceneBoardDraftSchema` | — | — | — |

## Determinism boundary

- Deterministic by construction (post-lock): lock `src/run/lessonLock.ts:32` v4, seeded
  Rough `src/render/roughAdapter.ts:51`, pure `renderSVG` `src/render/renderScene.ts:247`,
  content hashes, `--from=<lock>` rerender.
- Deterministic by replay (model stages): every call writes a `replay-fixture.json`
  (`recorder.ts:74`); `replayClient` re-serves it only when `requestHashOf(system,user,schemaName)`
  matches (`replayClient.ts:28`). A completed run re-executes bit-identically.
- Not bit-identical on a fresh call: LLM judgment (steps 1-9, 11-13). Measure by
  reliability / pass@k / variance (STCC §46), never assert bit-equality.

## Trace locations

`<run>/structured/<stage>/<n>-<subject>/`: `raw-model-output.json`, `validation-errors.json`,
`repair-patches.json`, `validated-output.json`, `coercions.json`, `report.json`,
`replay-fixture.json`.

# Agent pack 03 — S3 Teaching plan

- Stage: S3. Builder: `buildV6DerivedContractsPrompt` `src/plan/stages.ts:308` (variant `v6-derived-contracts`).
- Schema: `TeachingPlanDraftSchema` `schemas.ts:272`. `TeachingPlanSchema` `schemas.ts:149` validates the code-derived full plan.
- Repairs: 1. Source: `src/plan/prompts/stageExamples.ts` (`TEACHING_PLAN_EXAMPLES`).

## Role

Turn a concept graph into a time-budgeted plan, one scene per section. The model
writes **only the teaching decisions**; code derives each `SceneContract` and the
`LessonBible` from the draft and the graph. The prompt already embeds a worked
example inline (`src/plan/stages.ts:280-282`).

## Output shape (draft)

```json
{
  "targetDurationSec": 60,
  "intro": { "sourceTitle": "...", "sections": ["2-5 word headings"] },
  "domain": "optional broad subject",
  "sections": [{
    "id": "scene_1", "title": "<=8 words, no unsupported number", "goal": "...", "kind": "intro|explain|step|example|recap",
    "conceptIds": ["...1-6 exact graph ids..."], "budgetSec": 60,
    "teachingSkill": "definition|mechanism|comparison|process|derivation|application|recap",
    "candidateMechanisms": ["focus|chain|convergence|fan_out|weighted_blend|cycle|threshold|comparison|trajectory|equation|state_transition"],
    "essentialClaims": [{ "id": "...", "statement": "...", "conceptIds": ["..."], "relations": [{ "from": "...", "to": "...", "type": "..." }], "evidenceSpanIds": ["..."] }],
    "visualForm": "process|comparison|array|geometry|formula|plot|number-line|matrix|worked-example|code",
    "mentalModel": "one sentence",
    "misconceptionRisk": ["..."],
    "semanticVisualIntents": [{ "claimId": "...", "conceptType": "entity|state|process|cause|condition|sequence|comparison|hierarchy|quantity|evidence|argument|system|math", "strategy": "literal|metaphor|state-change|topology|diagram|math|plot|code", "conceptIds": ["..."], "roles": [] }]
  }],
  "recap": { "keyPoints": ["..."] }
}
```

## Hard rules

- `semanticVisualIntents` carries one entry per essential claim. `conceptType` must match the concept's graph `kind`: a `process` uses `strategy: diagram`, a `quantity` uses `plot`, only an `entity` uses `literal`. A literal intent on a process/quantity concept is rejected (`src/plan/contracts.ts:295`).
- Every section's `budgetSec` sums to `targetDurationSec` exactly; ~18 s per scene.
- Related concepts share a section: a relation is taught only where both endpoints are in `conceptIds`.
- Order by prerequisites; a later scene uses an earlier idea in a new role, never a restatement.

## Richness + synchronization rules

The prompt (`TEACHING_DIRECTOR_GUIDANCE`, `stages.ts:296`) now also requires:

- **DEPICTION**: every scene must SHOW something. Choose the depiction the claim's `conceptType` warrants and say what is drawn — `entity` → pictogram/labelled object (`literal`), `process`/mechanism → diagram or topology of parts and arrows, `quantity`/function → plot or number line, equation → formula built term by term, comparison → the two things side by side. A board of only labelled boxes is a failed scene.
- **SYNCHRONIZATION**: for each claim, state the visual reveal that happens as the claim is spoken (what appears, changes, or connects) so the board builds while the narrator talks, with the visual subject introduced before its conclusion.

## Examples

`agentExampleBlock('teaching_plan')` is injected into the v6 system prompt. The
bank `TEACHING_PLAN_EXAMPLES` in `src/plan/prompts/stageExamples.ts`
(`plan-mechanism-60`, `plan-quantity-plot`) is validated against
`TeachingPlanDraftSchema` by the offline suite.

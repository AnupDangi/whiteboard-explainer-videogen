# Agent pack 01 — S1b Syllabus

- Stage: S1b. Builder: `syllabusSystemPrompt` `src/plan/hierarchical.ts:138`. Call: `hierarchical.ts:263`.
- Schema: `SyllabusOutputSchema` / `SyllabusSchema` `hierarchical.ts:20`. Stored as `lesson-syllabus/v5`.
- Repairs: 2. Source: `src/plan/prompts/stageExamples.ts` (`SYLLABUS_EXAMPLES`).

## Role

Turn a source and a learner goal into a duration-bounded, source-grounded syllabus:
one learning objective, audience assumptions, stable global concept IDs, prerequisite
order, distinct module goals, and each concept's exact evidence quotes.

## Output shape

```json
{
  "requestedDurationSec": 60, "plannedDurationSec": 60,
  "coverageReason": "...", "sourceSupport": "supported|partial|insufficient",
  "learningObjective": "...", "audienceAssumptions": ["..."],
  "concepts": [{ "id": "...", "label": "<=4 words", "definition": "...", "evidence": [{ "spanId": "...", "quote": "verbatim" }] }],
  "prerequisites": [{ "concept": "...", "needs": "..." }],
  "modules": [{ "id": "...", "title": "...", "goal": "...", "budgetSec": 60, "conceptIds": ["..."], "evidenceSpanIds": ["..."], "recallOfModuleIds": [] }]
}
```

## Hard rules

- `sourceSupport` is judged on the text. A title/index/TOC that only names the goal is `insufficient`.
- Module budgets must follow the duration shape (`60 → [60]`, `300 → [300]`, `600 → [300,300]`, `1800 → 6×300`, `3600 → 6×600`) and sum exactly.
- IDs are lowercase snake_case; copy source span IDs exactly.
- Every quote is one contiguous verbatim substring of the cited span (≤200 chars, plain words, no equations/symbols).
- Prerequisites occur earlier; `recallOfModuleIds` is only for explicit spaced retrieval.

## Example (shape to copy, not facts)

```json
{"requestedDurationSec":60,"plannedDurationSec":60,"coverageReason":"The source explains how the two stages connect at the requested depth.","sourceSupport":"supported","learningObjective":"Explain how the first stage leads to the second.","audienceAssumptions":["No prior background in the subject."],"concepts":[{"id":"stage_one","label":"First stage","definition":"The first stage sets the starting condition.","evidence":[{"spanId":"span_2","quote":"the first stage sets the starting condition"}]},{"id":"stage_two","label":"Second stage","definition":"The second stage acts on what the first produced.","evidence":[{"spanId":"span_3","quote":"the second stage acts on what the first produced"}]}],"prerequisites":[{"concept":"stage_two","needs":"stage_one"}],"modules":[{"id":"module_1","title":"How the two stages connect","goal":"Connect the first stage to the second and state the relation.","budgetSec":60,"conceptIds":["stage_one","stage_two"],"evidenceSpanIds":["span_2","span_3"],"recallOfModuleIds":[]}]}
```

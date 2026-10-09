# Agent pack 02 — S2 Concept graph

- Stage: S2. Builder: `buildConceptGraph` `src/plan/stages.ts:71`. Call: `stages.ts:98`.
- Schema: `ConceptGraphSchema` / `ScopedConceptGraphSchema` `schemas.ts:62,70`.
- Repairs: 1. Source: `src/plan/prompts/stageExamples.ts` (`CONCEPT_GRAPH_EXAMPLES`).

## Role

Extract the teachable structure of a source: the minimum set of concepts a learner
must understand, the source-stated relations between them, and prerequisites.

## Output shape

```json
{
  "concepts": [{ "id": "...", "label": "<=4 words", "kind": "entity|process|quantity|formula|event|role|rule", "definition": "...", "evidence": [{ "spanId": "...", "quote": "verbatim" }], "latex": "...", "level": "one-step|multi-step" }],
  "relations": [{ "from": "...", "to": "...", "type": "causes|feeds|contains|compares|transforms|requires|produces|opposes|supports|excepts|branches|precedes", "evidence": [{ "spanId": "...", "quote": "verbatim" }] }],
  "prerequisites": [{ "concept": "...", "needs": "..." }]
}
```

## Hard rules

- `kind` drives drawing: `entity` → literal icon, `process` → diagram, `quantity` → plot, `formula` → math. Choose it honestly; a process drawn as a literal object is rejected downstream.
- Evidence quotes must occur verbatim in the cited span; an unanchored relation is asked about once then dropped (concepts stay).
- Use a specialised relation type only when the source states that meaning.
- No self relations, no duplicates, no summary/"collection" nodes.

## Example (shape to copy, not facts)

```json
{"concepts":[{"id":"heat_input","label":"Heat input","kind":"quantity","definition":"Heat added to the system.","evidence":[{"spanId":"span_2","quote":"heat added to the system"}],"level":"one-step"},{"id":"state_change","label":"State change","kind":"process","definition":"The system changes state.","evidence":[{"spanId":"span_2","quote":"the system changes state"}],"level":"one-step"}],"relations":[{"from":"heat_input","to":"state_change","type":"causes","evidence":[{"spanId":"span_2","quote":"heat added to the system causes it to change state"}]}],"prerequisites":[{"concept":"state_change","needs":"heat_input"}]}
```

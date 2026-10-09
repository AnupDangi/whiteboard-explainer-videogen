# Agent pack 07 — S6 Board planner

- Stage: S6. Builder: `buildBoardPrompt` `src/planner/board.ts`. Call `board.ts:1270`.
- Schema: board `v5-representation-intent`. Repairs: 2 (structure, then claim/relation).
- Prompt version: `board-prompt-v28-generic-notation+board-bank-v4-representation-intent`. Few-shots: `src/planner/fewshots/boardBank.v2.ts`.

## Role

Compose ONE narrated scene into a board: typed nodes, edges, and a layout choice.
The model emits **representation intent only** — no asset names, IDs, coordinates,
SVG, or code. S7 selects the actual asset.

## Output shape

```json
{
  "schemaVersion": "claude-board/v5-representation-intent",
  "title": "...", "layout": "flow|fan_out|convergence|list|compare|cycle|hub",
  "nodes": [{ "id": "...", "mention": "...", "concept": "...", "representation": { "kind": "literal|metaphor|retrieval|semantic-role|topology|shape|labelled", "...": "..." }, "label": "...", "role": "input|process|output|item|attribute" }],
  "visual": { "kind": "process" }
}
```

## Hard rules

- One node per concept, unless the narration names different concrete examples of one concept.
- Representation intent must match the concept: a literal intent is only for a pointable object; diagrams/topology for mechanism/relation shapes; labelled when no honest picture exists.
- Never choose an asset; never emit coordinates or code.
- Few-shot examples are illustrative, not about this lesson: copy no facts, labels, numbers, or relations.
- A scene no longer uses one icon for two different concepts; claim targets must be spoken inside the claim.

## Few-shots

`BOARD_EXAMPLES` (`src/planner/fewshots/boardBank.v2.ts`), version `board-bank-v4-representation-intent`.

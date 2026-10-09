# Agent prompt packs

One pack per model stage in the STCC pipeline. Each pack is the human-readable
contract for that agent: role, exact output shape, hard rules, and strict-JSON
examples. The canonical, machine-checked examples live in
`src/plan/prompts/stageExamples.ts` and are validated against the stage schemas by
`src/__tests__/agent-examples.test.ts`; the JSON here mirrors those examples.

Every stage calls the model through `src/llm/structuredCall.ts` (temperature 0,
provider JSON schema, bounded repair, budget ledger). The full call inventory is
in `docs/AGENT-CONTRACTS.md`.

| Pack | Stage | schemaName | Prompt version |
|---|---|---|---|
| [01-syllabus](01-syllabus.md) | S1b | `lesson_syllabus` | `S1-syllabus-prompt-v4-source-examples` |
| [02-concept-graph](02-concept-graph.md) | S2 | `concept_graph` | `S2-concept-graph-prompt-v4-source-examples` |
| [03-teaching-plan](03-teaching-plan.md) | S3 | `teaching_plan` | `S3-teaching-plan-prompt-v6-derived-contracts-v9-richness-examples` |
| [04-narration](04-narration.md) | S4 | `scene_narration` | one call per scene |
| [05-depiction-nouns](05-depiction-nouns.md) | S3.5 | `depiction_nouns` | `depiction-director-v1` |
| [06-icon-validation](06-icon-validation.md) | S3.5 | `icon_validation` | `icon-validation-v1` (not on the live path; see `AGENT-CONTRACTS.md`) |
| [07-board](07-board.md) | S6 | `board` | `board-prompt-v28` |

The `+<examples-hash>` suffix in the live cache key is `AGENT_EXAMPLES_HASH` (first 12 hex chars); editing any example in `stageExamples.ts` automatically invalidates the S1b/S2/S3 cached stages.

## Rules that bind every pack

- Output is strict JSON only. No prose, no markdown fences.
- No coordinates, SVG, executable code, shell commands, or asset/provider IDs.
- Every factual value cites a source evidence reference, or is marked illustrative.
- An unknown enum value is coerced to a neutral default only where the schema
  says so (kind, level, mechanism, strategy); facts and evidence are never invented.
- Repair is bounded (1, or 2 for S1b/S6); exhausting it is a hard failure, never a
  fabricated success.

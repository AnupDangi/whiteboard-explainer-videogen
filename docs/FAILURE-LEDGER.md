# Failure ledger — every proof-run failure tracked to its owner stage and fix

One row per failed scene-stage. `prompt-sha` pins the exact model input;
`defect` names the validator class; `owner` is the single stage that must
change; `fix` is the commit or MISSING-record. No row closes without one of:
a passing rerun, a committed fix, or a named blocker.

| attempt | scene | stage | prompt-sha | defect | owner | fix / status |
|---|---|---|---|---|---|---|
| osmosis-a1 | water_potential | board-ops | pre-recorder | text_overflow 110px slot + movement_path_collision | S6 prompt | zone cap 2 + no-crossing-moves rule |
| osmosis-a2 | membrane_and_osmosis | board-ops | pre-recorder | dangling water_marker + zoneLabels A/B as source facts | S6 prompt | zoneLabel-verbatim + target-existence rules |
| osmosis-a3 | water_potential | board-ops | pre-recorder | missing bindings + derived value w/o verifier | S6 prompt | (rule exhausted, MISSING stands) |
| math-a1 | all | beats/narration | pre-recorder | provider omitted usage → ledger fail-closed | infra (transient) | reran |
| math-a2 | lesson | audio | pre-recorder | 65.7s vs 75s request (-9.3s) | S4 budgets | diagnostic-video mode + relative tolerance |
| math-a3 | method_recap | beat-narration | pre-recorder | 55 words vs 25 stated, repair → 27 vs 25 | S1b/S4 | open: recap minimum budgets scale with scenes |
| physics-a1 | circuit_and_charging | board-ops | pre-recorder | missing bindings on all ops | S6 prompt | bindings-required example + rule |
| physics-a2 | circuit_balance | board-ops | pre-recorder | equation symbols vs prose quote | S6 prompt | symbolic equations must be illustrative |
| physics-a3 | what_sets_the_time | board-ops | pre-recorder | sentence-labels in ~200px slots | S6 prompt | label/value split + sentence-label ban |
| physics-a4 | ? | ? | pre-recorder | running | ? | ? |

Autopsy tool: `node scripts/stcc-autopsy.mjs <run-dir>`.
Prompt recording lands with the recorder change (prompt.json per call); rows before it cite input via replay-fixture + report only.
| physics-video | all beats | S9 timeline | spread rule | early reveals (45/46 cue=0) | S9 compiler | degenerate-cue spread in compileSceneTimeline |
| pictorial-gap | all scenes | S7 resolver | zero pictorial (V2 bypass) | S7 wiring | approved resolver + upgrade + revalidate |
| choreography | all beats | S9 timeline | arrows waited for targets | S9 compiler | connect needs source only |
| edge wording | switch scene | S7 provenance | relation verb demanded literally | S7 ground.ts | endpoint-order + negation guard for process verbs |
| chained equality | time-constant scene | S7 provenance | A=B=C rejected outright | S7 verify.ts | pairwise numeric chain verification |
| cut inconsistency | all scenes | S6 transition | retain nobody uses | S6 validator | retain must touch inherited elements or be clean |
| aligner flake | half_to_quarters | S5 align | stable-ts zero intervals + CTC digit fail | S5 aligner | open: aligner robustness task |
| missing bindings | all scenes | S6 planner | optional schema, required validator | S6 complete.ts | deterministic unambiguous completion pre-validation |
| short syllabus | phys scenes | S1b syllabus | planned 60s for 90s request, gate compares requested | S1b scope | open: requested vs planned duration reconciliation |
| short syllabus | phys+bio scenes | S1b syllabus | gate compared requested, syllabus planned short | S1b/runLessonV2 | gate targets min(requested, planned) |

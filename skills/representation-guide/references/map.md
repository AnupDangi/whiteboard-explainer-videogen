# Relation -> representation map

| Relation | First choice | Alternates |
|---|---|---|
| causes / activates / inhibits | cause_effect, flow | branch, timeline |
| flows_to / moves_toward | flow, timeline | trajectory, branch |
| contains / part_of | hierarchy, structural_diagram | cross_section |
| transforms_to / state change | transformation, state_machine | flow |
| compares_with | comparison | hierarchy (ranked) |
| depends_on | branch, convergence | hierarchy |
| labels (definition) | simple_explanation | numbered_steps |
| cycle relations | cycle | flow + return arc (fallback) |
| quantity / equation | equation_walkthrough, matrix_operation, chart | numbered_steps |
| spatial / location | spatial_process, trajectory, cross_section | structural_diagram |
| many-to-one | convergence | hierarchy |
| one-to-many | branch | timeline |

Rules: state change requires before/after encoding; comparison requires
side-by-side, never sequential reveal alone; cycles keep flow layout with
smallest-id feedback demoted to return arc.

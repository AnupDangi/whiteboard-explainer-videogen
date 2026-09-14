# Live Evaluation Report

Generated: 2026-09-13T10:41:50.762Z
Config hash: `a7ae0569d74f2e32`
Cases: 6 · Runs: 6

## Stage success
| Stage | Pass | Fail | Rate |
| --- | --- | --- | --- |
| sourceUnderstandingSuccess | 6 | 0 | 100% |
| teachingPlanSuccess | 6 | 0 | 100% |
| storyboardSuccess | 6 | 0 | 100% |
| mentalModelSuccess | 6 | 0 | 100% |
| representationResolutionSuccess | 6 | 0 | 100% |
| visualDirectionSuccess | 2 | 4 | 33.3% |
| sceneGraphSuccess | 2 | 4 | 33.3% |
| compileSuccess | 2 | 4 | 33.3% |
| timelineSuccess | 2 | 4 | 33.3% |
| ttsSuccess | 0 | 6 | 0% |
| fullJobSuccess | 2 | 4 | 33.3% |

## By category
| Category | Runs | Full success | Rate |
| --- | --- | --- | --- |
| structural | 1 | 1 | 100% |
| spatial_process | 1 | 0 | 0% |
| equation | 1 | 1 | 100% |
| matrix | 1 | 0 | 0% |
| comparison | 1 | 0 | 0% |
| flow | 1 | 0 | 0% |

## By archetype
| Archetype | Runs | Full success | Rate |
| --- | --- | --- | --- |
| convergence | 1 | 1 | 100% |
| unknown | 4 | 0 | 0% |
| equation_walkthrough | 1 | 1 | 100% |

## Repair histogram
| Repair | Count |
| --- | --- |
| schemaRetryCount | 10 |
| geometryRepairCount | 2 |
| timelineRepairCount | 1 |

## Failure taxonomy
| Kind | Count |
| --- | --- |
| asset | 2 |
| plan | 1 |
| unknown | 1 |

## Latency
| Metric | P50 | P95 | Mean |
| --- | --- | --- | --- |
| firstAVPlayableMs | 0 | 0 | 0 |
| fullPlayableMs | 13140.201833 | 15885.04375 | 14513 |

## Cost
| P50 | P95 | Mean | Total |
| --- | --- | --- | --- |
| 0.019553 | 0.027242 | 0.017933 | 0.107595 |

## Case-level results
| Case | Category | Runs | Success | Partial | Error | Mean cost | Mean first AV ms | Mean full ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| photosynthesis_inputs | structural | 1 | 1 | 0 | 0 | 0.021838 | — | 15885 |
| dna_replication | spatial_process | 1 | 0 | 0 | 1 | 0.009707 | — | — |
| linear_equation | equation | 1 | 1 | 0 | 0 | 0.020627 | — | 13140 |
| matrix_multiplication | matrix | 1 | 0 | 0 | 1 | 0.027242 | — | — |
| deepseek_mla | comparison | 1 | 0 | 0 | 1 | 0.019553 | — | — |
| http_lifecycle | flow | 1 | 0 | 0 | 1 | 0.008628 | — | — |

## Regressions
| Case | Run | Reason |
| --- | --- | --- |
| dna_replication | 0 | No teaching asset for hero concept parent-dna |
| matrix_multiplication | 0 | Matrix operation requires an operator or equals token |
| deepseek_mla | 0 | Label needs more than three lines |
| http_lifecycle | 0 | No teaching asset for hero concept web_browser |

## Limitations
- Timing source depends on configured speech provider; estimated timing is labeled.
- firstAVPlayableMs is null when narration is disabled or TTS fails.
- Repair counts rely on emitted telemetry and diagnostic strings.
- Teaching quality is not judged; only structural success/failure is measured.

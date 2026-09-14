# Live Evaluation Report

Generated: 2026-09-13T16:44:13.442Z
Config hash: `1867f76f89b18a0f`
Cases: 1 · Runs: 1

## Stage success
| Stage | Pass | Fail | Rate |
| --- | --- | --- | --- |
| sourceUnderstandingSuccess | 0 | 1 | 0% |
| teachingPlanSuccess | 0 | 1 | 0% |
| storyboardSuccess | 0 | 1 | 0% |
| mentalModelSuccess | 0 | 1 | 0% |
| representationResolutionSuccess | 0 | 1 | 0% |
| visualDirectionSuccess | 0 | 1 | 0% |
| sceneGraphSuccess | 0 | 1 | 0% |
| compileSuccess | 0 | 1 | 0% |
| timelineSuccess | 0 | 1 | 0% |
| ttsSuccess | 0 | 1 | 0% |
| fullJobSuccess | 0 | 1 | 0% |

## By category
| Category | Runs | Full success | Rate |
| --- | --- | --- | --- |
| structural | 1 | 0 | 0% |

## By archetype
| Archetype | Runs | Full success | Rate |
| --- | --- | --- | --- |
| unknown | 1 | 0 | 0% |

## Repair histogram
| Repair | Count |
| --- | --- |
| (none) | 0 |

## Failure taxonomy
| Kind | Count |
| --- | --- |
| provider | 1 |

## Latency
| Metric | P50 | P95 | Mean |
| --- | --- | --- | --- |
| firstAVPlayableMs | 0 | 0 | 0 |
| fullPlayableMs | 0 | 0 | 0 |

## Cost
| P50 | P95 | Mean | Total |
| --- | --- | --- | --- |
| 0 | 0 | 0 | 0 |

## Case-level results
| Case | Category | Runs | Success | Partial | Error | Mean cost | Mean first AV ms | Mean full ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| photosynthesis_inputs | structural | 1 | 0 | 0 | 1 | 0 | — | — |

## Regressions
| Case | Run | Reason |
| --- | --- | --- |
| photosynthesis_inputs | 0 | OPENROUTER_API_KEY required for V2 automatic planning |

## Limitations
- Timing source depends on configured speech provider; estimated timing is labeled.
- firstAVPlayableMs is null when narration is disabled or TTS fails.
- Repair counts rely on emitted telemetry and diagnostic strings.
- Teaching quality is not judged; only structural success/failure is measured.

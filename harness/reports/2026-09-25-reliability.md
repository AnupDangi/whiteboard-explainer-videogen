# S1–S4 reliability — 2026-09-25

Model: qwen/qwen3.8-flash
Sources: ocean-tides, bicycle-balance, composting, rainbow-formation, mirror-images
Durations (seconds): 60
Repeats per source and duration: 3
Total cost: $0.0274

| stage | pass rate |
| --- | ---: |
| S2 | 0.333 |
| S3, conditional on reaching S3 | 0.600 |
| S4, conditional on reaching S4 | 0.667 |
| End to end | 0.133 |

## Failure codes

- concepts-call-failed: 10
- plan-repair-failed: 2
- script-call-failed: 1


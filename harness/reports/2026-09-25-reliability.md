# S1–S4 reliability — 2026-09-25

Model: qwen/qwen3.8-flash
Sources: ocean-tides, bicycle-balance, composting, rainbow-formation, mirror-images
Durations (seconds): 60
Repeats per source and duration: 3
Total cost: $0.0663

| stage | pass rate |
| --- | ---: |
| S2 | 0.867 |
| S3, conditional on reaching S3 | 0.231 |
| S4, conditional on reaching S4 | 1.000 |
| End to end | 0.200 |

## Failure codes

- plan-repair-failed: 10
- concepts-repair-failed: 2


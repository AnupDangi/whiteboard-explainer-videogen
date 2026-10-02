# S3 plan calibration — 2026-09-25

Model: qwen/qwen3.8-flash
Sources (5, held-out, non-G-10): ocean-tides, bicycle-balance, composting, rainbow-formation, mirror-images
Repeats per source: 3

## v4-explicit-concepts
Pass rate: 7/15 (47%)
Total cost: $0.0353
Failure codes:
- S3_CALL_FAILED: 8

## v5-fully-worked-example
Pass rate: 8/15 (53%)
Total cost: $0.0316
Failure codes:
- S3_CALL_FAILED: 7

**Winning variant (highest measured pass rate, ties broken by fewest failure-code occurrences): v5-fully-worked-example**

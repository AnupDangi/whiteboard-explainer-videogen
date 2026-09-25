# S3 plan calibration — 2026-09-24

Model: qwen/qwen3.8-flash
Sources (5, held-out, non-G-10): ocean-tides, bicycle-balance, composting, rainbow-formation, mirror-images
Repeats per source: 3

## v3-baseline
Pass rate: 0/15 (0%)
Total cost: $0.0398
Failure codes:
- S3_CALL_FAILED: 15

## v4-explicit-concepts
Pass rate: 6/15 (40%)
Total cost: $0.0370
Failure codes:
- S3_CALL_FAILED: 9

**Winning variant (highest measured pass rate, ties broken by fewest failure-code occurrences): v4-explicit-concepts**

# Front-end comparison — 1-minute target

| pipeline | case | scenes | wall s | output s | ratio | gate | calls | cost $ | error |
|---|---|---|---|---|---|---|---|---|---|
| semantic-v3 | photosynthesis | 2 | 32.0 | 53.5 | 0.89 | PASS | 6 | 0.0277 |  |
| semantic | photosynthesis | 2 | 87.1 | 61.3 | 1.02 | PASS | 6 | 0.0441 |  |
| semantic-v3 | http | 2 | 21.1 | 52.4 | 0.87 | PASS | 6 | 0.0272 |  |
| semantic | http | 1 | 103.7 | 31.2 | 0.52 | FAIL | 7 | 0.0510 | Illegal overlap: concept_1_http_request_lifecycle_1/concept_ |
| semantic-v3 | gradient | 2 | 16.6 | 59.1 | 0.98 | PASS | 6 | 0.0250 |  |
| semantic | gradient | 1 | 87.4 | 31.2 | 0.52 | FAIL | 7 | 0.0471 | V2 director validation exhausted: Action has no target |

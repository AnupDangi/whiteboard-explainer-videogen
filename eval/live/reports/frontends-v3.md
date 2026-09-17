# Front-end comparison — 1-minute target

| pipeline | case | scenes | wall s | output s | ratio | gate | concept | relation | critical | calls | cost $ | error |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| semantic-v3 | photosynthesis | 2 | 33.7 | 73.5 | 1.23 | MISS | 0.29 | 1.00 | MISS | 6 | 0.0296 |  |
| semantic | photosynthesis | 1 | 105.6 | 31.2 | 0.52 | FAIL | 0.00 | 0.00 | — | 8 | 0.0556 | Illegal overlap: concept_1_sunlight_1/concept_1_oxygen_1 |
| semantic-v3 | http | 2 | 19.7 | 55.7 | 0.93 | PASS | 0.71 | 0.00 | MISS | 6 | 0.0265 |  |
| semantic | http | 0 | 93.3 | 0.0 | 0.00 | FAIL | 0.00 | 0.00 | — | 7 | 0.0474 | Director chose unavailable mental model |
| semantic-v3 | gradient | 0 | 7.8 | 0.0 | 0.00 | FAIL | 0.00 | 0.00 | — | 2 | 0.0080 | Teacher gate failed: LessonBible persistentObjects reference |
| semantic | gradient | 1 | 77.7 | 31.2 | 0.52 | FAIL | 0.00 | 0.00 | — | 7 | 0.0424 | Illegal overlap: concept_1_gradient_descent_1/concept_1_loss |

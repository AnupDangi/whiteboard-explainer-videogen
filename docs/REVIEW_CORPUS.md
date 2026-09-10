# Fixed review corpus

A named, stable set of generated jobs/topics that quality reports (`docs/RESULTS.md`,
`docs/VIDEO_QUALITY_REVIEW.md`, future ones) should reference by name instead of citing ad hoc
job IDs each time — so "the DNA video" means the same evidence across sessions until this file
is deliberately updated. Per `docs/OPTIMIZATION_PLAN.md` §9 "First batch to execute" item 1.

Origin legend: **fresh** = a live model-planned generation; **fixture** = `src/fixtures.ts`
hand-authored data, no model call; **replay** = re-rendering a previously saved `job.json`
under the current code (tests compile-idempotence, not planning quality).

| Name | Topic | Origin | Duration | Evidence |
|---|---|---|---|---|
| dna | DNA replication | fresh | 5 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| tectonics | Plate tectonics | fresh | 5 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| printing | Printing press | fresh | 5 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| bicycle-pump | Bicycle pump | fresh | 1 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| gps | GPS trilateration | fresh | 1 min | `docs/VIDEO_QUALITY_REVIEW.md` (2026-09-09 review) |
| attention | Attention mechanism | fixture | n/a | `src/fixtures.ts`'s `attention` fixture; used throughout the test suite as the deterministic baseline |

Adding a job to this table: record its actual job ID, exact prompt/source, model, and
`manifestVersion` (see `src/jobs.ts`'s `GENERATION_MANIFEST_VERSION`) in the evidence doc being
cited, then add one row here pointing at that doc. Do not delete a row once evidence has been
published referencing it by name — supersede it with a new row/name instead.

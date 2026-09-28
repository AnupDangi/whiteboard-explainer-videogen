# Validation Severities — Teaching Compiler V1

Three levels. Severity is a property of the finding, not the gate file.

## HARD — video fails, no acceptance

| Code family | Meaning |
|---|---|
| `visual-claim-coverage` | essential claim lacks exactly-one spoken span + exactly-one visual intent, or a target is unsupported/dangling, or a reveal misses the claim window |
| `major-claim-undepicted` | essential claim depicted only by text fallback, never drawn |
| `semantic-asset-mismatch` | object resolved at rung 3 (weak, uncalibrated match zone) |
| `unresolved-object`, `license` | missing resolution record; unlicensed asset |
| `min-readable-text`, `tiny-element` | text below 32px floor; element shrunk below solver minimum |
| `board-concept-omitted`, `board-relation-omitted`, `board-role-*` | typed board drops source-required concepts/relations/roles |
| `board-too-sparse` | non-structured, non-compare board below 0.30 occupancy or under 2 elements |
| `concurrency` | >2 simultaneous reveals |
| `formula-error` | MathJax typeset failure |
| `lesson-lock-failed` | `lesson.lock.json` could not be written (reproducibility contract broken) |
| `video-render-blocked-by-claim-coverage`, `video-scenes-incomplete` | coverage gate stopped S10/S11; scenes missing from output |
| `source-insufficient-for-goal` | source cannot support the requested lesson (stops before narration) |
| alignment hard failures | empty/non-finite/out-of-range/non-positive/out-of-order word intervals |
| encode failures | resvg/ffmpeg/media-probe errors, stale-MP4 attachment |

## DRAFT — video exists, not accepted (hard:false failures)

| Code family | Meaning |
|---|---|
| `mechanism-literal-fallback` | diagram-first concept depicted via literal/retrieval instead of diagram/role |
| `text-fallback-despite-assets` | text fallback although approved assets exist |
| `numeric-*` guidance findings | repairable title/number issues reported for model repair |

Draft videos are watchable and registered in runs, but do not count toward
benchmark acceptance or release.

## WARN — ship candidate (warnings array)

Occupancy outside [0.45, 0.75], idle stretches, timeline compression/idle-fill,
`labelOnlyProcess` review cues, contact-sheet PNG failure, small support
labels, nonideal symmetry. Warnings never block acceptance alone.

## Mapping rule

New gates MUST choose: meaning-breaking (wrong/missing/clipped/unprovenanced)
→ HARD; present-but-weak depiction → DRAFT (hard:false); cosmetic → WARN.
Never let a weak depiction pass silently, and never hard-fail a useful lesson
for spacing.

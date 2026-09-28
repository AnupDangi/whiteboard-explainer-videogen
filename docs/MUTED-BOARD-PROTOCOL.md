# Muted-Board Comprehension Protocol — Teaching Compiler V1

The single mandatory human test (§25). Unit tests prove structure; this test
proves teaching.

## Procedure (per scene, on the final board only)

1. Export the scene's final frame (`final-boards/scene-<id>.png` or the
   contact sheet tile). No audio, no captions, no narration text.
2. Show it to a reviewer who has NOT seen the lesson plan or source.
3. Ask exactly: **"What is this scene explaining?"**
4. Record the verbatim answer plus the reviewer's confidence (1–5).

## Scoring

- **Recovered**: answer restates the scene's essential claim(s) in any words
  (e.g. "water moves into the cell" for an osmosis claim). Counts toward the
  ≥80% muted-board concept-recovery release target.
- **Partial**: right topic, wrong mechanism (counts as fail for release, but
  note it — usually a topology/arrow defect, not an icon defect).
- **Miss**: cannot reconstruct the claim. File as `major-claim-undepicted`
  evidence even if all gates passed: semantic visualization failed.

## Rules

- Never reveal the expected answer or the lesson title before scoring.
- Minimum 3 reviewers per benchmark scene for release decisions.
- A scene that passes only after the reviewer hears the audio is a
  narration-carried scene, not a visually-taught one — log it as such.
- Log results in `runs/<run-id>/muted-board.md` (scene, reviewer, verbatim,
  score). The run is not release-accepted until recovery ≥80%.

## What it catches that gates cannot

Wrong-but-confident rung-2 metaphors (atom for osmosis), label-as-explanation
boards (verb text on arrows instead of geometry), and sparse-but-valid boards
that no metric flags. If reviewers consistently miss a passing scene, the
defect class goes back to S3/S6 semantics — never to renderer polish.

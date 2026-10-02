# SIMI-60 benchmark — fixed 60s reference run

Fixed benchmark. No new runs. No new topic logic. All values below are read
from the already-run artifacts; expectations are domain-general.

## Run identity

- Source: https://www.tomzahavy.com/files/llms-cant-jump.pdf
- Prompt: "Explain the paper's core argument"
- Requested duration: 60s. Planned: 60s. Measured audio/video: 65.523s (+5523ms budget delta, no padding/truncation).
- One-shot stamp: `.data/one-shot/2026-09-27T06-45-29-884Z-www-tomzahavy-com`
- Run dir: `www-tomzahavy-com/runs/2026-09-27T06-45-30-186Z-8fcc4e44-314d-460e-84ae-aecac4fbc4bc/`
- Provenance: `output/2026-09-27T06-45-29-884Z-www-tomzahavy-com/provenance.json` (commit cf6c328, tree clean, dist hash pinned, tampered false)
- Pipeline status: failed (4 hard failures, 1 fallback). Cost $0.01198849 (ledger, 13 calls). S5 gate `alignment-calibration-unmeasured` caps run at draft.
- Scenes: 4 planned / 4 reached. Module title "Why LLMs Can't Jump" (run artifact only, not a reusable rule).

## How to read this doc

- Micro-claims: verbatim `plainText` sentences from `narration.json`, split one claim per sentence.
- Representation strategy: expected rendering kind for this frozen run, using only the shared vocabulary literal / metaphor / state / topology / labeled-primitive / text. Describes what this run used, never a rule that a topic must map to an asset.
- Reveal counts: events from `timeline.<scene>.json` (stroke = element reveal, edge = relation reveal, emphasis = non-reveal highlight).
- Muted-pass criterion: domain-general visual check with audio off. Same wording every scene.
- Known failures: run-level list at the end. Scene rows point at the applicable item.

## Scene 01-module_1_reasoning_modes

- Micro-claims (3):
  1. "Think of three reasoning modes."
  2. "Induction gathers cases and results to form a general rule."
  3. "Deduction applies an established rule to a case and predicts the result."
  4. "Abduction uses a rule and surprising result to propose a cause that explains it."
- Representation expected: labeled-primitive boxes carrying text labels (3x `prim: box` + visible text); topology convergence (two inputs compared against one operator); no object icons in the frozen fallback output.
- Reveal counts: 5 events — 3 stroke (n1, n2, n3) + 2 edge (n1->n3, n2->n3). Scene window 0–16788ms.
- Muted-pass criterion: with audio muted, each of the three labeled boxes is legible when revealed; both comparison edges are visible between their endpoints; the scene title is readable; at most 2 concurrent reveals at any instant.
- Known failures: F1 (numeric title "Three"), F2 (fallback missing output — `board-role-incomplete`, convergence without output).

## Scene 01-module_1_llm_gap

- Micro-claims (3):
  1. "Models can find patterns in data and apply rules to reach results."
  2. "Yet scientific invention needs an abductive jump: proposing a cause and formulating new premises."
  3. "The paper argues models lack it."
- Representation expected: single metaphor object (`prim: object`, iconBasis metaphor) standing in for an abstract gap; no edges; title carries the scene claim.
- Reveal counts: 1 event — 1 stroke (n1). Scene window 16988–31756ms.
- Muted-pass criterion: with audio muted, the single labeled element is legible for the full hold; the title states the claim; at most 2 concurrent reveals; long idle hold is recorded as warning, not failure.
- Known failures: F3 (1-element board — `element-count` warning, occupancy 0.33 below 0.45 floor).

## Scene 01-module_1_sensory_bridge

- Micro-claims (2):
  1. "The paper proposes physically consistent, multimodal world models to connect abstract symbols with sensory simulation."
  2. "This grounding may bridge the abductive gap, helping turn physical experience into premises for scientific invention."
- Representation expected: two metaphor objects (abstract-gap node, grounding node); topology chain with one labeled factual edge (`requires`) bridging them.
- Reveal counts: 3 events — 2 stroke (n2, n1) + 1 edge (n1->n2). Scene window 31956–47908ms.
- Muted-pass criterion: with audio muted, both labeled nodes are legible; the bridging edge with its label is visible; title readable; at most 2 concurrent reveals.
- Known failures: none hard in this scene (occupancy/idle warnings only).

## Scene 01-module_1_key_takeaway

- Micro-claims (4):
  1. "In brief, induction finds patterns in cases;"
  2. "deduction applies rules to predict results."
  3. "Scientific invention needs abduction: a leap to explain surprises."
  4. "The paper proposes sensory grounding to link abstract ideas with physical experience."
- Representation expected: mixed board — 4 metaphor objects + 1 labeled-primitive box (`prim: box`, text "Sensory Grounding"); topology hub_spoke (hub + 4 spokes); 3 factual edges.
- Reveal counts: 11 events — 5 stroke (n1..n5) + 3 edge (n1->n3, n2->n3, n4->n5) + 3 emphasis (n2, n4, n5; highlight only, not reveals). Scene window 48108–65523ms.
- Muted-pass criterion: with audio muted, all five labels legible; hub/spoke grouping readable; all three edges visible; at most 2 concurrent element reveals.
- Known failures: F4 (overlap — n3/n4 strokes share start 56265ms; edge pair shares one window; within the <=2 concurrent rule, recorded as timing overlap to watch).

## Known failures (run-level, frozen)

- F1 numeric title: `planner-repair-failed` on 01-module_1_reasoning_modes — title numeric value "Three" unsupported by cited evidence; identical before/after one repair; deterministic fallback used; publish gate retains 4 hard failures (repair-failed + fallback + fallback-gate + board-role-incomplete).
- F2 fallback missing output: fallback board for 01-module_1_reasoning_modes carries `board-role-incomplete` (convergence typed board missing at least one output); renders as diagnostic preview, cannot publish.
- F3 1-element: 01-module_1_llm_gap has 1 element (expected 2–9, warning only); occupancy 0.33 warning; 6870ms idle-window warning.
- F4 overlap: 01-module_1_key_takeaway n3/n4 identical reveal start; paired edges share windows; no >2 concurrency violation, kept as overlap watch item.
- Non-failures: scene/test "4/4" counts (4 scenes planned/reached, gate 4/4 scene checks) have 0 hard failures attached; never read "4/4" as 4 failures. Run-level hard-failure count stays 4, all in F1/F2.

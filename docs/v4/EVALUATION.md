# Explain Canvas Lab V2 — Evaluation & Results Contract

## 0. Purpose

This file defines:
- what to measure
- what "better" means
- how results are stored
- how model/prompt/renderer changes are compared
- how release decisions are made

Do not collapse all quality into one score.

---

# 1. Headline scorecard

Maintain separate dimensions:

```text
Truth / Grounding
Teaching / Semantics
Visual Composition
Timing / Motion
Reliability / Determinism
Performance / Cost
```

Hard failures cannot be compensated by high aesthetic scores.

Example:
- factual hallucination = fail
- beautiful visuals do not offset it

---

# 2. Ground-truth boundaries

Do not encode unverified assumptions about Simi as benchmark truth.

Verified public target:
- prompt/document -> whiteboard explainer
- script + illustration + animation + narration
- scene-by-scene drawing
- near-real-time / structured video positioning
- ~40s generation for the public one-minute product example

Unverified:
- exact renderer
- SVG versus canvas
- exact model provider
- fine-tuning status
- exact asset registry
- exact schema
- exact TTS/alignment provider
- exact multi-agent decomposition

Benchmark our product behavior, not imagined private internals.

---

# 3. Benchmark corpus

Start with ~48 cases.

Organize by representation archetype, not merely academic domain.

Categories:
- structural
- spatial process
- transformation
- flow
- cause/effect
- cycle
- comparison
- hierarchy
- timeline
- equation
- matrix
- trajectory
- list/facts

Each archetype should include:
- simple prompt
- advanced prompt
- source-grounded prompt
- ambiguous/adversarial prompt when useful

---

# 4. Eval case format

```ts
interface EvalCase {
  id: string;
  prompt: string;
  category: string;

  sourceFixture?: string;

  mustExplain: string[];
  criticalClaims?: string[];

  requiredRelations?: {
    from: string;
    relation: string;
    to: string;
  }[];

  expectedConcepts?: string[];

  preferredArchetypes?: VisualArchetype[];
  forbiddenPatterns?: string[];

  criticalAssetRoles?: string[];
}
```

Do not require exact coordinates or exact wording.

---

# 5. Level A — deterministic integrity

Metrics:
- schemaValidity
- compileSuccess
- invalidIdCount
- missingAssetCount
- unsafeSvgCount
- boundsViolationCount
- illegalOverlapCount
- textClipCount
- connectorViolationCount
- invalidStateCount
- invalidActionCount
- determinismMismatchCount
- browserExportMismatchCount

Hard gate:
- critical deterministic counts must be zero

---

# 6. Level B — semantic correctness

Metrics:

```text
criticalClaimCoverage
conceptCoverage
relationshipCoverage
processStateCoverage
sourceEvidenceCoverage
archetypeAppropriateness
assetSemanticMatch
genericFallbackRate
```

Suggested initial gates:
- critical claim coverage: 100%
- required relation coverage: 100%
- source-grounded critical claims: 100% evidence-backed
- no forbidden representation pattern on benchmark cases

Do not automatically require 100% supporting-detail coverage.

---

# 7. Level C — composition quality

Metrics:
- heroSalience
- visualHierarchy
- canvasOccupancy
- labelReadability
- annotationClarity
- connectorClarity
- semanticGrouping
- whitespaceBalance
- clutter
- irrelevantDecorationCount

Some are deterministic diagnostics.
Some are multimodal/human judgments.

Use archetype-specific occupancy ranges.

---

# 8. Level D — timeline quality

Metrics:
- anchorLagP50Ms
- anchorLagP95Ms
- maxLateAnchorLagMs
- longestNarratedNoChangeMs
- meaningfulVisualBeatsPerMinute
- actionCoverage
- continuityBreakCount
- unnecessarySceneResetCount

Initial static target:
- <=3500ms unintended narrated no-change interval

Treat as tuneable benchmark threshold, not universal cognitive law.

---

# 9. Level E — multimodal judge

Prefer pairwise.

Input:
- candidate A event-aligned contact sheet
- candidate B event-aligned contact sheet
- narration
- semantic requirements

Ask:
- which teaches the required mechanism more clearly?
- which better represents required relations?
- which has better visual hierarchy?
- which better coordinates visuals with narration?
- does either contain a factual/visual error?

Run both orderings.

Reliable result:
- same winner A/B and B/A

Inconsistent:
- winner changes after order swap

Track judgeConsistencyRate.

---

# 10. Judge calibration benchmark

The evaluator itself must be evaluated.

From known-good scenes generate controlled corruptions:

```text
semantic corruption
relationship reversal
asset mismatch
missing critical object
late reveal
label swap
clipping
generic-box downgrade
unnecessary decoration
continuity reset
```

Judge target:
- original preferred over corruption

Report:

```text
judgeCalibrationAccuracy
judgePositionFlipRate
judgeFalsePositiveRate
judgeFalseNegativeRate
```

Do not trust a judge model that cannot clear this suite.

---

# 11. Level F — human pairwise

Primary metric:
- V2 preference rate over V1 for teaching clarity

Initial migration target:
- V2 wins >=70% of blind pairwise comparisons on representative benchmark subset

Also collect:
- factual error flag
- confusing visual flag
- clutter flag
- narration mismatch flag

Do not ask humans only "which is prettier?"

---

# 12. Level G — learning efficacy

Subset only.

After viewing:
- 3 factual questions
- 1 mechanism question
- 1 transfer question

Report:
- factualScore
- mechanismScore
- transferScore

Long term, this is more important than stylistic similarity to Simi.

---

# 13. Performance metrics

Keep separate from teaching quality.

Record:
- sourceExtractionMs
- outlineMs
- storyboardMs
- visualModelMs
- assetSearchMs
- narrationFinalizeMs
- ttsMs
- directorMs
- compileMs
- preflightMs
- criticMs
- firstPlayableMs
- totalPlayableMs
- fullExportMs

Cost:
- calls
- prompt tokens
- completion tokens
- cached tokens
- total cost

Operational:
- repairCount
- fallbackCount
- assetFallbackCount
- geometryRepairCount
- criticRepairCount

---

# 14. Model benchmark

For each model routing configuration run the same eval cases.

Report:

```text
schema success
semantic coverage
archetype accuracy
asset selection accuracy
repair rate
critic agreement
human preference
latency
cost
```

Do not choose a model by brand.

A cheaper model that needs three repairs may be worse than a stronger model that succeeds once.

---

# 15. Results manifest

Each run creates:

```json
{
  "runId": "2026-09-12T00-00-00Z__commit",
  "commit": "...",
  "schemaVersion": "v2.x",
  "assetRegistryHash": "...",
  "promptHashes": {},
  "models": {},
  "cases": []
}
```

Each case result includes:

```json
{
  "caseId": "photosynthesis-plant",
  "status": "pass",

  "planning": {
    "archetype": "structural_diagram",
    "mentalModel": "...",
    "beats": 6,
    "plannerRepairs": 0
  },

  "semantic": {
    "criticalClaimCoverage": 1.0,
    "relationshipCoverage": 1.0,
    "sourceEvidenceCoverage": 1.0
  },

  "assets": {
    "selected": [],
    "fallbackCount": 0
  },

  "compiler": {
    "geometryRepairCount": 1,
    "illegalOverlapCount": 0,
    "textClipCount": 0
  },

  "timeline": {
    "anchorLagP50Ms": -80,
    "anchorLagP95Ms": 250,
    "longestNarratedNoChangeMs": 2100
  },

  "performance": {
    "firstPlayableMs": 6200,
    "costUsd": 0.02
  }
}
```

---

# 16. Comparison report

For every architecture/model change produce:

```text
BASELINE
CANDIDATE

semantic wins/losses
visual pairwise wins/losses
latency delta
cost delta
fallback delta
repair delta
known regressions
```

Never use averages alone.

Show case-level regressions.

---

# 17. Plant acceptance report

The plant benchmark is the first mandatory V2 report.

Report:

```text
MANUAL V2 SCENEGRAPH
- renderer quality
- correct semantic anchors
- progressive drawing
- no generic boxes
- event-aligned contact sheet

AUTOMATIC V2
- mental model selected
- assets selected
- required relationships
- beat sequence
- timing
- critic result
- human pairwise if available
```

Pass criteria:
- manual renderer proves capability
- automatic planner produces correct semantic representation
- no critical relation error
- no generic-box downgrade
- visual result clearly exceeds V1

---

# 18. Current known baseline concerns

Based on the current saved project analysis:
- the architecture already has deterministic rendering and structured validation
- the current representation remains node/edge heavy
- the VLM judge has not been exercised as a mature live quality gate
- mock semantic coverage is not meaningful evidence of real teaching quality
- many benchmark scenes have exceeded the existing static-interval target
- passing implementation tests therefore demonstrates software feasibility, not Simi-level teaching quality

Treat these as baseline issues to resolve, not permanent truths.

---

# 19. Release policy

A candidate release must pass:

Hard:
- source truth
- schema
- compiler safety
- asset safety
- deterministic rendering

Quality:
- semantic benchmark
- pairwise visual benchmark
- selected human benchmark

Performance:
- first playable within accepted budget
- later scene generation compatible with progressive playback

No single aggregate score can override a hard failure.

---

# 20. What success means

Success is not:

```text
more icons
more animations
more LLM calls
more templates
```

Success is:

```text
the system selects the correct mental model,
constructs the right visual objects,
draws them coherently,
coordinates them with narration,
and measurably improves understanding.
```

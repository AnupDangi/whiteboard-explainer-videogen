# Explain Canvas Lab V2 — Test Strategy

## 0. Principle

Tests are divided by failure class.

A passing renderer test does not prove pedagogical quality.
A good VLM score does not prove compiler safety.
A beautiful frame does not prove source grounding.

Run all applicable layers.

---

# 1. Test layers

```text
T0  schema/unit
T1  compiler/property
T2  asset/illustration
T3  semantic planning
T4  timing/sync
T5  visual regression
T6  multimodal critic
T7  human pairwise
T8  learning efficacy
T9  performance/reliability
```

---

# 2. T0 — Schema and unit tests

Test:
- every V2 schema rejects additional properties
- IDs obey syntax and uniqueness
- invalid archetype rejected
- invalid action type rejected
- missing target object rejected
- invalid assetRef rejected
- child references valid
- relation anchors valid
- continuity IDs valid
- unsafe synthesized SVG AST rejected

Required cases:
- empty plan
- duplicate IDs
- unknown concept
- unknown object
- malformed relation
- action to nonexistent object
- invalid parent cycle
- excessive object count
- excessively long text
- missing critical scene field

---

# 3. T1 — Deterministic compiler tests

For every compiled scene assert:
- finite coordinates
- no NaN/Infinity
- no canvas escape unless explicitly allowed
- no illegal semantic overlap
- containment constraints hold
- touch constraints resolve correctly
- overlays preserve z-order
- text does not clip
- minimum font size respected
- relations terminate on valid semantic anchors
- forbidden connector-through-object is absent
- object states are valid
- action windows fit scene duration
- serialized compiled scene round-trips

Determinism:

```ts
expect(renderSVG(scene, 5000)).toEqual(renderSVG(scene, 5000))
```

Run in:
- same process
- fresh process
- browser renderer
- export renderer

---

# 4. Property-based tests

Generate random valid SceneGraph V2 inputs.

Assert:
- compiler never returns invalid SVG
- compiler never produces NaN
- every object remains addressable
- every action target exists
- action progress is monotonic
- direct seek is stateless
- relation endpoints stay finite
- serialization/deserialization preserves semantics

Generate constrained random:
- object count
- label lengths
- zone combinations
- relation density
- nesting depth
- state transitions
- mixed collision policies

Reject impossible semantic scenes early.

---

# 5. T2 — Asset tests

Every AssetDefinition must pass:
- unique asset ID
- valid viewBox
- drawable parts valid
- path complexity under limits
- no script/event/foreignObject/external URLs
- anchors inside normalized bounds
- states reference valid parts
- deterministic output
- style family declared
- semantic tags present

For complex assets:
- semantic subpart anchors required

Plant test:
- roots anchor exists
- leaf anchors exist
- stem anchor exists
- parts have deterministic order
- 0/25/50/75/100% snapshots render valid partial geometry

---

# 6. Illustration animation tests

For each multi-part asset:
- part order is correct
- path progress is monotonic
- fill starts only after configured outline threshold
- final frame matches static asset
- cursor follows active path point
- cursor tangent is finite
- cursor is absent when no active drawable stroke
- backward seek reconstructs exact state

Snapshot at:
- 0%
- 10%
- 25%
- 50%
- 75%
- 90%
- 100%

---

# 7. T3 — Semantic planning tests

Each benchmark case defines:

```ts
interface VisualBenchCase {
  id: string;
  prompt: string;
  category: string;

  mustExplain: string[];
  requiredRelations?: string[];
  preferredArchetypes?: VisualArchetype[];
  forbiddenPatterns?: string[];

  expectedConcepts?: string[];
}
```

Test planner:
- critical mustExplain coverage
- concept identity consistency
- source evidence coverage
- relation coverage
- process/state coverage
- archetype compatibility
- generic fallback rate
- duplicate beat rate
- unsupported hallucinated concepts

Do not test exact wording.

---

# 8. Plant golden semantic test

Prompt:

```text
Explain how plants make food to a middle-school student.
```

Must contain:
- plant
- sunlight
- water
- carbon dioxide

Must represent:
- water -> roots
- sunlight -> leaf/canopy
- CO2 -> leaf/canopy

Must use:
- structural/converging visual model

Must not use:
- generic_box_flow
- plant represented only as text in rectangle
- water arrow to plant center when root anchor exists

Manual golden and automatic plan may differ spatially.
Semantic requirements are mandatory.

---

# 9. DeepSeek MLA test

Must explain:
- standard KV representation is large
- MLA compresses representation
- compressed latent representation is smaller
- K/V can be reconstructed/used from latent representation

Preferred:
- transformation/compression mental model

Forbidden:
- only "Standard Attention -> MLA" boxes
- unexplained 671B/37B circles as the main mechanism

---

# 10. Expert routing test

Must include:
- token/input
- router
- expert pool
- selected experts
- output/aggregation

Must visually communicate selection.

Forbidden:
- only parameter-count circles
- all experts shown as identical unrelated nodes with no routing state

---

# 11. T4 — Timing / synchronization tests

For every action record:
- beat ID
- speech anchor
- action start
- action end
- signed lag

Metrics:
- anchorLagP50
- anchorLagP95
- maxLateAnchorLag
- longestNarratedNoChangeMs
- visualBeatsPerMinute
- meaningfulActionCoverage

Initial guidance:
- preferred meaningful reveal around -300ms..+300ms of spoken anchor
- warn on large positive lag
- persistent context can legitimately appear earlier
- fail if critical visual never appears

Static interval:
- warn/fail threshold initially 3500ms narrated no-change
- intentionalPause bypasses with explicit reason

---

# 12. T5 — Visual regression

Create two snapshot families.

## Fixed progress snapshots
For renderer regression:
- 0
- 25
- 50
- 75
- 100%

## Event-aligned snapshots
For semantic review:
- initial
- after beat 1
- after beat 2
- ...
- final

Store:
- SVG
- PNG
- contact sheet
- scene JSON hash

Use image diff only for deterministic renderer regressions.
Do not require pixel similarity between alternative valid visual plans.

---

# 13. Composition tests

Per archetype define:
- expected occupancy range
- hero salience expectations
- text density expectations
- relation limits
- zone constraints

Example:
- simple explanation: can be sparse
- structural diagram: higher central occupancy
- cross-section: high scene occupancy
- equation walkthrough: clear equation region
- list: repeated aligned items are acceptable

Do not enforce one universal occupancy value.

---

# 14. Semantic overlap tests

Test legal:
- child inside parent
- highlight behind label
- annotation leader touches object
- badge overlays parent
- particle starts within source

Test illegal:
- unrelated labels overlap
- two unrelated hero objects obscure each other
- annotation covers critical label
- connector passes through forbidden object region

---

# 15. VLM critic tests

Before trusting the critic, test the critic.

Create known degradations from a good plant scene:
- water arrow to leaf instead of roots
- remove sunlight
- swap CO2 and O2 labels
- clip plant roots
- delay critical reveal
- hide hero behind annotation
- convert plant to generic box
- reverse relation direction
- add irrelevant decorative objects

Judge must prefer original over corrupted versions.

Run pairwise both orders:
- A vs B
- B vs A

If preference flips:
- mark judge result inconsistent
- do not count as reliable signal

---

# 16. T6 — Multimodal evaluation

Use event-aligned contact sheet + narration + semantic requirements.

Judge dimensions:
- teaching clarity
- representation correctness
- relationship correctness
- visual hierarchy
- readability
- continuity
- motion semantics
- asset appropriateness
- unnecessary decoration

Primary protocol:
- pairwise comparison

Secondary protocol:
- 1–5 rubric for diagnostics

Never use one scalar score as a release gate.

---

# 17. T7 — Human pairwise

Questions:

Primary:

```text
Which version helps you understand the mechanism more clearly?
```

Secondary:
- which visual is easier to follow?
- which feels less cluttered?
- which better matches the narration?
- which contains any factual/visual error?

Comparisons:
- V1 vs V2
- V2 model A vs model B
- current commit vs previous accepted commit
- V2 vs reference-style target

Randomize ordering.

---

# 18. T8 — Learning efficacy

For a smaller set:
1. learner watches explainer
2. ask 3 factual questions
3. ask 1 mechanism question
4. ask 1 transfer question

Example transfer:
- if a plant has water and CO2 but receives no light, what happens to its ability to make glucose?

Measure:
- factual accuracy
- mechanism accuracy
- transfer accuracy

This is the product-level north star.

---

# 19. T9 — Performance / reliability

Record:
- firstPlayableMs
- sceneReadyMs
- fullPlayableMs
- exportMs
- tokens
- cached tokens
- model calls
- cost
- repair count
- fallback count
- geometry repair count
- asset fallback count
- critic repair count

Progressive requirement:

```text
generation(scene N+1) < playbackDuration(scene N)
```

for most normal runs after scene 1.

---

# 20. Required CI gates

PR CI:
- T0
- T1
- T2
- selected T3 fixtures
- deterministic snapshots

Nightly:
- full semantic benchmark
- model runs
- contact sheets
- VLM pairwise
- latency/cost report

Release candidate:
- human pairwise subset
- learning-efficacy subset
- full performance profile

---

# 21. Failure triage

If manual SceneGraph looks bad:
- renderer/compiler/asset bug

If manual looks good but automatic plan is bad:
- planner/director/asset retrieval bug

If static frame looks good but video feels wrong:
- timeline/action grammar bug

If scene is semantically correct but visually weak:
- composition/style/asset quality bug

If VLM complains but deterministic/human tests disagree:
- judge calibration problem

Do not change five subsystems at once.

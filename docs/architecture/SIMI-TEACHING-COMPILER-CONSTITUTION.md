# STCC — Simi Teaching Compiler Constitution

**Status:** CANONICAL
**Authority:** Highest project architecture authority below explicit human instructions
**Applies to:** production pipeline, agents, prompts, evaluators, worktrees, renderer, assets, performance work, experiments
**Architecture version:** STCC-1

---

# 0. Purpose

Simi is a **source-grounded visual teaching compiler**.

It is not primarily:

- a generative-video application
- an SVG generator
- an animation generator
- a collection of prompt templates
- an icon retrieval system
- a fine-tuned tutor
- a clone of another company's private implementation

The system converts source material into an evidence-backed pedagogical model and then deterministically compiles that model into synchronized visual teaching video.

Canonical transformation:

```text
SOURCE
  ↓
LEARNING OBJECTIVE
  ↓
EVIDENCE + PROVENANCE
  ↓
CONCEPT GRAPH
  ↓
LEARNER / CONFUSION MODEL
  ↓
TEACHING SCENE CONTRACTS
  ↓
TEACHING STRATEGY
  ↓
TEACHING MOVE PLAN
  ↓
NARRATION + VISUAL TEACHING MODEL
  ↓
TTS + ALIGNMENT
  ↓
TYPED VISUAL PROGRAM
  ↓
SEMANTIC RESOLUTION
  ↓
DETERMINISTIC GEOMETRY
  ↓
AUDIO-DRIVEN TIMELINE
  ↓
COMPILE LOCK
  ↓
SVG
  ↓
RASTER / ENCODE
  ↓
VIDEO
  ↓
TRACE + EVALUATION
  ↓
MEASURED IMPROVEMENT
```

---

# 1. Supreme invariant

## Models perform judgment.

Models may decide:

```text
what matters
what the learner needs to understand
teaching order
claims
misconception risks
confusion hotspots
intuition bridges
mental models
cognitive operation
representation family
semantic relationships
teaching strategy
example requirements
error contrasts
emphasis
narration
semantic reveal order
```

## Software performs execution.

Deterministic software owns:

```text
asset identity after resolution
coordinates
dimensions
text measurement
safe regions
layout
collision handling
routing
edge geometry
typography metrics
Rough.js seeds
interpolation
timing arithmetic
SVG paths
frames
rasterization
muxing
encoding
```

### Forbidden production behavior

A production model MUST NOT emit arbitrary:

```text
JavaScript
TypeScript
HTML
Canvas code
Manim code
unrestricted SVG
CSS layout
final x/y pixel coordinates
FFmpeg commands
arbitrary renderer code
```

A model emits **typed semantic contracts**.

Compilers interpret those contracts.

---

# 2. Source-of-truth hierarchy

When sources disagree, use this precedence:

```text
1. Explicit current human instruction
2. STCC constitution
3. Stage contract/schema
4. Current repository implementation
5. Stage-specific AGENTS.md
6. Tests and eval definitions
7. Approved skills/references
8. External documentation
9. Model assumptions
```

Model assumptions are never architecture authority.

If repository reality contradicts STCC:

```text
DO NOT silently rewrite STCC.
DO NOT silently rewrite the implementation.

Report:
ARCHITECTURE_DRIFT
```

with:

```text
expected
observed
files
impact
recommended owner stage
```

---

# 3. Anti-hallucination protocol

Every coding agent MUST distinguish:

```text
OBSERVED
INFERRED
PROPOSED
UNKNOWN
```

## OBSERVED

Supported by an inspected repository file, test, artifact, trace, schema, current documentation, or explicit user instruction.

## INFERRED

Reasonable interpretation derived from observed facts.

An inference may guide investigation but MUST NOT be treated as repository fact.

## PROPOSED

A new architectural or implementation idea.

A proposal MUST NOT be silently represented as existing behavior.

## UNKNOWN

Information that has not been established.

When unknown:

```text
search repo
inspect caller
inspect tests
inspect schemas
inspect relevant stage
```

If still unknown, report UNKNOWN.

Never invent:

```text
files
modules
APIs
configuration
dependencies
metrics
test results
benchmark results
provider capabilities
existing abstractions
database schemas
architecture decisions
```

---

# 4. Repository reconnaissance protocol

Before editing code, an agent MUST inspect:

```text
1. root AGENTS.md
2. this STCC document
3. task-specific worktree contract
4. git status
5. current branch
6. relevant package/module tree
7. relevant nested AGENTS.md
8. current interfaces/types
9. direct callers
10. relevant tests/evals
```

The agent MUST create a short internal change map:

```text
task
stage owner
current behavior
desired behavior
files likely involved
tests/evals
forbidden adjacent areas
```

No edits before stage ownership is identified.

---

# 5. Canonical pipeline

## S1 — Source Intake

Responsibility:

```text
ingestion
parsing
source identity
evidence spans
source hashes
provenance
```

Output:

```text
SourceDocument
EvidenceSpan[]
SourceProvenance
```

S1 MUST NOT decide how the topic should be taught.

---

## S1b — Goal / Syllabus

Responsibility:

```text
learning objective
audience
prerequisites
duration budget
source sufficiency
scope
```

Output:

```text
LearningGoal
AudienceModel
LessonBudget
SourceSufficiency
```

---

## S2 — Concept Graph

Responsibility:

```text
concept identities
dependencies
evidence-backed relationships
terminology
canonical concept ordering constraints
```

Output:

```text
ConceptGraph
```

Concept identity becomes globally stable after S2 unless explicitly revised by the canonical planning process.

---

# 6. S3 — Teaching Director

The Teaching Director decides what must change in the learner's mental model.

It emits:

```typescript
interface TeachingSceneContract {
  sceneId: string

  objective: string
  prerequisites: string[]
  learnerDelta: string

  essentialClaims: Claim[]
  evidence: EvidenceReference[]

  misconceptionRisks: Misconception[]
  confusionHotspots: ConfusionHotspot[]

  intuitionBridge?: IntuitionBridge

  mentalModel: MentalModel

  learningQuestion: string
  cognitiveOperation: CognitiveOperation

  representationQuestion: string
  semanticVisualIntent: SemanticVisualIntent

  targetDurationMs: number
}
```

Every production scene MUST have exactly one primary learning objective.

A scene may have secondary support claims but MUST NOT contain multiple unrelated learning objectives merely to reduce scene count.

---

# 7. S3b — Teaching Strategy Director

S3b is a separate semantic stage.

It answers:

> What teaching treatment is most likely to produce the required learner delta?

This stage is NOT narration.

This stage is NOT rendering.

This stage is NOT asset lookup.

Canonical strategies:

```typescript
type TeachingStrategy =
  | "direct"
  | "motivation"
  | "intuition-example"
  | "worked-example"
  | "contrastive-example"
  | "erroneous-example"
  | "example-nonexample"
  | "counterexample"
  | "boundary-case"
  | "predict-reveal"
  | "faded-worked-example"
  | "transfer-example"
  | "mechanism-trace";
```

Selection depends on:

```text
learner delta
cognitive operation
novelty
prerequisites
misconception probability
procedural depth
concept abstraction
confusability
source support
duration budget
```

S3b MUST NOT mechanically add examples to every scene.

---

# 8. Teaching Move Library

Teaching strategies are compiled into reusable **Teaching Moves**.

Canonical moves:

```text
RevealMotivation
ActivatePriorKnowledge
StateLearningQuestion
BuildIntuition
IntroduceMentalModel
RevealDefinition
TraceMechanism
WorkExample
PredictNextStep
ExposeMisconception
ForkCorrectIncorrect
ExplainDivergence
RepairMisconception
ShowNonExample
ShowCounterexample
TestBoundary
CompareCases
ConfirmInvariant
FadeSupport
TransferVariant
SummarizeLearnerDelta
```

These are semantic operations, not visual templates.

---

# 9. Example policy

Examples are semantic teaching objects.

Canonical example roles:

```typescript
type ExampleRole =
  | "positive-example"
  | "worked-example"
  | "non-example"
  | "counterexample"
  | "common-error"
  | "boundary-case"
  | "transfer-example";
```

An example MUST exist only when it contributes to the learner delta.

Examples MUST preserve the scene's core mental model where possible.

Do not change visual metaphors merely because an example begins.

---

# 10. Common-error architecture

A common mistake MUST NOT be represented as:

```text
wrong answer ❌
correct answer ✅
```

unless the distinction itself is trivial.

Use a structured divergence model.

```typescript
interface ErrorContrast {
  misconceptionId: string

  problem: ExampleProblem

  sharedPrefix: ReasoningStep[]

  divergence: {
    decision: string
    wrongStep: ReasoningStep
    correctStep: ReasoningStep
    whyWrongSeemsPlausible: string
    violatedInvariant: string
  }

  repair: {
    diagnosticIntent: SemanticVisualIntent
    explanation: string
    repairedStep: ReasoningStep
  }

  transferCheck?: ExampleProblem
}
```

Pedagogical sequence:

```text
shared reasoning
      ↓
decision point
   ↙      ↘
wrong    correct
  ↓         ↓
WHY?     invariant
   ↘      ↙
      repair
        ↓
 transfer case
```

---

# 11. Prediction beats

Non-interactive video may use active-prediction beats.

A prediction beat consists of:

```text
question
brief cognitive pause
visual reveal
explanation
```

It MUST NOT pretend an answer was received from the learner.

---

# 12. S4 — Narration Director

Narration is derived from the SAME semantic contract as visuals.

Input:

```text
TeachingSceneContract
TeachingStrategyPlan
TeachingMovePlan
```

Output:

```text
NarrationContract
ClaimNarrationMap
```

Narration MUST:

```text
preserve source grounding
preserve teaching order
explain decisions, not merely actions
avoid unsupported facts
avoid narrating decorative visuals
avoid introducing concepts missing from the scene contract
```

Narration does not control coordinates.

---

# 13. S5 — Audio Lane

Audio is the master clock.

Responsibilities:

```text
scene TTS
audio duration
word alignment
phrase alignment
claim alignment
pause markers
```

Output:

```text
AudioArtifact
AlignmentMap
```

Downstream timing MUST reference audio alignment rather than approximate character counts once real audio exists.

---

# 14. S6 — Visual Compiler

The Visual Compiler answers:

> What must the learner visibly understand?

Before visual elements exist, every major claim receives a Visual Teaching Model.

```typescript
interface VisualTeachingModel {
  claimId: string

  learningQuestion: string

  cognitiveOperation:
    | "identify"
    | "compare"
    | "classify"
    | "trace"
    | "transform"
    | "quantify"
    | "predict"
    | "infer"
    | "explain-cause"
    | "understand-system";

  representationFamily:
    | "literal-object"
    | "process"
    | "state-transition"
    | "sequence"
    | "topology"
    | "hierarchy"
    | "comparison"
    | "causal-chain"
    | "feedback-loop"
    | "quantity"
    | "spatial-model"
    | "equation"
    | "plot"
    | "code"
    | "scientific-diagram";

  teachingMoves: TeachingMove[];

  entities: SemanticEntity[];
  states: SemanticState[];
  relationships: SemanticRelationship[];
  transitions: SemanticTransition[];

  misconceptionToPrevent?: string

  visualInvariant: string
  semanticRevealOrder: string[]
  mutedMeaning: string
}
```

Icons MUST NOT determine representation.

Start with the cognitive question, then representation, then semantic elements, then assets.

---

# 15. Representation policy

Use the smallest representation that expresses the mechanism.

Forbidden default:

```text
BOX
 ↓
BOX
 ↓
BOX
```

for every concept. Generic box-arrow layouts are acceptable only when they accurately represent the semantic relationship.

---

# 16. S7 — Semantic Resolver

S7 maps semantic entities into deterministic renderable resources.

Responsibilities:

```text
procedural domain primitives
scientific diagram primitives
local vector assets
literal icons
metaphorical fallback assets
provenance
licensing metadata
```

All runtime asset access flows through:

```text
AssetBridge
```

Production renderer performs ZERO web searches.

Assets MUST NOT change what the lesson teaches.

---

# 17. S8 — Layout + Geometry

S8 exclusively owns:

```text
placement
dimensions
text wrapping
font measurement
safe margins
grouping
alignment
collision detection
edge routing
label placement
viewport fit
camera framing if applicable
```

S8 receives already-defined semantic structure.

The model does not output final coordinates.

Layout problems MUST NOT be repaired through prompt hacks in S3/S4/S6.

---

# 18. S9 — Timeline Compiler

S9 owns exact visual event timing.

Inputs:

```text
AlignmentMap
semantic dependencies
reveal order
geometry
animation contracts
```

Output:

```text
CompiledTimeline
```

Every reveal event should answer:

> What did the learner just hear, and what should visibly change now?

Timing MUST respect semantic dependencies.

---

# 19. Compile lock

Before rendering:

```text
lesson.lock.json
```

MUST be produced. The lock contains resolved data, not further instructions.

After lock creation:

```text
NO LLM CALLS
NO WEB CALLS
NO PROVIDER DISCOVERY
NO ASSET SEARCH
NO SEMANTIC REINTERPRETATION
NO RANDOM LAYOUT
NO UNSEEDED ROUGH OPERATIONS
NO ENVIRONMENT-DEPENDENT FONT FALLBACK
NO TIMESTAMP-BASED RANDOMNESS
```

The same lock MUST produce behaviorally equivalent rendering given the same supported render environment.

---

# 20. S10 — Pure SVG Renderer

Renderer responsibility:

```text
compiled geometry
+
compiled timeline state
+
resolved vector resources
→ SVG
```

Renderer MUST NOT make semantic decisions.

SVG is the canonical visual representation.

Rough.js may be used as a deterministic seeded geometry/style adapter. Rough.js is NOT a semantic generator.

---

# 21. S11 — Raster + Encode

Responsibilities:

```text
SVG rasterization
frame production
audio mux
video encoding
artifact generation
```

Preferred deterministic stack remains:

```text
SVG
→ resvg / equivalent deterministic rasterizer
→ FFmpeg
```

Browser preview and backend export MUST consume the same compiled semantic/timeline representation.

---

# 22. S12 — QA

S12 evaluates independent quality dimensions. Never collapse them into one score.

Categories:

```text
SOURCE / PEDAGOGY / VISUAL SEMANTICS / NARRATION / GEOMETRY / TIMELINE / PRODUCTION / ASSETS / SYSTEM
```

See plan §22 / rubric for the full per-dimension checklists. Pedagogy explicitly includes teaching-strategy appropriateness, worked-example correctness, misconception usefulness, divergence clarity, repair clarity, transfer quality.

---

# 23. Failure ownership

Defects MUST be fixed where they originate.

```text
bad source provenance        → S1
wrong scope                  → S1b
wrong concept dependency     → S2
wrong lesson order           → S3
wrong learner delta          → S3
bad strategy                 → S3b
bad example choice           → S3b
bad misconception selection  → S3/S3b
unsupported narration        → S3/S4
poor mental model            → S3/S6
wrong representation         → S6
wrong semantic element       → S6
wrong asset                  → S7
asset licensing issue        → S7/S12
overlap/clipping             → S8
edge-routing failure         → S8
poor synchronization         → S9
SVG corruption               → S10
render failure               → S10/S11
mux/encoding failure         → S11
evaluation defect            → S12
```

### Forbidden repair patterns

Do not fix structural defects using:

```text
topic-specific hardcoding
benchmark-specific hardcoding
scene-name conditionals
arbitrary icons
magic coordinates
validator weakening
test deletion
golden-output rewriting
special-casing one demo
prompt additions in unrelated stages
```

---

# 24. Trace architecture

Every lesson generation MUST be traceable across canonical stages (S1 → S12 + lock + renderer + encoder + evaluations).

Each artifact SHOULD contain:

```text
runId / stage / stageVersion / inputHash / outputHash / parentArtifactIds
model/provider when applicable / prompt-policy version / duration
cost where applicable / repairCount
```

---

# 25. Continuous improvement loop

```text
REAL GENERATIONS → TRACES → FAILURE CLUSTERING → CAPABILITY EVALS
→ ONE HYPOTHESIS → ONE CANDIDATE CHANGE → FROZEN REGRESSION DATASET
→ BASELINE VS CANDIDATE → CORRECTNESS GATES → PROMOTE / REJECT
```

---

# 26. Evaluation-first development

Before architecture changes record: problem, baseline, capability, evaluation, correctness gate, metric, hypothesis, allowed scope, search budget.

Do NOT implement first and invent success criteria afterward.

---

# 27. Candidate promotion rules

Promote only when: target metric improves AND all correctness gates pass AND no unacceptable regression AND determinism preserved AND improvement generalizes beyond one test topic.

---

# 28. Golden and adversarial eval families

Maintain cases covering math procedural/misconception, physics causal, scientific processes, technical architecture, algorithm tracing, code behavior, comparison, hierarchy, feedback, abstract concepts, long/short/ambiguous/insufficient grounding, asset-heavy topics, procedural diagrams. Add adversarial cases for known regressions. Never tune only on public demo topics.

---

# 29. Parallelism rules

Semantic consistency before parallel speed. Safe after dependencies freeze: source extraction, local concept extraction, scene expansion after canonical ordering, scene TTS, alignment, visual compilation, asset resolution, layout, independent rasterization, scene encoding.

Do NOT independently parallelize: lesson order, terminology, concept identity, global semantic conventions, global visual semantics, mental-model continuity, shared pedagogical progression.

---

# 30–37. Worktree architecture

One substantial hypothesis = one Git worktree at `../simi-worktrees/`, branch `wt/<stage>/<task-slug>`. One mutable worktree = one primary coding agent. Every worktree declares task_id, stage_owner, hypothesis, allowed/forbidden paths, baseline/focused/regression commands, success metrics, correctness gates, and finishes with the §36 result contract (TASK / HYPOTHESIS / FILES / BEFORE / AFTER / TESTS / EVALS / REGRESSIONS / DEVIATIONS / RISKS / RECOMMENDATION). Promote via §37 ladder: focused → stage → integration → determinism → semantic evals → perf → architecture review → human approval → merge.

---

# 38. OpenCode agent roles

`simi-builder` (mutable, STCC-bound). Read-only: `architecture-guardian`, `eval-reviewer`, `root-cause-auditor`. `performance-investigator` measures first, active in perf phases.

---

# 39. Stage-local AGENTS.md

Nested instructions specialize subtree conventions only. They MUST NOT redefine global architecture. STCC always wins.

---

# 40. Skills policy

Load skills by concern only. Skills provide methods; they do NOT override STCC.

---

# 41–42. Performance policy

Never report one number called "generation speed". Measure per-stage latencies, TTFP, p50/p95, render/encode, completion, cache, memory, repairs, LLM/TTS cost. One variable at a time; reject speed that damages grounding, teaching, representation, determinism, reproducibility, correctness.

---

# 43. Renderer boundary

The renderer is intentionally dumb: no rewriting, no strategy/representation choice, no asset search, no model calls, no semantic repair, no inferred relations. Upstream-looking diagnosis first.

---

# 44–45. Validator / recovery policy

Never weaken validators to pass. Valid new use case: establish semantics → regression case → intentional schema/contract update → validator update → old cases still pass. Bounded repairs with failure class, owner, action, retry limit, termination. Never "fix the video" via a general model.

---

# 46–49. Determinism / visualization quality / muted comprehension / stable objects

Determinism binds after semantic compilation; evaluate reasoning stages via reliability/pass@k/variance. Every visual beat answers what the learner heard, what changed in their model, and what visibly changed. Important scenes stay interpretable muted (entities, relations, mechanism, transition, comparison, causality, result — not narration-as-text). Preserve identity/role/position of continuing objects; motion must mean something.

---

# 50. Explicitly prohibited architectural shortcuts

No topic/benchmark/scene conditionals, magic coordinates, hardcoded answers, eval-fixture timing, hidden demo substitutions, post-render semantic patches, production LLM-SVG, unbounded retries, silent grounding relaxation — without explicit human authorization + justification.

---

# 51. Definition of done

Done = correct stage owns it, contracts valid, focused + regression + relevant evals pass, no forbidden scope, traceability + determinism intact, docs/schemas updated, evidence reported. Compiling is not done.

---

# 52. Final architecture principle

Optimized for **observable learner-model change**, in order: semantic correctness, teaching clarity, mechanism visibility, source grounding, reproducibility — before decorative richness.

---

# 53. Agent stop conditions

Stop and report with evidence when: stage ownership unclear, required schema absent, task breaks STCC, repo contradicts STCC materially, base branch unknown, wrong worktree, another writer active, success unmeasurable, or change would weaken validation.

---

# 54. Constitutional rule

Every architecture change states: STCC section, problem, evidence, proposal, proving eval, migration, rollback. No silent architecture mutation through implementation.

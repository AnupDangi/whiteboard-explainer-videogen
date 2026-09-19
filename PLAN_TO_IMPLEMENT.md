Note: 'NEVER EDIT THIS FILE'


# Explain Canvas Lab — Final Source-to-Lesson Architecture Plan

## 0. Mission

Build a teacher-quality visual explanation pipeline that accepts:

```text
PDF
URL
DOCX
PPTX
Markdown
Text
HTML
Images
scanned pages
```

plus an optional:

```text
userPrompt
```

and a required:

```text
targetDuration
```

then produces:

```text
source understanding
→ cached ConceptGraph
→ complete LessonGraph
→ parallel SceneIntents
→ narration
→ deterministic compiled scenes
→ video
```

Do NOT build a swarm of conversational agents.

Runtime intelligence should be concentrated into three semantic roles:

```text
1. Knowledge Compiler
2. Teacher Planner
3. Scene Director
```

Everything else should be deterministic infrastructure.

---

# 1. Core invariant

Preserve the current strongest architectural decision:

```text
LLMs own:

WHAT exists
WHAT matters
WHAT should be taught
HOW concepts relate
HOW narration should explain them
WHAT semantic visual representation is required


CODE owns:

coordinates
geometry
layout
routing
timing
SVG
rendering
persistence
validation
caching
retrieval
```

Never allow models to output:

```text
x/y coordinates
raw SVG
runtime object IDs
arbitrary code
layout mathematics
```

Existing compiler and renderer remain authoritative.

---

# 2. Canonical request

Create one lesson request.

```ts
interface LessonRequest {
  sources: SourceInput[];

  userPrompt?: string;

  targetDurationSec: number;

  audience?: {
    level?: string;
    assumedKnowledge?: string[];
  };

  language?: string;

  teachingStyle?: string;
}
```

`userPrompt` is optional.

Examples:

```text
source:
Attention Is All You Need.pdf

prompt:
undefined

duration:
600s
```

means:

> Teach the important material from this source in ten minutes.

Whereas:

```text
prompt:
Focus primarily on why multi-head attention is useful.
```

changes lesson focus without changing source truth.

---

# 3. Separate SOURCE understanding from LESSON personalization

This is mandatory.

Do NOT create a new source ConceptGraph for every user prompt.

Use:

```text
SOURCE
   ↓
BaseConceptGraph
```

and then:

```text
BaseConceptGraph
+
userPrompt
+
duration
+
audience
   ↓
LessonGraph
```

This means:

```text
same PDF
different lesson
different duration
different learner
```

can reuse the expensive source analysis.

---

# 4. Source ingestion

Normalize every supported input into:

```ts
interface SourceDocument {
  id: string;
  sourceHash: string;

  metadata: SourceMetadata;

  blocks: SourceBlock[];
}
```

Use typed blocks.

```ts
type SourceBlock =
  | TextBlock
  | HeadingBlock
  | TableBlock
  | FigureBlock
  | EquationBlock
  | CodeBlock;
```

Do NOT flatten everything into one giant string.

---

# 5. PDF multimodal ingestion

PDF processing should fan out immediately.

```text
                        PDF
                         │
          ┌──────────────┼───────────────┐
          ↓              ↓               ↓
      text layer       figures         tables
          │              │               │
          ↓              ↓               ↓
      structure       extraction      extraction
          │              │               │
          └──────────────┼───────────────┘
                         ↓
                 SourceDocument
```

Also detect:

```text
page has insufficient text
        ↓
OCR required
```

Do not OCR every page.

---

# 6. Figure handling

A `FigureBlock` should retain:

```ts
interface FigureBlock {
  id: string;

  page: number;

  imageRef: string;

  caption?: string;

  nearbyText: string[];

  description?: string;

  semanticTags?: string[];
}
```

For meaningful figures:

```text
crop
→ VLM description
→ retain actual image
```

Do NOT convert a useful scientific figure merely into prose.

We may later reuse the source figure in the generated explanation.

---

# 7. Table handling

Keep tables structurally.

```ts
interface TableBlock {
  id: string;

  page: number;

  caption?: string;

  columns: string[];
  rows: string[][];

  nearbyText: string[];
}
```

For large tables also create a textual retrieval representation.

The renderer can later decide whether to:

```text
show original table
reconstruct simplified table
teach one portion
```

---

# 8. Semantic chunking

After source normalization:

```text
SourceDocument
      ↓
SemanticChunker
```

Do NOT use arbitrary fixed character windows.

Chunks should respect:

```text
heading boundaries
paragraph boundaries
figure-caption relationships
table context
equation context
code blocks
section hierarchy
```

Initial target:

```text
~700–1,500 tokens/chunk
```

with modest overlap only where semantic continuity requires it.

---

# 9. Retrieval architecture

Create a hybrid index.

```text
chunks
   │
   ├── BM25
   ├── vector embedding
   ├── section metadata
   └── entity/concept metadata
```

Prefer local embedding/reranking models initially so this layer does not consume generative-model tokens.

Retrieval should roughly be:

```text
query
 ↓
hybrid retrieve ~75–100
 ↓
reranker
 ↓
top 25
```

But TOP 25 IS NOT THE ENTIRE SOURCE UNDERSTANDING.

---

# 10. Two retrieval sets

Use:

```text
A. COVERAGE SET
B. FOCUS SET
```

## Coverage Set

Guarantees representation from major source sections.

For example:

```text
intro
architecture
method
experiments
limitations
conclusion
```

depending on source structure.

## Focus Set

Hybrid retrieval + reranking:

```text
top 25
```

using:

```text
user prompt
source title
requested learning objective
```

Then:

```text
GraphContext =
CoverageSet
UNION
FocusSet
```

This prevents personalization from accidentally deleting important source context.

---

# 11. If userPrompt is absent

Create focus intent automatically from:

```text
source title
abstract/introduction
headings
high-centrality concepts
conclusion
```

Goal:

```text
teach the source's core intellectual structure
```

Not:

```text
summarize every paragraph
```

---

# 12. Knowledge graph construction

Do not call one model per raw chunk.

Pack related chunks together.

Example:

```text
8 chunks
→ knowledge batch
```

Then execute knowledge-map calls concurrently.

```text
Batch A ──→ GraphFragment A
Batch B ──→ GraphFragment B
Batch C ──→ GraphFragment C
Batch D ──→ GraphFragment D
```

Each fragment contains:

```ts
interface GraphFragment {
  concepts: Concept[];
  relations: Relation[];

  claims: Claim[];

  mechanisms: Mechanism[];

  prerequisites: Prerequisite[];

  terminology: Term[];

  evidenceRefs: EvidenceRef[];
}
```

Every factual claim must carry evidence.

---

# 13. One graph reducer

After parallel fragment generation:

```text
GraphFragments[]
       ↓
GraphReducer
       ↓
BaseConceptGraph
```

Reducer responsibilities:

```text
canonicalize aliases
deduplicate concepts
merge identical claims
resolve terminology
build prerequisite edges
build mechanism edges
preserve evidence
identify source-level thesis
identify central concepts
```

Reducer must NOT invent unsupported content.

---

# 14. Cache the BaseConceptGraph

Key roughly by:

```text
sourceHash
+
chunkerVersion
+
retrievalVersion
+
graphCompilerVersion
```

Persist:

```text
SourceDocument
ChunkIndex
BaseConceptGraph
EvidenceIndex
```

A second video using the same source must not regenerate these.

---

# 15. User focus should not mutate BaseConceptGraph

For:

```text
"Explain only DeepSeek's MLA architecture."
```

derive:

```text
FocusedConceptGraph
```

from:

```text
BaseConceptGraph
+
userPrompt
```

Base source knowledge remains immutable.

This means:

```text
Video A:
MLA

Video B:
training

Video C:
inference optimization
```

can share the same source graph.

---

# 16. Teacher Planner

This becomes the most important semantic call in the lesson pipeline.

INPUT:

```text
BaseConceptGraph
FocusedConceptGraph
userPrompt?
targetDuration
audience
source metadata
```

OUTPUT:

```text
LessonGraph
+
LessonBible
```

ONE model call under normal conditions.

---

# 17. LessonGraph

```ts
interface LessonGraph {
  title: string;

  lessonGoal: string;

  targetDurationSec: number;

  scenes: SceneContract[];

  summaryGoal: string;

  continuityPlan: ContinuityPlan;
}
```

Each scene represents:

```text
A LEARNER DELTA
```

not one graph node.

---

# 18. Never make ConceptNode == Scene

Wrong:

```text
water
→ scene

sun
→ scene

CO2
→ scene

chloroplast
→ scene
```

Correct:

```text
ConceptGraph nodes
      ↓
pedagogical clustering
      ↓
SceneContract
```

Example photosynthesis:

```text
Scene 1
What the plant needs

sunlight + water + CO2


Scene 2
Where conversion happens

leaf + chloroplast + chlorophyll


Scene 3
What the process produces

glucose + oxygen + stored energy
```

---

# 19. Teacher-like ordering

Lesson Planner must reason:

```text
What should learner understand first?

What prerequisite is required?

What should I introduce before terminology?

When should I show mechanism?

Where is an example useful?

Where should depth increase?

What should I intentionally leave out given duration?
```

The lesson must progress:

```text
orientation
↓
mental model
↓
core concepts
↓
mechanism
↓
deeper relationships
↓
examples / implications
↓
synthesis
```

appropriate to target duration.

---

# 20. Duration controls depth, not playback speed

Do NOT squeeze a ten-minute lesson into one minute by speaking faster.

For approximately:

```text
1 minute
```

teach:

```text
topic orientation
core mental model
one central mechanism
main takeaway
```

For:

```text
2 minutes
```

add:

```text
important components
one example
```

For:

```text
5 minutes
```

add:

```text
prerequisites
mechanism in stages
example
important caveat
summary
```

For:

```text
10 minutes
```

allow:

```text
context
architecture
major components
step-by-step mechanism
example
interactions
limitations
implications
summary
```

The teacher chooses depth based on time budget.

---

# 21. Video title policy

The video title should describe the subject.

For source:

```text
DeepSeek B4 Flash Architecture Review
```

acceptable title:

```text
DeepSeek B4 Flash Architecture
```

or:

```text
DeepSeek B4 Flash: Architecture Review
```

Not:

```text
Why Is DeepSeek B4 Flash So Fast?
```

unless user explicitly requests that framing.

Analogies and pedagogical questions belong inside scenes.

Not as the default lesson title.

---

# 22. Introduction policy

For normal educational videos, narration should orient the learner naturally.

Example:

```text
"Today we're going to look at the architecture behind
DeepSeek B4 Flash, starting with the overall design and
then moving into the mechanisms that make it efficient."
```

Do not jump immediately into an unexplained analogy.

Short videos can compress this to one sentence.

---

# 23. LessonBible

Teacher Planner generates one lesson-wide consistency artifact.

```ts
interface LessonBible {
  canonicalTerminology: Record<string, string>;

  conceptIdentity: Record<string, ConceptIdentity>;

  visualIdentity: Record<string, VisualIdentity>;

  analogies: Record<string, Analogy>;

  narrativeStyle: NarrativeStyle;

  learnerLevel: string;

  persistentObjects: string[];

  introducedConceptsByScene: Record<string, string[]>;

  forbiddenRepetition: string[];
}
```

This solves cross-scene inconsistency.

---

# 24. Visual consistency

Example:

```text
Q = blue
K = purple
V = green
```

is declared once.

Every scene worker receives it.

A worker may not reinterpret it.

Same for:

```text
plant
server
neuron
database
concept aliases
notation
```

---

# 25. Scene contracts

Teacher Planner returns all scene contracts at once.

```ts
interface SceneContract {
  id: string;

  sequence: number;

  learningDelta: string;

  requiredConceptIds: string[];

  requiredRelations: string[];

  mechanismIds: string[];

  evidenceRefs: string[];

  targetDurationSec: number;

  narrationIntent: string;

  candidateArchetypes: string[];

  continuityIn: string[];

  continuityOut: string[];
}
```

This is now the authoritative lesson architecture.

---

# 26. Scene-specific RAG

Before generating a scene:

```text
SceneContract
      ↓
retrieve supporting evidence
```

Use:

```text
concept IDs
required relations
learning delta
mechanism
```

as retrieval queries.

Rerank down to approximately:

```text
5–10 evidence chunks
```

per scene.

Scene models do NOT receive the entire PDF.

---

# 27. Scene generation

One scene worker should produce both:

```text
VisualIntent
+
Narration
```

Do not create separate:

```text
narration agent
visual agent
pedagogy agent
```

for every scene.

That recreates the call explosion we are trying to remove.

---

# 28. Scene worker input

Each worker receives only:

```text
SceneContract
LessonBible
relevant concept subgraph
5–10 evidence chunks
available representation candidates
```

NOT:

```text
entire PDF
entire graph
all other scenes
```

This dramatically reduces prefill.

---

# 29. Scene worker output

```ts
interface SceneIntent {
  sceneId: string;

  narration: string;

  objects: SemanticObject[];

  relations: SemanticRelation[];

  actions: SemanticAction[];

  continuity: SceneContinuity;
}
```

Still no geometry.

---

# 30. Parallel scene generation

After LessonGraph is frozen:

```text
Scene 1 ──→ Worker
Scene 2 ──→ Worker
Scene 3 ──→ Worker
Scene 4 ──→ Worker
```

run concurrently.

Do not serialize expensive model reasoning because of scene geometry.

---

# 31. Scene batching

Do not necessarily make one network request per scene.

Use:

```text
Scene 1
```

alone because it is latency-critical.

Then group adjacent scenes:

```text
Scenes 2–3
Scenes 4–5
Scenes 6–7
...
```

into independent scene-worker calls when schemas and context size allow.

This reduces:

```text
network overhead
prefill
total call count
```

while retaining scene-level outputs.

---

# 32. Why Scene 1 is special

Optimize first-AV latency.

Execute:

```text
Teacher Plan complete
      ↓
Scene 1 immediately
      ↓
Narration
      ↓
TTS
      ↓
Compile
      ↓
PLAY
```

while all later scene batches continue in parallel.

User should not wait for the whole ten-minute lesson.

---

# 33. Expensive parallel, cheap sequential

Generate:

```text
semantic SceneIntents
```

in parallel.

If geometric continuity requires previous scene geometry:

```text
compile scene 1
→ compile scene 2
→ compile scene 3
```

sequentially.

That is acceptable because compilation is cheap.

Do NOT serialize LLM calls merely because compilation is sequential.

---

# 34. TTS

Generate one narration stream per scene where practical.

Do NOT invoke TTS separately for every tiny beat unless alignment quality requires it.

Prefer:

```text
scene narration
      ↓
TTS
      ↓
word alignment
      ↓
timeline
```

Audio is the master clock.

---

# 35. Runtime model roles

Runtime architecture should have three main LLM roles:

```text
Knowledge Compiler
Teacher Planner
Scene Worker
```

plus optional:

```text
Vision Extractor
Rescue Model
```

That is enough.

Do not create ten runtime agents.

---

# 36. Model routing — current recommendation

## Multimodal / difficult source pages

```text
google/gemini-3.8-flash
```

Use for:

```text
figure interpretation
table interpretation
scanned/visual pages
complex multimodal source extraction
```

Do NOT send normal selectable-text pages through it.

---

## Graph fragment compiler

Primary:

```text
openai/gpt-5.6-luna
```

Graph fragments are strict structured JSON.

Luna is cheap and has a large context window.

---

## Graph reducer

Primary:

```text
openai/gpt-5.6-luna
```

Escalate difficult multimodal/very complex source reductions to:

```text
google/gemini-3.8-flash
```

---

## Teacher Planner

Economy/default:

```text
openai/gpt-5.6-luna
```

Fast mode candidate:

```text
anthropic/claude-haiku-4.5
```

Only one Teacher Planner call normally occurs per lesson, so paying slightly more for a faster/high-quality planner can be worthwhile.

---

## Scene 1

Fast-mode candidate:

```text
anthropic/claude-haiku-4.5
```

because first-playable latency matters most.

Economy:

```text
openai/gpt-5.6-luna
```

---

## Later Scene Workers

Benchmark:

```text
qwen/qwen3.5-27b
```

against:

```text
openai/gpt-5.6-luna
```

Do not switch until live schema/gate-pass benchmarks prove Qwen is acceptable.

---

## Rescue

Only after one gate failure:

```text
anthropic/claude-sonnet-5
```

No routine Sonnet usage.

---

# 37. DeepSeek V3.2

Do not use DeepSeek V3.2 for contract-critical JSON stages by default.

It may remain useful for:

```text
cheap summarization
retrieval preprocessing
non-schema analysis
```

but structured-output enforcement is more important than raw token price for our main stages.

---

# 38. Approximate model call formula

For a NEW source:

```text
Calls =
V
+ G
+ 1 GraphReducer
+ 1 TeacherPlanner
+ B SceneBatches
+ failures/retries
```

where:

```text
V = multimodal extraction batches
G = graph map batches
B = scene generation batches
```

For an already-cached source:

```text
Calls =
1 TeacherPlanner
+ B SceneBatches
```

For identical lesson settings with cached LessonGraph/scenes:

```text
potentially 0 LLM calls
```

---

# 39. Graph-call policy by source size

Small source:

```text
1 graph map
+
1 reducer
```

Medium:

```text
2–4 graph maps parallel
+
1 reducer
```

Large:

```text
4–8 graph maps parallel
+
1 reducer
```

Do not create one graph call per chunk.

---

# 40. Approximate scene density

Scene count should be semantic, but initial planning target:

```text
~25–45 seconds / teaching scene
```

Typical:

```text
1 min  → ~2 scenes
2 min  → ~4 scenes
5 min  → ~8–10 scenes
10 min → ~16–20 scenes
```

Teacher Planner can override when concept density demands it.

---

# 41. Approximate scene API calls

With Scene 1 isolated and later scenes grouped in pairs:

```text
2 scenes  → 2 scene calls
4 scenes  → 3 scene calls
10 scenes → 6 scene calls
18 scenes → 10 scene calls
```

Therefore cached-source generation is approximately:

```text
1 min  → 3 LLM calls
2 min  → 4 LLM calls
5 min  → ~7 LLM calls
10 min → ~11 LLM calls
```

plus any failed-stage repair.

This is dramatically better than creating:

```text
teaching call
+
architect call
+
director call
```

for every scene.

---

# 42. Caching hierarchy

Persist:

```text
SOURCE CACHE
├── SourceDocument
├── chunks
├── embeddings/index
├── figure/table metadata
├── BaseConceptGraph
└── EvidenceIndex


LESSON CACHE
├── FocusedConceptGraph
├── LessonGraph
├── LessonBible
└── SceneContracts


SCENE CACHE
├── SceneIntent
├── narration
├── audio
└── CompiledScene
```

---

# 43. Cache invalidation

Source-level cache key:

```text
sourceHash
parserVersion
chunkerVersion
embeddingVersion
graphCompilerVersion
```

Lesson-level:

```text
baseGraphHash
userPromptHash
duration
audience
language
teacherPlannerVersion
```

Scene-level:

```text
lessonGraphHash
sceneContractHash
sceneWorkerVersion
representationVersion
```

---

# 44. Existing architecture to KEEP

Do not rewrite:

```text
TeachingHarness
schema validation
failure ownership
one-repair policy
compiler
renderSVG
browser/export renderer sharing
job journal
provenance envelopes
```

We are restructuring the expensive semantic front end.

Not rebuilding the trusted deterministic back end.

---

# 45. Existing architecture to CONSOLIDATE

Current:

```text
knowledge windows
teaching windows
per-scene architect
whiteboard planner
per-scene director
```

Target:

```text
source knowledge maps
        ↓
one BaseConceptGraph
        ↓
one TeacherPlanner
        ↓
all SceneContracts
        ↓
parallel SceneWorkers
```

Remove redundant semantic re-planning after migration proves parity.

---

# 46. Implementation coding agents

Use multiple coding agents to implement this, but runtime stays simple.

## Agent A — Multimodal Source Model

Own:

```text
SourceDocument
SourceBlock
PDF/URL/DOCX/PPTX adapters
figure/table/equation preservation
```

---

## Agent B — Retrieval

Own:

```text
semantic chunking
BM25
embeddings
hybrid retrieval
reranker
coverage selection
top-25 focus selection
```

---

## Agent C — ConceptGraph

Own:

```text
GraphFragment schema
parallel map
graph reducer
evidence preservation
BaseConceptGraph caching
```

---

## Agent D — Teacher Planner

Own:

```text
LessonGraph
LessonBible
SceneContract
duration-aware pedagogy
title policy
teacher-like introduction
```

---

## Agent E — Scene Runtime

Own:

```text
scene-specific retrieval
parallel SceneWorkers
scene batching
Scene 1 priority
progressive generation
```

---

## Agent F — Model Router

Own:

```text
stage-specific models
provider routing
cost metrics
TTFT
schema pass rate
gate pass rate
fallback
```

---

## Agent G — Cache/Persistence

Own:

```text
source cache
lesson cache
scene cache
versioned invalidation
resume/replay
```

---

## Agent H — Migration/Evaluation

Compare:

```text
CURRENT V2
vs
NEW FRONT END
```

on the same benchmark.

No migration until quality is at least equal.

---

# 47. Required benchmark

Use at least:

```text
photosynthesis
attention
DeepSeek architecture
HTTP lifecycle
DNA replication
matrix multiplication
plate tectonics
cache hit/miss
```

Test:

```text
1 min
5 min
10 min
```

Measure:

```text
concept coverage
critical claim accuracy
teaching coherence
cross-scene consistency
first AV
full generation latency
API calls
tokens
cost
repair count
schema pass rate
```

---

# 48. Success target

The architecture is successful when:

```text
source understanding occurs once

ConceptGraph is reusable

user prompt changes lesson focus,
not source truth

lesson structure is planned once

all scenes share one teacher identity

scene reasoning runs mostly parallel

first scene plays before full lesson completes

compiler/renderer remain deterministic

same source re-use becomes very cheap
```

That is the architecture to implement.

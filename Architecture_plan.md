Note: 'NEVER EDIT THIS FILE'

# Explain Canvas Lab — Final Production Architecture

## 1. Final architectural rule

The system has three primary semantic intelligence stages:

```text
1. KNOWLEDGE COMPILER
2. TEACHER PLANNER
3. SCENE DIRECTOR
```

Optionally:

```text
4. VISION EXTRACTOR
```

only when the source contains information that cannot be reliably extracted structurally.

Everything else remains deterministic.

```text
LLMs
│
├── understand knowledge
├── decide how to teach
└── decide semantic scene intent

CODE
│
├── ingestion
├── OCR routing
├── chunking
├── BM25/vector retrieval
├── reranking
├── representation resolution
├── whiteboard persistence
├── geometry
├── layout
├── routing
├── timing
├── TTS orchestration
├── rendering
└── export
```

Do not create a large runtime agent swarm.

---

# 2. End-to-end architecture

```text
USER
│
├── source(s)
│     ├ PDF
│     ├ URL
│     ├ DOCX
│     ├ PPTX
│     ├ Markdown
│     ├ text
│     └ image/scanned document
│
├── optional userPrompt
│
├── targetDuration
│
├── audience / level
│
└── language
         │
         ▼
┌─────────────────────────────┐
│ 1. SOURCE INGESTION         │
└──────────────┬──────────────┘
               │
       normalized blocks
               │
               ▼
┌─────────────────────────────┐
│ 2. MULTIMODAL EXTRACTION    │
│ text / figures / tables /   │
│ equations / code / OCR      │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 3. SEMANTIC CHUNKING        │
└──────────────┬──────────────┘
               │
        ┌──────┴───────┐
        ▼              ▼
      BM25          Embeddings
        │              │
        └──────┬───────┘
               ▼
         hybrid index
               │
               ▼
          reranking
               │
      ┌────────┴─────────┐
      ▼                  ▼
Coverage Set        Focus Set
source-wide         top ~25
               │
               ▼
┌─────────────────────────────┐
│ 4. KNOWLEDGE MAP            │
│ parallel graph fragments    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 5. GRAPH REDUCER            │
│ BaseConceptGraph            │
└──────────────┬──────────────┘
               │
             CACHE
               │
               ▼
┌─────────────────────────────┐
│ 6. TEACHER PLANNER          │
│ ConceptGraph + prompt +     │
│ duration + audience         │
└──────────────┬──────────────┘
               │
               ▼
       LessonGraph
       LessonBible
       SceneContracts[]
               │
             CACHE
               │
               ▼
       scene-specific RAG
               │
         ┌─────┼─────┐
         ▼     ▼     ▼
      Scene1 Scene2 SceneN
      Worker Worker Worker
         │     │     │
         └─────┼─────┘
               ▼
        SceneIntent[]
        narration[]
               │
     ┌─────────┴─────────┐
     ▼                   ▼
 local TTS         representation
                        resolver
     │                   │
     └─────────┬─────────┘
               ▼
       deterministic compiler
               │
               ▼
         renderSVG(t)
               │
       ┌───────┴────────┐
       ▼                ▼
 interactive        video export
 playback              MP4
```

---

# 3. Request contract

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

The source contains truth.

The optional prompt controls:

```text
focus
depth
learning objective
style
requested emphasis
```

It must not rewrite source truth.

---

# 4. Ingestion

There must be exactly one ingestion pathway.

```text
API
CLI
job worker
tests
     │
     ▼
 ingestSource()
```

No CLI-specific PDF parser.

No second source pipeline.

---

# 5. Normalized source model

Preserve document structure.

```ts
type SourceBlock =
  | HeadingBlock
  | TextBlock
  | FigureBlock
  | TableBlock
  | EquationBlock
  | CodeBlock;
```

Do not flatten:

```text
figure → plain text
table → random paragraph
equation → prose
```

unless creating an additional retrieval representation.

Keep the original structured block.

---

# 6. Extraction should happen in parallel

For a PDF:

```text
                       PDF
                        │
      ┌─────────────────┼─────────────────┐
      ▼                 ▼                 ▼
 text extraction     figures           tables
      │                 │                 │
      ▼                 ▼                 ▼
 headings          captions/VLM      structured rows
 equations
      │                 │                 │
      └─────────────────┼─────────────────┘
                        ▼
                 SourceDocument
```

Only use vision when required.

A PDF with selectable text should not be sent page-by-page to Gemini.

Vision is for:

```text
scanned pages
meaningful figures
charts
visual diagrams
complex tables that structural extraction failed on
```

---

# 7. Semantic chunking

Chunks should respect semantic structure.

Target approximately:

```text
700–1,500 tokens
```

depending on material.

Boundaries:

```text
sections
subsections
paragraph groups
figure + caption
table + description
equation + explanation
code + explanation
```

Do not go back to arbitrary 40,000-character chunks as the primary retrieval unit.

---

# 8. Retrieval

Build once:

```text
BM25
+
embeddings
+
section metadata
+
document hierarchy
```

Then:

```text
retrieve 75–100 candidates
        ↓
rerank
        ↓
top ~25 focus chunks
```

But top 25 cannot be the only source used for graph construction.

Maintain:

```text
CoverageSet
+
FocusSet
```

Coverage prevents important parts of the document from disappearing.

Focus personalizes the lesson.

---

# 9. Coverage Set

Select representative evidence from all meaningful sections.

Example paper:

```text
Abstract
Introduction
Architecture
Method
Training
Experiments
Limitations
Conclusion
```

The exact sections depend on the source.

This provides global source understanding.

---

# 10. Focus Set

If the user says:

```text
"Explain DeepSeek MLA and why it reduces KV-cache."
```

retrieve and rerank specifically around:

```text
MLA
latent representation
KV cache
attention
inference
memory
```

Top ~25 becomes the focus set.

Then:

```text
GraphContext =
CoverageSet ∪ FocusSet
```

---

# 11. Knowledge compilation

Do NOT make one LLM call for every chunk.

Group semantic chunks.

Example:

```text
chunks 1–8   → graph map A
chunks 9–16  → graph map B
chunks 17–24 → graph map C
chunks 25–32 → graph map D
```

Run concurrently.

Each returns:

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

Every factual claim must have evidence.

---

# 12. Knowledge-map concurrency

Initial policy:

```text
small source:
1 graph-map call

medium:
2–4 concurrent map calls

large:
4–8 concurrent map calls
```

Do not create dozens of model calls simply because the document contains dozens of chunks.

---

# 13. Graph reducer

One reducer call receives GraphFragments, not the original entire document.

Responsibilities:

```text
deduplicate concepts

canonicalize aliases

merge terminology

merge mechanisms

create prerequisite edges

resolve relations

retain evidence

identify central concepts

identify source thesis
```

Output:

```text
BaseConceptGraph
```

---

# 14. Cache BaseConceptGraph

Cache key:

```text
sourceHash
+
parserVersion
+
chunkerVersion
+
retrievalVersion
+
knowledgeCompilerVersion
```

This graph belongs to the source/project.

Not to one lesson.

---

# 15. Same source must never be re-understood unnecessarily

Example:

```text
deepseek-paper.pdf
```

First request:

```text
Explain the architecture.
```

Graph created.

Second:

```text
Explain MLA in two minutes.
```

Reuse graph.

Third:

```text
Teach inference optimizations for advanced students.
```

Reuse graph.

Only lesson planning changes.

---

# 16. Teacher Planner

This is one of the most important calls.

It receives:

```text
BaseConceptGraph

optional userPrompt

target duration

audience

language

source metadata
```

and outputs:

```text
LessonGraph
LessonBible
SceneContracts[]
```

Normally:

```text
ONE LLM CALL
```

Do not perform another teacher-planning call independently for every scene.

---

# 17. LessonGraph

```ts
interface LessonGraph {
  title: string;

  lessonGoal: string;

  targetDurationSec: number;

  scenes: SceneContract[];

  continuity: ContinuityPlan;

  endingGoal: string;
}
```

Scene != concept node.

A scene is:

```text
one learner delta
```

or:

```text
one coherent teaching step
```

---

# 18. Teaching style

The Teacher Planner owns the educational progression.

Default pattern:

```text
orientation
   ↓
big-picture mental model
   ↓
core vocabulary
   ↓
main mechanism
   ↓
deeper mechanism
   ↓
example
   ↓
implications / limitations
   ↓
synthesis
```

This changes with duration.

---

# 19. Duration planning

Duration determines depth.

Not speaking speed.

Approximate initial scene density:

| Duration | Typical scenes |
| -------: | -------------: |
|    1 min |             ~2 |
|    2 min |           ~3–4 |
|    5 min |          ~8–10 |
|   10 min |         ~16–20 |

Do not hardcode these as strict values.

Teacher Planner decides based on semantic density.

---

# 20. Title behaviour

Generate a direct subject title.

Example source:

```text
DeepSeek B4 Flash Architecture Review
```

Good:

```text
DeepSeek B4 Flash Architecture
```

Bad default:

```text
Why Is DeepSeek B4 Flash So Crazy Fast?
```

unless the user explicitly asks for that style.

Pedagogical questions belong inside the lesson.

---

# 21. LessonBible

One object owns cross-scene consistency.

```ts
interface LessonBible {
  terminology: Record<string, string>;

  conceptIdentity: Record<string, ConceptIdentity>;

  visualIdentity: Record<string, VisualIdentity>;

  pronunciationDictionary: Record<string, string>;

  analogies: Record<string, Analogy>;

  voiceProfile: VoiceProfile;

  narrativeStyle: NarrativeStyle;

  persistentObjects: string[];

  introducedConcepts: Record<string, number>;
}
```

This replaces pairwise improvisation as the main semantic source of truth.

---

# 22. Scene-specific retrieval

Every SceneContract gets its own tiny evidence package.

Query using:

```text
learning delta
concept IDs
mechanism IDs
required relations
```

Retrieve approximately:

```text
5–10 best chunks
```

Scene Worker does NOT receive the entire PDF.

---

# 23. Scene Worker

One call should decide both:

```text
narration
+
semantic visual intent
```

Do NOT use:

```text
narration agent
visual agent
layout agent
animation agent
critic agent
```

for every scene.

That recreates the exact call explosion we are removing.

---

# 24. Scene Worker contract

Input:

```text
SceneContract

LessonBible

relevant ConceptGraph subset

5–10 evidence chunks

allowed representation candidates
```

Output:

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

Still no coordinates.

---

# 25. Scene batching

We should not make 20 network requests for a 20-scene lesson.

Use:

```text
Scene 1
```

alone when latency matters.

Then batch:

```text
Scenes 2–4
Scenes 5–7
Scenes 8–10
...
```

Each batch returns:

```text
SceneIntent[]
```

Individual scenes remain independent artifacts.

---

# 26. Scene generation concurrency

After Teacher Planner returns:

```text
Scene 1        ─────────→ high priority

Scenes 2–4    ─────────→ parallel
Scenes 5–7    ─────────→ parallel
Scenes 8–10   ─────────→ parallel
```

Do not wait for Scene 2 before reasoning about Scene 5.

LessonBible contains the semantic continuity.

---

# 27. First-playable scheduling

First AV is more important than full-video preparation.

Schedule:

```text
Teacher Planner
       ↓
Scene 1 Worker
       ↓
Scene 1 TTS
       ↓
Scene 1 compile
       ↓
PLAY
```

Meanwhile:

```text
later scene workers
+
later TTS
+
later compile
```

continue.

---

# 28. Representation Guide

Keep it deterministic.

It receives:

```text
concept
semantic role
required parts
required states
required anchors
scene archetype
```

and selects:

```text
trusted asset
composition
template
primitive
synthesis
abstraction
```

No LLM API call.

Therefore:

```text
representation-guide/SKILL.md
```

should NOT be loaded into a runtime model.

Its invariants belong in:

```text
types
resolver logic
validators
tests
```

---

# 29. Whiteboard Planner

Same decision.

It is deterministic.

Rules such as:

```text
preserve hero
do not re-add persistent objects
remove only intentional concepts
maintain canvas continuity
```

belong in code.

Do not spend tokens sending a whiteboard-planner skill to some unrelated model.

---

# 30. Pedagogy Critic

If pedagogy-critic remains deterministic:

```text
critical claim coverage
prerequisite order
terminology-before-use
learner delta coverage
```

must remain code gates.

No runtime skill prompt.

If someday a real LLM critic is introduced, it can get its own skill then.

Not now.

---

# 31. Final runtime skill system

Keep only skills that instruct actual semantic model decisions.

Runtime:

```text
knowledge-compiler

teacher-planner
(existing teaching-architect can evolve into this)

scene-director
(existing visual-director can evolve into this)

vision-extractor
only if/when VLM extraction is active
```

That is approximately:

```text
3–4 runtime skills
```

not 13.

---

# 32. What to do with current teaching-architect

Do not necessarily rename files immediately.

During migration:

```text
teaching-architect
```

can become the implementation of:

```text
TeacherPlanner
```

internally.

After stabilization, naming can be cleaned up.

Avoid unnecessary rename churn now.

---

# 33. Knowledge compiler skill

Currently knowledge-compiler instructions live as a reference document under teaching-architect.

Promote the hard invariants conceptually into a proper knowledge-stage skill.

Important invariants might include:

```text
every factual claim must reference evidence

do not invent concepts absent from evidence

preserve quantities exactly

preserve mechanism direction

distinguish source claims from pedagogical interpretation

canonicalize aliases without changing meaning
```

Keep hard invariants compact.

---

# 34. Reference documents

Do NOT start injecting all 19 unused reference files into prompts.

That would:

```text
increase prefill
increase cost
increase latency
increase conflicting instructions
```

If a reference contains a true runtime invariant:

```text
promote that invariant into ≤10 hard lines
```

or:

```text
encode it as code/test
```

Otherwise keep it as developer documentation.

---

# 35. Process skills

These should not be runtime prompt skills:

```text
eval-audit
eval-builder
skill-writer
canvas
prompt-builder
video-generation
```

Move/classify them as:

```text
development/process documentation
```

They should not increase user-generation token cost.

---

# 36. Multilingual skill

Keep disabled until multilingual runtime is deliberately activated.

If language handling becomes part of Teacher Planner:

```text
language
terminology
pronunciation
```

can be handled by TeacherPlanner + VoiceProfile.

No separate agent is inherently required.

---

# 37. Speech architecture

Speech must sound like one teacher.

Define once per lesson:

```ts
interface VoiceProfile {
  engine: string;

  voiceId: string;

  language: string;

  speakingRate: number;

  pronunciationDictionary: Record<string, string>;

  sentenceStyle: string;

  pausePolicy: string;
}
```

Every scene receives the same profile.

---

# 38. TTS call strategy

Do NOT call TTS per word.

Avoid TTS per micro-beat.

Prefer:

```text
one narration
→ one TTS render
→ one audio asset
```

per scene.

Then:

```text
audio
→ word/sentence alignment
→ timeline
```

---

# 39. Local TTS

Keep:

```text
Supertonic 3 primary
Piper fallback
```

until benchmarking proves something else is materially better.

The biggest immediate optimizations are:

```text
keep TTS process warm

keep model loaded

do not spawn model per scene

cache generated speech

avoid micro-call overhead
```

---

# 40. TTS concurrency

Local TTS is CPU-bound.

Default initially:

```text
Scene 1 = priority
later scenes = queued
```

Then test bounded concurrency:

```text
1 worker
vs
2 workers
```

Do not assume more concurrent workers are faster.

---

# 41. TTS cache

Cache key:

```text
ttsModelVersion
+
voiceId
+
language
+
speakingRate
+
pronunciationDictionaryHash
+
narrationTextHash
```

If narration does not change:

```text
never regenerate speech
```

---

# 42. Pronunciation consistency

LessonBible should freeze pronunciations for technical terms.

Example:

```text
MLA
MoE
KV-cache
Qwen
DeepSeek
CUDA
```

Scene 7 should pronounce a term exactly as Scene 1 did.

---

# 43. Audio normalization

All scenes should use the same:

```text
sample rate
channel layout
loudness target
codec settings
```

For final video, use one consistent audio mastering pipeline.

No scene-specific volume differences.

---

# 44. Compiler

Preserve existing architecture.

Input:

```text
SceneIntent
+
representation
+
previous geometry state
```

Output:

```text
CompiledSceneV2
```

Compiler owns:

```text
x/y
width/height
labels
anchors
routing
timeline
z-index
collision resolution
```

---

# 45. Geometry continuity

Semantic reasoning should be parallel.

Cheap compilation may stay sequential if required:

```text
compile scene 1
      ↓
geometry state
      ↓
compile scene 2
      ↓
compile scene 3
```

This is fine.

Do not serialize expensive LLM work because cheap geometry depends on the previous scene.

---

# 46. Renderer

Keep:

```text
renderSVG(scene, timeMs)
```

pure.

No:

```text
network
model
filesystem
database
randomness
wall clock
```

---

# 47. Interactive playback

Do not require final MP4 export before the learner can watch.

Once:

```text
Scene 1
+
audio
+
compiled timeline
```

exist, playback can begin.

Final export is a separate downstream operation.

---

# 48. Final video export

Default production profile:

```text
1920×1080
30fps
H.264
yuv420p
AAC audio
48kHz
```

Exact FFmpeg compression parameters should be benchmarked for quality/size.

Do not couple first-playable latency to full MP4 completion.

---

# 49. Export scheduling

Once scenes are compiled:

```text
scene render A
scene render B
scene render C
```

can be processed with bounded concurrency where safe.

Then:

```text
concat
+
audio mux
```

Final export.

No LLM call.

---

# 50. Caching hierarchy

## Source cache

```text
SourceDocument
semantic chunks
BM25 index
embeddings
figure metadata
table metadata
BaseConceptGraph
EvidenceIndex
```

## Lesson cache

```text
FocusedConceptGraph
LessonGraph
LessonBible
SceneContracts
```

## Scene cache

```text
retrieved evidence
SceneIntent
narration
TTS audio
CompiledScene
```

## Render cache

```text
optional scene frames/video segments
final export
```

---

# 51. Cache only validated artifacts

Never cache merely because a model responded.

Cache after:

```text
schema pass
+
semantic gate pass
```

Semantic-repaired artifacts should be explicitly marked.

Prefer not to promote unreliable outputs into durable reusable source knowledge.

---

# 52. Prompt caching

Keep model prompt prefixes byte-stable.

For each LLM stage:

```text
SYSTEM
SKILL HARD INVARIANTS
JSON SCHEMA
STATIC POLICY
──────── CACHE BOUNDARY ────────
dynamic graph/evidence/request
```

Do not randomly reorder instructions.

---

# 53. OpenRouter session routing

Use stable session IDs where prompt-cache reuse materially helps.

Conceptually:

```text
source:<sourceHash>
lesson:<lessonHash>
```

Provider routing should preserve cached prefixes where possible.

---

# 54. Model routing

Initial production routing:

| Stage                | Default          | Fallback              |
| -------------------- | ---------------- | --------------------- |
| Vision extraction    | Gemini 3.8 Flash | Claude Haiku 4.5      |
| Knowledge map        | GPT-5.6 Luna     | Gemini 3.8 Flash      |
| Graph reduce         | GPT-5.6 Luna     | Gemini 3.8 Flash      |
| Teacher Planner      | GPT-5.6 Luna     | Claude Haiku 4.5      |
| Scene 1              | GPT-5.6 Luna     | Claude Haiku 4.5      |
| Later scene batches  | GPT-5.6 Luna     | benchmark Qwen3.5-27B |
| Hard semantic rescue | Claude Sonnet 5  | none                  |

Do not deploy Qwen as default until measured.

---

# 55. Provider routing

For schema-critical stages, prioritize reliability.

Start with:

```text
Balanced
```

or accuracy-oriented routing.

Do not automatically use the absolute fastest provider.

After benchmarks:

```text
Scene Workers
```

may use lower-latency routing if structured-output pass rates remain acceptable.

---

# 56. Failure routing

Distinguish:

```text
provider failure
```

from:

```text
semantic failure
```

Provider timeout:

```text
same model
→ another healthy provider
```

Semantic gate failure:

```text
different/stronger model
```

Do not pay Sonnet prices because one hosting endpoint timed out.

---

# 57. Hallucination prevention — Knowledge stage

Every source claim requires:

```text
evidenceRefs[]
```

ConceptGraph cannot contain an unsupported factual claim.

Missing evidence:

```text
reject
```

not:

```text
guess
```

---

# 58. Hallucination prevention — Teacher Planner

Teacher can:

```text
sequence
simplify
select
cluster
create pedagogical analogy
```

Teacher cannot:

```text
invent factual source claims
invent unsupported mechanisms
change numbers
change causal direction
```

Analogies must be explicitly marked:

```text
pedagogicalAnalogy
```

so they never become source facts.

---

# 59. Hallucination prevention — Scene Worker

Pass closed-world lists:

```text
allowedConceptIds
allowedRelationIds/types
allowedEvidenceRefs
allowedRepresentationCandidates
```

Unknown critical concept:

```text
hard validation failure
```

not a new invented object.

---

# 60. Hallucination prevention — Representation

Scene Worker never invents:

```text
asset filenames
SVG IDs
coordinates
external URLs
```

Representation Resolver owns those.

---

# 61. One repair maximum

Keep existing principle:

```text
one semantic repair
```

per model stage.

Never create:

```text
retry until it works
```

That multiplies both latency and cost.

---

# 62. API-call budget

## Cached source

For 1–2 scenes:

```text
1 Teacher Planner
+
1 Scene batch

≈ 2 normal LLM calls
```

For 4 scenes:

```text
1 Teacher
+
1 Scene 1
+
1 batch scenes 2–4

≈ 3 calls
```

For ~9 scenes:

```text
1 Teacher
+
1 Scene 1
+
3 later batches

≈ 5 calls
```

For ~18 scenes:

```text
1 Teacher
+
1 Scene 1
+
6 later batches

≈ 8 calls
```

This excludes failures.

---

# 63. New-source call budget

Add:

```text
GraphMapCount
+
1 graph reducer
```

plus VLM calls only for pages/figures that genuinely require vision.

Typical target:

```text
small source:
1 map + 1 reduce

medium:
2–4 parallel map + 1 reduce

large:
4–8 parallel map + 1 reduce
```

These are source-level costs, not video-level costs.

---

# 64. Do not use one graph call per chunk

This is prohibited.

If a 200-page PDF produces 150 semantic chunks, that does NOT mean:

```text
150 LLM calls
```

Batch related chunks.

---

# 65. Fast execution schedule

New source:

```text
ingest
 ├ text extraction
 ├ figure extraction
 ├ table extraction
 └ chunking
       │
       ├ index building
       ├ embeddings
       └ graph-map preparation
              │
         parallel graph maps
              │
          graph reducer
              │
         Teacher Planner
              │
         Scene 1 immediately
              │
              ├ TTS
              └ compile
              │
             PLAY

Meanwhile:
later scene batches
→ TTS
→ compile
```

---

# 66. Latency objectives

These are engineering targets, not promises.

For a warm system and cached source:

```text
first AV P50:
~8–15 seconds
```

For a new text-heavy source:

```text
~15–25 seconds
```

For a complex multimodal PDF:

```text
~20–40 seconds
```

depending on source complexity and vision work.

Do not measure success solely by total MP4 completion.

Primary latency metrics:

```text
sourceReady
graphReady
lessonReady
scene1IntentReady
scene1AudioReady
firstAVPlayable
fullLessonPrepared
finalExportReady
```

---

# 67. Current-vs-target cost principle

Current architecture has repeated semantic work.

Target architecture amortizes:

```text
source understanding
```

across many lessons.

The primary runtime cost becomes:

```text
one Teacher Planner
+
small Scene batches
```

instead of re-understanding the source and re-planning teaching repeatedly.

---

# 68. No unnecessary APIs

Do not call a model for something code already knows.

Examples:

```text
chunking → code

BM25 → code

embedding → embedding model

reranking → local/small reranker

representation lookup → code

layout → code

collision repair → code

timeline → code

export → code
```

LLMs only make semantic decisions.

---

# 69. Migration rule

Do NOT replace current V2 in one commit.

Implement alongside existing front end.

Compare:

```text
CURRENT FRONT END
vs
NEW FRONT END
```

feeding the same compiler/renderer.

Only migrate when:

```text
semantic quality >= existing

critical coverage = 100%

latency lower

API calls lower

cost lower

scene consistency improved
```

---

# 70. Runtime skill cleanup

Final desired classification:

```text
RUNTIME MODEL SKILLS
--------------------
knowledge-compiler
teacher-planner
scene-director
vision-extractor (conditional)


DETERMINISTIC INVARIANTS
------------------------
whiteboard-planner
representation-guide
pedagogy-critic


DEVELOPMENT / PROCESS DOCS
--------------------------
prompt-builder
canvas
video-generation
eval-audit
eval-builder
skill-writer


DEFERRED FEATURE POLICY
-----------------------
multilingual-teacher
pdf-extraction
```

`pdf-extraction` should eventually become implementation documentation/tests around ingestion, not a prompt skill.

---

# 71. Main thing NOT to do

Do not solve the skill audit by saying:

```text
"load all 13 skills into every prompt"
```

That would make the architecture slower, more expensive, and harder for the model to follow.

The correct fix is:

```text
model policy → tiny skill

deterministic policy → code + tests

engineering process → docs
```

---

# 72. Final definition of success

For one PDF:

```text
parse once
index once
understand once
build ConceptGraph once
cache once
```

For each new lesson:

```text
plan teaching once
generate scenes in small parallel batches
speak consistently
compile deterministically
start playback early
export independently
```

That is the production architecture.

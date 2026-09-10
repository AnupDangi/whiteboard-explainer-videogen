# Source Intelligence Plan — large-document support (LD1–LD8)

> Status 2026-09-10 (end of batched session): **LD1–LD7 implemented and committed**
> (suite 118 tests, 116 pass, 0 fail, 2 skip). **LD8 (live validation) pending** — needs a
> real multi-hundred-page PDF from the user plus paid keys. Implementation notes beyond this
> plan: chunk ids are `p{page}:c{n}` (per-page index; the `s{section}` component was dropped
> so ids stay stable under section re-routing); retrieval chunk granularity is configurable
> via opts.maxChars; straddling section-boundary chunks are excluded from both sections by
> full-containment scoping. See `docs/RESULTS.md` 2026-09-10 entries for exact tests.

> Status: approved 2026-09-10, not yet implemented. Primary goal per user decision:
> **large-document support** (P0). This plan supersedes the generic P0–P5 ordering in
> `docs/OPTIMIZATION_PLAN.md` for the source/retrieval layer; Phase C–H there remain
> valid for representation/geometry work and are NOT duplicated here.

## Grounded limitations this plan fixes (verified in code 2026-09-10)

| # | Limitation | Evidence | Impact |
|---|---|---|---|
| L1 | PDF extracts **first 15 pages only** | `sources.ts:14` `PAGE_LIMIT=15` | 900-page book → 15 pages. Hardest cap. |
| L2 | Tail truncation at 3 layers | `sources.ts:13` 200k clip · `prompt-builder.ts:18` 60k · `planner.ts:42` outline sees 120k | Even ≤200k docs lose the tail before outline runs. |
| L3 | Retrieval lexical-only, fixed 8k/chapter | `planner.ts:50-62` `retrieveForChapter`, `CHAPTER_SOURCE_LIMIT=8000` | Synonym miss: objective "representational collapse" never matches source phrase "loss of feature diversity". No BM25/embeddings/rerank. |
| L4 | No evidence IDs / claim provenance / grounded validator | content schema keyed to `keyPoint` only (`planner.ts` contentShape) | Grounding rated 3/10 in review. Confident-storyteller risk. |
| L5 | Output tokens hardcoded | `planner.ts:451` content `9000`, `:483` director `5000` | Not scaled with duration/scene count; not budget-managed. |
| L6 | Figure VLM calls serial | `figures.ts:149` for-loop, ≤4 | Bounded parallel win, deferred (see Next). |
| L7 | Prompt source-of-truth duplicated | inline prompts `planner.ts` + `skills/*.md` + `schema.ts` | Drift risk; deferred (see Next). |
| L8 | Eval not wired to routing | judge live-unexercised; no cost/success metrics | Deferred (see Next). |
| L9 | Director called on 100% of scenes | `planner.ts:474-508` | ~8s/chapter even for deterministic layouts. Deferred (see Next). |

## Premises that are ALREADY true (do not re-implement)

- Chapter generation is concurrent: `semaphore(Math.min(durationMinutes,5))` (`planner.ts:415-416`).
- Scenes within a chapter are concurrent ≤3, committed in order (`jobs.ts:131-183`).
- Kokoro TTS speculatively overlaps the Visual Director call (`jobs.ts:89-98`).
- Audio-as-master-clock partially exists: `beats[]`, beat-local anchor resolution, Kokoro native `pred_dur` word timings (V3-2).
- Renderer is deterministic and fast: 4.5s / 768 frames. Export optimization is LOW ROI now.

## Constraint guardrails (unchanged, from AGENTS.md)

1. `renderSVG(scene, timeMs)` stays deterministic; browser and export share it.
2. Models produce **validated scene data**; no arbitrary generated code execution, no Manim.
3. Core test suite runs with **no provider keys and no new installed dependencies**. Embeddings are key-gated with a deterministic BM25-only fallback.
4. Provider failures stay visible: an embedding-endpoint failure logs `source.embed-failed`, degrades to BM25-only, and stamps the ledger `retrievalMode: "bm25"|"hybrid"`. Never a silent fake success.
5. Estimated timing and injected delays stay visibly labeled; fixture throughput is never reported as LLM/TTS performance.
6. A passing local experiment establishes feasibility of OUR implementation only.
7. Keys in `.env`, media/job data in `.data/`, exports in `output/` (git-ignored).

## Architecture target

```
PDF/book (any length, ≤50MB)
  ↓ pdftotext -raw, page-delimited by \f        [LD1]
Page-tagged full text (no 15-page cap)
  ↓ heading/TOC detection → document map        [LD2]
Map: title · section tree · page ranges · extractive summaries · figure digest
  (cached by source sha256 under .data/)
  ↓ outline call sees the MAP, not raw text     [LD5]
Outline → selects relevant sections per chapter
  ↓ chunking (structural, stable IDs)           [LD3]
chunks p{page}:s{section}:c{n}
  ↓ BM25 (zero-dep, always on)  +  embeddings (key-gated, cached)
  ↓ Reciprocal Rank Fusion                      [LD4]
per-chapter evidence set (computed budget, not fixed 8k)
  ↓ content calls + evidenceIds on nodes        [LD6]
grounding validator flags unsupported claims → existing repair loop
  ↓ deterministic renderer (unchanged)
```

Key principle: **do not build a bigger prompt; build a system that knows what deserves to enter the prompt.** Long model context stays a hard safety cap, never the retrieval strategy.

---

## LD1 — Full-document, page-aware extraction

Files: `src/sources.ts`, `test/` (new extraction test).

- Remove `PAGE_LIMIT=15` (`sources.ts:14`). `pdftotext` already emits form-feed (`\f`)
  between pages — parse it to produce a page-tagged document instead of a flat string.
- Extend `SourceDocument` with page boundaries (e.g. `pages: {start:number; end:number; charStart:number; charEnd:number}[]`) or a page-index array; downstream consumers keep working off `text`.
- Raise `TEXT_LIMIT` (`sources.ts:13`) from 200k to a book-scale cap (~5M chars ≈ 1000 pages) with a memory guard; raise the 2MB `maxBuffer` on the `pdftotext` exec (`sources.ts:41`) to accommodate full output.
- Keep `stripAcademicTail` but gate it: apply only to paper-like docs (short docs with a References heading in the final quarter). A book's appendix chapters must survive.
- **Acceptance:** synthetic multi-page PDF (>15 pages, generated in-test like the existing sips-generated PDF in `test/figures.test.js`) → all pages extracted, page boundaries correct; `npm test` green.

## LD2 — Document map (hierarchical index)

Files: new `src/document-map.ts`; wired in `src/jobs.ts` after ingest.

- Build from heading lines (numbered sections like `3.2 Methods`; reuse the
  `extractHeadings` heuristic from `prompt-builder.ts:47`) over page-tagged text.
  Fallback when structure is missing: fixed-size page windows.
- Each section: `id`, `title`, `pageStart/pageEnd`, `charStart/charEnd`, `summary`
  (extractive: first 1-2 sentences + number-bearing sentences via `extractFacts` — deterministic, zero-cost, no LLM), `charCount`.
- Output shape (consumed by LD5):

```
{ title, kind: "book"|"paper"|"unknown", sections: [...], figures: [...digest...] }
```

- Cache by source `sha256` in `.data/` (source.json already stores sha256 at `sources.ts:106`).
- Optional LLM section summaries: explicitly NOT in this program (cost/latency; extractive is sufficient for section routing). Revisit only if live routing fails.
- **Acceptance:** synthetic book fixture → ordered section tree with correct page ranges; second ingest is a cache hit; zero model calls in the unit test.

## LD3 — Structural chunking + BM25

Files: new `src/retrieval.ts`; replaces `retrieveForChapter` call site in `planner.ts:429` (keep `retrieveForChapter` as the deterministic fallback for tiny/structureless sources).

- Chunk sections on paragraph boundaries, target ~1-2k chars with one-paragraph overlap; every chunk carries a stable ID `p{page}:s{section}:c{n}`.
- Zero-dependency BM25 (pure TS, deterministic) over chunks; IDF computed per document.
- Keep original document order when assembling the per-chapter evidence set (same property the current lexical scorer preserves at `planner.ts:61`).
- **Acceptance:** unit test ranks an on-topic chunk above filler; chunk IDs stable across runs; tiny-source pass-through preserved (existing retrieval test in `test/validators.test.js` stays green).

## LD4 — Embeddings + hybrid fusion (key-gated)

Files: `src/retrieval.ts`; `.env.example` gains `OPENROUTER_EMBED_MODEL` (optional).

- Embedding via OpenRouter embeddings endpoint; default model a cheap `text-embedding-*`
  class (~$0.01-0.02 per 1M tokens → full 1000-page book ≈ $0.01-0.05, one-time, cached).
- Vectors cached in `.data/<sha256>/index.json` next to the map; brute-force cosine over
  chunks (no vector DB — a few thousand chunks is fine in-memory).
- **Reciprocal Rank Fusion** of BM25 rank + cosine rank (k=60 standard); optional rerank of top-K is NOT in this program unless live grounding proves weak.
- No key, or provider error → log `source.embed-failed`, continue BM25-only, stamp ledger `retrievalMode:"bm25"`. Embedding cost is recorded in the ledger like every other call.
- Core suite stays key-free: all embedding paths are mock-fetcher tested.
- **Acceptance:** RRF fusion ordering test (mock embeddings); fallback test proves BM25-only + visible log + correct `retrievalMode`; `npm test` passes with no env keys.

## LD5 — Map-driven planning

Files: `src/planner.ts` (outline + chapter source assembly), `src/jobs.ts`.

- Outline call no longer ingests 120k raw chars (`planner.ts:42` `OUTLINE_CONTEXT_LIMIT`,
  `:385` `outlineSource`). It receives: document title + kind, the section map (titles +
  summaries + page ranges), figure digest, user question/objective, requested duration.
- Outline schema gains one required output per chapter: `sourceSections: string[]` (section
  ids this chapter teaches from). Validation: ids must exist in the map.
- Chapter content calls retrieve **only from the selected sections** (BM25/hybrid within that subset). `CHAPTER_SOURCE_LIMIT` becomes a computed budget (e.g. scales with doc size and duration) instead of fixed 8000.
- Backward compatibility: docs below a small threshold (say <60k chars) keep today's behavior — full text to outline, direct retrieval — so the proven 1-min paper path is unchanged.
- **Acceptance:** mock outline receives the map (not raw text) on a large fixture; chapter retrieval pulls from routed sections; existing 1-min paper-path tests unchanged.

## LD6 — Evidence IDs + grounding validator

Files: `src/schema.ts` (contentSchema), `src/planner.ts` (validators + repair loop), `src/engine.ts` (whitelist passthrough if evidenceIds lives on nodes).

- Retrieved chunk IDs ride into content calls; `contentShape` gains `evidenceIds: string[]`
  (1-4 chunk ids) per node or per beat.
- New deterministic validator `checkGrounding(scenes, chunkIndex)`: for each node with
  `evidenceIds`, require ≥N content-word overlap between the node's label/keyPoint/narration
  span and the referenced chunks; nodes citing chunks that don't exist fail loudly.
- Unsupported-claim findings are thrown into the existing content repair loop (same pattern as `checkQuantities`/`checkKeyPoints` at `planner.ts:458`) — no new agent stage.
- This gives the first mechanical faithfulness metric; the Level-C judge can later score
  grounding per claim instead of per video.
- **Acceptance:** node citing a real chunk with overlapping content passes; node citing a nonexistent chunk or unrelated chunk fails and repair loop receives the message.

## LD7 — Budget manager

Files: new `src/budgets.ts`; call sites `planner.ts:451,483` and retrieval assembly.

- Split the blended heuristic into five functions:

```
getInputBudget(sourceSize, task)          // context chars per call
getRetrievalBudget(docTokens, complexity) // evidence chars per chapter
getOutputBudget(durationMinutes, sceneCount, task) // max_tokens per call
getCostBudget(...)                        // existing maxCostUsd reservation math
getLatencyBudget(...)                     // per-stage timeout ceilings
```

- Output tokens scale with `durationMinutes` × scenes (a 5-min chapter needs more than a
  1-min chapter; a 1000-page source must NOT raise output budgets).
- Model context window remains only a hard safety clamp (`min(default, modelCtx − estimatedPromptTokens)`).
- **Acceptance:** unit tests prove each budget scales with its own input and NOT with the others (source size does not raise output budget; duration does not raise retrieval budget).

## LD8 — Live validation ($0.15-0.40 per run)

- One real multi-hundred-page document (user supplies; e.g. a textbook PDF), 1-min video,
  paid path (OpenRouter + Kokoro). Expected cost: outline over the MAP is cheap; embeddings
  one-time ~$0.01-0.05; total within budget.
- Record in `docs/RESULTS.md`: retrieval mode, section-routing correctness (human check),
  grounding pass rate, page coverage (proves >15 pages used), cost, wall time, repair count.
- Honest claims only: this establishes OUR implementation's feasibility on large docs, not
  anything about Lamina Labs.

---

## Explicitly out of scope for this program (Next, in value order)

1. **Deterministic layout compiler (L9)** — compile `compare/flow/hierarchy/timeline/branch/radial` from `visualIntent` without the Visual Director; target 70-85% of scenes director-free. Biggest remaining latency lever (first-playable ~14-30s is planning-bound).
2. **Parallel figure VLM + adaptive provider concurrency (L6)** — `Promise.allSettled` + semaphore over `describeFigures`; backoff on 429/503/p95.
3. **Machine-readable canvas contract (L7)** — `canvas-contract.ts` as single source of truth; prompts + `skills/*.md` generated/tested against it.
4. **Eval/router (L8)** — per-call traces (TTFT, tokens, finish_reason, repair_count, cost), cost/success table, judge exercised live, Gemini-vs-Qwen A/B (50 content + 50 director calls) before any production traffic flip.

## Anti-goals (do NOT do)

- Do not scale output tokens with source size.
- Do not treat a 1M-token context window as the retrieval strategy.
- Do not add a vector database dependency at this scale.
- Do not run the expensive VLM judge on every production generation (offline eval only).
- Do not turn an embedding-provider failure into a silently degraded-but-claimed success.

## Session protocol (per AGENTS.md)

- `npm test` before editing; suite must stay green (currently 93 tests, 91 pass, 2 live-skip).
- Work on `opt-v3-harness` branch; commit per LD phase; update `docs/HANDOFF.md` and
  `docs/RESULTS.md` at each material boundary with exact tests and limitations.
- First bounded task: **LD1** (extraction). Do not start LD2 in the same session without
  re-reading this plan's dependency notes.

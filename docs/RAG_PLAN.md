# RAG / Retrieval Plan — reading of the target and the gap

Status: planning only. Nothing here is implemented beyond what §2 records as already
landed. Authority: root `PLAN_TO_IMPLEMENT.md` §9–10, §26 and `Architecture_plan.md`
§8–10, §22. Never edit those two files.

## 1. What the target retrieval architecture is

```text
chunks
  ├── BM25
  ├── vector embedding
  ├── section metadata
  └── entity/concept metadata

query → hybrid retrieve ~75–100 → reranker → top ~25
```

Two retrieval sets, not one:

- **Coverage Set** — guarantees representation from each major source section
  (intro, architecture, method, experiments, limitations, conclusion, …), so focus
  never deletes important context.
- **Focus Set** — hybrid retrieval + reranking over `userPrompt`, source title and
  the learning objective.

`GraphContext = CoverageSet ∪ FocusSet`. With no `userPrompt`, focus intent is derived
from title/abstract/headings/high-centrality concepts/conclusion — teach the source's
intellectual structure, do not summarise every paragraph.

Retrieval is also **scene-specific** (`PLAN_TO_IMPLEMENT.md` §26, `Architecture_plan.md`
§22): each Scene Worker retrieves ~9–12 chunks around its own teaching goal and the
previous scene's continuity, rather than receiving one global blob.

Determinism rule: retrieval is deterministic code (BM25, RRF fusion, section scoping).
Embeddings are an injected, key-gated, fail-soft input; without a key retrieval is
BM25-only and that mode is logged, never silently substituted.

## 2. What is already landed on `v4-optimization`

| piece | where |
|---|---|
| zero-dep BM25 + RRF fusion (injected vectors) | `src/semantic/retrieval/bm25.ts` |
| CoverageSet / FocusSet / graphContext union | `src/semantic/retrieval/sets.ts` |
| semantic chunker (~1000 tok target, heading-scoped, indivisible code/table/figure) | `src/semantic/source/chunker.ts` |
| source-tier cache over keys/store | `src/semantic/source/cache.ts`, `src/semantic/cache/` |
| parallel graph maps → BaseConceptGraph reducer | `src/semantic/knowledge/` |
| `embedTexts` (key-gated, fail-soft) on the single network module | `src/semantic/planning/model-adapter.ts` |

Honest gaps carried in the handoff: no reranker beyond BM25/RRF; embeddings are
untested against a real provider; PDF figure/table structural extraction is partial;
retrieval is not yet wired into scene generation.

## 3. Phased plan (proposed, not started)

- **R1 — typed blocks end to end.** Ensure `SourceBlock[]` (heading/text/figure/table/
  equation/code) reaches the chunker for every ingest path; keep figures/tables whole.
  Gate: chunk ids stable and reproducible from the same source hash.
- **R2 — hybrid index + fusion.** BM25 ∥ embeddings → RRF; embeddings failure leaves a
  logged BM25-only mode. Gate: RRF retrieves a synonym-only chunk BM25 misses
  (existing `test/hybrid-retrieval.test.js` semantics ported).
- **R3 — reranker.** Deterministic reranker over the fused top ~100 → Focus top ~25
  (local model or a lexical/cross-encoder; no generative tokens). Gate: Focus ranking
  beats BM25 order on a labelled fixture.
- **R4 — Coverage Set.** One coverage slice per top-level section, sized by section
  weight; `GraphContext = Coverage ∪ Focus`. Gate: a held-out section is never
  silently dropped when the prompt focuses elsewhere.
- **R5 — scene-specific retrieval.** Scene Worker query = teaching goal + continuity +
  previous scene labels; returns ~9–12 chunks. Gate: per-scene evidence readout is
  logged and disjoint from other scenes where the goals differ.
- **R6 — cache keying.** Cache retrieval artifacts on `sourceHash + chunkerVersion +
  retrievalVersion + queryHash`; only validated artifacts may be written. Gate:
  first run N retrievals, replay 0, offline render identical.

## 4. Metrics

`retrievalMode` (bm25 | hybrid), `focusRecall` on labelled cases, `coverageSectionsHit`,
`sceneEvidenceOverlap` between adjacent scenes, `retrievalLatencyMs`, and the
representation resolution distribution (see `docs/ICON_SYSTEM_PLAN.md` §12).

## 5. Open decisions

1. Reranker: local cross-encoder vs deterministic lexical reranker (cost/latency).
2. Embeddings provider (local vs paid) and whether it is ever required.
3. Whether Coverage Set sizing is section-count or token-budget based.

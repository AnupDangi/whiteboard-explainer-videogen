> Historical (2026-09-11): file paths below predate the 2026-09-13 `src/` restructure (now `src/explainer/`, `src/shared/`, `src/semantic/`).

# Performance, cost and architecture analysis — 2026-09-11

Scope: why a 1-minute video takes 70–90s, where the cost goes, what the architecture
limits are, and the concrete plan to reach Lamina's claimed "about 40 seconds".
All numbers are measured from real paid runs on the 53-page DeepSeek-V3 report
(`.data/<job>/log.jsonl`, `planner.call` ledger events) — not estimates.

## 1. Measured latency (1-min video = 1 chapter = 2 scenes)

| stage | run A (`9886a265`) | run B (`35dddd0d`) | current (`ddf92a9f`) |
|---|---|---|---|
| enrich + figure VLM (parallel, pre-job) | ~4s | ~4s | ~4s |
| ingest + document map (cached) | <1s | <1s | <1s |
| outline | 3.8s | 4.7s | 5.5s |
| content (first attempt) | 27.6s | 23.0s | 24.5s |
| content repairs | 0 | 1 × 21.9s | 2 × 20s |
| director | 21.2s | 18.4s | 19.6s |
| director repair | 20.3s | 0 | 0 |
| TTS (speculative Kokoro) | overlapped | overlapped | overlapped |
| render + mux | ~5s | ~5s | ~5s |
| **wall** | **1:28** | **1:15** | **1:30** |

The critical path is a **serial chain of LLM calls**: `outline → content → [repairs] →
director → render`. For a 1-minute video there is exactly one chapter, so nothing
overlaps. `sum(call ms) ≈ wall ms` in every run — the pipeline is ~100% LLM latency.

**Model generation speed is a hard floor**: ~2,000 output tokens per content call at
~100 tok/s ≈ 20s, and the director is ~1,700 tokens ≈ 18-21s. Reasoning is already capped
at 1,200 tokens (`reasoning:{max_tokens:1200}`).

## 2. Measured cost (per 1-min video)

| call | in tokens | out tokens | cost | share |
|---|---|---|---|---|
| outline | 8.1–9.4k | 320–450 | **$0.0072–0.0084** | **82–89%** |
| content | 6.5k | ~1.9k | $0.0004 | 4–5% |
| content repairs (0–2) | ~9.7k each | ~1.9k | $0.0005 each | ~5% |
| director (+repair) | 3.0k | ~1.7k | $0.00025 | ~3% |
| figure VLM (≤4, parallel) | image | ~600 | ~$0.001 | ~9% |
| Kokoro TTS | — | — | $0 (local) | 0% |
| **total** | | | **~$0.009–0.011** | |

**The outline call is the cost driver, not content** — it ingests the whole document map
(one line per section). Fix applied: `renderMapForOutline` summaries capped to 180 chars
(was 400) → outline input fell 9.4k → 8.1k tokens (~15% cheaper) with no routing loss.
The bigger lever is a **cheaper model for the outline task** (see §5).

## 3. Root causes of the latency gap (vs Lamina's ~40s)

1. **Outline is a separate serial call even for tiny videos.** A 1-min video has one
   chapter; a dedicated planning call costs 4–6s and 82–89% of the money. The plan doc's
   own "≤2 min fast path" (one combined call) is not implemented.
2. **Both scenes are generated in ONE content call** — cannot be parallelised as-is
   (~24s floor). A 2-call scene split would need cross-scene continuity handling.
3. **The Visual Director is a second serial call (~20s)** producing metadata a
   deterministic compiler can produce. The auto-director exists but does not fire on
   chapters with unclassifiable note/directive labels or kind collisions (now partly
   healed: note hints + `deCollideKinds`).
4. **Repair loops dominate variance.** Content must satisfy ~10 hard gates per attempt
   (word budget, key points drawn AND narrated, board text, first visual, beat coverage,
   anchor spread, concept continuity, edge labels, concept budget, grounding, quantities).
   Real first-attempt pass rate is ~30–40%, so 0–3 repairs × ~20s is common. Gates are
   post-hoc reject/retry rather than generation-constrained.
5. **No streaming, no hedging, no speculative execution.** Wall time = completion time;
   nothing is visible until the end.
6. **Director-repair burns 20s on a single enum mistake** (two nodes sharing kind
   `brain`) — now deterministically healed (`deCollideKinds`).

## 4. Architecture assessment

**Sound (keep):** deterministic `renderSVG`; models emit validated scene data; JSON-schema
whitelist validation; browser/export share one renderer; job snapshots with progressive
playback; chapter-level concurrency (5-min+); speculative Kokoro TTS overlapped with the
director; per-call ledger (tokens/finish/cost/ms) already captures everything a router
needs; retrieval (map + BM25 + evidence ids) is well-factored.

**Limits (fix):**
- No short-video fast path (outline merged into content).
- One chapter = two scenes in a single call; no scene-level parallelism.
- Director is serial and LLM-based for compositions deterministic code can do.
- Validation is reject-and-retry, not constrain-and-heal (many heals now added:
  `fillBeats`, `healDanglingEdges`, `deCollideKinds`, `keypoint-healed`,
  `grounding-autofix`, `conceptId-healed`, `addKeyPointBoard`).
- No hedging/speculation; no streaming.
- Model choice is static per task (env vars), not measured/routed.
- Canvas list semantics: key points render as a `bullet` node (now added via
  `addKeyPointBoard` on the closing scene) but the renderer animates the whole list as
  one label — no per-item reveal.
- Text metrics are heuristic (no real font measurement); no tables/equations as real
  graphics (5 domain templates only).

## 5. Model router (proposal, structure-first)

Per-task routing, measured rather than assumed. The ledger already records
`model, promptTokens, completionTokens, costUsd, finishReason, elapsedMs` and the job
result records success/repairs — aggregate those into a table:

| task | candidate tier | why |
|---|---|---|
| outline / map routing | **cheap fast model** | extraction + selection; 82-89% of cost at flash prices — the single largest win |
| content (JSON teaching) | mid model (current gemini-3.8-flash) | instruction-following across ~10 gates |
| director | cheap model (or none) | small metadata output; deterministic compiler first |
| critic | strong vision model | only when `visualCritic` enabled |
| figure describe | cheap vision model | one caption per figure |
| embeddings | cheapest embedding model | already key-gated, BM25 fallback |

Implementation: `src/model-router.ts` with a config (`OPENROUTER_MODEL_MAP` JSON or
per-task env), ledger aggregation (`scripts/router-report`), and a gate: only switch a
task's model when it wins `cost/success` over ≥50 labelled calls. Do not flip production
traffic on anecdote.

**Immediate cost win without a router:** the outline task is a good candidate for a
smaller model today — it is extraction-heavy and its output is only ~350 tokens.

## 6. Parallelism plan (ordered by expected saving)

| # | change | expected saving | risk |
|---|---|---|---|
| 1 | **Auto-director coverage** (note-label hints + kind de-collision — landed; measure coverage) | **−18–21s** | low |
| 2 | **Fast path ≤2 min**: merge outline into the content call (chapterFrame derived from source) | −4–6s, **−$0.007** | medium (prompt rewrite) |
| 3 | **Hedged content attempts**: 2 concurrent attempts, first valid wins | −30–40% of content+repair time | low-medium (2× content cost, ~$0.0005) |
| 4 | **Scene-parallel content** (2 calls with a shared glossary + scene-1 constraint) | content −8–10s | medium (coherence) |
| 5 | **Streaming** (SSE/partial scenes) for first-playable | perceived only | medium |
| 6 | **Batch figure describe + map summaries** already parallel | done | — |

Target after 1+2+3: `outline-container 5s + content/hedge ~15s + director 0s + render 5s`
≈ **25–35s wall**, i.e. at or below Lamina's ~40s claim, at ~$0.002–0.003/cost.

## 7. Key points on the canvas (user request) — implemented

`addKeyPointBoard()` renders the chapter's key points as **one bulleted list node** on the
closing scene (`shape:'bullet'`, label = key points joined by `. `), anchored in the recap
beat, evidence-cited, flagged `auto` (structural). The narration speaks the facts and the
canvas now shows them as list items. Limitation: the list is drawn as one label — per-item
progressive reveal is future work.

## 8. Where we are vs the 40s claim

Measured today: **70–90s** (best 1:15) vs Lamina's own published "about 40 seconds".
The gap is not the renderer (5s) or TTS (free, overlapped) — it is **two serial LLM calls
plus repair loops**. Fixes 1–3 in §6 close most of it; fixes 4–5 close the rest.

## 9. Honest caveats

- Runs are stochastic: content first-attempt pass rate varies 30–60%, so wall time
  varies 70–90s. The heals bound the worst case but do not eliminate retries.
- Lamina's 40s is a vendor claim on unknown hardware/provider mix; we have not reproduced
  it and our numbers describe only this local implementation.
- The 1-min path is the worst case for overlap (one chapter); 5-min+ videos already
  overlap chapters and scale better.

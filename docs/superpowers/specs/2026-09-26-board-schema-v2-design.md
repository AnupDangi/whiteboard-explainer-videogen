# Board Schema v2 + Sketchy Asset Library — Design

Date: 2026-09-26
Status: approved in chat (2026-09-26, "go on start A" / "go on"); awaiting written-spec review
Track: `src/experimental/hypothesis/v1_claude/`

## 1. Goal

Test the hypothesis that a source-grounded, data-driven pipeline can generate 60-second explainer videos at the visual level of the Simi reference frames (`harness/reference/lamina/simi-*.png`), with no topic-specific code. The hypothesis is concluded by the user's eyeball review of five freshly generated videos (see §8).

## 2. Evidence that motivated this design (2026-09-26)

- The only MP4 produced in the 2026-09-26 five-domain test (`mirror-images`) did not use the LLM scene planner. Both S6 calls failed with OpenRouter `404 No endpoints found that satisfy the max price`; both scenes are the deterministic `list_icon` fallback.
- Its frames show grey text boxes, one semantically wrong icon (a water drop for "virtual image"), no arrows, and roughly 60% empty canvas. The Simi frames show one consistent pastel icon style with black outlines, uppercase labels, relation arrows, and 50–70% canvas coverage.
- Root causes:
  1. `claude-scene-spec/v1` exposes 17 primitives, most without a Simi counterpart. `object.concept` is a free string, so unresolvable concepts fall through to rung 4 (grey box).
  2. The current catalog mixes Streamline (1,992) and AssetLab (208) icons of different styles. Ingest collapses fill colours into `main/white/ink` palette roles.
  3. The fallback builds a grid without relations, so it draws no arrows.
  4. v1 asks the model to copy evidence quotes verbatim into every element, which costs output tokens and fails gates.
- S6 uses Anthropic strict `json_schema`, which rejects schemas with too many optional fields (observed 79 → HTTP 400). A smaller schema is also a reliability gain.

## 3. Scope

In scope:

- Phase 0 dead-code cleanup (no behavior change).
- Sketchy-downshift icon family sourced through Assest-Library.
- Board schema v2 for S6, compiled per call with enums.
- Board → existing S7–S11 compile path, Simi composition tokens.
- Deterministic relation-aware fallback.
- Offline tests, deterministic metrics, one paid five-video run, conclusion record.

Out of scope (named so nothing slips in):

- Wiring `parse-engine/` or `rag-engine/` into the hypothesis pipeline (kept untouched; next plan).
- Long-form lessons (5–10 minutes).
- The S5 human word-boundary review and calibration.
- Math, plot, formula, number-line, and token-strip lessons.
- S2/S3 reliability work (current conditional S3 pass rate ≈ 0.53–0.60).

## 4. Phase 0 — cleanup

Delete code that no hypothesis entry point or test reaches (computed by an import-graph walk from every `package.json` script and every `__tests__/*.test.ts`), except the parse/RAG closure.

Delete (≈50 files, ≈7,100 lines):

- `src/server.ts`, `src/runtime/*`, `src/domain/*`, `src/planning/*`, `src/generation/*`, `src/visual/*`
- `src/core/{budgets,concurrency,language,model-router,versions}.ts`
- `src/gateway/{llm-gateway,openrouter-provider,paid-speech-gateway,postgres-budget-ledger}.ts`
- `src/types/{engine,runtime}.ts`
- `public/`, `migrations/`
- `scripts/{domain-smoke,release-corpus,export,postgres-smoke,router-report}.ts`, `scripts/journal.ts`, `scripts/evidence-inventory.mjs`
- The `package.json` scripts that only reference deleted files (`start`, `test:postgres`, `benchmark*`, `export`, `router:report`).

Keep:

- `src/ingest/**`, `src/gateway/rag-gateway.ts`, `src/gateway/budget-ledger.ts`, `src/core/logger.ts`, `src/types/contracts.ts`
- `parse-engine/`, `rag-engine/`, `voice-engine/`, `src/experimental/hypothesis/shared/alignment`

Also in Phase 0:

- Keep the uncommitted S6 model change (`anthropic/claude-haiku-4.5`) and record it as `unmeasured` until the Phase 4 run.
- The in-track v1 generated path (fixtures, example banks v1/v2, math primitives, v1 recipe cards) is not deleted in Phase 0. It is removed in Phase 5 only if v2 is accepted, so rollback stays possible.

Gate: `npm run typecheck:hypothesis` and `npm run test:hypothesis` pass before and after.

## 5. Asset pipeline

### 5.1 Assest-Library (separate repository)

1. Clone `https://github.com/Downshift/sketchy-icons` (MIT) into `asset-lab/assets/inbox/sketchy-downshift` (the HANDOVER already names this step; it is a download and needs explicit user approval at execution time).
2. Bulk-approve only entries whose taxonomy name matches a concept id or alias exactly and whose SVG has both an `ink` layer and a `fill` layer. The existing denylist in `src/acquire.ts` stays enforced. Every refusal writes quarantine, as the library's rules require.
3. Aliases come from `catalog/concepts.seed.json` plus the taxonomy names.
4. `npm run bridge-pipeline` produces a sketchy-only manifest (MIT). `npm run attribution` regenerates attribution.

### 5.2 Hypothesis ingest

Extend `catalog/libraryIngest.ts`:

- Resolve `var(--sk-cN, #hex)` and `var(--sk-ink, #hex)` to their fallback colours.
- Keep each fill region's own colour on the catalog entry (new optional `color` on a fill). The renderer uses it instead of mapping to a palette role. Existing entries without `color` render exactly as before.
- Keep the `ink` layer as strokes, so the existing outline-then-fill reveal works.

Output: `catalog/data/sketchy.json` + `sketchy.emb.bin` + ingest report, via the existing `icons:ingest` and embedding scripts.

### 5.3 Registry and retrieval

- Add a `sketchy` library to `catalog/registry.ts`. Generated lessons enable only `sketchy`. The Streamline and AssetLab catalogs stay on disk for rollback but are not enabled for generated lessons. `catalogVersion()` changes accordingly, which invalidates S6/S7 caches.
- For each narration mention, retrieval returns up to 5 candidates: alias exact match first, then MiniLM embedding rank. Candidates below the mid threshold are dropped before the model sees them. The total candidate set per scene is capped at 40.
- Icon pins (`catalog/iconPins.ts`) keep one icon per concept across the lesson.

## 6. Board schema v2

### 6.1 Model output

```json
{
  "schemaVersion": "claude-board/v2",
  "layout": "flow | fan_out | convergence | list | compare | cycle | hub",
  "nodes": [
    {
      "id": "n1",
      "mention": "<enum: this scene's mention ids>",
      "icon": "<enum: this scene's candidate icon ids | \"label\">",
      "label": "<= 3 words, no markup>",
      "role": "input | process | output | item | attribute"
    }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "relation": "<enum: this scene's relation ids>" }
  ],
  "caption": "<= 6 words, no markup> | null"
}
```

- 2–7 nodes, 0–8 edges. `caption` is required and nullable. No other optional field exists.
- Every enum is built in code, per call, from that scene's own data: S4 mention ids, retrieval candidates, and S2 graph relations that involve the scene's concepts. No topic data exists in code.
- `id` values are `n1..n7` (enum), so edges can only reference declared node slots; a post-check confirms the referenced node exists.

### 6.2 Fields the model no longer writes

- Title: code uses the S3 section `displayText`.
- Anchors: each node reveals at its mention's measured start time. Edges keep the existing S9 rule (drawn after the source, before the target).
- Evidence: code derives node evidence from mention → concept → concept evidence, and edge evidence from the graph relation's evidence.
- Coordinates, sizes, colours, primitives: all code-owned.

### 6.3 Post-parse checks (one repair, then hard failure)

- `icon` is `"label"` or a candidate for that node's own mention.
- Each mention appears in at most one node.
- Each edge's `from`/`to` nodes exist, and the edge direction matches the relation's `fromConceptId`/`toConceptId` through the nodes' mention concepts.
- A node whose mention concept is persistent uses the canonical terminology term as its label.
- `label` words come from the mention phrase or the concept label (case-insensitive).
- `caption` words come from this scene's narration plain text.
- No markup (`<`, `>`) in any string.

### 6.4 Prompt

- New S6 prompt `board-v1`: role, the schema, Simi composition guidance (one icon per concept, arrows follow cause/flow, prefer icons over labels when a candidate fits), the scene's mentions with their candidates (id, name, tags), and the scene's relations.
- Few-shot: three topic-neutral synthetic examples stored as versioned few-shot data (`fewshots/boardBank.v1.ts`), labeled `illustrative-example`. They are never counted as generated results.
- The prompt version, schema hash, enum payload hash, and catalog version enter the S6 cache identity and run manifest.

## 7. Compile, layout, render, fallback

### 7.1 Board → ResolvedScene

A new `board/compile.ts` turns a validated board into the existing `ResolvedScene`:

- Icon node → `object` element with a pinned catalog entry (rung 2, the picked id).
- Label node → a new label-only visual: uppercase hand-lettered text, no box, no fill.
- Edge → existing `Edge` with `factualRelation` and derived evidence.
- Layout → existing template geometry: flow → `chain`, fan_out → `fan_out`, convergence → `convergence`, list → `list_icon`, compare → `compare_2`, cycle → `cycle`, hub → `hub_spoke`.
- `caption` → bottom-centred text element, revealed after the last node.

S8 layout, edge routing, S9 timeline, S10 `renderSVG`, and S11 encode are reused.

### 7.2 Simi composition tokens

Added to the style module as generic tokens (no topic data):

- Icon side 140–200 px at 1080p. When a scene has few nodes, scale up within that range.
- Uppercase label under the icon, or beside it for the `attribute` role.
- Short arrows with open arrowheads.
- Target content coverage 50–70% of the frame.
- Title centred at the top.

### 7.3 Deterministic fallback

After a failed repair, build a board from data only: one node per mention (icon = top candidate if above the high threshold, else `"label"`), edges from graph relations whose concepts both appear, layout chosen from the relation graph shape (single chain → flow; one source with many targets → fan_out; many sources to one target → convergence; otherwise list). The fallback stays a hard `planner-fallback` failure and can never pass.

## 8. Measurement and conclusion

Offline tests:

- Enum compiler: enums contain exactly the scene's mentions, candidates, and relations.
- Post-checks: each rule has a failing and a passing case.
- Ingest: `var(--sk-*)` resolution and per-region colour kept.
- Board compile + layout for every layout value.
- Topic-swap regression: same layout, different topic and values; no content from one appears in the other.
- Fallback: relation-aware edges and layout choice.

Deterministic metrics per scene (diagnostic, not acceptance): canvas coverage %, label-only node ratio, edge count, icon families per scene (must be 1), fallback count.

Paid run (explicit user approval required at execution time):

- Five new held-out sources not previously seen by this pipeline, 60 seconds each.
- S2–S4 stage cache may be reused, so S3 flakiness does not block the S6 test. Cache state is recorded.
- Outputs: MP4, contact sheets, and a side-by-side sheet against Simi frames.

Conclusion:

- The user watches the five videos and decides whether the hypothesis works.
- The result, run evidence, and limitations go to `docs/HANDOFF.md` and `docs/superpowers/specs/2026-09-26-board-schema-v2-conclusion.md`.
- Pipeline `status` semantics do not change: S5 remains a hard failure until the human alignment calibration exists, so no run is labeled `passed`. The user's review is recorded separately as the hypothesis verdict.

Phase 5 (only if the verdict is "works"): remove the v1 generated path — fixtures, example banks v1/v2, math primitives and their renderers, v1 recipe cards, and v1-only tests — keeping git history as the record.

## 9. Risks

- Coverage: abstract concepts become label-only nodes. Simi shows the same pattern for abstract terms.
- Grammar limits: enum size under Anthropic strict mode is unmeasured. Mitigation: ≤5 candidates per mention, ≤40 per scene; measured in the first paid scene.
- S3 reliability can stop runs before S6; the stage cache isolates the S6 test.
- Bulk approval quality: exact-name matches can still be visually wrong; a contact sheet of approved sketchy icons is generated for the user to skim before the paid run.

## 10. Constraints carried from CLAUDE.md

- No topic-specific runtime branches. All content comes from source-grounded data.
- Missing evidence, alignment, or assets stays a visible failure.
- Frozen plans, Simi references, and goldens are not edited.
- Commits only with the user's approval (granted in chat for this spec).
